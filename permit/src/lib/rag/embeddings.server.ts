// Server-only meaning-based (semantic) similarity via embeddings from the configured AI provider.
// Document vectors are computed once per server instance and cached in memory.
import { AI_BASE_URL, EMBEDDING_MODEL, getAiApiKey } from "./gateway.server";
import type { Account, RagDocument } from "./types";

const BATCH_SIZE = 20;
const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;
const PAUSE_MS = 30_000;
const QUERY_CACHE_LIMIT = 200;

type Vector = number[];
type EmbeddingsResponse = {
  data?: { index?: number; embedding?: Vector }[];
  error?: unknown;
};

// After an embeddings failure, skip embeddings briefly instead of retrying on every request.
let embeddingsPausedUntil = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postEmbeddings(apiKey: string, input: string[]): Promise<Vector[]> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${AI_BASE_URL}/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Network error or timeout: retry a couple of times, then give up.
      if (attempt >= MAX_ATTEMPTS) throw error;
      await sleep(500 * 2 ** attempt + Math.random() * 300);
      continue;
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`Embeddings failed: ${response.status} ${await response.text()}`);
      }
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 500 * 2 ** attempt;
      await sleep(delay + Math.random() * 300);
      continue;
    }

    const json = (await response.json()) as EmbeddingsResponse;
    const items = Array.isArray(json.data) ? json.data : [];

    // Use `index` only if every item has a valid one; otherwise trust response order.
    const hasValidIndexes =
      items.length === input.length &&
      items.every((it) => Number.isInteger(it.index) && (it.index as number) >= 0 && (it.index as number) < input.length);

    const ordered: (Vector | undefined)[] = Array.from({ length: input.length });
    items.forEach((item, i) => {
      const position = hasValidIndexes ? (item.index as number) : i;
      if (position < input.length) ordered[position] = item.embedding;
    });

    if (ordered.some((v) => !Array.isArray(v) || v.length === 0)) {
      console.error(
        `Embeddings response problem: sent ${input.length} inputs, got ${items.length} items. Shape:`,
        JSON.stringify(json).slice(0, 500),
      );
      throw new Error("Embeddings response missing vectors");
    }
    return ordered as Vector[];
  }
}

function normalize(v: Vector): Vector {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/** Embeds all texts, sending up to CONCURRENCY batches at a time. Output order matches input order. */
async function embedAll(apiKey: string, texts: string[]): Promise<Vector[]> {
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) batches.push(texts.slice(i, i + BATCH_SIZE));

  const results: Vector[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= batches.length) return;
      results[i] = await postEmbeddings(apiKey, batches[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return results.flat().map(normalize);
}

// Small in-memory cache so repeated queries (e.g. during evals) are not re-embedded.
const queryCache = new Map<string, Vector>();

async function embedQueries(apiKey: string, queries: string[]): Promise<Vector[]> {
  const missing = Array.from(new Set(queries.filter((q) => !queryCache.has(q))));
  if (missing.length > 0) {
    const vectors = await embedAll(apiKey, missing);
    missing.forEach((q, i) => {
      if (queryCache.size >= QUERY_CACHE_LIMIT) {
        const oldest = queryCache.keys().next().value;
        if (oldest !== undefined) queryCache.delete(oldest);
      }
      queryCache.set(q, vectors[i]!);
    });
  }
  return queries.map((q) => queryCache.get(q)!);
}

let docVectorsPromise: Promise<Map<string, Vector>> | null = null;

function docVectors(apiKey: string, docs: RagDocument[], accounts: Account[]): Promise<Map<string, Vector>> {
  if (!docVectorsPromise) {
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const texts = docs.map((d) => `${d.title}\nCustomer: ${names.get(d.account_id) ?? "All customers"}\n${d.content}`);
    docVectorsPromise = embedAll(apiKey, texts)
      .then((vectors) => new Map(docs.map((d, i) => [d.doc_id, vectors[i] ?? []])))
      .catch((error) => {
        docVectorsPromise = null; // allow a later request to try again
        throw error;
      });
  }
  return docVectorsPromise;
}

/**
 * Cosine similarity of each query to every document (doc ID -> similarity).
 * Returns null when embeddings are unavailable so callers fall back to keyword-only ranking.
 * Similarities are computed for all documents; permission filtering still happens in the retriever.
 */
export async function semanticScores(
  queries: string[],
  docs: RagDocument[],
  accounts: Account[],
): Promise<Map<string, number>[] | null> {
  const apiKey = getAiApiKey();
  if (!apiKey || queries.length === 0) return null;
  if (Date.now() < embeddingsPausedUntil) return null;
  try {
    const [vectors, queryVectors] = await Promise.all([
      docVectors(apiKey, docs, accounts),
      embedQueries(apiKey, queries),
    ]);
    return queryVectors.map((q) => new Map(Array.from(vectors, ([id, v]) => [id, dot(q, v)])));
  } catch (error) {
    console.error("Semantic search unavailable, using keyword ranking only:", error);
    embeddingsPausedUntil = Date.now() + PAUSE_MS;
    return null;
  }
}
