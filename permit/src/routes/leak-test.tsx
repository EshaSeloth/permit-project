import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { SBadge, SButton, SIcon } from "@/components/ui-kit";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { CenteredModal } from "@/components/centered-modal";
import { EVAL_QUESTIONS, USERS } from "@/lib/rag/dataset";
import { displayName } from "@/lib/rag/display";
import { gradeAnswer, type AiEvalCheck } from "@/lib/rag/evaluate";
import { askQuestion, getRetrievalReport } from "@/lib/rag/rag.functions";
import type { AskResult, EvalQuestion, RetrievalReport, RetrievalRun } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const reportQuery = queryOptions({
  queryKey: ["retrieval-report"],
  queryFn: () => getRetrievalReport(),
  staleTime: Infinity,
});

export const Route = createFileRoute("/leak-test")({
  // Rendered in the browser only: the design system packages require the DOM at import time.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Leak test · Permission-Aware Knowledge" },
      { name: "description", content: "Run every test question as every user and confirm no restricted document is ever retrieved or cited." },
      { property: "og:title", content: "Leak test · Permission-Aware Knowledge" },
      { property: "og:description", content: "Run every test question as every user and confirm no restricted document is ever retrieved or cited." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(reportQuery),
  component: LeakTestPage,
});

const CATEGORY_LABEL: Record<string, string> = {
  easy_lookup: "Lookup",
  synthesis: "Synthesis",
  conflict: "Conflicting sources",
  stale: "Stale info",
  must_refuse: "Must refuse",
};
const CATEGORY_ORDER = ["easy_lookup", "synthesis", "conflict", "stale", "must_refuse"];

const STORAGE_KEY = "permit.leak-test.last-run";

interface EvalRow {
  status: "idle" | "running" | "done" | "error";
  result?: AskResult;
  check?: AiEvalCheck;
  error?: string;
}

interface StoredRun {
  at: string;
  rows: Record<string, EvalRow>;
}

function loadStoredRun(): StoredRun | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredRun) : null;
  } catch {
    return null;
  }
}

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function failureReason(row: EvalRow): string {
  if (row.status === "error") return row.error ?? "Request failed";
  if (!row.check) return "";
  if (!row.check.noLeak) return `Leaked ${row.check.forbiddenMentioned.join(", ")}`;
  return row.check.note;
}

function isFailed(row: EvalRow | undefined): boolean {
  return !!row && (row.status === "error" || (row.status === "done" && !row.check?.pass));
}

function ToggleButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SIcon name={open ? "chevron-up" : "chevron-down"} size={16} />
      {open ? children.replace(/^(View|Show)/, "Hide") : children}
    </button>
  );
}

