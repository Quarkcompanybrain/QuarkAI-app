const Sentry = require('@sentry/node');
const { randomUUID } = require('crypto');
const ProjectSource = require('../../models/ProjectSource');
const Project = require('../../models/Project');
const Integration = require('../../models/Integration');
const File = require('../../models/File');
const WhatsAppChat = require('../../models/WhatsAppChat');
const WhatsAppMessage = require('../../models/WhatsAppMessage');
const WhatsAppIngestionBatch = require('../../models/WhatsAppIngestionBatch');
const { decideAndStore } = require('../memory/ingest.service');
const { splitFileIntoChunks } = require('../memory/split.service');
const { buildKey, uploadBuffer } = require('../storage/s3.service');
const { processFile } = require('../processing/processFile');
const { SUPPORTED_MIME_TYPES } = require('../file_handlers/registry');
const { normalizeMessageContent } = require('baileys');
const env = require('../../config/env');
const { isAiPaused, nextRetry, shouldReport } = require('../../utils/aiErrors');

const MAX_UNSPLIT_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const BATCH_CLAIM_MS = 5 * 60 * 1000;
const ATTACHMENT_CLAIM_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// WhatsApp documents use the same supported-format registry as uploaded
// files: images, PDF, DOCX, PPTX, XLSX, CSV, TXT, and Markdown.
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set(SUPPORTED_MIME_TYPES);
const batchTimers = new Map();
let batchWorkerTimer = null;
let batchWorkerRunning = false;

function describeMessage(message) {
  const m = normalizeMessageContent(message.message) || message.message;
  if (!m) return { text: null, messageType: 'unknown', contextInfo: null, attachment: null };
  if (typeof m.conversation === 'string') return { text: m.conversation.trim() || null, messageType: 'text', contextInfo: null, attachment: null };
  if (m.extendedTextMessage) return { text: m.extendedTextMessage.text?.trim() || null, messageType: 'extended_text', contextInfo: m.extendedTextMessage.contextInfo, attachment: null };
  if (m.imageMessage) return {
    text: m.imageMessage.caption?.trim() || null,
    messageType: 'image',
    contextInfo: m.imageMessage.contextInfo,
    attachment: { mimeType: m.imageMessage.mimetype || 'image/jpeg', filename: m.imageMessage.fileName || null, sizeBytes: Number(m.imageMessage.fileLength) || null },
  };
  if (m.documentMessage) return {
    text: m.documentMessage.caption?.trim() || null,
    messageType: 'document',
    contextInfo: m.documentMessage.contextInfo,
    attachment: { mimeType: m.documentMessage.mimetype || '', filename: m.documentMessage.fileName || null, sizeBytes: Number(m.documentMessage.fileLength) || null },
  };
  // Keep a video caption as text knowledge, but intentionally never download
  // video or audio binaries in this release.
  if (m.videoMessage) return { text: m.videoMessage.caption?.trim() || null, messageType: 'video', contextInfo: m.videoMessage.contextInfo, attachment: null };
  if (m.audioMessage) return { text: null, messageType: 'audio', contextInfo: m.audioMessage.contextInfo, attachment: null };
  return { text: null, messageType: Object.keys(m)[0] || 'unknown', contextInfo: null, attachment: null };
}

function isSupportedAttachment(attachment) {
  return Boolean(attachment && SUPPORTED_ATTACHMENT_MIME_TYPES.has(attachment.mimeType) && (!attachment.sizeBytes || attachment.sizeBytes <= MAX_ATTACHMENT_BYTES));
}

function attachmentFilename(attachment, sentAt) {
  if (attachment.filename) return attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
  const extension = attachment.mimeType === 'application/pdf' ? 'pdf' : attachment.mimeType.includes('wordprocessingml') ? 'docx' : attachment.mimeType.split('/')[1] || 'bin';
  return `whatsapp-${sentAt.toISOString().replace(/[:.]/g, '-')}.${extension}`;
}

function messageSentAt(message) {
  const timestamp = Number(message.messageTimestamp);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : new Date();
}

function chatJidCandidates(message) {
  return [...new Set([message.key?.remoteJid, message.key?.remoteJidAlt].filter(Boolean))];
}

function preferredChatJid(candidates) {
  return candidates.find((jid) => jid.endsWith('@s.whatsapp.net')) || candidates[0];
}

function senderPhoneNumber(senderJid) {
  const number = senderJid?.split('@')[0]?.split(':')[0] || '';
  return /^\d+$/.test(number) ? number : null;
}

function resolveSender({ message, integration, chatJid, isGroup, existingChat, senderChat }) {
  const fromMe = Boolean(message.key?.fromMe);
  const ownJid = integration.phoneNumber ? `${integration.phoneNumber}@s.whatsapp.net` : null;
  const senderJid = fromMe
    ? message.key?.participant || ownJid || chatJid
    : message.key?.participant || chatJid;
  const eventName = message.pushName?.trim();
  const senderName = fromMe
    ? 'You'
    : eventName || senderChat?.name || (!isGroup ? existingChat?.name : null) || senderJid;

  return { fromMe, senderJid, senderName, senderPhoneNumber: senderPhoneNumber(senderJid) };
}

