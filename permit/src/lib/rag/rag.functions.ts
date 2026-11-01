import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const askInput = z.object({
  username: z.string().min(1).max(64),
  question: z.string().trim().min(3).max(500),
});

export type AskResponse =
  | { ok: true; result: import("./types").AskResult }
  | { ok: false; error: string; status: number };

export const askQuestion = createServerFn({ method: "POST" })
  .validator((input: unknown) => askInput.parse(input))
  .handler(async ({ data }): Promise<AskResponse> => {
    const { answerQuestion, RagError } = await import("./rag.server");
    try {
      return { ok: true, result: await answerQuestion(data.username, data.question) };
    } catch (error) {
      if (error instanceof RagError) return { ok: false, error: error.message, status: error.status };
      console.error(error);
      return { ok: false, error: "Something went wrong while answering.", status: 500 };
    }
  });

export const getRetrievalReport = createServerFn({ method: "GET" }).handler(async () => {
  const { runRetrievalReport } = await import("./rag.server");
  return runRetrievalReport();
});
