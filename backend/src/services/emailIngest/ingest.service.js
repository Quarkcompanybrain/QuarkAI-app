const Sentry = require('@sentry/node');
const { randomUUID } = require('crypto');
const EmailMessage = require('../../models/EmailMessage');
const ProjectSource = require('../../models/ProjectSource');
const Integration = require('../../models/Integration');
const Project = require('../../models/Project');
const File = require('../../models/File');
const { decideAndStore } = require('../memory/ingest.service');
const { splitFileIntoChunks } = require('../memory/split.service');
const { processFile } = require('../processing/processFile');

const CLAIM_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60 * 1000;
const MAX_UNSPLIT_EMAIL_CHARS = 8000;
const THREAD_CONTEXT_MESSAGES = 3;
const THREAD_CONTEXT_CHARS = 600;
const DUE_BATCH_SIZE = 20;

let running = false;

function formatAddress(entry) {
  if (!entry?.address) return 'unknown';
  return entry.name ? `${entry.name} <${entry.address}>` : entry.address;
}

function dueFilter(now) {
  return { status: 'pending', $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] };
}

function emailCandidate(email, body, threadContext, part) {
  const attachments = email.attachments.filter((attachment) => attachment.s3Key).map((attachment) => attachment.filename);
  const context = threadContext.length
    ? `\n\nEarlier in this thread (context only — already evaluated, don't save it again):\n${threadContext
        .map((earlier) => {
          const text = earlier.replyText || '';
          return `[${earlier.sentAt.toISOString()}] ${earlier.fromMe ? 'Mailbox owner' : formatAddress(earlier.from)}: ${text.length > THREAD_CONTEXT_CHARS ? `${text.slice(0, THREAD_CONTEXT_CHARS)}…` : text}`;
        })
        .join('\n')}`
    : '';
  return `Email from a connected mailbox:
- Mailbox: ${email.mailbox}
- Direction: ${email.fromMe ? 'sent by the mailbox owner' : 'received'}
- From: ${formatAddress(email.from)}
- To: ${email.to.map(formatAddress).join(', ') || 'none'}
- Cc: ${email.cc.map(formatAddress).join(', ') || 'none'}
- Sent at: ${email.sentAt.toISOString()}
- Subject: ${email.subject || '(no subject)'}
- Attachments: ${attachments.join(', ') || 'none'}${attachments.length ? ' (evaluated separately)' : ''}${part.total > 1 ? `\n- Part ${part.index + 1} of ${part.total} of a long email` : ''}${context}

New content of this email:
${body || '(no body text)'}`;
}

async function ingestEmailForProject({ email, source, integration, project, traceId }) {
  const projectContext = { name: project.name, description: project.description, websiteUrl: project.websiteUrl };
  const metadata = {
    isEmail: true,
    integrationId: integration._id,
    mailbox: email.mailbox,
    emailMessageId: email._id,
    emailSubject: email.subject,
    emailFrom: formatAddress(email.from),
    emailThreadKey: email.threadKey,
    messageTimestamp: email.sentAt,
    traceId,
  };
  const chunkIds = [];
  const fileIds = [];
  const failedFiles = [];

  const body = (email.replyText || email.text || '').trim();
  if (body || email.subject) {
    const threadContext = await EmailMessage.find({
      integrationId: email.integrationId,
      threadKey: email.threadKey,
      _id: { $ne: email._id },
      sentAt: { $lte: email.sentAt },
    })
      .sort({ sentAt: -1 })
      .limit(THREAD_CONTEXT_MESSAGES)
      .select('from fromMe sentAt replyText')
      .lean()
      .then((earlier) => earlier.reverse());
    const pieces = body.length <= MAX_UNSPLIT_EMAIL_CHARS
      ? [body]
      : await splitFileIntoChunks({ kind: 'text', text: body }, `Email: ${email.subject || '(no subject)'}`, { traceId });
    for (const [index, piece] of pieces.entries()) {
      const outcome = await decideAndStore({
        orgId: source.orgId,
        projectId: source.projectId,
        ownerId: integration.userId,
        sourceType: 'email',
        text: emailCandidate(email, piece, threadContext, { index, total: pieces.length }),
        projectContext,
        metadata: { ...metadata, chunkIndex: index },
      });
      if (outcome.chunkId) chunkIds.push(outcome.chunkId);
    }
  }

  for (const attachment of email.attachments.filter((entry) => entry.s3Key)) {
    // A retry must not create a second File for an attachment already handled.
    const existing = await File.findOne({ projectId: source.projectId, 'email.emailMessageId': email._id, s3Key: attachment.s3Key }).select('_id').lean();
    if (existing) {
      fileIds.push(String(existing._id));
      continue;
    }
    const file = await File.create({
      orgId: source.orgId,
      projectId: source.projectId,
      ownerId: integration.userId,
      s3Key: attachment.s3Key,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sourceType: 'email',
      email: {
        integrationId: integration._id,
        emailMessageId: email._id,
        mailbox: email.mailbox,
        subject: email.subject,
        from: formatAddress(email.from),
        sentAt: email.sentAt,
      },
    });
    fileIds.push(String(file._id));
    try {
      const result = await processFile(file._id, { traceId });
      chunkIds.push(...(result.chunkIds || []));
    } catch {
      // processFile marks the File failed and reports to Sentry; the email itself still counts as evaluated.
      failedFiles.push(attachment.filename);
    }
  }
  return { chunkIds, fileIds, failedFiles };
}