async function createMessageRecord(data) {
  try {
    return await WhatsAppMessage.create(data);
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

async function messageCandidates(text, traceId) {
  return text.length <= MAX_UNSPLIT_MESSAGE_LENGTH ? [text] : splitFileIntoChunks({ kind: 'text', text }, 'WhatsApp message', { traceId });
}

async function ingestTextForProject({ messageRecord, source, integration, text, senderJid, senderName, senderPhoneNumber, projectContext, traceId }) {
  const candidates = await messageCandidates(text, traceId);
  const chunkIds = [];
  let skippedCount = 0;
  for (const [chunkIndex, candidate] of candidates.entries()) {
    const outcome = await decideAndStore({
      orgId: source.orgId,
      projectId: source.projectId,
      ownerId: integration.userId,
      sourceType: 'whatsapp',
      text: candidate,
      projectContext,
      metadata: {
        integrationId: integration._id,
        chatJid: source.chatJid,
        chatName: source.chatName || messageRecord.chatName,
        sender: senderJid,
        senderName,
        senderPhoneNumber,
        fromMe: messageRecord.fromMe,
        sourceMessageId: messageRecord._id,
        whatsappMessageId: messageRecord.messageId,
        messageTimestamp: messageRecord.sentAt,
        chunkIndex,
        traceId,
      },
    });
    if (outcome.action === 'skipped') skippedCount++;
    if (outcome.chunkId) chunkIds.push(outcome.chunkId);
  }
  return { chunkIds, skippedCount, totalCount: candidates.length };
}

// WhatsApp media can only be downloaded while the live message event is at
// hand, so each project's copy is stored as a File first; a retry reprocesses
// that File instead of downloading again.
async function storeAttachmentFile({ buffer, attachment, messageRecord, source, integration, traceId }) {
  const filename = attachmentFilename(attachment, messageRecord.sentAt);
  const key = buildKey({ orgId: source.orgId, projectId: source.projectId, ownerId: integration.userId, filename });
  await uploadBuffer({ key, buffer, mimeType: attachment.mimeType });
  const file = await File.create({
    orgId: source.orgId,
    projectId: source.projectId,
    ownerId: integration.userId,
    s3Key: key,
    filename,
    mimeType: attachment.mimeType,
    sizeBytes: buffer.length,
    sourceType: 'whatsapp',
    whatsapp: {
      integrationId: integration._id,
      sourceMessageId: messageRecord._id,
      chatJid: source.chatJid,
      chatName: source.chatName || messageRecord.chatName,
      sender: messageRecord.senderJid,
      senderName: messageRecord.senderName,
      senderPhoneNumber: messageRecord.senderPhoneNumber,
      fromMe: messageRecord.fromMe,
      messageTimestamp: messageRecord.sentAt,
    },
  });
  Sentry.logger.info('WhatsApp attachment stored for AI processing', { traceId, fileId: String(file._id), attachment, messageId: messageRecord.messageId, projectId: String(source.projectId) });
  return file._id;
}

function batchGroupKey({ integrationId, chatJid, projectId, sourceId }) {
  return [integrationId, chatJid, projectId, sourceId].map(String).join('|');
}

async function acquireBatchLease(group) {
  const key = batchGroupKey(group);
  const lockId = randomUUID();
  const now = new Date();
  try {
    const lease = await WhatsAppIngestionBatch.findOneAndUpdate(
      { key, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $set: { lockId, lockedUntil: new Date(Date.now() + BATCH_CLAIM_MS) } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return lease?.lockId === lockId ? lockId : null;
  } catch (err) {
    // Two PM2 processes can race to create the first lease document. The
    // unique key makes one winner; the other simply tries again on the next poll.
    if (err?.code === 11000) return null;
    throw err;
  }
}

async function releaseBatchLease(group, lockId) {
  if (!lockId) return;
  await WhatsAppIngestionBatch.updateOne(
    { key: batchGroupKey(group), lockId },
    { $set: { lockId: null, lockedUntil: null, lastCompletedAt: new Date() } }
  );
}

function pendingProjectIngestionFilter(group, now = new Date()) {
  return {
    projectId: group.projectId,
    sourceId: group.sourceId,
    status: 'pending',
    batchEligible: true,
    $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
  };
}

function batchTranscript(messages) {
  return `WhatsApp message batch. Each recordId is a database message record id. When saving or updating memory, include every supporting recordId in sourceMessageIds.\n\n${messages.map((message, index) => {
    const sender = message.senderName || message.senderJid || (message.fromMe ? 'You' : 'Unknown sender');
    return `Message ${index + 1}\n- recordId: ${message._id}\n- WhatsApp message id: ${message.messageId}\n- Sent at: ${message.sentAt.toISOString()}\n- Sender: ${sender}\n- Sender JID: ${message.senderJid || 'unknown'}\n- Sender phone: ${message.senderPhoneNumber || 'unknown'}\n- Direction: ${message.fromMe ? 'sent by connected account' : 'received'}\n- Chat: ${message.chatName || message.chatJid}\n- Group: ${message.isGroup ? 'yes' : 'no'}\n- Type: ${message.messageType}\n- Reply to: ${message.quotedMessageId || 'none'}\n- Mentions: ${(message.mentionedJids || []).join(', ') || 'none'}\n- Text: ${message.content}`;
  }).join('\n\n')}`;
}

function overallMessageStatus(projectIngestions) {
  if (projectIngestions.some((entry) => entry.status === 'pending' || entry.status === 'processing')) return 'pending';
  const hasIngested = projectIngestions.some((entry) => entry.memoryChunkIds?.length);
  const hasFailed = projectIngestions.some((entry) => entry.status === 'failed');
  return hasFailed ? (hasIngested ? 'partial' : 'failed') : 'processed';
}

async function refreshMessageIngestionSummary(messageId) {
  const message = await WhatsAppMessage.findById(messageId).select('projectIngestions').lean();
  if (!message) return;
  await WhatsAppMessage.updateOne(
    { _id: messageId },
    {
      $set: {
        hasIngestedMemory: message.projectIngestions.some((entry) => entry.memoryChunkIds?.length),
        ingestionStatus: overallMessageStatus(message.projectIngestions),
      },
    }
  );
}

async function completeBatchEntry(messageId, group, batchId, { status, reason, chunkIds = [] }) {
  const result = await WhatsAppMessage.updateOne(
    {
      _id: messageId,
      projectIngestions: {
        $elemMatch: {
          projectId: group.projectId,
          sourceId: group.sourceId,
          status: 'processing',
          batchId,
        },
      },
    },
    {
      $set: {
        'projectIngestions.$.status': status,
        'projectIngestions.$.reason': reason,
        'projectIngestions.$.memoryChunkIds': chunkIds,
        'projectIngestions.$.processedAt': new Date(),
        'projectIngestions.$.processingStartedAt': null,
        'projectIngestions.$.processingExpiresAt': null,
        'projectIngestions.$.nextAttemptAt': null,
      },
    }
  );
  if (result.modifiedCount) await refreshMessageIngestionSummary(messageId);
}

function projectIngestionFor(message, group) {
  return message.projectIngestions?.find((entry) => String(entry.projectId) === String(group.projectId) && String(entry.sourceId) === String(group.sourceId));
}

// Every message in a failed batch either goes back to pending for a later
// attempt or, once its attempts run out (or the error can't be fixed by
// retrying), is marked failed.
async function retryBatchEntries(messages, group, batchId, err) {
  const reason = err.message?.slice(0, 500) || 'Batch ingestion failed.';
  await Promise.all(messages.map(async (message) => {
    // `message` is the pre-claim snapshot; the claim added one attempt.
    const attempts = (projectIngestionFor(message, group)?.attempts || 0) + 1;
    const retry = nextRetry(err, attempts);
    if (!retry) {
      await completeBatchEntry(message._id, group, batchId, { status: 'failed', reason });
      return;
    }
    await WhatsAppMessage.updateOne(
      {
        _id: message._id,
        projectIngestions: {
          $elemMatch: {
            projectId: group.projectId,
            sourceId: group.sourceId,
            status: 'processing',
            batchId,
          },
        },
      },
      {
        $set: {
          'projectIngestions.$.status': 'pending',
          'projectIngestions.$.reason': reason,
          'projectIngestions.$.batchId': null,
          'projectIngestions.$.processingStartedAt': null,
          'projectIngestions.$.processingExpiresAt': null,
          'projectIngestions.$.nextAttemptAt': retry.at,
        },
        ...(retry.countsAsAttempt ? {} : { $inc: { 'projectIngestions.$.attempts': -1 } }),
      }
    );
  }));
}

function scheduleTextBatch(group, delayMs = env.whatsappIngestionBatchWindowMs) {
  const key = batchGroupKey(group);
  if (batchTimers.has(key)) return;
  const timer = setTimeout(() => {
    batchTimers.delete(key);
    processTextBatchGroup(group, { force: true }).catch((err) => {
      Sentry.captureException(err, { tags: { pipeline: 'whatsapp_text_batch_timer' }, extra: { group } });
    });
  }, Math.max(250, delayMs));
  timer.unref?.();
  batchTimers.set(key, timer);
}

async function claimTextBatch(group, { force = false } = {}) {
  const now = new Date();
  const pendingFilter = pendingProjectIngestionFilter(group, now);
  const candidates = await WhatsAppMessage.find({
    integrationId: group.integrationId,
    chatJid: group.chatJid,
    content: { $type: 'string', $ne: '' },
    projectIngestions: { $elemMatch: pendingFilter },
  })
    .sort({ sentAt: 1, _id: 1 })
    .limit(env.whatsappIngestionBatchMaxMessages)
    .lean();

  const messages = [];
  let chars = 0;
  for (const candidate of candidates) {
    const textLength = candidate.content.length;
    if (messages.length > 0 && chars + textLength > env.whatsappIngestionBatchMaxChars) break;
    messages.push(candidate);
    chars += textLength;
  }
  if (!messages.length) return [];

  const firstCreatedAt = messages[0].createdAt || messages[0].sentAt;
  const ageMs = Date.now() - new Date(firstCreatedAt).getTime();
  if (!force && messages.length < env.whatsappIngestionBatchMaxMessages && ageMs < env.whatsappIngestionBatchWindowMs) {
    scheduleTextBatch(group, env.whatsappIngestionBatchWindowMs - ageMs);
    return [];
  }

  const batchId = randomUUID();
  const expiresAt = new Date(Date.now() + BATCH_CLAIM_MS);
  const claimed = [];
  for (const message of messages) {
    const updated = await WhatsAppMessage.findOneAndUpdate(
      {
        _id: message._id,
        projectIngestions: { $elemMatch: pendingProjectIngestionFilter(group, new Date()) },
      },
      {
        $set: {
          'projectIngestions.$.status': 'processing',
          'projectIngestions.$.batchId': batchId,
          'projectIngestions.$.processingStartedAt': new Date(),
          'projectIngestions.$.processingExpiresAt': expiresAt,
          'projectIngestions.$.nextAttemptAt': null,
          'projectIngestions.$.reason': null,
        },
        $inc: { 'projectIngestions.$.attempts': 1 },
      },
      { new: true }
    ).lean();
    if (updated) claimed.push(message);
  }
  if (claimed.length) {
    Sentry.logger.info('WhatsApp text batch claimed', {
      batchId,
      group,
      messageIds: claimed.map((message) => String(message._id)),
      count: claimed.length,
      characters: claimed.reduce((total, message) => total + message.content.length, 0),
    });
  }
  return claimed.length ? { batchId, messages: claimed } : [];
}

async function processTextBatchGroup(group, { force = false } = {}) {
  const timer = batchTimers.get(batchGroupKey(group));
  if (timer) {
    clearTimeout(timer);
    batchTimers.delete(batchGroupKey(group));
  }
  const leaseId = await acquireBatchLease(group);
  if (!leaseId) return;
  let batchId = null;
  let messages = [];
  const traceId = randomUUID();
  try {
    const claimed = await claimTextBatch(group, { force });
    if (!claimed?.messages?.length) return;

    ({ batchId, messages } = claimed);
    const [source, integration, project] = await Promise.all([
      ProjectSource.findOne({ _id: group.sourceId, integrationId: group.integrationId, chatJid: group.chatJid, projectId: group.projectId, sourceType: 'whatsapp' }).lean(),
      Integration.findById(group.integrationId).lean(),
      Project.findById(group.projectId).select('name description websiteUrl').lean(),
    ]);
    if (!source || !integration || !project) {
      const reason = !source ? 'WhatsApp source is no longer active.' : !integration ? 'WhatsApp integration is no longer available.' : 'Project is no longer available.';
      await Promise.all(messages.map((message) => completeBatchEntry(message._id, group, batchId, { status: 'skipped', reason })));
      Sentry.logger.info('WhatsApp text batch skipped because its source is unavailable', { traceId, batchId, group, reason });
      return;
    }

    const outcome = await decideAndStore({
      orgId: source.orgId,
      projectId: source.projectId,
      ownerId: integration.userId,
      sourceType: 'whatsapp',
      text: batchTranscript(messages),
      projectContext: { name: project.name, description: project.description, websiteUrl: project.websiteUrl },
      metadata: {
        integrationId: integration._id,
        chatJid: group.chatJid,
        chatName: source.chatName || messages[0].chatName,
        sourceMessageId: messages[0]._id,
        batchMessageIds: messages.map((message) => String(message._id)),
        messageTimestamp: messages[messages.length - 1].sentAt,
        isBatch: true,
        traceId,
      },
    });
    const chunkIdsByMessageId = new Map(messages.map((message) => [String(message._id), []]));
    for (const action of outcome.actions || []) {
      for (const messageId of action.sourceMessageIds || []) {
        const chunkIds = chunkIdsByMessageId.get(String(messageId));
        if (chunkIds && action.chunkId) chunkIds.push(action.chunkId);
      }
    }
    await Promise.all(messages.map(async (message) => {
      const chunkIds = [...new Set(chunkIdsByMessageId.get(String(message._id)) || [])];
      await completeBatchEntry(message._id, group, batchId, {
        status: chunkIds.length ? 'ingested' : 'skipped',
        reason: chunkIds.length ? null : 'No lasting information found.',
        chunkIds,
      });
    }));

    const linked = messages.flatMap((message) => chunkIdsByMessageId.get(String(message._id)) || []);
    if (linked.length) {
      await updateChatMemorySummary({
        integrationId: group.integrationId,
        chatJid: group.chatJid,
        projectIds: [group.projectId],
        messageId: messages[messages.length - 1].messageId,
        chunkIds: [...new Set(linked)],
        messageCount: messages.filter((message) => (chunkIdsByMessageId.get(String(message._id)) || []).length > 0).length,
      });
    }
    Sentry.logger.info('WhatsApp text batch completed', { traceId, batchId, group, outcome, messageCount: messages.length, linkedChunkIds: [...new Set(linked)] });
  } catch (err) {
    if (batchId && messages.length) {
      await retryBatchEntries(messages, group, batchId, err);
      if (shouldReport(err)) Sentry.captureException(err, { tags: { pipeline: 'whatsapp_text_batch' }, extra: { traceId, batchId, group, messageIds: messages.map((message) => String(message._id)) } });
      Sentry.logger.info('WhatsApp text batch failed', { traceId, batchId, group, error: err.message });
    } else {
      Sentry.captureException(err, { tags: { pipeline: 'whatsapp_text_batch_claim' }, extra: { group } });
    }
  } finally {
    await releaseBatchLease(group, leaseId);
    // If more messages arrived while this batch was processing, start their
    // own coalescing window instead of leaving them pending until the poller.
    scheduleTextBatch(group);
  }
}

async function recoverExpiredBatchClaims() {
  const now = new Date();
  const result = await WhatsAppMessage.updateMany(
    { projectIngestions: { $elemMatch: { status: 'processing', processingExpiresAt: { $lte: now } } } },
    {
      $set: {
        'projectIngestions.$[entry].status': 'pending',
        'projectIngestions.$[entry].batchId': null,
        'projectIngestions.$[entry].processingStartedAt': null,
        'projectIngestions.$[entry].processingExpiresAt': null,
        'projectIngestions.$[entry].nextAttemptAt': now,
        'projectIngestions.$[entry].reason': 'Recovered after an interrupted batch worker.',
      },
    },
    { arrayFilters: [{ 'entry.status': 'processing', 'entry.processingExpiresAt': { $lte: now } }] }
  );
  if (result.modifiedCount) Sentry.logger.info('WhatsApp text batch recovered expired claims', { count: result.modifiedCount });
}

async function processDueTextBatches() {
  if (batchWorkerRunning) return;
  batchWorkerRunning = true;
  try {
    await recoverExpiredBatchClaims();
    if (isAiPaused()) return;
    await processDueAttachmentEntries();
    const now = new Date();
    const groups = await WhatsAppMessage.aggregate([
      { $match: { content: { $type: 'string', $ne: '' }, projectIngestions: { $elemMatch: { status: 'pending' } } } },
      { $unwind: '$projectIngestions' },
      { $match: { 'projectIngestions.status': 'pending', 'projectIngestions.batchEligible': true, $or: [{ 'projectIngestions.nextAttemptAt': null }, { 'projectIngestions.nextAttemptAt': { $lte: now } }] } },
      {
        $group: {
          _id: {
            integrationId: '$integrationId',
            chatJid: '$chatJid',
            projectId: '$projectIngestions.projectId',
            sourceId: '$projectIngestions.sourceId',
          },
          oldestCreatedAt: { $min: '$createdAt' },
          count: { $sum: 1 },
        },
      },
      { $sort: { oldestCreatedAt: 1 } },
      { $limit: 100 },
    ]);
    for (const entry of groups) {
      const group = entry._id;
      const ageMs = Date.now() - new Date(entry.oldestCreatedAt).getTime();
      if (entry.count >= env.whatsappIngestionBatchMaxMessages || ageMs >= env.whatsappIngestionBatchWindowMs) {
        await processTextBatchGroup(group);
      } else {
        scheduleTextBatch(group, env.whatsappIngestionBatchWindowMs - ageMs);
      }
    }
  } finally {
    batchWorkerRunning = false;
  }
}

function queueTextBatchForSources(messageRecord, sources) {
  for (const source of sources) {
    const group = {
      integrationId: messageRecord.integrationId,
      chatJid: messageRecord.chatJid,
      projectId: source.projectId,
      sourceId: source._id,
    };
    scheduleTextBatch(group);
    // This is cheap MongoDB bookkeeping only. It lets the tenth message flush
    // immediately instead of waiting for the next worker poll or timer.
    processTextBatchGroup(group).catch((err) => {
      Sentry.captureException(err, { tags: { pipeline: 'whatsapp_text_batch_enqueue' }, extra: { group } });
    });
  }
}

function startWhatsAppTextBatchWorker() {
  if (batchWorkerTimer) return;
  batchWorkerTimer = setInterval(() => {
    processDueTextBatches().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'whatsapp_text_batch_worker' } }));
  }, Math.max(1_000, env.whatsappIngestionBatchPollMs));
  batchWorkerTimer.unref?.();
  processDueTextBatches().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'whatsapp_text_batch_worker_start' } }));
}

