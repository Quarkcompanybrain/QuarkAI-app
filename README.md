# Quark AI

Company brain: org-wide AI workspace for files, projects, and chat over your team's knowledge. See [PRODUCT_PLAN.md](PRODUCT_PLAN.md) for the full architecture and data model.

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `.env`:
- `MONGODB_URI` — a MongoDB **Atlas** cluster (required — Atlas Vector Search powers retrieval, a local/self-hosted Mongo won't support it)
- `JWT_SECRET` — any long random string
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` — for OTP and invite emails ([create an app password](https://myaccount.google.com/apppasswords))
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `S3_BUCKET_NAME` / `AWS_REGION` — for file storage
- `ANTHROPIC_API_KEY` — powers chat (Sonnet) and file chunking (Haiku)
- `OPENAI_API_KEY` — powers embeddings

```bash
npm run dev   # http://localhost:4000
```

The Atlas Vector Search index on `chunks` is created automatically on startup if it doesn't exist yet (see `ensureVectorIndex` in `src/config/db.js`) — Atlas takes a couple of minutes to finish building it in the background after that; chat retrieval returns zero results (not an error) until it's ready. Check status any time with:

```bash
node -e "require('dotenv').config();require('mongoose').connect(process.env.MONGODB_URI).then(async m=>{console.log(await m.connection.db.collection('chunks').listSearchIndexes().toArray());process.exit(0)})"
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # defaults to http://localhost:4000/api, adjust if needed
npm run dev             # http://localhost:5173
```

## What's built

- Auth: OTP email signup, login, JWT sessions, multi-org support with an active-org switcher
- Orgs: creation, email invites, admin/member roles
- Projects: creation, membership, org-member invites
- Files: upload to S3, per-format handler registry (PDF/image native via Claude, docx/pptx/xlsx converted to text), Haiku chunking, OpenAI embeddings, Atlas Vector Search storage
- Chat: personal or project-scoped RAG retrieval, Claude Sonnet responses streamed via SSE
- Three-tier data isolation (org → project/personal) enforced in shared middleware, soft delete everywhere

## Verified so far

- Backend: all files pass `node --check` (syntax-clean); full request flow not yet exercised against a live Atlas cluster (needs your credentials)
- Frontend: `tsc --noEmit` and `vite build` both pass clean; Login/Signup/protected-route redirect confirmed visually in-browser

Once your `.env` is filled in, walking through signup → create org → invite a teammate → create a project → upload a file → chat is the natural first end-to-end test.
