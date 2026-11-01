# Permit: permission-aware knowledge base

A RAG assistant that answers questions from tickets, calls, Slack and policy docs, and only ever sees
documents the asking user is allowed to read. All data is simulated and for sample use only.

## How it works
1. Filter documents by the user's role, access level and customer scope (`src/lib/rag/access.ts`).
2. Retrieve with keyword (BM25) plus optional semantic search, then rerank (`retrieve.ts`).
3. Re-check permissions on the final context, then send only those documents to the model (`rag.server.ts`).
4. The model answers with `[DOC-ID]` citations, flags conflicting sources, and warns on confidential ones.
5. The Leak test page runs every test question as every user and reports leaks and answer quality.

## Run locally
```sh
npm install
cp .env.example .env   # then add your OPENAI_API_KEY
npm run dev
npm test               # access rules and zero-leak checks
```

## Deploy on Vercel
1. Push this folder to a GitHub repo and import it in Vercel.
2. Settings → Environment Variables: add `OPENAI_API_KEY` (server-side only).
3. Deploy, ask a question, then run the Leak test page.

`vercel.json` sets `NITRO_PRESET=vercel` because the build defaults to a Cloudflare target.
Without `OPENAI_API_KEY` the app still loads and search works, but answers cannot be generated.

Made by Esha Seloth with the help of Claude. Inspired by a subscription-billing domain.
