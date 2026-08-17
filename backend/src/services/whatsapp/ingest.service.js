const Sentry = require('@sentry/node');
const ProjectSource = require('../../models/ProjectSource');
const Project = require('../../models/Project');
const Integration = require('../../models/Integration');
const File = require('../../models/File');
const WhatsAppChat = require('../../models/WhatsAppChat');
const WhatsAppMessage = require('../../models/WhatsAppMessage');
const { decideAndStore } = require('../memory/ingest.service');
const { splitFileIntoChunks } = require('../memory/split.service');
const { buildKey, uploadBuffer } = require('../storage/s3.service');
const { processFile } = require('../processing/processFile');
const { SUPPORTED_MIME_TYPES } = require('../file_handlers/registry');
const { encrypt } = require('../../utils/crypto');
const { normalizeMessageContent } = require('baileys');

const MAX_UNSPLIT_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
// WhatsApp documents use the same supported-format registry as uploaded
// files: images, PDF, DOCX, PPTX, XLSX, CSV, TXT, and Markdown.
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set(SUPPORTED_MIME_TYPES);

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

async function createMessageRecord(data) {
  try {
    return await WhatsAppMessage.create(data);
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

async function messageCandidates(text) {
  return text.length <= MAX_UNSPLIT_MESSAGE_LENGTH ? [text] : splitFileIntoChunks({ kind: 'text', text }, 'WhatsApp message');
}

async function ingestTextForProject({ messageRecord, source, integration, text, senderJid, senderName, projectContext }) {
  const candidates = await messageCandidates(text);
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
        fromMe: messageRecord.fromMe,
        sourceMessageId: messageRecord._id,
        whatsappMessageId: messageRecord.messageId,
        messageTimestamp: messageRecord.sentAt,
        chunkIndex,
      },
    });
    if (outcome.action === 'skipped') skippedCount++;
    if (outcome.chunkId) chunkIds.push(outcome.chunkId);
  }
  return { chunkIds, skippedCount, totalCount: candidates.length };
}

async function ingestAttachmentForProject({ buffer, attachment, messageRecord, source, integration, senderJid, senderName }) {
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
      sender: senderJid,
      senderName,
      fromMe: messageRecord.fromMe,
      messageTimestamp: messageRecord.sentAt,
    },
  });
  console.info('[whatsapp][attachment] stored', { messageId: messageRecord.messageId, fileId: String(file._id), filename, mimeType: attachment.mimeType, sizeBytes: buffer.length });
  const result = await processFile(file._id);
  return { fileId: String(file._id), chunkIds: result.chunkIds || [] };
}

async function updateChatMemorySummary({ integrationId, chatJid, projectIds, messageId, chunkIds }) {
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
      $inc: { 'memory.ingestedMessageCount': 1 },
    }
  );
}

