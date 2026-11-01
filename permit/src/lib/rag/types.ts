export type AccessLevel = "L0" | "L1" | "L2" | "L3";

export interface RagUser {
  username: string;
  role: string;
  department: string;
  /** "ALL", "NONE", or a single account ID such as "ACC-001". */
  accountScope: string;
  maxAccessLevel: AccessLevel;
  revoked: boolean;
}

export interface Account {
  id: string;
  name: string;
  segment: string;
}

export interface RagDocument {
  doc_id: string;
  title: string;
  source_type: string;
  account_id: string;
  department: string;
  access_level: AccessLevel;
  origin: string;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
  content: string;
}

export type EvalCategory = "easy_lookup" | "synthesis" | "conflict" | "stale" | "must_refuse";

export interface EvalQuestion {
  qid: string;
  category: EvalCategory | string;
  askingUser: string;
  question: string;
  expectedDocIds: string[];
  forbiddenDocIds: string[];
  expectedBehavior: string;
  referenceAnswer: string;
}

/** Metadata about a retrieved document that is safe to show to the user who retrieved it. */
export interface RetrievedDoc {
  docId: string;
  title: string;
  sourceType: string;
  accessLevel: AccessLevel;
  accountId: string;
  updatedAt: string;
  score: number;
  /** Full text, included only for documents already permitted for the asking user. */
  content: string;
}

export interface AskResult {
  answer: string;
  citations: string[];
  refused: boolean;
  conflictNoted: boolean;
  confidential: boolean;
  retrieved: RetrievedDoc[];
  accessibleDocCount: number;
}

export interface RetrievalRun {
  qid: string;
  username: string;
  retrievedIds: string[];
  /** Retrieved docs that this user is not permitted to see. Must always be empty. */
  permissionViolations: string[];
  /** forbidden_doc_ids hits for the asking user. Must always be empty. */
  forbiddenHits: string[];
  isAskingUser: boolean;
}

export interface RetrievalReport {
  runs: RetrievalRun[];
  expectedRecall: Record<string, { found: string[]; missing: string[] }>;
}
