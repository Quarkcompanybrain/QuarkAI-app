# Quark AI — Product Plan (v1)

Quark AI is a company brain: an org-wide AI workspace where teams upload files, organize work into projects, and chat with an AI agent that retrieves from either personal or project-level memory.

## 1. Final Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express |
| Primary DB | MongoDB (Atlas) |
| Vector store | MongoDB Atlas Vector Search |
| Embeddings | OpenAI `text-embedding-3-small` |
| Extraction + chunking | Claude Haiku — see §3 for native vs. converted formats |
| File storage | AWS S3 |
| Email | Nodemailer via Gmail app password (OTP, invites) |
| AI agent | Claude (Sonnet, via Anthropic API) for chat; Haiku for cheap preprocessing tasks |
| Hosting | AWS (ECS/Fargate recommended over raw EC2 — less server upkeep, same AWS-native fit with S3) |

## 2. Data Model (MongoDB)

A user can belong to multiple orgs (Notion-style), so membership is modeled as its own collection rather than an array on `Org`/`Project` — this supports per-membership metadata (role, joined date) and avoids unbounded arrays.

- **User** — email, hashedPassword, name, lastActiveOrgId, deletedAt, deletedBy *(no orgId/role here — see OrgMembership)*
- **Org** — name, createdBy, deletedAt, deletedBy
- **OrgMembership** — userId, orgId, role (`admin`|`member`), joinedAt, deletedAt, deletedBy
- **Invite** — email, orgId, token, status, expiresAt
- **Project** — name, orgId, createdBy, deletedAt, deletedBy
- **ProjectMembership** — userId, projectId, joinedAt, deletedAt, deletedBy
- **File** — orgId, projectId (null if personal), ownerId, s3Key, filename, type, status (`pending`/`in_progress`/`done`/`failed`), failureReason, deletedAt, deletedBy
- **Chunk** — fileId, orgId, projectId (null if personal), text, embedding (vector), metadata, deletedAt, deletedBy
- **ChatSession** — userId, orgId, scope (`personal`|`project`), projectId (null if personal), deletedAt, deletedBy
- **Message** — sessionId (→ ChatSession), role, content, citedChunkIds[]

**Soft delete everywhere:** every model carries `deletedAt` + `deletedBy` (who performed the delete). Deletes set these instead of removing the document; all reads filter `deletedAt: null` by default.

### Multi-org implication

Since one user can be a member of several orgs, auth needs an **active org** concept: after login, the user defaults into their most recently active org (`User.lastActiveOrgId`), falling back to any org they belong to if unset (e.g. first login). That org's id travels with the session (a claim in the JWT, or an `x-org-id` header verified against `OrgMembership` on every request). Switching orgs updates `lastActiveOrgId` so the next login resumes there. The frontend needs an org switcher; the backend never trusts a client-supplied `orgId` without checking `OrgMembership` first.

### Data isolation model (three tiers)

1. **Org scope — mandatory, always enforced.** Every Chunk/File/Project query is filtered by `orgId` first, no exceptions. This is the outermost boundary and the single most important line of defense in the product.
2. **Project scope — optional.** If a File/Chunk/ChatSession has a `projectId`, it's visible to all members of that project (checked via `ProjectMembership`, within the org).
3. **Personal scope.** If there's no `projectId`, the record is owned by a single `ownerId` and visible only to that user.

One rule: `orgId` match is required always; then either `projectId` match (via `ProjectMembership`) or `ownerId` match (personal), never both. Enforced in one shared middleware/query-helper, not repeated per route.

## 3. Core Flows

**Auth & Org Setup**
1. Admin signs up with email → OTP sent via Nodemailer → verifies → sets password → creates Org (becomes `admin` via `OrgMembership`).
2. Admin invites teammates by email → invite link → teammate sets ID/password (or logs in if already a Quark AI user) → joins Org as `member` via `OrgMembership`.
3. A user with memberships in multiple orgs defaults into `lastActiveOrgId` on login; can switch orgs anytime, which updates that field.

**OTP & Invite abuse protection (standard limits)**
- OTP: 6-digit code, expires in 10 minutes, max 5 send requests per email per hour, max 5 verify attempts per code before it's invalidated.
- Invite links: signed token, expires in 7 days, single-use (marked `accepted` once claimed).
- Both enforced via `express-rate-limit` on the relevant routes, keyed by email/IP.

**Projects**
1. Any org member can create a project and invite any other org member into it (creates a `ProjectMembership`).
2. Project members share access to project-level files/chat; personal files/chat stay owner-only.

**File Upload → Extraction → RAG Pipeline**

