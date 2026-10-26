const Sentry = require('@sentry/node');
const path = require('path');
const { randomUUID } = require('crypto');
const { simpleParser } = require('mailparser');
const { v4: uuidv4 } = require('uuid');
const Integration = require('../../models/Integration');
const ProjectSource = require('../../models/ProjectSource');
const EmailMessage = require('../../models/EmailMessage');
const { uploadBuffer } = require('../storage/s3.service');
const { SUPPORTED_MIME_TYPES } = require('../file_handlers/registry');
const { decryptJson } = require('../../utils/crypto');
const { createClient, friendlyImapError } = require('./imap');
const { processDueEmails } = require('./ingest.service');
const env = require('../../config/env');

const SYNC_LEASE_MS = 10 * 60 * 1000;
const MAX_MESSAGES_PER_FOLDER_SYNC = 50;
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const OVERSIZED_PREVIEW_BYTES = 256 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const NETWORK_FAILURES_BEFORE_ALERT = 3;
const NETWORK_ERROR_CODES = new Set(['ETIMEDOUT', 'ETIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE', 'NoConnection']);

function isNetworkError(err) {
  if (err?.authenticationFailed) return false;
  // A dual-stack connect failure arrives as an AggregateError of per-address errors.
  if (err instanceof AggregateError) return err.errors.every(isNetworkError);
  return NETWORK_ERROR_CODES.has(err?.code) || /socket timeout|connection timeout|timed out/i.test(err?.message || '');
}
const SYNC_CONCURRENCY = 4;
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set(SUPPORTED_MIME_TYPES);
// Mail clients often send real documents as application/octet-stream.
const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

let syncTimer = null;
let ingestTimer = null;
let syncRunning = false;

function normalizeMessageId(value) {
  return value ? String(value).trim().replace(/^<|>$/g, '').toLowerCase() : null;
}

function addressList(field) {
  return (Array.isArray(field) ? field : field ? [field] : [])
    .flatMap((group) => group.value || [])
    .filter((entry) => entry.address)
    .map((entry) => ({ name: entry.name || '', address: entry.address.toLowerCase() }));
}

function threadKeyFor(parsed, gmailThreadId, messageId) {
  if (gmailThreadId) return `gm:${gmailThreadId}`;
  const references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? String(parsed.references).split(/\s+/) : [];
  return `mid:${normalizeMessageId(references[0]) || normalizeMessageId(parsed.inReplyTo) || messageId}`;
}