/** Persists every live message, then evaluates text and supported media per selected project. */
async function handleIncomingMessage(integrationId, message, { downloadMedia } = {}) {
  const eventChatJid = message.key?.remoteJid;
  const messageId = message.key?.id;
  if (!eventChatJid || !messageId) return;

  const jidCandidates = chatJidCandidates(message);
  const sources = await ProjectSource.find({ integrationId, chatJid: { $in: jidCandidates }, sourceType: 'whatsapp' });
  const preferredJid = preferredChatJid(jidCandidates);
  const existingChat = preferredJid ? await WhatsAppChat.findOne({ integrationId, jid: preferredJid }) : null;
  const chatJid = sources[0]?.chatJid || existingChat?.jid || preferredJid;
  if (!chatJid) return;

  const integration = await Integration.findById(integrationId);
  if (!integration) return;

  const { text, messageType, contextInfo, attachment } = describeMessage(message);
  const isGroup = chatJid.endsWith('@g.us');
  const sentAt = messageSentAt(message);
  const senderJid = message.key.fromMe ? null : message.key.participant || chatJid;
  const senderName = message.pushName || null;
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
      $setOnInsert: { name: senderName || chatJid },
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
    senderJid,
    senderName,
    fromMe: Boolean(message.key.fromMe),
    messageType,
    contentEncrypted: text ? encrypt(text) : null,
    quotedMessageId: contextInfo?.stanzaId || null,
    mentionedJids: contextInfo?.mentionedJid || [],
    sentAt,
  });
  if (!messageRecord) return;

  if (sources.length === 0) {
    messageRecord.ingestionStatus = 'not_subscribed';
    await messageRecord.save();
    return;
  }

  const supportedAttachment = isSupportedAttachment(attachment);
  if (attachment) {
    console.info('[whatsapp][attachment] detected', {
      messageId,
      messageType,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      supported: supportedAttachment,
    });
  }
  messageRecord.projectIngestions = sources.map((source) => ({ projectId: source.projectId, sourceId: source._id, status: 'pending' }));
  if (!text && !supportedAttachment) {
    const reason = attachment ? 'Attachment type or size is not supported.' : 'Message has no searchable text or supported attachment.';
    for (const ingestion of messageRecord.projectIngestions) {
      ingestion.status = 'skipped';
      ingestion.reason = reason;
      ingestion.processedAt = new Date();
    }
    messageRecord.ingestionStatus = 'processed';
    await messageRecord.save();
    return;
  }
  await messageRecord.save();

  let attachmentBufferPromise = null;
  const getAttachmentBuffer = async () => {
    if (!attachmentBufferPromise) {
      if (!downloadMedia) throw new Error('WhatsApp media downloader is unavailable.');
      console.info('[whatsapp][attachment] downloading', { messageId, mimeType: attachment.mimeType });
      attachmentBufferPromise = Promise.resolve(downloadMedia()).then((buffer) => {
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('WhatsApp attachment download returned no data.');
        if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error('WhatsApp attachment exceeds the 25 MB limit.');
        console.info('[whatsapp][attachment] downloaded', { messageId, mimeType: attachment.mimeType, sizeBytes: buffer.length });
        return buffer;
      });
    }
    return attachmentBufferPromise;
  };

  let ingestedAny = false;
  let failedAny = false;
  const linkedChunkIds = [];
  const linkedProjectIds = [];
  for (const [index, source] of sources.entries()) {
    const projectIngestion = messageRecord.projectIngestions[index];
    const chunkIds = [];
    const fileIds = [];
    try {
      const project = await Project.findById(source.projectId).select('name description').lean();
      const projectContext = project ? { name: project.name, description: project.description } : null;
      let skippedCount = 0;
      if (text) {
        const textResult = await ingestTextForProject({ messageRecord, source, integration, text, senderJid, senderName, projectContext });
        chunkIds.push(...textResult.chunkIds);
        skippedCount += textResult.skippedCount;
      }
      if (supportedAttachment) {
        const attachmentResult = await ingestAttachmentForProject({ buffer: await getAttachmentBuffer(), attachment, messageRecord, source, integration, senderJid, senderName });
        fileIds.push(attachmentResult.fileId);
        chunkIds.push(...attachmentResult.chunkIds);
        if (attachmentResult.chunkIds.length === 0) skippedCount++;
      }
      projectIngestion.status = chunkIds.length > 0 ? (skippedCount > 0 ? 'partial' : 'ingested') : 'skipped';
      projectIngestion.reason = chunkIds.length > 0 ? null : 'No lasting information found.';
      projectIngestion.memoryChunkIds = chunkIds;
      projectIngestion.fileIds = fileIds;
      projectIngestion.processedAt = new Date();
      if (chunkIds.length > 0) {
        ingestedAny = true;
        linkedProjectIds.push(source.projectId);
        linkedChunkIds.push(...chunkIds);
      }
    } catch (err) {
      failedAny = true;
      projectIngestion.status = chunkIds.length > 0 ? 'partial' : 'failed';
      projectIngestion.reason = err.message?.slice(0, 500) || 'Ingestion failed.';
      projectIngestion.memoryChunkIds = chunkIds;
      projectIngestion.fileIds = fileIds;
      projectIngestion.processedAt = new Date();
      if (chunkIds.length > 0) {
        ingestedAny = true;
        linkedProjectIds.push(source.projectId);
        linkedChunkIds.push(...chunkIds);
      }
      Sentry.captureException(err, { tags: { pipeline: 'whatsapp_ingest_project' }, extra: { projectId: String(source.projectId), chatJid, messageId } });
    }
  }

  messageRecord.hasIngestedMemory = ingestedAny;
  messageRecord.ingestionStatus = failedAny ? (ingestedAny ? 'partial' : 'failed') : 'processed';
  await messageRecord.save();
  if (ingestedAny) {
    await updateChatMemorySummary({ integrationId, chatJid, projectIds: linkedProjectIds, messageId, chunkIds: linkedChunkIds });
    Sentry.logger.info('WhatsApp message ingested', { messageId, chatJid, projects: linkedProjectIds.map(String), chunkCount: linkedChunkIds.length });
  }
}

module.exports = { handleIncomingMessage };