Every format gets its own handler behind a common interface (`extract(file) → HaikuInput`), registered in a handler registry keyed by mime-type/extension. This keeps the code uniform and easy to extend — adding a new format later means adding one handler, not special-casing a pipeline. What each handler does internally varies:
- **PDF handler** — passes the file straight through to Haiku (Claude's Messages API reads PDF text + layout natively); extraction and chunking happen in one Haiku pass.
- **Image handler** — same pass-through shape, using Claude's native vision support.
- **Text/Markdown handler** — passes the raw text straight through to Haiku for chunking.
- **Word (.docx) handler** — converts to plain text via `mammoth`, then sends to Haiku.
- **PowerPoint (.pptx) handler** — converts to plain text via a pptx text extractor, then sends to Haiku.
- **Excel/CSV (.xlsx/.csv) handler** — converts to plain text via `SheetJS`/`csv-parse`, then sends to Haiku.

Pipeline:
1. Upload → S3, `File` record created with `status: pending`.
2. Async processing kicks off right after upload. `status → in_progress`.
3. The registry resolves the file's mime-type to its handler, which produces Haiku's input (raw file or converted text); Haiku returns semantic chunks either way.
4. Embed each chunk with OpenAI → store chunk + vector in Atlas, scoped per the isolation model in §2.
5. `status → done`, or `failed` with `failureReason` set.

Frontend polls or re-fetches file status; values are just `pending` / `in_progress` / `done` / `failed` for v1.

**Chat (SSE streaming)**
1. User picks scope: personal or a specific project.
2. Query embedded → Atlas vector search filtered to that scope (org + project/personal, per §2) → top-k chunks retrieved.
3. Claude's response is requested with streaming enabled. The backend exposes this as a standard **Server-Sent Events** endpoint (`text/event-stream`), forwarding each token as an SSE `data:` event as it arrives from Claude. Frontend consumes it with an SSE client and appends tokens as they arrive.

## 4. File Structure

```
quark-ai/
├── frontend/                          # React + Vite + TypeScript + Tailwind
│   ├── tailwind.config.js             # theme: magenta/black/white tokens live here
│   ├── src/
│   │   ├── pages/                     # route-level page components
│   │   │   ├── Login.tsx
│   │   │   ├── Signup.tsx
│   │   │   ├── OrgSwitcher.tsx
│   │   │   ├── ProjectView.tsx
│   │   │   └── ChatView.tsx
│   │   ├── features/
│   │   │   ├── auth/                  # OTP signup, login, invite-accept
│   │   │   ├── org/                   # org creation, member management, org switcher logic
│   │   │   ├── projects/              # project CRUD, member invites
│   │   │   ├── files/                 # upload UI, project/personal toggle, status display
│   │   │   └── chat/                  # chat UI, scope toggle, SSE consumer
│   │   ├── components/                # shared UI primitives
│   │   ├── lib/                       # api client, auth token handling
│   │   ├── hooks/
│   │   ├── store/                     # auth/session state, active org
│   │   ├── types/
│   │   └── assets/
│   │       └── logo-placeholder.svg
│   └── public/
│
├── backend/                            # Node.js + Express
│   ├── src/
│   │   ├── config/                    # env, mongo/atlas connection, s3 client
│   │   ├── models/                    # User, Org, OrgMembership, Invite, Project, ProjectMembership, File, Chunk, ChatSession, Message
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/                # jwt auth, active-org resolution, org/project/personal scoping, upload limits, rate limiting
│   │   ├── services/
│   │   │   ├── auth/                  # OTP gen/verify, invite tokens
│   │   │   ├── email/                 # nodemailer templates
│   │   │   ├── storage/               # S3 upload/download
│   │   │   ├── file_handlers/         # one handler per format (pdf, image, text, docx, pptx, xlsx, csv) behind a common interface + registry
│   │   │   ├── chunking/              # Haiku call: handler output → semantic chunks
│   │   │   ├── embeddings/            # OpenAI embedding calls
│   │   │   ├── vectorstore/           # Atlas Vector Search query + upsert
│   │   │   └── agent/                 # Claude agent orchestration, RAG assembly, SSE response streaming
│   │   └── utils/
│   └── server.js
│
└── docs/
```

## 5. Build Order

1. **Foundations** — auth (OTP signup/login), org creation, `OrgMembership`, invite flow, active-org resolution, org/project/personal scoping middleware
2. **Projects** — CRUD, `ProjectMembership`, invites within org
3. **Files** — upload to S3, personal vs project scoping, status tracking (`pending`/`in_progress`/`done`/`failed`)
4. **RAG pipeline** — file handler registry (pdf/image/text/docx/pptx/xlsx/csv) → Haiku chunking → embeddings → Atlas vector storage
5. **Chat** — scope selector, vector retrieval, Claude agent response streamed via SSE
6. **Polish** — Tailwind theme, blank logo placeholder, OTP/invite rate limiting

## 6. Deferred to Future Scope
- Connectors: Zoho (WhatsApp and IMAP email ingestion have shipped)
- Email reply drafting on top of email ingestion — on hold (see README)
- Email OAuth (Gmail API / Microsoft Graph) for providers that block password IMAP, e.g. Microsoft 365
- Custom per-project metrics
- Swap Gmail app-password email to a transactional provider (SES/Resend) before real launch volume
- OCR for scanned/image uploads (note: Claude vision already handles most image text directly — revisit whether dedicated OCR is even needed)
- RBAC beyond admin/member (granular permissions, custom roles)
- Error monitoring (Sentry or similar)
- Dedicated job queue (BullMQ + Redis) if async file-processing volume grows beyond simple fire-and-forget
- WhatsApp lifecycle reconciliation: message edits, revocations/deletions, reactions, and group metadata/participant updates; propagate relevant changes from source-message records into memory