async function refreshMessageSummary(messageId) {
  const message = await EmailMessage.findById(messageId).select('projectIngestions').lean();
  if (!message) return;
  const entries = message.projectIngestions;
  const hasIngested = entries.some((entry) => entry.memoryChunkIds?.length);
  const hasFailed = entries.some((entry) => entry.status === 'failed');
  const pending = entries.some((entry) => entry.status === 'pending' || entry.status === 'processing');
  await EmailMessage.updateOne(
    { _id: messageId },
    { $set: { hasIngestedMemory: hasIngested, ingestionStatus: pending ? 'pending' : hasFailed ? (hasIngested ? 'partial' : 'failed') : 'processed' } }
  );
}

async function finishEntry(messageId, projectId, claimId, fields) {
  await EmailMessage.updateOne(
    { _id: messageId, projectIngestions: { $elemMatch: { projectId, status: 'processing', claimId } } },
    {
      $set: Object.fromEntries(
        Object.entries({ ...fields, claimId: null, processingExpiresAt: null }).map(([key, value]) => [`projectIngestions.$.${key}`, value])
      ),
    }
  );
  await refreshMessageSummary(messageId);
}

async function processEntry(messageId, projectId) {
  const claimId = randomUUID();
  const now = new Date();
  const claimed = await EmailMessage.findOneAndUpdate(
    { _id: messageId, projectIngestions: { $elemMatch: { projectId, ...dueFilter(now) } } },
    {
      $set: {
        'projectIngestions.$.status': 'processing',
        'projectIngestions.$.claimId': claimId,
        'projectIngestions.$.processingExpiresAt': new Date(now.getTime() + CLAIM_MS),
      },
      $inc: { 'projectIngestions.$.attempts': 1 },
    },
    { new: true }
  ).lean();
  const entry = claimed?.projectIngestions.find((item) => item.claimId === claimId);
  if (!entry) return;

  const traceId = randomUUID();
  try {
    const [source, integration, project] = await Promise.all([
      ProjectSource.findOne({ _id: entry.sourceId, sourceType: 'email' }).lean(),
      Integration.findOne({ _id: claimed.integrationId, type: 'email' }).select('userId').lean(),
      Project.findById(entry.projectId).select('name description websiteUrl').lean(),
    ]);
    if (!source || !integration || !project) {
      const reason = !source ? 'Mailbox is no longer linked to this project.' : !integration ? 'Mailbox was disconnected.' : 'Project is no longer available.';
      await finishEntry(messageId, projectId, claimId, { status: 'skipped', reason, processedAt: new Date() });
      return;
    }

    const { chunkIds, fileIds, failedFiles } = await ingestEmailForProject({ email: claimed, source, integration, project, traceId });
    const reasons = [];
    if (!chunkIds.length) reasons.push('No lasting information found.');
    if (failedFiles.length) reasons.push(`Could not process: ${failedFiles.join(', ')}.`);
    await finishEntry(messageId, projectId, claimId, {
      status: chunkIds.length ? (failedFiles.length ? 'partial' : 'ingested') : 'skipped',
      reason: reasons.join(' ') || null,
      memoryChunkIds: chunkIds,
      fileIds,
      processedAt: new Date(),
      nextAttemptAt: null,
    });
    Sentry.logger.info('Email ingested for project', { traceId, messageId: String(messageId), projectId: String(projectId), chunkCount: chunkIds.length, fileCount: fileIds.length });
  } catch (err) {
    const giveUp = entry.attempts >= MAX_ATTEMPTS;
    await finishEntry(messageId, projectId, claimId, {
      status: giveUp ? 'failed' : 'pending',
      reason: err.message?.slice(0, 500) || 'Ingestion failed.',
      nextAttemptAt: giveUp ? null : new Date(Date.now() + RETRY_DELAY_MS * entry.attempts),
      processedAt: giveUp ? new Date() : null,
    });
    Sentry.captureException(err, { tags: { pipeline: 'email_ingest' }, extra: { traceId, messageId: String(messageId), projectId: String(projectId), attempts: entry.attempts } });
  }
}

async function recoverExpiredClaims() {
  const now = new Date();
  await EmailMessage.updateMany(
    { projectIngestions: { $elemMatch: { status: 'processing', processingExpiresAt: { $lte: now } } } },
    {
      $set: {
        'projectIngestions.$[entry].status': 'pending',
        'projectIngestions.$[entry].claimId': null,
        'projectIngestions.$[entry].processingExpiresAt': null,
        'projectIngestions.$[entry].nextAttemptAt': now,
        'projectIngestions.$[entry].reason': 'Recovered after an interrupted worker.',
      },
    },
    { arrayFilters: [{ 'entry.status': 'processing', 'entry.processingExpiresAt': { $lte: now } }] }
  );
}

/** Evaluates every pending (email, project) pair, oldest email first. Safe to call from several processes. */
async function processDueEmails() {
  if (running) return;
  running = true;
  try {
    await recoverExpiredClaims();
    // Bounded so one call can't monopolise the worker; the next poll continues.
    for (let round = 0; round < 10; round++) {
      const now = new Date();
      const due = await EmailMessage.find({ projectIngestions: { $elemMatch: dueFilter(now) } })
        .sort({ sentAt: 1 })
        .limit(DUE_BATCH_SIZE)
        .select('projectIngestions.projectId projectIngestions.status projectIngestions.nextAttemptAt')
        .lean();
      if (!due.length) return;
      for (const message of due) {
        for (const entry of message.projectIngestions) {
          if (entry.status === 'pending' && (!entry.nextAttemptAt || entry.nextAttemptAt <= now)) {
            await processEntry(message._id, entry.projectId);
          }
        }
      }
      if (due.length < DUE_BATCH_SIZE) return;
    }
  } finally {
    running = false;
  }
}

module.exports = { processDueEmails };