// Newsletters, mailing lists, and auto-replies carry standard headers; they
// are stored but never sent to the model.
function isAutomatedEmail(parsed) {
  const header = (name) => {
    const value = parsed.headers?.get(name);
    return value == null ? null : String(typeof value === 'object' ? value.value ?? value.text ?? '' : value).toLowerCase();
  };
  // mailparser folds List-Id, List-Unsubscribe, etc. into one structured `list` header.
  if (parsed.headers?.has('list') || parsed.headers?.has('list-unsubscribe') || parsed.headers?.has('list-id')) return true;
  if (['bulk', 'list', 'junk'].includes(header('precedence'))) return true;
  const autoSubmitted = header('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  return parsed.headers?.has('x-autoreply') || parsed.headers?.has('x-autorespond');
}

// Replies quote the whole thread below the new text. Only the new part is
// ingested; earlier messages were already evaluated when they arrived. A
// forwarded message is new content to this mailbox, so it is kept whole.
const FORWARD_MARKER = /^(?:-{5,}\s*Forwarded message\s*-{5,}|Begin forwarded message:)/im;

function stripQuotedReply(text) {
  const forwardAt = FORWARD_MARKER.exec(text)?.index ?? text.length;
  const cutPatterns = [
    /^On\b[^\n]{0,300}(?:\n[^\n]{0,300})?\bwrote:[ \t]*$/im,
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^_{8,}[ \t]*\n(?:From|De|Von):/im,
    /^From:[^\n]*\n(?:[^\n]*\n){0,3}?(?:Sent|Date):/im,
  ];
  let cutAt = text.length;
  for (const pattern of cutPatterns) {
    const match = pattern.exec(text);
    if (match && match.index < cutAt && match.index < forwardAt) cutAt = match.index;
  }
  return text
    .slice(0, cutAt)
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attachmentMimeType(attachment) {
  if (SUPPORTED_ATTACHMENT_MIME_TYPES.has(attachment.contentType)) return attachment.contentType;
  return MIME_BY_EXTENSION[path.extname(attachment.filename || '').toLowerCase()] || attachment.contentType || 'application/octet-stream';
}

async function storeAttachments(integrationId, parsed) {
  const stored = [];
  for (const attachment of parsed.attachments || []) {
    // Inline parts are signature logos and embedded images, not documents.
    if (attachment.related || attachment.contentDisposition === 'inline') continue;
    const filename = (attachment.filename || `attachment-${stored.length + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
    const mimeType = attachmentMimeType(attachment);
    const sizeBytes = attachment.size || attachment.content?.length || 0;
    let skippedReason = null;
    if (!SUPPORTED_ATTACHMENT_MIME_TYPES.has(mimeType)) skippedReason = 'Unsupported file type.';
    else if (sizeBytes > MAX_ATTACHMENT_BYTES) skippedReason = 'Larger than 25 MB.';

    let s3Key = null;
    if (!skippedReason) {
      s3Key = `integrations/${integrationId}/email/${uuidv4()}-${filename}`;
      await uploadBuffer({ key: s3Key, buffer: attachment.content, mimeType });
    }
    stored.push({ filename, mimeType, sizeBytes, s3Key, skippedReason });
  }
  return stored;
}

async function storeEmail({ integration, folder, uid, parsed, gmailThreadId, oversized, sources }) {
  const messageId = normalizeMessageId(parsed.messageId) || `synthetic:${integration._id}:${folder.path}:${folder.uidValidity}:${uid}`;
  if (await EmailMessage.exists({ integrationId: integration._id, messageId })) return null;

  const from = addressList(parsed.from)[0] || { name: '', address: '' };
  const fromMe = folder.role === 'sent' || from.address === integration.emailAddress;
  const text = (parsed.text || '').slice(0, MAX_TEXT_CHARS);
  const automated = isAutomatedEmail(parsed);
  // Oversized messages were only partially downloaded, so their attachments are unusable.
  const attachments = automated || oversized ? [] : await storeAttachments(integration._id, parsed);
  const now = new Date();
  const skipReason = automated ? 'Automated or bulk email (newsletter, mailing list, or auto-reply).' : null;

  try {
    return await EmailMessage.create({
      integrationId: integration._id,
      mailbox: integration.emailAddress,
      folder: folder.path,
      uid,
      messageId,
      threadKey: threadKeyFor(parsed, gmailThreadId, messageId),
      inReplyTo: normalizeMessageId(parsed.inReplyTo),
      subject: (parsed.subject || '').slice(0, 1000),
      from,
      to: addressList(parsed.to),
      cc: addressList(parsed.cc),
      fromMe,
      sentAt: parsed.date || now,
      text,
      replyText: stripQuotedReply(text),
      attachments,
      isAutomated: automated,
      ingestionStatus: automated ? 'processed' : 'pending',
      projectIngestions: sources.map((source) => ({
        projectId: source.projectId,
        sourceId: source._id,
        status: automated ? 'skipped' : 'pending',
        reason: skipReason,
        processedAt: automated ? now : null,
      })),
    });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

async function saveCursor(integrationId, folder) {
  await Integration.updateOne(
    { _id: integrationId, 'email.folders.path': folder.path },
    { $set: { 'email.folders.$.uidValidity': folder.uidValidity, 'email.folders.$.lastUid': folder.lastUid } }
  );
}

/** Fetches mail that arrived in one folder since its cursor, oldest first. */
async function syncFolder({ client, integration, folder, sources, traceId }) {
  const status = await client.status(folder.path, { uidNext: true, uidValidity: true });
  const uidValidity = String(status.uidValidity);
  const end = Math.max(0, (status.uidNext || 1) - 1);

  // A reset folder or a mailbox with no linked project only moves its cursor
  // to "now", so linking a project later never backfills old mail.
  if (folder.uidValidity !== uidValidity || sources.length === 0) {
    if (folder.uidValidity !== uidValidity || folder.lastUid !== end) {
      Object.assign(folder, { uidValidity, lastUid: end });
      await saveCursor(integration._id, folder);
    }
    return 0;
  }
  if (end <= folder.lastUid) return 0;

  const lock = await client.getMailboxLock(folder.path, { readOnly: true });
  let stored = 0;
  try {
    const envelopes = await client.fetchAll(`${folder.lastUid + 1}:*`, { uid: true, size: true, threadId: true }, { uid: true });
    // "N:*" always returns the newest message, even when its UID is below N.
    const batch = envelopes
      .filter((message) => message.uid > folder.lastUid)
      .sort((a, b) => a.uid - b.uid)
      .slice(0, MAX_MESSAGES_PER_FOLDER_SYNC);

    for (const envelope of batch) {
      const oversized = (envelope.size || 0) > MAX_SOURCE_BYTES;
      const full = await client.fetchOne(String(envelope.uid), { source: oversized ? { maxLength: OVERSIZED_PREVIEW_BYTES } : true }, { uid: true });
      if (full?.source) {
        const parsed = await simpleParser(full.source);
        const record = await storeEmail({ integration, folder, uid: envelope.uid, parsed, gmailThreadId: envelope.threadId, oversized, sources });
        if (record) stored++;
      }
      folder.lastUid = envelope.uid;
      await saveCursor(integration._id, folder);
    }
  } finally {
    lock.release();
  }
  if (stored) Sentry.logger.info('Email folder synced', { traceId, integrationId: String(integration._id), folder: folder.path, stored, lastUid: folder.lastUid });
  return stored;
}

async function acquireSyncLease(integrationId) {
  const lockId = randomUUID();
  const now = new Date();
  const leased = await Integration.findOneAndUpdate(
    {
      _id: integrationId,
      type: 'email',
      status: 'connected',
      deletedAt: null, // findOneAndUpdate bypasses the soft-delete query hook
      $or: [{ 'email.syncLockedUntil': null }, { 'email.syncLockedUntil': { $lte: now } }],
    },
    { $set: { 'email.syncLockId': lockId, 'email.syncLockedUntil': new Date(now.getTime() + SYNC_LEASE_MS) } },
    { new: true }
  );
  return leased?.email?.syncLockId === lockId ? { lockId, integration: leased } : null;
}

async function syncIntegration(integrationId) {
  const lease = await acquireSyncLease(integrationId);
  if (!lease) return 0;
  const { lockId, integration } = lease;
  const traceId = randomUUID();
  const update = {};
  let stored = 0;
  try {
    const sources = await ProjectSource.find({ integrationId, sourceType: 'email' }).select('projectId').lean();
    const client = createClient(integration.email, decryptJson(integration.credsEncrypted));
    client.on('error', (err) => Sentry.logger.info('IMAP connection error', { traceId, integrationId: String(integrationId), error: err.message }));
    await client.connect();
    try {
      for (const folder of integration.email.folders.map((entry) => entry.toObject())) {
        stored += await syncFolder({ client, integration, folder, sources, traceId });
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
    Object.assign(update, { 'email.lastSyncedAt': new Date(), 'email.consecutiveFailures': 0, lastError: null });
  } catch (err) {
    update.lastError = friendlyImapError(err).slice(0, 500);
    // A rejected password won't fix itself; stop polling until the user reconnects.
    if (err?.authenticationFailed) update.status = 'failed';
    // Mail servers time out now and then and the next poll recovers, so a
    // network error is only reported once it has failed several polls in a row.
    const failures = (integration.email?.consecutiveFailures || 0) + 1;
    update['email.consecutiveFailures'] = failures;
    if (!isNetworkError(err) || failures === NETWORK_FAILURES_BEFORE_ALERT) {
      Sentry.captureException(err, { tags: { pipeline: 'email_sync' }, extra: { traceId, integrationId: String(integrationId), consecutiveFailures: failures } });
    } else {
      Sentry.logger.warn('IMAP sync failed with a network error; retrying on the next poll', { traceId, integrationId: String(integrationId), error: err.message, consecutiveFailures: failures });
    }
  } finally {
    await Integration.updateOne(
      { _id: integrationId, 'email.syncLockId': lockId },
      { $set: { ...update, 'email.syncLockId': null, 'email.syncLockedUntil': null } }
    );
  }
  return stored;
}

async function syncAllMailboxes() {
  if (syncRunning) return;
  syncRunning = true;
  try {
    const integrations = await Integration.find({ type: 'email', status: 'connected' }).select('_id').lean();
    const queue = integrations.map((integration) => integration._id);
    let stored = 0;
    await Promise.all(
      Array.from({ length: Math.min(SYNC_CONCURRENCY, queue.length) }, async () => {
        while (queue.length) stored += await syncIntegration(queue.shift());
      })
    );
    if (stored) processDueEmails().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'email_ingest_kick' } }));
  } finally {
    syncRunning = false;
  }
}

function startEmailWorkers() {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    syncAllMailboxes().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'email_sync_worker' } }));
  }, Math.max(30_000, env.emailSyncPollMs));
  ingestTimer = setInterval(() => {
    processDueEmails().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'email_ingest_worker' } }));
  }, Math.max(5_000, env.emailIngestionPollMs));
  syncTimer.unref?.();
  ingestTimer.unref?.();
  syncAllMailboxes().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'email_sync_worker_start' } }));
}

module.exports = { startEmailWorkers, syncIntegration, stripQuotedReply, isAutomatedEmail, threadKeyFor };
