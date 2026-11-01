import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";

import documents from "../../server-data/documents.json";
import { canAccess } from "./access";
import { ACCOUNTS, EVAL_QUESTIONS, USERS } from "./dataset";
import { AI_BASE_URL, AI_MODEL, getAiApiKey } from "./gateway.server";
import { semanticScores } from "./embeddings.server";
import { createRetriever } from "./retrieve";
import type { AskResult, RagDocument, RagUser, RetrievalReport, RetrievedDoc } from "./types";

const DOCS = documents as RagDocument[];
const retriever = createRetriever(DOCS, ACCOUNTS);

export class RagError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function getUser(username: string): RagUser {
  const user = USERS.find((u) => u.username === username);
  if (!user) throw new RagError("Unknown user", 400);
  return user;
}

const answerSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()),
  refused: z.boolean(),
  conflictNoted: z.boolean(),
});

const INSTRUCTIONS = `You are a permission-aware knowledge assistant for a subscription-billing company.
Answer ONLY from the SOURCES provided. They are the only documents this user is authorized to read.

Rules:
- Cite every factual claim inline with the source ID in square brackets, e.g. [TKT-1001]. List all cited IDs in "citations".
- Never cite or mention an ID that is not in SOURCES.
- If the sources do not contain the answer, set "refused" to true and reply that you cannot find this in the documents available to this user. Do not guess, and do not speculate about whether restricted documents exist.
- Only say information is unavailable or restricted if the retrieved documents truly lack it. Never describe a limitation as an access issue unless the user's role excludes those documents. If you cannot answer part of the question, say exactly what is missing.
- When the question compares customers, cover each customer separately using its own sources.
- If two sources disagree (for example a roadmap vs a newer Slack thread), describe both, prefer the more recently updated one, and set "conflictNoted" to true.
- Prefer current policies. Sources marked as superseded are never provided; do not invent older versions.
- If any cited source is L2 (Confidential), end with a short reminder not to share it externally.
- Be concise: 2 to 6 sentences, plain business language, no headings.`;

function formatSources(docs: RagDocument[]): string {
  return docs
    .map(
      (d) =>
        `<source id="${d.doc_id}" title="${d.title}" type="${d.source_type}" access="${d.access_level}" account="${d.account_id}" updated="${d.updated_at}">\n${d.content}\n</source>`,
    )
    .join("\n\n");
}

function toRetrievedDoc(doc: RagDocument, score: number): RetrievedDoc {
  return {
    docId: doc.doc_id,
    title: doc.title,
    sourceType: doc.source_type,
    accessLevel: doc.access_level,
    accountId: doc.account_id,
    updatedAt: doc.updated_at,
    score: Math.round(score * 100) / 100,
    content: doc.content,
  };
}

export async function answerQuestion(username: string, question: string): Promise<AskResult> {
  const user = getUser(username);
  // Meaning-based similarity for the reranker; falls back to keyword-only ranking if unavailable.
  const semantic = (await semanticScores([question], DOCS, ACCOUNTS))?.[0];
  const hits = retriever.search(user, question, { semantic });
  // Defense in depth: re-check permissions on the final context.
  const allowed = hits.filter((h) => canAccess(user, h.doc));
  const retrieved = allowed.map((h) => toRetrievedDoc(h.doc, h.score));
  const accessibleDocCount = retriever.accessibleCount(user);

  if (allowed.length === 0) {
    return {
      answer: "I can't find anything about this in the documents available to you.",
      citations: [],
      refused: true,
      conflictNoted: false,
      confidential: false,
      retrieved,
      accessibleDocCount,
    };
  }

  const apiKey = getAiApiKey();
  if (!apiKey) throw new RagError("AI is not configured. Set OPENAI_API_KEY on the server.", 500);

  const provider = createOpenAI({ baseURL: AI_BASE_URL, apiKey });

  const result = streamText({
    model: provider.responses(AI_MODEL),
    instructions: INSTRUCTIONS,
    prompt: `User role: ${user.role}\nQuestion: ${question}\n\nSOURCES:\n${formatSources(allowed.map((h) => h.doc))}`,
    output: Output.object({ schema: answerSchema }),
  });

  let parsed: z.infer<typeof answerSchema>;
  try {
    parsed = await result.output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new RagError("The AI returned an unreadable answer. Please try again.", 502);
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 402) throw new RagError("The AI provider quota is used up. Check billing on your provider account.", 402);
    if (status === 429) throw new RagError("Too many requests right now. Please wait a moment and retry.", 429);
    if (status === 403) throw new RagError("The AI provider rejected the request. Check the API key and its permissions.", 403);
    throw new RagError("The AI service failed to answer. Please try again.", status ?? 500);
  }

  // Strip any citation the model produced that was not in the authorized context.
  const allowedIds = new Set(allowed.map((h) => h.doc.doc_id));
  const inlineIds = Array.from(parsed.answer.matchAll(/\[([A-Z]{2,5}-\d{1,4})\]/g)).map((m) => m[1] ?? "");
  const citations = Array.from(new Set([...parsed.citations, ...inlineIds])).filter((id) => allowedIds.has(id));
  const confidential = allowed.some((h) => citations.includes(h.doc.doc_id) && h.doc.access_level === "L2");

  return {
    answer: parsed.answer,
    citations,
    refused: parsed.refused,
    conflictNoted: parsed.conflictNoted,
    confidential,
    retrieved,
    accessibleDocCount,
  };
}

/** Runs retrieval (no AI answers) for every question as every user and reports leaks. */
export async function runRetrievalReport(): Promise<RetrievalReport> {
  const semantic = await semanticScores(EVAL_QUESTIONS.map((q) => q.question), DOCS, ACCOUNTS);
  const runs: RetrievalReport["runs"] = [];
  const expectedRecall: RetrievalReport["expectedRecall"] = {};
  for (const [i, q] of EVAL_QUESTIONS.entries()) {
    for (const user of USERS) {
      const hits = retriever.search(user, q.question, { semantic: semantic?.[i] });
      const ids = hits.map((h) => h.doc.doc_id);
      const isAskingUser = user.username === q.askingUser;
      runs.push({
        qid: q.qid,
        username: user.username,
        retrievedIds: ids,
        permissionViolations: hits.filter((h) => !canAccess(user, h.doc)).map((h) => h.doc.doc_id),
        forbiddenHits: isAskingUser ? ids.filter((id) => q.forbiddenDocIds.includes(id)) : [],
        isAskingUser,
      });
      if (isAskingUser) {
        expectedRecall[q.qid] = {
          found: q.expectedDocIds.filter((id) => ids.includes(id)),
          missing: q.expectedDocIds.filter((id) => !ids.includes(id)),
        };
      }
    }
  }
  return { runs, expectedRecall };
}
