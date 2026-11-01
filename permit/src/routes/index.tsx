import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { SButton, STextarea } from "@/components/ui-kit";
import { useMemo, useState, type FormEvent } from "react";

import { AnswerCard, type ConversationTurn } from "@/components/rag/answer-card";
import { UserPicker } from "@/components/rag/user-picker";
import { EVAL_QUESTIONS, USERS } from "@/lib/rag/dataset";
import { displayName } from "@/lib/rag/display";
import { askQuestion } from "@/lib/rag/rag.functions";

export const Route = createFileRoute("/")({
  // Rendered in the browser only: the design system packages require the DOM at import time.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Assistant · Permission-Aware Knowledge" },
      { name: "description", content: "Pick a user and ask a question. Answers cite only documents that user is allowed to read." },
      { property: "og:title", content: "Assistant · Permission-Aware Knowledge" },
      { property: "og:description", content: "Pick a user and ask a question. Answers cite only documents that user is allowed to read." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssistantPage,
});

/** Longest question that can be sent. */
export const MAX_QUESTION_LENGTH = 500;

function AssistantPage() {
  const ask = useServerFn(askQuestion);
  const [username, setUsername] = useState(USERS[0]?.username ?? "");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const busy = turns.some((t) => t.status === "pending");
  const tooLong = question.trim().length > MAX_QUESTION_LENGTH;

  const suggestions = useMemo(
    () => EVAL_QUESTIONS.filter((q) => q.askingUser === username).slice(0, 5),
    [username],
  );

  async function submit(text: string) {
    const q = text.trim();
    if (q.length < 3 || q.length > MAX_QUESTION_LENGTH || busy) return;
    const id = crypto.randomUUID();
    setTurns((prev) => [{ id, username, question: q, status: "pending" }, ...prev]);
    setQuestion("");
    try {
      const res = await ask({ data: { username, question: q } });
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? res.ok
              ? { ...t, status: "done", result: res.result }
              : { ...t, status: "error", error: res.error }
            : t,
        ),
      );
    } catch {
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "error", error: "Could not reach the server. Please retry." } : t)),
      );
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(question);
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-[220px_minmax(0,1fr)] sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Ask as</h2>
          <p className="mt-1 text-xs text-muted-foreground">Each user sees only documents their role and account allow.</p>
        </div>
        <UserPicker users={USERS} value={username} onChange={setUsername} />
      </aside>

      <section className="min-w-0 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Knowledge assistant</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Answers come from tickets, Slack, calls, policies and product docs, with every claim cited.
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <STextarea
            value={question}
            onChange={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
            placeholder={`Ask a question as ${displayName(username)}…`}
            aria-label="Question"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(question);
              }
            }}
          />
          {tooLong && (
            <p role="alert" className="text-sm text-destructive">
              Please shorten your question to under {MAX_QUESTION_LENGTH} characters ({question.trim().length} now).
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.qid}
                  type="button"
                  disabled={busy}
                  onClick={() => void submit(s.question)}
                  className="max-w-full rounded-full border border-border bg-background px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  {s.question}
                </button>
              ))}
            </div>
            <SButton type="button" onClick={() => void submit(question)} variant="primary" loading={busy} disabled={busy || question.trim().length < 3 || tooLong}>
              Ask
            </SButton>
          </div>
        </form>

        {turns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <p className="font-medium text-foreground">No questions yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try the same question as different users to see how answers change.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((t) => (
              <AnswerCard key={t.id} turn={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
