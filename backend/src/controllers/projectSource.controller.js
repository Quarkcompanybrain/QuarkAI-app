const Sentry = require('@sentry/node');
const ProjectSource = require('../models/ProjectSource');
const Integration = require('../models/Integration');
const WhatsAppChat = require('../models/WhatsAppChat');
const Chunk = require('../models/Chunk');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

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

// You can only add chats from your own connected account — picking a
// teammate's WhatsApp chats on their behalf isn't something they've
// consented to just by being on the same project.
const addSource = asyncHandler(async (req, res) => {
  const { integrationId, chatJid } = req.body;
  if (!integrationId || !chatJid) throw new ApiError(400, 'integrationId and chatJid are required.');

  const integration = await Integration.findOne({ _id: integrationId, userId: req.user.id });
  if (!integration) throw new ApiError(403, 'You can only add chats from your own connected accounts.');

  const chat = await WhatsAppChat.findOne({ integrationId, jid: chatJid });
  if (!chat) throw new ApiError(404, 'That chat was not found on this account.');

  const existing = await ProjectSource.findOne({ projectId: req.projectId, integrationId, chatJid });
  if (existing) throw new ApiError(409, 'This chat is already a source for this project.');

  const sourceCount = await ProjectSource.countDocuments({ projectId: req.projectId });
  if (sourceCount >= MAX_SOURCES_PER_PROJECT) {
    throw new ApiError(409, `A project can have at most ${MAX_SOURCES_PER_PROJECT} connected chats/groups.`);
  }

  const source = await ProjectSource.create({
    projectId: req.projectId,
    orgId: req.org.id,
    sourceType: 'whatsapp',
    integrationId,
    chatJid,
    chatName: chat.name,
    isGroup: chat.isGroup,
    addedBy: req.user.id,
  });

  Sentry.logger.info('Project source added', { projectId: req.projectId, chatJid });
  res.status(201).json({ source: { id: source._id, chatName: source.chatName } });
});

const removeSource = asyncHandler(async (req, res) => {
  const source = await ProjectSource.findOne({ _id: req.params.sourceId, projectId: req.projectId });
  if (!source) throw new ApiError(404, 'Source not found.');

  await source.softDelete(req.user.id);
  res.json({ message: 'Removed.' });
});

// Actual ingested WhatsApp knowledge for the project's Memory tab — distinct
// from listSources (which chats/groups are picked), this is what got saved
// from them.
const listWhatsAppMemory = asyncHandler(async (req, res) => {
  const chunks = await Chunk.find({ projectId: req.projectId, sourceType: 'whatsapp' })
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({
    chunks: chunks.map((c) => ({
      id: c._id,
      text: c.text,
      chatName: c.metadata?.chatName || null,
      chatJid: c.metadata?.chatJid || null,
      sender: c.metadata?.sender || null,
      messageTimestamp: c.metadata?.messageTimestamp || null,
    })),
  });
});

module.exports = { listSources, addSource, removeSource, listWhatsAppMemory };
