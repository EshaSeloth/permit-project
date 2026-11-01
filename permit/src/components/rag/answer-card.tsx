import { SBadge } from "@/components/ui-kit";
import { Fragment, useState } from "react";

import { CenteredModal } from "@/components/centered-modal";
import { ACCOUNTS } from "@/lib/rag/dataset";
import { displayName } from "@/lib/rag/display";
import type { AskResult, RetrievedDoc } from "@/lib/rag/types";
import { AccessBadge } from "./access-badge";

export interface ConversationTurn {
  id: string;
  username: string;
  question: string;
  status: "pending" | "done" | "error";
  result?: AskResult;
  error?: string;
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  ticket: "Ticket",
  slack: "Slack",
  call: "Call",
  prd: "PRD",
  policy: "Policy",
  docs: "Product docs",
  release_note: "Release note",
  roadmap: "Roadmap",
};

function customerLabel(accountId: string): string {
  if (accountId === "ALL") return "All customers";
  return ACCOUNTS.find((a) => a.id === accountId)?.name ?? accountId;
}

const CHIP_CLASS =
  "mx-0.5 inline-flex rounded bg-accent px-1.5 align-baseline leading-5 font-mono text-[11px] font-medium text-accent-foreground";

/** Renders answer text with [DOC-ID] markers turned into citation chips. Only permitted, retrieved docs are clickable. */
function AnswerText({ text, openable, onOpen }: { text: string; openable: Set<string>; onOpen: (docId: string) => void }) {
  const parts = text.split(/(\[[A-Z]{2,5}-\d{1,4}\])/g);
  return (
    <p className="text-[15px] leading-7 text-foreground">
      {parts.map((part, i) => {
        if (!/^\[[A-Z]{2,5}-\d{1,4}\]$/.test(part)) return <Fragment key={i}>{part}</Fragment>;
        const id = part.slice(1, -1);
        return openable.has(id) ? (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(id)}
            aria-haspopup="dialog"
            aria-label={`Open source ${id}`}
            className={`${CHIP_CLASS} cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          >
            {id}
          </button>
        ) : (
          <span key={i} className={CHIP_CLASS}>
            {id}
          </span>
        );
      })}
    </p>
  );
}

function SourceDocModal({ doc, cited, onClose }: { doc: RetrievedDoc | undefined; cited: boolean; onClose: () => void }) {
  return (
    <CenteredModal
      open={Boolean(doc)}
      onClose={onClose}
      title={
        doc && (
          <>
            <span className="mr-2 font-mono text-xs font-normal text-muted-foreground">{doc.docId}</span>
            {doc.title}
          </>
        )
      }
    >
      {doc && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SBadge variant="neutral" mode="light">
              {SOURCE_TYPE_LABEL[doc.sourceType] ?? doc.sourceType}
            </SBadge>
            <AccessBadge level={doc.accessLevel} />
            <SBadge variant="neutral" mode="light">
              {customerLabel(doc.accountId)}
            </SBadge>
            <SBadge variant="neutral" mode="light">
              Updated {doc.updatedAt}
            </SBadge>
            {cited && (
              <SBadge variant="primary" mode="light">
                Cited in this answer
              </SBadge>
            )}
          </div>
          <p className="whitespace-pre-wrap leading-6 text-foreground">{doc.content}</p>
        </>
      )}
    </CenteredModal>
  );
}

export function AnswerCard({ turn }: { turn: ConversationTurn }) {
  const r = turn.result;
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  // Only documents already in this answer's permitted results can be opened.
  const openDoc = r?.retrieved.find((d) => d.docId === openDocId);
  const openable = new Set(r?.retrieved.map((d) => d.docId) ?? []);
  const citesRestricted = Boolean(r?.retrieved.some((d) => d.accessLevel === "L3" && r.citations.includes(d.docId)));
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/50 px-4 py-3 sm:px-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Asked as {displayName(turn.username)}</p>
        <p className="mt-1 break-words font-medium text-foreground">{turn.question}</p>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {turn.status === "pending" && (
          <div className="space-y-2" aria-live="polite">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <p className="text-sm text-muted-foreground">Searching permitted documents…</p>
          </div>
        )}

        {turn.status === "error" && (
          <div className="rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive">
            {turn.error}
          </div>
        )}

        {r && (
          <>
            <div className="flex flex-wrap gap-2">
              {r.citations.length === 0 ? (
                <SBadge variant="neutral" mode="outline">Not found in your documents</SBadge>
              ) : (
                <SBadge variant="success" mode="light">Answered from {r.citations.length} source{r.citations.length === 1 ? "" : "s"}</SBadge>
              )}
              {r.conflictNoted && <SBadge variant="warning" mode="light">Conflicting sources surfaced</SBadge>}
              {r.confidential && <SBadge variant="danger" mode="light">Confidential – internal only</SBadge>}
            </div>

            <AnswerText text={r.answer} openable={openable} onOpen={setOpenDocId} />

            {citesRestricted && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm font-medium text-destructive">
                This answer uses Restricted (L3) sources. Do not share it outside leadership.
              </div>
            )}

            {r.confidential && (
              <div className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">
                This answer uses L2 confidential sources. Do not share it with customers or outside the company.
              </div>
            )}

            <details className="group min-w-0 rounded-md border border-border">
              <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                {r.retrieved.length} retrieved of {r.accessibleDocCount} documents this user can access
              </summary>
              <div className="overflow-x-auto border-t border-border">
              <ul className="min-w-[560px] divide-y divide-border">
                {r.retrieved.map((d) => (
                  <li key={d.docId}>
                    <button
                      type="button"
                      onClick={() => setOpenDocId(d.docId)}
                      aria-haspopup="dialog"
                      className="flex w-full cursor-pointer items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{d.docId}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{d.title}</span>
                      {r.citations.includes(d.docId) && <SBadge variant="primary" mode="light">Cited</SBadge>}
                      <AccessBadge level={d.accessLevel} />
                      <span className="shrink-0 text-xs text-muted-foreground">Updated {d.updatedAt}</span>
                    </button>
                  </li>
                ))}
                {r.retrieved.length === 0 && (
                  <li className="px-4 py-3 text-sm text-muted-foreground">No permitted documents matched this question.</li>
                )}
              </ul>
              </div>
            </details>

            <SourceDocModal
              doc={openDoc}
              cited={Boolean(openDoc && r.citations.includes(openDoc.docId))}
              onClose={() => setOpenDocId(null)}
            />
          </>
        )}
      </div>
    </article>
  );
}
