const Sentry = require('@sentry/node');
const ProjectSource = require('../../models/ProjectSource');
const Project = require('../../models/Project');
const Integration = require('../../models/Integration');
const WhatsAppChat = require('../../models/WhatsAppChat');
const { isMessageRelevantToProject } = require('../agent/claude.service');
const { embedText } = require('../embeddings/openai.service');
const { insertChunks } = require('../vectorstore/atlas.service');

function extractText(message) {
  const m = message.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    null
  );
}

/**
 * Runs on every inbound WhatsApp message. Cheap early-exits (no text, no
 * project has subscribed to this chat) before ever calling Haiku, since most
 * messages across all connected accounts will hit neither project's radar.
 */
async function handleIncomingMessage(integrationId, message) {
  const text = extractText(message)?.trim();
  if (!text) return;

  const chatJid = message.key.remoteJid;
  if (!chatJid) return;

  const sources = await ProjectSource.find({ integrationId, chatJid, sourceType: 'whatsapp' });
  if (sources.length === 0) return;

  const integration = await Integration.findById(integrationId);
  if (!integration) return;

  const sender = message.key.participant || message.key.remoteJid;
  const messageTimestamp = message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000) : new Date();

  // Keep the chat's display name fresh for the project settings picker.
  WhatsAppChat.findOneAndUpdate(
    { integrationId, jid: chatJid },
    { lastMessageAt: messageTimestamp },
    { upsert: true }
  ).catch(() => {});

  for (const source of sources) {
    try {
      const project = await Project.findById(source.projectId);
      if (!project) continue;

      const relevant = await isMessageRelevantToProject({ projectName: project.name, message: text });
      if (!relevant) continue;

      const embedding = await embedText(text);
      await insertChunks([
        {
          sourceType: 'whatsapp',
          fileId: null,
          orgId: source.orgId,
          projectId: source.projectId,
          ownerId: integration.userId,
          text,
          embedding,
          metadata: {
            integrationId: integration._id,
            chatJid,
            chatName: source.chatName,
            sender,
            messageTimestamp,
          },
        },
      ]);

      Sentry.logger.info('WhatsApp message ingested', {
        projectId: String(source.projectId),
        chatJid,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { pipeline: 'whatsapp_ingest_project' },
        extra: { projectId: String(source.projectId), chatJid },
      });
    }
  }
}

module.exports = { handleIncomingMessage };
