// Server-only AI provider config. Defaults to OpenAI; set the env vars below to change it.
export const AI_BASE_URL = process.env["AI_BASE_URL"] ?? "https://api.openai.com/v1";
export const AI_MODEL = process.env["AI_MODEL"] ?? "gpt-4.1-mini";
export const EMBEDDING_MODEL = process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small";

/** The provider key. Set OPENAI_API_KEY in .env locally or in the host's environment settings; never commit it. */
export function getAiApiKey(): string | undefined {
  return process.env["OPENAI_API_KEY"];
}
