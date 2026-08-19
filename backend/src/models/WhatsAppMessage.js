const { Schema, model } = require('mongoose');

// One durable record for every WhatsApp message event. This deliberately
// stays separate from WhatsAppChat: a chat may contain an unbounded number of
// messages, while WhatsAppChat remains the lightweight chat/source cache used
// by the project settings UI.
const projectIngestionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sourceId: { type: Schema.Types.ObjectId, ref: 'ProjectSource', required: true },
    status: { type: String, enum: ['pending', 'skipped', 'ingested', 'partial', 'failed'], required: true },
    reason: { type: String, default: null },
    memoryChunkIds: [{ type: Schema.Types.ObjectId, ref: 'Chunk' }],
    fileIds: [{ type: Schema.Types.ObjectId, ref: 'File' }],
    processedAt: { type: Date, default: null },
  },
  { _id: false }
);

const whatsappMessageSchema = new Schema(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: 'Integration', required: true },
    messageId: { type: String, required: true },
    // Canonical JID used by the chat cache and project source. Baileys may
    // deliver a LID as the event JID plus a phone-number alternate JID.
    chatJid: { type: String, required: true },
    eventChatJid: { type: String, required: true },
    eventChatJidAlt: { type: String, default: null },
    chatName: { type: String, default: '' },
    isGroup: { type: Boolean, default: false },
    senderJid: { type: String, default: null },
    senderName: { type: String, default: null },
    senderPhoneNumber: { type: String, default: null },
    fromMe: { type: Boolean, required: true },
    messageType: { type: String, required: true },
    // Message content is encrypted with the integration key. It is retained
    // for auditability and future replay, but never exposed by this model.
    contentEncrypted: { type: String, default: null },
    quotedMessageId: { type: String, default: null },
    mentionedJids: { type: [String], default: [] },
    sentAt: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },
    ingestionStatus: {
      type: String,
      enum: ['pending', 'not_subscribed', 'processed', 'partial', 'failed'],
      default: 'pending',
    },
    hasIngestedMemory: { type: Boolean, default: false },
    projectIngestions: { type: [projectIngestionSchema], default: [] },
  },
  { timestamps: true }
);

// Baileys may repeat an event while reconnecting. The key prevents the same
// WhatsApp message from being stored or ingested more than once.
whatsappMessageSchema.index({ integrationId: 1, messageId: 1, chatJid: 1, fromMe: 1 }, { unique: true });
whatsappMessageSchema.index({ integrationId: 1, chatJid: 1, sentAt: -1 });
whatsappMessageSchema.index({ 'projectIngestions.projectId': 1 });

module.exports = model('WhatsAppMessage', whatsappMessageSchema);
