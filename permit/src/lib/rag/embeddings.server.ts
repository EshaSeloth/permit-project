// Server-only meaning-based (semantic) similarity via embeddings from the configured AI provider.
// Document vectors are computed once per server instance and cached in memory.
import { AI_BASE_URL, EMBEDDING_MODEL, getAiApiKey } from "./gateway.server";
import type { Account, RagDocument } from "./types";

const BATCH_SIZE = 40;
const MAX_ATTEMPTS = 3;
const PAUSE_MS = 60_000;

type Vector = number[];

// After an embeddings failure, skip embeddings for a while instead of retrying on every request.
let embeddingsPausedUntil = 0;

async function postEmbeddings(apiKey: string, input: string[]): Promise<Vector[]> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${AI_BASE_URL}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });
    const retryable = response.status === 429 || response.status >= 500;
    if (!response.ok) {
      if (!retryable || attempt >= MAX_ATTEMPTS) throw new Error(`Embeddings failed: ${response.status} ${await response.text()}`);
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay + Math.random() * 300));
      continue;
    }
    const json = (await response.json()) as { data: { index?: number; embedding: Vector }[] };
    const ordered: (Vector | undefined)[] = Array.from({ length: input.length });
    // Some providers omit `index`; fall back to the item's position in the response.
    json.data?.forEach((item, i) => {
      ordered[item.index ?? i] = item.embedding;
    });
    if (ordered.some((v) => !v?.length)) {
      console.error("Embeddings response shape:", JSON.stringify(json).slice(0, 500));
      throw new Error("Embeddings response missing vectors");
    }
    return ordered as Vector[];
  }
}

async function embedAll(apiKey: string, texts: string[]): Promise<Vector[]> {
  const out: Vector[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) out.push(...(await postEmbeddings(apiKey, texts.slice(i, i + BATCH_SIZE))));
  return out.map(normalize);
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
    const [vectors, queryVectors] = await Promise.all([docVectors(apiKey, docs, accounts), embedAll(apiKey, queries)]);
    return queryVectors.map((q) => new Map(Array.from(vectors, ([id, v]) => [id, dot(q, v)])));
  } catch (error) {
    console.error("Semantic search unavailable, using keyword ranking only:", error);
    embeddingsPausedUntil = Date.now() + PAUSE_MS;
    return null;
  }
}
