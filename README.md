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
- `OPENAI_API_KEY` — powers embeddings and low-cost WhatsApp ingestion decisions
- `INTEGRATION_ENCRYPTION_KEY` — 64-char hex string (32 bytes), encrypts stored integration credentials (e.g. WhatsApp session data) at rest. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

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

### Production: SSE behind Nginx

The WhatsApp connection screen uses Server-Sent Events (SSE) to deliver the QR code and connection status. The backend sends an immediate SSE heartbeat and disables Nginx buffering with `X-Accel-Buffering: no`; the EC2 Nginx proxy must also avoid WebSocket-only headers and response buffering.

For `/etc/nginx/sites-available/quark-backend`, use this proxy block inside the HTTPS server:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Do not set `Upgrade` or `Connection 'upgrade'` for this SSE proxy. After updating the server configuration, run:

```bash
sudo nginx -t
sudo systemctl reload nginx
pm2 restart <backend-app-name> --update-env
```

## What's built

- Auth: OTP email signup, login, JWT sessions, multi-org support with an active-org switcher
- Orgs: creation, email invites, admin/member roles
- Projects: org admins create projects (members can't) through a dedicated flow for name, website, relevance description, and up to 10 initial context files; membership, org-member invites, and creator-only soft deletion with confirmation
- Files: upload to S3, then the configurable OpenAI ingestion model (`OPENAI_INGESTION_MODEL`, default `gpt-5.4-nano`) processes PDF/image inputs natively and extracted DOCX/PPTX/XLSX/XLS/CSV/TXT/Markdown text before knowledge ingestion
- Chat: personal or project-scoped RAG retrieval, Claude Sonnet responses streamed via SSE, with formatted assistant responses
- Daily admin brief: once per org per day (at or after `DAILY_REPORT_HOUR` in `DAILY_REPORT_TIMEZONE`, default 09:00 Asia/Kolkata), org admins get one email with an executive summary, a "needs attention" list, and per-project highlights, decisions, risks, and next steps. It is written in a single Claude call (`ANTHROPIC_REPORT_MODEL`) with token limits per project section and for the whole prompt and response (see the budgets at the top of `dailyReport.service.js`; projects beyond the limits are listed with counts only), from the project memories captured or updated since the previous brief, plus WhatsApp, file, and chat activity counts. Personal-scope data is never included. Days with no project activity send nothing. A `DailyReport` record per org and date makes the send idempotent across PM2 processes and retries failures up to 3 times. Preview any org's brief without sending it: `npm run report:daily -- --org <orgId> [--hours 24] [--to you@example.com | --send]`
- Three-tier data isolation (org → project/personal) enforced in shared middleware, soft delete everywhere
- Integrations: WhatsApp (via Baileys — unofficial, see warning below), connected per-user with session credentials encrypted at rest. The source picker uses a cached catalog of chats and groups populated by the connection, so it remains responsive without a live picker request. Every live received and sent message is retained with plaintext text/caption plus sender, chat/group, reply, mention, and timestamp metadata; selected chats can feed multiple projects, each with its own relevance decision and memory links. Text-only messages are coalesced durably per integration, chat, and project (default: 5 minutes, 30 messages, or 12k characters) before one OpenAI ingestion-model decision; all source-message IDs are retained on resulting memory. A MongoDB worker atomically claims batches, retries failures, and recovers interrupted work after restart without an external queue. Files and WhatsApp ingestion use the configurable OpenAI model (`OPENAI_INGESTION_MODEL`, default `gpt-5.4-nano`), while Claude is reserved for product chat and chat titles. During ingestion, the AI can run focused, scoped MongoDB queries over earlier messages in the same chat (date, sender, direction, type, reply, mention, full-text/literal text, and ingestion filters) to obtain complete discussion context. Supported WhatsApp attachments (images, PDF, DOCX, PPTX, XLSX/XLS, CSV, TXT, Markdown) enter the same OpenAI file-processing pipeline; audio and video binaries are intentionally skipped. Sockets reconnect automatically after restart without re-scanning the QR code. Auth-key counts and encrypted size are tracked per connection, but active Signal keys are never auto-pruned.

- Integrations: Email (IMAP). Each user can connect up to 5 mailboxes with an app password; credentials are checked with a real IMAP sign-in, then stored encrypted at rest. The IMAP server is detected from the address or its MX records (Gmail/Google Workspace, Zoho, Yahoo, iCloud, Titan, GoDaddy, Hostinger), or entered manually. Outlook/Microsoft 365 isn't supported, because Microsoft no longer allows password-based IMAP. In project settings, members link their own mailboxes to a project; a mailbox can feed several projects, and each project keeps only what's relevant to it, as with WhatsApp chats.
  - **Sync:** a poller (`EMAIL_SYNC_POLL_MS`, default 2 min, leased per mailbox so PM2 processes don't overlap) reads new mail from INBOX and the Sent folder after the mailbox is connected. There's no backfill, and messages are never marked as read. Mailboxes not linked to any project are never fetched.
  - **Filtering and threading:** newsletters, mailing lists, and auto-replies are detected from their headers, stored, and skipped. Quoted reply history is stripped so each message is evaluated once; forwarded content is kept. Threads are grouped by Gmail thread ID or the `References` header.
  - **Ingestion:** a durable worker (`EMAIL_INGESTION_POLL_MS`) runs one memory decision per email per linked project, with the previous messages in the thread as context. It retries failures and recovers interrupted claims. Supported attachments are uploaded to S3 once and go through the same file pipeline as uploads.

  **⚠️ WhatsApp risk**: Baileys automates WhatsApp Web, which is against WhatsApp's Terms of Service and carries a real risk of the connected number being flagged or banned. The Integrations page shows this warning to users; consider using a spare/secondary number rather than a primary line, in dev and in production.

## On hold

- **Email reply drafting**: deciding whether a new email deserves a reply, drafting one from project memory, and saving it as a draft in the user's mailbox. Paused until email ingestion has run in production for a while. With IMAP, a draft can be saved by appending to the Drafts folder with `In-Reply-To`/`References` headers so it threads correctly.

## Verified so far

- Backend: all files pass `node --check` (syntax-clean); full request flow not yet exercised against a live Atlas cluster (needs your credentials)
- Frontend: `tsc --noEmit` and `vite build` both pass clean; Login/Signup/protected-route redirect confirmed visually in-browser

Once your `.env` is filled in, walking through signup → create org → invite a teammate → create a project → upload a file → chat is the natural first end-to-end test.

**WhatsApp integration specifically**: verified end-to-end through a real Baileys connection generating a scannable QR code over SSE, plus disconnect/cleanup. Before relying on it in production, run a paired-account check for inbound/outbound text and one supported attachment to confirm your WhatsApp account, S3, Atlas, Anthropic, and OpenAI configuration work together.
