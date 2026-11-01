import type { AccessLevel, RagDocument, RagUser } from "./types";

const LEVEL_RANK: Record<AccessLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  L0: "Public",
  L1: "Internal",
  L2: "Confidential",
  L3: "Restricted",
};

export function levelRank(level: AccessLevel): number {
  return LEVEL_RANK[level];
}

/**
 * Effective clearance. Revoked users keep only public (L0) access,
 * regardless of the level recorded on their profile.
 */
export function effectiveLevel(user: RagUser): AccessLevel {
  return user.revoked ? "L0" : user.maxAccessLevel;
}

/** Account-scoped documents require the user's scope to be ALL or to match the account. */
export function canAccessAccount(user: RagUser, accountId: string): boolean {
  if (accountId === "ALL") return true;
  if (user.revoked || user.accountScope === "NONE") return false;
  return user.accountScope === "ALL" || user.accountScope === accountId;
}

/** The single permission gate. Applied before ranking, so restricted text never reaches the model. */
export function canAccess(user: RagUser, doc: Pick<RagDocument, "access_level" | "account_id">): boolean {
  return (
    levelRank(doc.access_level) <= levelRank(effectiveLevel(user)) && canAccessAccount(user, doc.account_id)
  );
}
