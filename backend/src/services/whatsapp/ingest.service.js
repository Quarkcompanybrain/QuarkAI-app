const Sentry = require('@sentry/node');
const ProjectSource = require('../../models/ProjectSource');
const Integration = require('../../models/Integration');
const WhatsAppChat = require('../../models/WhatsAppChat');
const { decideAndStore } = require('../memory/ingest.service');

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
 * The actual save/skip/edit decision is delegated to the same decideAndStore
 * used for file ingestion, so both sources dedupe and update each other
 * identically.
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
      const outcome = await decideAndStore({
        orgId: source.orgId,
        projectId: source.projectId,
        ownerId: integration.userId,
        sourceType: 'whatsapp',
        text,
        metadata: {
          integrationId: integration._id,
          chatJid,
          chatName: source.chatName,
          sender,
          messageTimestamp,
        },
      });

      if (outcome.action !== 'skipped') {
        Sentry.logger.info('WhatsApp message ingested', {
          projectId: String(source.projectId),
          chatJid,
          action: outcome.action,
        });
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { pipeline: 'whatsapp_ingest_project' },
        extra: { projectId: String(source.projectId), chatJid },
      });
    }
  }
}

module.exports = { handleIncomingMessage };
