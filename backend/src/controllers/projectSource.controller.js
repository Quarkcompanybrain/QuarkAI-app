const Sentry = require('@sentry/node');
const { Types } = require('mongoose');
const ProjectSource = require('../models/ProjectSource');
const Integration = require('../models/Integration');
const WhatsAppChat = require('../models/WhatsAppChat');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Chunk = require('../models/Chunk');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');
const { parseListQuery, findPage } = require('../utils/listQuery');

const MAX_SOURCES_PER_PROJECT = 10;

const listSources = asyncHandler(async (req, res) => {
  const sources = await ProjectSource.find({ projectId: req.projectId });
  res.json({
    sources: sources.map((s) => ({
      id: s._id,
      sourceType: s.sourceType,
      integrationId: s.integrationId,
      chatJid: s.chatJid,
      chatName: s.chatName,
      isGroup: s.isGroup,
      addedBy: s.addedBy,
    })),
  });
});

async function assertSourceCapacity(projectId) {
  const sourceCount = await ProjectSource.countDocuments({ projectId });
  if (sourceCount >= MAX_SOURCES_PER_PROJECT) {
    throw new ApiError(409, `A project can have at most ${MAX_SOURCES_PER_PROJECT} connected sources.`);
  }
}

// You can only add chats, mailboxes or Cheerio connections from your own connected accounts —
// linking a teammate's WhatsApp or email on their behalf isn't something
// they've consented to just by being on the same project.
const addSource = asyncHandler(async (req, res) => {
  const { integrationId, chatJid } = req.body;
  if (!integrationId) throw new ApiError(400, 'integrationId is required.');

  const integration = await Integration.findOne({ _id: integrationId, userId: req.user.id });
  if (!integration) throw new ApiError(403, 'You can only add sources from your own connected accounts.');

  // A mailbox or Cheerio connection is linked whole; content starts flowing
  // from the next mail sync or webhook call onward.
  if (integration.type === 'email' || integration.type === 'cheerio') {
    const label = integration.type === 'email' ? 'mailbox' : 'Cheerio connection';
    if (integration.status !== 'connected') throw new ApiError(409, `Reconnect this ${label} before linking it.`);
    const existing = await ProjectSource.findOne({ projectId: req.projectId, integrationId });
    if (existing) throw new ApiError(409, `This ${label} is already a source for this project.`);
    await assertSourceCapacity(req.projectId);
    const source = await ProjectSource.create({
      projectId: req.projectId,
      orgId: req.org.id,
      sourceType: integration.type,
      integrationId,
      chatName: integration.type === 'email' ? integration.emailAddress : integration.cheerio?.name || 'Cheerio',
      addedBy: req.user.id,
    });
    Sentry.logger.info('Project source added', { projectId: req.projectId, integrationId: String(integrationId), sourceType: integration.type });
    return res.status(201).json({ source: { id: source._id, chatName: source.chatName } });
  }

  if (!chatJid) throw new ApiError(400, 'chatJid is required for a WhatsApp source.');

  const chat = await WhatsAppChat.findOne({ integrationId, jid: chatJid });
  if (!chat) throw new ApiError(404, 'That chat was not found on this account.');

  const existing = await ProjectSource.findOne({ projectId: req.projectId, integrationId, chatJid });
  if (existing) throw new ApiError(409, 'This chat is already a source for this project.');

  await assertSourceCapacity(req.projectId);

  const source = await ProjectSource.create({
    projectId: req.projectId,
    orgId: req.org.id,
    sourceType: 'whatsapp',
    integrationId,
    chatJid,
    chatName: chat.name || chatJid,
    isGroup: chat.isGroup,
    addedBy: req.user.id,
  });

  // The chat's earlier messages become lasting context for ingestion.
  await WhatsAppMessage.updateMany({ integrationId, chatJid, expiresAt: { $ne: null } }, { $set: { expiresAt: null } });

  Sentry.logger.info('Project source added', { projectId: req.projectId, chatJid });
  res.status(201).json({ source: { id: source._id, chatName: source.chatName } });
});

const removeSource = asyncHandler(async (req, res) => {
  const source = await ProjectSource.findOne({ _id: req.params.sourceId, projectId: req.projectId });
  if (!source) throw new ApiError(404, 'Source not found.');

  await source.softDelete(req.user.id);
  res.json({ message: 'Removed.' });
});

/** A readable sender for a raw WhatsApp id like "919876543210@s.whatsapp.net"; group/LID ids are hidden. */
function whatsappPhone(jid) {
  const match = /^\+?(\d{6,15})(@s\.whatsapp\.net)?$/.exec(jid || '');
  return match ? `+${match[1]}` : null;
}

function chunkSourceLabels(chunk) {
  if (chunk.sourceType === 'email') return { chatName: chunk.metadata?.emailSubject || chunk.metadata?.mailbox || null, sender: chunk.metadata?.emailFrom || null };
  if (chunk.sourceType === 'cheerio') {
    return { chatName: chunk.metadata?.cheerioConnection || 'Cheerio', sender: chunk.metadata?.contactName || chunk.metadata?.contactPhone || null };
  }
  return { chatName: chunk.metadata?.chatName || null, sender: chunk.metadata?.senderName || whatsappPhone(chunk.metadata?.senderPhoneNumber || chunk.metadata?.sender) };
}

const MEMORY_SOURCES = ['whatsapp', 'email', 'cheerio'];

// Actual ingested WhatsApp, email and Cheerio knowledge for the project's
// Memory tab — distinct from listSources (which chats/mailboxes/connections
// are picked), this is what got saved from them. Paged newest first, with
// optional ?source=whatsapp|email|cheerio and ?q= text search; the first
// page also carries per-source totals for the filter chips.
const listWhatsAppMemory = asyncHandler(async (req, res) => {
  const page = parseListQuery(req.query);
  const scope = { orgId: req.org.id, projectId: req.projectId, sourceType: { $in: MEMORY_SOURCES } };
  const filter = { ...scope };
  if (MEMORY_SOURCES.includes(req.query.source)) filter.sourceType = req.query.source;
  if (page.search) {
    filter.$or = ['text', 'metadata.chatName', 'metadata.senderName', 'metadata.emailSubject', 'metadata.emailFrom', 'metadata.contactName'].map((field) => ({ [field]: page.search }));
  }

  const [{ rows, hasMore }, countRows] = await Promise.all([
    findPage(Chunk, filter, page),
    page.before
      ? null
      : Chunk.aggregate([
          // aggregate() doesn't cast ids or apply the soft-delete filter, so both are explicit here.
          { $match: { ...scope, orgId: new Types.ObjectId(String(scope.orgId)), projectId: new Types.ObjectId(String(scope.projectId)), deletedAt: null } },
          { $group: { _id: '$sourceType', count: { $sum: 1 } } },
        ]),
  ]);

  res.json({
    chunks: rows.map((c) => ({
      id: c._id,
      sourceType: c.sourceType,
      text: c.text,
      ...chunkSourceLabels(c),
      chatJid: c.metadata?.chatJid || null,
      messageTimestamp: c.metadata?.messageTimestamp || null,
      createdAt: c.createdAt,
    })),
    hasMore,
    ...(countRows ? { counts: Object.fromEntries(MEMORY_SOURCES.map((source) => [source, countRows.find((row) => row._id === source)?.count || 0])) } : {}),
  });
});

module.exports = { listSources, addSource, removeSource, listWhatsAppMemory };
