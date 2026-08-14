const Sentry = require('@sentry/node');
const ProjectSource = require('../models/ProjectSource');
const Integration = require('../models/Integration');
const WhatsAppChat = require('../models/WhatsAppChat');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

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

module.exports = { listSources, addSource, removeSource };
