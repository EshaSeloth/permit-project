import { canAccess } from "./access";
import type { Account, RagDocument, RagUser } from "./types";

const STOPWORDS = new Set(
  "a an and are as at be by did do does for from give had has have how i in is it me of on or our per show so that the their this to us was we what when where which who why will with you your about there any my should get both around also".split(
    " ",
  ),
);

/** Light plural folding so "logs" matches "log" and "slips" matches "slip" (but not "status" or "access"). */
function fold(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(fold);
}

interface IndexedDoc {
  doc: RagDocument;
  tf: Map<string, number>;
  length: number;
}

export interface SearchOptions {
  /** Max results (capped at 8). */
  k?: number | undefined;
  /** Meaning-based similarity per doc ID (e.g. embedding cosine). When absent, ranking is keyword-only. */
  semantic?: Map<string, number> | undefined;
}

export interface Retriever {
  search(user: RagUser, query: string, options?: SearchOptions): { doc: RagDocument; score: number }[];
  accessibleCount(user: RagUser): number;
}

type Hit = { doc: RagDocument; score: number };

/** Candidates pulled per search before reranking, and the final context size. */
const CANDIDATES = 15;
const MIN_RESULTS = 6;
const MAX_RESULTS = 8;
/** Guaranteed slots per named customer in comparison questions; the rest go to the best remaining matches. */
const PER_CUSTOMER_QUOTA = 2;
const DOC_ID_PATTERN = /\b[A-Z]{2,5}-\d{1,4}\b/gi;
const ALL_CUSTOMERS_PATTERN = /\b(all|each|every|across|both|multiple|other)\s+(of\s+our\s+|of\s+the\s+)?(customers|accounts|clients)\b/i;

/** Customer accounts a question names (full name or first word), or all of them for "all/each/both customers". */
export function detectCustomers(query: string, accounts: Account[]): Account[] {
  if (ALL_CUSTOMERS_PATTERN.test(query)) return accounts;
  const q = query.toLowerCase();
  return accounts.filter((a) => {
    const first = a.name.toLowerCase().split(/\s+/)[0] ?? "";
    return q.includes(a.name.toLowerCase()) || (first.length > 3 && new RegExp(`\\b${first}\\b`).test(q));
  });
}

/** Specific terms to match literally: doc / feature request IDs and adjacent-word phrases like "audit log". */
function keyTerms(query: string, ignore: Set<string>): { ids: string[]; phrases: string[]; words: string[] } {
  const ids = Array.from(new Set((query.match(DOC_ID_PATTERN) ?? []).map((m) => m.toLowerCase())));
  // Customer names are handled by customer matching, so they don't count as specific terms here.
  const words = tokenize(query.replace(DOC_ID_PATTERN, " ")).filter((w) => !ignore.has(w));
  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i++) phrases.push(`${words[i]} ${words[i + 1]}`);
  return { ids, phrases: Array.from(new Set(phrases)), words: Array.from(new Set(words)) };
}

/**
 * Hybrid retriever. Permission filtering and superseded-document exclusion happen first, so every
 * later step only sees documents the user may read. Then:
 *  1. Candidate recall: top 15 by keyword relevance (BM25) and top 15 by meaning (when available),
 *     once for the whole question and once per named customer for comparison questions.
 *  2. Rerank: meaning + keyword relevance + exact ID / phrase / term matches, keeping the best 8.
 */