async function updateChatMemorySummary({ integrationId, chatJid, projectIds, messageId, chunkIds, messageCount = 1 }) {
  await WhatsAppChat.findOneAndUpdate(
    { integrationId, jid: chatJid },
    {
      $set: {
        'memory.hasIngestedMessages': true,
        'memory.lastIngestedAt': new Date(),
        'memory.lastIngestedMessageId': messageId,
        'memory.lastMemoryChunkIds': chunkIds,
      },
      $addToSet: { 'memory.projectIds': { $each: projectIds } },
      $inc: { 'memory.ingestedMessageCount': messageCount },
    }
  );
}

/** Persists every live message, then evaluates text and supported media per selected project. */
async function handleIncomingMessage(integrationId, message, { downloadMedia } = {}) {
  const traceId = randomUUID();
  const eventChatJid = message.key?.remoteJid;
  const messageId = message.key?.id;
  if (!eventChatJid || !messageId) return;

  Sentry.logger.info('WhatsApp ingestion received message event', { traceId, integrationId: String(integrationId), message });

  const jidCandidates = chatJidCandidates(message);
  const sources = await ProjectSource.find({ integrationId, chatJid: { $in: jidCandidates }, sourceType: 'whatsapp' });
  const preferredJid = preferredChatJid(jidCandidates);
  const existingChat = preferredJid ? await WhatsAppChat.findOne({ integrationId, jid: preferredJid }) : null;
  const chatJid = sources[0]?.chatJid || existingChat?.jid || preferredJid;
  if (!chatJid) {
    Sentry.logger.info('WhatsApp ingestion stopped without a canonical chat', { traceId, integrationId: String(integrationId), messageId, jidCandidates });
    return;
  }

  const integration = await Integration.findById(integrationId);
  if (!integration) {
    Sentry.logger.info('WhatsApp ingestion stopped because integration is missing', { traceId, integrationId: String(integrationId), messageId, chatJid });
    return;
  }

  const { text, messageType, contextInfo, attachment } = describeMessage(message);
  const isGroup = chatJid.endsWith('@g.us');
  const sentAt = messageSentAt(message);
  const rawSenderJid = message.key?.fromMe
    ? message.key?.participant || (integration.phoneNumber ? `${integration.phoneNumber}@s.whatsapp.net` : null)
    : message.key?.participant || chatJid;
  const senderChat = rawSenderJid ? await WhatsAppChat.findOne({ integrationId, jid: rawSenderJid }).lean() : null;
  const sender = resolveSender({ message, integration, chatJid, isGroup, existingChat, senderChat });
  Sentry.logger.info('WhatsApp ingestion resolved message metadata', { traceId, messageId, chatJid, jidCandidates, sourceCount: sources.length, text, messageType, attachment, isGroup, sentAt, sender });
  const chat = await WhatsAppChat.findOneAndUpdate(
    { integrationId, jid: chatJid },
    {
      $set: {
        isGroup,
        lastMessageAt: sentAt,
        lastMessageId: messageId,
        lastMessageText: text,
        lastMessageType: messageType,
        lastMessageFromMe: Boolean(message.key.fromMe),
      },
      $setOnInsert: { name: isGroup ? existingChat?.name || chatJid : sender.senderName || chatJid },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  const messageRecord = await createMessageRecord({
    integrationId,
    messageId,
    chatJid,
    eventChatJid,
    eventChatJidAlt: message.key?.remoteJidAlt || null,
    chatName: chat.name || chatJid,
    isGroup,
    senderJid: sender.senderJid,
    senderName: sender.senderName,
    senderPhoneNumber: sender.senderPhoneNumber,
    fromMe: sender.fromMe,
    messageType,
    content: text || null,
    quotedMessageId: contextInfo?.stanzaId || null,
    mentionedJids: contextInfo?.mentionedJid || [],
    sentAt,
  });
  if (!messageRecord) {
    Sentry.logger.info('WhatsApp ingestion skipped duplicate message event', { traceId, messageId, chatJid });
    return;
  }
  Sentry.logger.info('WhatsApp ingestion persisted message', { traceId, messageRecord });

  if (sources.length === 0) {
    messageRecord.ingestionStatus = 'not_subscribed';
    // Messages from chats no project uses are only kept for a while, as
    // context in case the chat is linked later (linking clears this).
    messageRecord.expiresAt = new Date(Date.now() + env.whatsappUnlinkedMessageRetentionDays * DAY_MS);
    await messageRecord.save();
    Sentry.logger.info('WhatsApp ingestion stopped because no project source matches', { traceId, messageId, chatJid });
    return;
  }

  const supportedAttachment = isSupportedAttachment(attachment);
  messageRecord.projectIngestions = sources.map((source) => ({
    projectId: source.projectId,
    sourceId: source._id,
    status: 'pending',
    batchEligible: Boolean(text && !supportedAttachment),
  }));
  if (!text && !supportedAttachment) {
    const reason = attachment ? 'Attachment type or size is not supported.' : 'Message has no searchable text or supported attachment.';
    for (const ingestion of messageRecord.projectIngestions) {
      ingestion.status = 'skipped';
      ingestion.reason = reason;
      ingestion.processedAt = new Date();
    }
    messageRecord.ingestionStatus = 'processed';
    await messageRecord.save();
    Sentry.logger.info('WhatsApp ingestion skipped unsupported or empty message', { traceId, messageId, chatJid, text, attachment, reason });
    return;
  }

  // Text-only messages are durable at this point and can wait briefly for
  // neighbouring messages from the same chat and project. Attachments retain
  // their immediate, per-file extraction path below.
  if (text && !supportedAttachment) {
    await messageRecord.save();
    queueTextBatchForSources(messageRecord, sources);
    Sentry.logger.info('WhatsApp text message queued for batch ingestion', {
      traceId,
      messageId,
      chatJid,
      projectIds: sources.map((source) => String(source.projectId)),
      windowMs: env.whatsappIngestionBatchWindowMs,
    });
    return;
  }

  // Claimed up front so the retry worker leaves these entries alone while
  // this live event processes them; an interrupted claim is recovered later.
  const claimedAt = new Date();
  for (const ingestion of messageRecord.projectIngestions) {
    ingestion.status = 'processing';
    ingestion.processingStartedAt = claimedAt;
    ingestion.processingExpiresAt = new Date(claimedAt.getTime() + ATTACHMENT_CLAIM_MS);
    ingestion.attempts = 1;
  }
  await messageRecord.save();

  let buffer = null;
  let downloadError = null;
  try {
    if (!downloadMedia) throw new Error('WhatsApp media downloader is unavailable.');
    Sentry.logger.info('WhatsApp attachment download started', { traceId, messageId, chatJid, attachment });
    buffer = await downloadMedia();
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('WhatsApp attachment download returned no data.');
    if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error('WhatsApp attachment exceeds the 25 MB limit.');
    Sentry.logger.info('WhatsApp attachment download completed', { traceId, messageId, chatJid, attachment, bytes: buffer.length });
  } catch (err) {
    buffer = null;
    downloadError = err;
  }

  for (const source of sources) {
    await runAttachmentEntry({ messageId: messageRecord._id, projectId: source.projectId, sourceId: source._id, attachment, buffer, downloadError, traceId });
  }
}

async function finishAttachmentEntry(messageId, { projectId, sourceId }, fields, inc = null) {
  const result = await WhatsAppMessage.updateOne(
    { _id: messageId, projectIngestions: { $elemMatch: { projectId, sourceId, status: 'processing' } } },
    {
      $set: Object.fromEntries(
        Object.entries({ nextAttemptAt: null, ...fields, processingStartedAt: null, processingExpiresAt: null }).map(([key, value]) => [`projectIngestions.$.${key}`, value])
      ),
      ...(inc ? { $inc: Object.fromEntries(Object.entries(inc).map(([key, value]) => [`projectIngestions.$.${key}`, value])) } : {}),
    }
  );
  if (result.modifiedCount) await refreshMessageIngestionSummary(messageId);
}

/**
 * Evaluates one claimed (attachment message, project) entry: the caption as
 * text and the attachment as a File. Live events pass the downloaded media;
 * retries reuse the File stored on the first attempt. A temporary AI failure
 * puts the entry back to pending for the retry worker.
 */
async function runAttachmentEntry({ messageId, projectId, sourceId, attachment = null, buffer = null, downloadError = null, traceId = randomUUID() }) {
  const messageRecord = await WhatsAppMessage.findById(messageId).lean();
  const entry = messageRecord && projectIngestionFor(messageRecord, { projectId, sourceId });
  if (!entry || entry.status !== 'processing') return;

  const group = { projectId, sourceId };
  const chunkIds = [...(entry.memoryChunkIds || []).map(String)];
  let fileId = entry.fileIds?.[0] || null;
  let skippedCount = 0;
  try {
    const [source, integration, project] = await Promise.all([
      ProjectSource.findOne({ _id: sourceId, projectId, sourceType: 'whatsapp' }).lean(),
      Integration.findById(messageRecord.integrationId).lean(),
      Project.findById(projectId).select('name description websiteUrl').lean(),
    ]);
    if (!source || !integration || !project) {
      const reason = !source ? 'WhatsApp source is no longer active.' : !integration ? 'WhatsApp integration is no longer available.' : 'Project is no longer available.';
      await finishAttachmentEntry(messageId, group, { status: 'skipped', reason, processedAt: new Date() });
      return;
    }
    Sentry.logger.info('WhatsApp project ingestion started', { traceId, messageId: messageRecord.messageId, projectId: String(projectId), attempt: entry.attempts, fileId });

    if (!fileId) {
      if (!buffer) throw downloadError || new Error('The attachment was never stored, and WhatsApp media can only be downloaded when the message arrives.');
      fileId = await storeAttachmentFile({ buffer, attachment, messageRecord, source, integration, traceId });
      await WhatsAppMessage.updateOne(
        { _id: messageId, projectIngestions: { $elemMatch: { projectId, sourceId, status: 'processing' } } },
        { $set: { 'projectIngestions.$.fileIds': [fileId] } }
      );
    }

    if (messageRecord.content) {
      const textResult = await ingestTextForProject({
        messageRecord,
        source,
        integration,
        text: messageRecord.content,
        senderJid: messageRecord.senderJid,
        senderName: messageRecord.senderName,
        senderPhoneNumber: messageRecord.senderPhoneNumber,
        projectContext: { name: project.name, description: project.description, websiteUrl: project.websiteUrl },
        traceId,
      });
      chunkIds.push(...textResult.chunkIds.map(String));
      skippedCount += textResult.skippedCount;
    }

    const fileResult = await processFile(fileId, { traceId });
    chunkIds.push(...(fileResult.chunkIds || []).map(String));
    if (!fileResult.chunkIds?.length) skippedCount++;

    const memoryChunkIds = [...new Set(chunkIds)];
    await finishAttachmentEntry(messageId, group, {
      status: memoryChunkIds.length ? (skippedCount ? 'partial' : 'ingested') : 'skipped',
      reason: memoryChunkIds.length ? null : 'No lasting information found.',
      memoryChunkIds,
      fileIds: [fileId],
      processedAt: new Date(),
    });
    if (memoryChunkIds.length) {
      await updateChatMemorySummary({ integrationId: messageRecord.integrationId, chatJid: messageRecord.chatJid, projectIds: [projectId], messageId: messageRecord.messageId, chunkIds: memoryChunkIds });
    }
    Sentry.logger.info('WhatsApp project ingestion completed', { traceId, messageId: messageRecord.messageId, projectId: String(projectId), memoryChunkIds, fileId });
  } catch (err) {
    // Without a stored File there's nothing to retry: the media is gone.
    const retry = fileId ? nextRetry(err, entry.attempts) : null;
    const memoryChunkIds = [...new Set(chunkIds)];
    const reason = err.message?.slice(0, 500) || 'Ingestion failed.';
    if (retry) {
      await finishAttachmentEntry(
        messageId,
        group,
        { status: 'pending', reason, memoryChunkIds, fileIds: [fileId], nextAttemptAt: retry.at },
        retry.countsAsAttempt ? null : { attempts: -1 }
      );
    } else {
      await finishAttachmentEntry(messageId, group, {
        status: memoryChunkIds.length ? 'partial' : 'failed',
        reason,
        memoryChunkIds,
        fileIds: fileId ? [fileId] : [],
        processedAt: new Date(),
      });
    }
    if (shouldReport(err)) {
      Sentry.captureException(err, { tags: { pipeline: 'whatsapp_ingest_project' }, extra: { traceId, projectId: String(projectId), messageId: messageRecord.messageId, attempts: entry.attempts, retryAt: retry?.at || null } });
    }
    Sentry.logger.info('WhatsApp project ingestion failed', { traceId, messageId: messageRecord.messageId, projectId: String(projectId), error: err.message, retryAt: retry?.at || null });
  }
}

/** Claims and reruns attachment entries whose retry time has come. */
async function processDueAttachmentEntries() {
  const now = new Date();
  const dueEntry = { status: 'pending', batchEligible: false, nextAttemptAt: { $ne: null, $lte: now } };
  const due = await WhatsAppMessage.find({ projectIngestions: { $elemMatch: dueEntry } })
    .sort({ sentAt: 1 })
    .limit(20)
    .select('projectIngestions')
    .lean();
  for (const message of due) {
    for (const entry of message.projectIngestions) {
      if (isAiPaused()) return;
      if (entry.status !== 'pending' || entry.batchEligible || !entry.nextAttemptAt || entry.nextAttemptAt > now) continue;
      const claimedAt = new Date();
      const claimed = await WhatsAppMessage.updateOne(
        { _id: message._id, projectIngestions: { $elemMatch: { ...dueEntry, projectId: entry.projectId, sourceId: entry.sourceId } } },
        {
          $set: {
            'projectIngestions.$.status': 'processing',
            'projectIngestions.$.processingStartedAt': claimedAt,
            'projectIngestions.$.processingExpiresAt': new Date(claimedAt.getTime() + ATTACHMENT_CLAIM_MS),
            'projectIngestions.$.nextAttemptAt': null,
          },
          $inc: { 'projectIngestions.$.attempts': 1 },
        }
      );
      if (claimed.modifiedCount) await runAttachmentEntry({ messageId: message._id, projectId: entry.projectId, sourceId: entry.sourceId });
    }
  }
}

module.exports = { handleIncomingMessage, startWhatsAppTextBatchWorker };