function LeakTestPage() {
  const { data: report } = useSuspenseQuery(reportQuery);
  const ev = useAiEvaluation();

  const violations = report.runs.reduce((s, r) => s + r.permissionViolations.length, 0);
  const forbidden = report.runs.reduce((s, r) => s + r.forbiddenHits.length, 0);
  const totalLeaks = violations + forbidden;
  const recall = Object.values(report.expectedRecall);
  const found = recall.reduce((s, r) => s + r.found.length, 0);
  const expected = recall.reduce((s, r) => s + r.found.length + r.missing.length, 0);
  const recallPct = expected ? Math.round((found / expected) * 100) : 0;
  const clean = totalLeaks === 0;

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-10 px-4 py-8 sm:px-6">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leak test</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every test question is run as every user. Pass means no restricted document was retrieved or cited.
          </p>
        </div>
        <div
          role="status"
          className={cn(
            "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
            clean ? "border-success/30 bg-success-soft text-success" : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <span className="shrink-0">
            <SIcon name={clean ? "circle-check" : "circle-x"} size={20} />
          </span>
          <p className="min-w-0 font-medium">
            {totalLeaks} permission violation{totalLeaks === 1 ? "" : "s"} in {report.runs.length} searches · Retrieval
            recall {recallPct}% ·{" "}
            {ev.doneCount > 0 ? `AI answers ${ev.passed} of ${ev.doneCount} passed` : "AI answers not run yet"}
          </p>
        </div>
      </header>

      <SearchResults report={report} />
      <AiEvaluationSection ev={ev} />
    </div>
  );
}

function SearchResults({ report }: { report: RetrievalReport }) {
  const [showGrid, setShowGrid] = useState(false);

  const byKey = useMemo(() => {
    const m = new Map<string, RetrievalRun>();
    for (const r of report.runs) m.set(`${r.qid}:${r.username}`, r);
    return m;
  }, [report]);

  const perUser = useMemo(
    () =>
      USERS.map((u) => {
        const runs = report.runs.filter((r) => r.username === u.username);
        const violations = runs.reduce((s, r) => s + r.permissionViolations.length + r.forbiddenHits.length, 0);
        let found = 0;
        let expected = 0;
        for (const q of EVAL_QUESTIONS) {
          if (q.askingUser !== u.username) continue;
          const rec = report.expectedRecall[q.qid];
          if (!rec) continue;
          found += rec.found.length;
          expected += rec.found.length + rec.missing.length;
        }
        return { username: u.username, searches: runs.length, violations, found, expected };
      }),
    [report],
  );

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">Search results by user</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 text-right font-medium">Searches run</th>
              <th className="px-4 py-2.5 text-right font-medium">Violations</th>
              <th className="px-4 py-2.5 text-right font-medium">Expected sources found</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {perUser.map((u) => (
              <tr key={u.username}>
                <td className="px-4 py-2.5 font-medium text-foreground">{displayName(u.username)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{u.searches}</td>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right font-medium tabular-nums",
                    u.violations === 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {u.violations}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                  {u.expected ? `${u.found}/${u.expected}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ToggleButton open={showGrid} onClick={() => setShowGrid((v) => !v)}>
        {`View all ${EVAL_QUESTIONS.length} questions`}
      </ToggleButton>

      {showGrid && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Number of documents retrieved per run. The outlined cell is the user the question was written for.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Question</th>
                  {USERS.map((u) => (
                    <th key={u.username} className="px-2 py-2.5 text-center font-medium">
                      {displayName(u.username)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {EVAL_QUESTIONS.map((q) => (
                  <tr key={q.qid}>
                    <td className="max-w-md px-4 py-2">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">{q.qid}</span>
                      <span className="text-foreground">{q.question}</span>
                    </td>
                    {USERS.map((u) => {
                      const run = byKey.get(`${q.qid}:${u.username}`);
                      const bad = !!run && (run.permissionViolations.length > 0 || run.forbiddenHits.length > 0);
                      return (
                        <td key={u.username} className="px-2 py-2 text-center">
                          <span
                            title={run?.retrievedIds.join(", ") || "No documents"}
                            className={cn(
                              "inline-flex h-7 min-w-9 items-center justify-center rounded-md px-2 text-xs font-medium tabular-nums",
                              bad ? "bg-destructive text-destructive-foreground" : "bg-success-soft text-success",
                              run?.isAskingUser && "outline outline-2 outline-offset-1 outline-primary",
                            )}
                          >
                            {bad ? "Leak" : (run?.retrievedIds.length ?? 0)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function useAiEvaluation() {
  const ask = useServerFn(askQuestion);
  const [rows, setRows] = useState<Record<string, EvalRow>>({});
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Restore the last completed run after mount (browser storage is not available during render).
  useEffect(() => {
    const stored = loadStoredRun();
    if (stored) {
      setRows(stored.rows);
      setLastRunAt(stored.at);
    }
  }, []);

  async function run() {
    setRunning(true);
    stopRef.current = false;
    setRows({});
    const queue = [...EVAL_QUESTIONS];
    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const q = queue.shift()!;
        setRows((p) => ({ ...p, [q.qid]: { status: "running" } }));
        try {
          const res = await ask({ data: { username: q.askingUser, question: q.question } });
          if (!res.ok) {
            setRows((p) => ({ ...p, [q.qid]: { status: "error", error: res.error } }));
            // Credit or access problems are terminal: stop the whole run.
            if (res.status === 402 || res.status === 403) stopRef.current = true;
            continue;
          }
          setRows((p) => ({ ...p, [q.qid]: { status: "done", result: res.result, check: gradeAnswer(q, res.result) } }));
        } catch {
          setRows((p) => ({ ...p, [q.qid]: { status: "error", error: "Request failed" } }));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);

    // Persist finished rows so the results survive a page reload.
    const finished = Object.fromEntries(
      Object.entries(rowsRef.current).filter(([, r]) => r.status === "done" || r.status === "error"),
    );
    if (Object.keys(finished).length) {
      const at = new Date().toISOString();
      setRows(finished);
      setLastRunAt(at);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ at, rows: finished } satisfies StoredRun));
      } catch {
        // Storage full or unavailable: results stay visible until reload.
      }
    }
  }

  const done = Object.values(rows).filter((r) => r.status === "done");
  return {
    rows,
    running,
    lastRunAt,
    run,
    stop: () => (stopRef.current = true),
    doneCount: done.length,
    passed: done.filter((r) => r.check?.pass).length,
  };
}

type Evaluation = ReturnType<typeof useAiEvaluation>;

function ResultBadge({ row }: { row: EvalRow | undefined }) {
  if (!row) return <span className="text-xs text-muted-foreground">Not run</span>;
  if (row.status === "running") return <SBadge variant="info" mode="light">Running</SBadge>;
  if (row.status === "error")
    return (
      <SBadge variant="danger" mode="outline" title={row.error}>
        Error
      </SBadge>
    );
  if (row.check)
    return (
      <SBadge variant={row.check.pass ? "success" : "warning"} mode="dark">
        {row.check.pass ? "Pass" : "Review"}
      </SBadge>
    );
  return null;
}

function clickableRowProps(row: EvalRow | undefined, qid: string, onOpen: (qid: string) => void) {
  const clickable = Boolean(row?.result);
  return {
    className: cn("transition-colors", clickable && "cursor-pointer hover:bg-muted/50"),
    onClick: () => clickable && onOpen(qid),
    onKeyDown: (e: KeyboardEvent) => {
      if (clickable && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onOpen(qid);
      }
    },
    tabIndex: clickable ? 0 : undefined,
    "aria-haspopup": clickable ? ("dialog" as const) : undefined,
  };
}

function QuestionCell({ q }: { q: EvalQuestion }) {
  return (
    <>
      <span className="mr-2 font-mono text-xs text-muted-foreground">{q.qid}</span>
      <span className="text-foreground">{q.question}</span>
    </>
  );
}

function AiEvaluationSection({ ev }: { ev: Evaluation }) {
  const { rows, running } = ev;
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const categories = CATEGORY_ORDER.map((cat) => {
    const qs = EVAL_QUESTIONS.filter((q) => q.category === cat);
    const passed = qs.filter((q) => rows[q.qid]?.check?.pass).length;
    return { cat, total: qs.length, passed };
  });
  const failed = EVAL_QUESTIONS.filter((q) => isFailed(rows[q.qid]));
  const hasResults = Object.values(rows).some((r) => r.status === "done" || r.status === "error");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">AI answer evaluation</h2>
          <p className="text-sm text-muted-foreground">
            A real AI answer is generated for each question as its intended user.
          </p>
          {ev.lastRunAt && !running && (
            <p className="mt-1 text-xs text-muted-foreground">Last run: {formatRunTime(ev.lastRunAt)}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Uses {EVAL_QUESTIONS.length} AI requests</span>
          {running ? (
            <SButton variant="neutral-outline" onClick={ev.stop}>
              Stop evaluation
            </SButton>
          ) : (
            <SButton variant="primary" onClick={() => void ev.run()}>
              Run evaluation
            </SButton>
          )}
        </div>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {categories.map(({ cat, total, passed }) => (
          <div key={cat} className="grid grid-cols-[10rem_4rem_1fr] items-center gap-4 px-4 py-3 text-sm">
            <span className="font-medium text-foreground">{CATEGORY_LABEL[cat]}</span>
            <span className="tabular-nums text-muted-foreground">
              {passed} / {total}
            </span>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${CATEGORY_LABEL[cat]} passed`}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={passed}
            >
              <div className="h-full rounded-full bg-success" style={{ width: `${total ? (passed / total) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Failed questions</h3>
        {!hasResults ? (
          <p className="text-sm text-muted-foreground">Run the evaluation to see results.</p>
        ) : failed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failures</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {failed.map((q) => {
              const row = rows[q.qid];
              const props = clickableRowProps(row, q.qid, setOpen);
              return (
                <li key={q.qid} {...props} className={cn("space-y-0.5 px-4 py-2.5", props.className)}>
                  <p>
                    <QuestionCell q={q} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Asked as {displayName(q.askingUser)} · {failureReason(row!)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ToggleButton open={showAll} onClick={() => setShowAll((v) => !v)}>
        {`Show all ${EVAL_QUESTIONS.length} questions`}
      </ToggleButton>

      {showAll && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Question</th>
                <th className="px-3 py-2.5 font-medium">Asked as</th>
                <th className="px-3 py-2.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {EVAL_QUESTIONS.map((q) => {
                const row = rows[q.qid];
                const props = clickableRowProps(row, q.qid, setOpen);
                return (
                  <tr key={q.qid} {...props} className={cn("align-top", props.className)}>
                    <td className="max-w-md px-4 py-2.5">
                      <QuestionCell q={q} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{displayName(q.askingUser)}</td>
                    <td className="px-3 py-2.5">
                      <ResultBadge row={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EvalDetailDialog qid={open} row={open ? rows[open] : undefined} onClose={() => setOpen(null)} />
    </section>
  );
}

interface EvalDetailDialogProps {
  qid: string | null;
  row: EvalRow | undefined;
  onClose: () => void;
}

function EvalDetailDialog({ qid, row, onClose }: EvalDetailDialogProps) {
  const q = qid ? EVAL_QUESTIONS.find((x) => x.qid === qid) : undefined;
  const result = row?.result;
  const check = row?.check;
  const isOpen = Boolean(q && result && check);

  return (
    <CenteredModal
      open={isOpen}
      onClose={onClose}
      title={
        q && (
          <>
            <span className="mr-2 font-mono text-xs font-normal text-muted-foreground">{q.qid}</span>
            {q.question}
          </>
        )
      }
      footer={
        q &&
        result && (
          <>
            Cited: {result.citations.join(", ") || "none"} · Expected: {q.expectedDocIds.join(", ") || "none"} ·
            Forbidden: {q.forbiddenDocIds.join(", ") || "none"}
          </>
        )
      }
    >
      {q && result && check && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SBadge variant="neutral" mode="light">
              Type: {CATEGORY_LABEL[q.category] ?? q.category}
            </SBadge>
            <SBadge variant="neutral" mode="light">
              Asked as: {displayName(q.askingUser)}
            </SBadge>
            <SBadge variant={check.pass ? "success" : "warning"} mode="dark">
              {check.pass ? "Pass" : "Review"}
            </SBadge>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI answer</p>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{result.answer}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reference answer</p>
            <p className="mt-1 text-muted-foreground">{q.referenceAnswer}</p>
          </div>
        </>
      )}
    </CenteredModal>
  );
}