export function createRetriever(docs: RagDocument[], accounts: Account[]): Retriever {
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const customerTokens = new Set(accounts.flatMap((a) => tokenize(a.name)));
  const indexed: IndexedDoc[] = docs.map((doc) => {
    const account = accountNames.get(doc.account_id) ?? "";
    const text = `${doc.title} ${doc.title} ${account} ${doc.source_type} ${doc.department} ${doc.content}`;
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { doc, tf, length: tokens.length };
  });
  // Normalized text (same tokenization) for literal phrase checks, plus raw lowercase text for ID checks.
  const phraseText = new Map(indexed.map((d) => [d.doc.doc_id, ` ${tokenize(`${d.doc.title} ${d.doc.content}`).join(" ")} `]));
  const rawText = new Map(indexed.map((d) => [d.doc.doc_id, `${d.doc.doc_id} ${d.doc.title} ${d.doc.content}`.toLowerCase()]));
  const avgLen = indexed.reduce((s, d) => s + d.length, 0) / Math.max(indexed.length, 1);
  const df = new Map<string, number>();
  for (const d of indexed) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const N = indexed.length;

  const eligible = (user: RagUser) => indexed.filter((d) => !d.doc.superseded_by && canAccess(user, d.doc));

  function bm25(pool: IndexedDoc[], qTokens: string[], limit: number): Hit[] {
    const k1 = 1.4;
    const b = 0.75;
    return pool
      .map((d) => {
        let score = 0;
        for (const t of qTokens) {
          const f = d.tf.get(t);
          if (!f) continue;
          const n = df.get(t) ?? 0;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.length) / avgLen));
        }
        return { doc: d.doc, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, limit);
  }

  function semanticTop(pool: IndexedDoc[], semantic: Map<string, number> | undefined, limit: number): IndexedDoc[] {
    if (!semantic) return [];
    return [...pool].sort((a, b2) => (semantic.get(b2.doc.doc_id) ?? 0) - (semantic.get(a.doc.doc_id) ?? 0)).slice(0, limit);
  }

  /** A document's highest tf-idf terms, ignoring customer names and numbers. */
  function distinctiveTerms(docId: string, n: number): string[] {
    const d = indexed.find((x) => x.doc.doc_id === docId);
    if (!d) return [];
    return Array.from(d.tf, ([t, f]) => ({ t, w: f * Math.log(N / (df.get(t) ?? 1)) }))
      .filter((x) => !customerTokens.has(x.t) && !/^\d+$/.test(x.t) && x.t.length > 2)
      .sort((a, b2) => b2.w - a.w)
      .slice(0, n)
      .map((x) => x.t);
  }

  /** 0..1 score for literal matches of IDs (weighted highest), phrases and individual terms. */
  function keywordScore(doc: RagDocument, terms: ReturnType<typeof keyTerms>): number {
    const raw = rawText.get(doc.doc_id) ?? "";
    const text = phraseText.get(doc.doc_id) ?? "";
    let got = 0;
    let max = 0;
    for (const id of terms.ids) {
      max += 3;
      if (raw.includes(id)) got += 3;
    }
    for (const p of terms.phrases) {
      max += 2;
      if (text.includes(` ${p} `)) got += 2;
    }
    for (const w of terms.words) {
      max += 1;
      if (text.includes(` ${w} `)) got += 1;
    }
    return max === 0 ? 0 : got / max;
  }

  return {
    accessibleCount: (user) => eligible(user).length,
    search(user, query, options = {}) {
      const { k = MAX_RESULTS, semantic } = options;
      const qTokens = Array.from(new Set(tokenize(query)));
      if (qTokens.length === 0) return [];
      const customers = detectCustomers(query, accounts);
      const namedIds = new Set(customers.map((c) => c.id));
      // A question about specific customers looks at those customers' documents plus shared ones,
      // never at other customers' documents. (Permissions were already applied by `eligible`.)
      const pool = eligible(user).filter(
        (d) => customers.length === 0 || d.doc.account_id === "ALL" || namedIds.has(d.doc.account_id),
      );
      // Customer names match every document of that customer, so they would drown out the specific
      // terms. Drop them from keyword search when the question has anything else to go on.
      const topicTokens = qTokens.filter((t) => !customerTokens.has(t));
      const searchTokens = customers.length > 0 && topicTokens.length > 0 ? topicTokens : qTokens;

      // 1) Candidate recall.
      const candidates = new Map<string, number>(); // doc ID -> best BM25 score (0 if found by meaning only)
      const add = (hits: Hit[]) => {
        for (const h of hits) candidates.set(h.doc.doc_id, Math.max(candidates.get(h.doc.doc_id) ?? 0, h.score));
      };
      const addSemantic = (ds: IndexedDoc[]) => {
        for (const d of ds) if (!candidates.has(d.doc.doc_id)) candidates.set(d.doc.doc_id, 0);
      };
      add(bm25(pool, searchTokens, CANDIDATES));
      addSemantic(semanticTop(pool, semantic, CANDIDATES));
      const isComparison = customers.length >= 2;
      const perCustomer = new Map<string, Set<string>>();
      if (isComparison) {
        const per = Math.ceil(CANDIDATES / customers.length);
        for (const c of customers) {
          const own = pool.filter((d) => d.doc.account_id === c.id);
          // Include this customer's own name so its documents are still represented when no topic term matches.
          const hits = bm25(own, Array.from(new Set([...searchTokens, ...tokenize(c.name)])), per);
          const sem = semanticTop(own, semantic, per);
          add(hits);
          addSemantic(sem);
          perCustomer.set(c.id, new Set([...hits.map((h) => h.doc.doc_id), ...sem.map((d) => d.doc.doc_id)]));
        }
      }
      if (candidates.size === 0) return [];

      // 2) Rerank: meaning (normalized), BM25 relevance (normalized) and exact keyword / phrase / ID matches.
      const terms = keyTerms(query, customerTokens);
      const byId = new Map(pool.map((d) => [d.doc.doc_id, d.doc]));
      const maxBm25 = Math.max(...candidates.values(), 1e-9);
      const semValues = semantic ? pool.map((d) => semantic.get(d.doc.doc_id) ?? 0) : [];
      const semMin = semValues.length ? Math.min(...semValues) : 0;
      const semMax = semValues.length ? Math.max(...semValues) : 0;
      const semNorm = (id: string) =>
        semantic && semMax > semMin ? ((semantic.get(id) ?? semMin) - semMin) / (semMax - semMin) : 0;
      const reranked = Array.from(candidates, ([id, raw]) => {
        const doc = byId.get(id)!;
        const bm = raw / maxBm25;
        const kw = keywordScore(doc, terms);
        const score = semantic ? 0.45 * semNorm(id) + 0.35 * bm + 0.2 * kw : 0.6 * bm + 0.4 * kw;
        return { doc, bm25: bm, score };
      }).sort((a, b2) => b2.score - a.score);

      // Follow-up hop: a customer conversation often refers to a shared topic (e.g. a call that promised
      // an SSO date). Search shared documents with the top customer document's most distinctive terms so
      // the current status of that topic (roadmap, PRD, Slack update) is found even when it never names the customer.
      const seed = reranked.find((r) => r.doc.account_id !== "ALL");
      if (seed && customers.length > 0) {
        const seedTerms = distinctiveTerms(seed.doc.doc_id, 8);
        const shared = pool.filter((d) => d.doc.account_id === "ALL");
        const hop = bm25(shared, seedTerms, 3);
        const maxHop = hop[0]?.score ?? 0;
        for (const [i, h] of hop.entries()) {
          if (h.score < maxHop * 0.4) continue;
          // Rank strongly related shared docs right after the document that referred to them.
          const score = seed.score * (0.97 - 0.02 * i);
          const existing = reranked.find((r) => r.doc.doc_id === h.doc.doc_id);
          if (existing) existing.score = Math.max(existing.score, score);
          else reranked.push({ doc: h.doc, bm25: 0, score });
        }
        reranked.sort((a, b2) => b2.score - a.score);
      }

      // 3) Keep the best 8: everything reasonably close to the top match, padded to 6 if needed.
      const limit = Math.max(1, Math.min(k, MAX_RESULTS));
      const top = reranked[0]?.score ?? 0;
      let picked = reranked.filter((r) => r.score >= top * 0.3).slice(0, limit);
      if (picked.length < Math.min(MIN_RESULTS, limit)) {
        const extra = reranked.filter((r) => !picked.includes(r) && (semantic ? r.score >= top * 0.15 : r.bm25 >= 0.15));
        picked = [...picked, ...extra].slice(0, Math.min(MIN_RESULTS, limit));
      }

      // Comparison questions: guarantee each named customer a couple of its own best documents,
      // then fill the remaining slots by overall relevance (which leaves room for shared docs like PRDs).
      if (isComparison) {
        const balanced: typeof reranked = [];
        for (const c of customers) {
          const own = perCustomer.get(c.id) ?? new Set<string>();
          balanced.push(...reranked.filter((r) => own.has(r.doc.doc_id) && !balanced.includes(r)).slice(0, PER_CUSTOMER_QUOTA));
        }
        for (const r of reranked) if (balanced.length < limit && !balanced.includes(r) && r.score >= top * 0.3) balanced.push(r);
        picked = balanced.slice(0, Math.max(limit, customers.length * PER_CUSTOMER_QUOTA)).sort((x, y) => y.score - x.score);
      }

      return picked.map((r) => ({ doc: r.doc, score: r.score }));
    },
  };
}
