import { describe, expect, it } from "vitest";

import documents from "../server-data/documents.json";
import { canAccess } from "../lib/rag/access";
import { ACCOUNTS, EVAL_QUESTIONS, USERS } from "../lib/rag/dataset";
import { gradeAnswer } from "../lib/rag/evaluate";
import { createRetriever } from "../lib/rag/retrieve";
import type { RagDocument } from "../lib/rag/types";

const DOCS = documents as RagDocument[];
const user = (name: string) => USERS.find((u) => u.username === name)!;
const doc = (id: string) => DOCS.find((d) => d.doc_id === id)!;

describe("permission rules", () => {
  it("blocks an account manager from another account's documents", () => {
    expect(canAccess(user("am_meridian"), doc("CALL-002"))).toBe(false);
    expect(canAccess(user("am_brightpath"), doc("CALL-001"))).toBe(false);
  });

  it("allows an account manager to read their own account's confidential documents", () => {
    expect(canAccess(user("am_meridian"), doc("CALL-001"))).toBe(true);
  });

  it("blocks L2 confidential documents for an L1 support agent", () => {
    expect(canAccess(user("support1"), doc("SLK-001"))).toBe(false);
  });

  it("only lets the L3 executive read the restricted exec Slack thread", () => {
    const readers = USERS.filter((u) => canAccess(u, doc("SLK-002"))).map((u) => u.username);
    expect(readers).toEqual(["exec1"]);
  });

  it("limits the revoked ex-account manager to public L0 documents", () => {
    const visible = DOCS.filter((d) => canAccess(user("ex_am"), d));
    expect(visible.every((d) => d.access_level === "L0")).toBe(true);
    expect(canAccess(user("ex_am"), doc("POL-002"))).toBe(false);
  });
});

describe("retrieval leakage", () => {
  const retriever = createRetriever(DOCS, ACCOUNTS);

  it("never retrieves superseded documents", () => {
    const hits = retriever.search(user("exec1"), "discount approval policy account managers");
    expect(hits.map((h) => h.doc.doc_id)).not.toContain("POL-001");
  });

  it("has zero permission violations and zero forbidden hits across every question and user", () => {
    let violations = 0;
    let forbidden = 0;
    for (const q of EVAL_QUESTIONS) {
      for (const u of USERS) {
        const hits = retriever.search(u, q.question);
        violations += hits.filter((h) => !canAccess(u, h.doc)).length;
        if (u.username === q.askingUser) {
          forbidden += hits.filter((h) => q.forbiddenDocIds.includes(h.doc.doc_id)).length;
        }
      }
    }
    expect(violations).toBe(0);
    expect(forbidden).toBe(0);
  });

  it("represents every named customer in a comparison question", () => {
    const hits = retriever.search(user("pm1"), "Compare Meridian and Brightpath escalations");
    const accounts = hits.map((h) => h.doc.account_id);
    expect(accounts.filter((a) => a === "ACC-001").length).toBeGreaterThanOrEqual(2);
    expect(accounts.filter((a) => a === "ACC-002").length).toBeGreaterThanOrEqual(2);
  });

  it("still keeps a comparison inside the asking user's permissions", () => {
    const hits = retriever.search(user("am_meridian"), "Compare Meridian and Brightpath escalations");
    expect(hits.some((h) => h.doc.account_id === "ACC-002")).toBe(false);
  });

  it("returns at most 8 documents", () => {
    for (const q of EVAL_QUESTIONS) {
      expect(retriever.search(user(q.askingUser), q.question).length).toBeLessThanOrEqual(8);
    }
  });

  it("ranks documents containing a named feature request ID first", () => {
    const top = retriever.search(user("pm1"), "What is the status of FR-221?").slice(0, 2);
    expect(top.every((h) => h.doc.content.includes("FR-221"))).toBe(true);
  });

  it("finds both customers' tickets and the shared PRD for a two-customer audit log question", () => {
    const ids = retriever.search(user("pm1"), "What do Meridian and Brightpath both need around audit logs?").map((h) => h.doc.doc_id);
    expect(ids).toEqual(expect.arrayContaining(["TKT-901", "TKT-902", "PRD-001"]));
  });

  it("follows a customer's promise through to the shared roadmap and status update", () => {
    // Simulated meaning-based scores where the QBR call is the closest match to "promise".
    const semantic = new Map(DOCS.map((d) => [d.doc_id, d.doc_id === "CALL-001" ? 0.9 : 0.6]));
    const ids = retriever
      .search(user("am_meridian"), "What did we promise Meridian and where does it stand?", { semantic })
      .map((h) => h.doc.doc_id);
    expect(ids).toEqual(expect.arrayContaining(["CALL-001", "SLK-001", "RDM-001"]));
  });

  it("returns at most 8 documents with meaning-based scores too", () => {
    const semantic = new Map(DOCS.map((d, i) => [d.doc_id, (i % 17) / 17]));
    for (const q of EVAL_QUESTIONS) {
      expect(retriever.search(user(q.askingUser), q.question, { semantic }).length).toBeLessThanOrEqual(8);
    }
  });

  it("has zero permission violations with meaning-based scores that favour restricted documents", () => {
    // Scores rank L3/L2 docs highest to prove permissions are applied before ranking.
    const semantic = new Map(DOCS.map((d) => [d.doc_id, d.access_level === "L3" ? 1 : d.access_level === "L2" ? 0.8 : 0.1]));
    let violations = 0;
    for (const q of EVAL_QUESTIONS) {
      for (const u of USERS) {
        violations += retriever.search(u, q.question, { semantic }).filter((h) => !canAccess(u, h.doc)).length;
      }
    }
    expect(violations).toBe(0);
  });
});

describe("answer grading", () => {
  const q = EVAL_QUESTIONS.find((x) => x.qid === "Q37")!;
  const base = { conflictNoted: false, confidential: false, retrieved: [], accessibleDocCount: 1 };

  it("fails a must-refuse question when the answer cites the forbidden document", () => {
    const r = gradeAnswer(q, { ...base, answer: "Per [SLK-002] yes.", citations: ["SLK-002"], refused: false });
    expect(r.noLeak).toBe(false);
    expect(r.pass).toBe(false);
  });

  it("passes a must-refuse question when the assistant declines", () => {
    const r = gradeAnswer(q, { ...base, answer: "I can't find that.", citations: [], refused: true });
    expect(r.pass).toBe(true);
  });
});
