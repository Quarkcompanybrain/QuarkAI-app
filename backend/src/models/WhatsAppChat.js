const { Schema, model } = require('mongoose');

// A cache of chats/groups seen on a connected WhatsApp account, so the
// project source picker has something to list without needing a live
// connection at browse time.
const whatsappChatSchema = new Schema(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: 'Integration', required: true },
    jid: { type: String, required: true },
    name: { type: String, default: '' },
    isGroup: { type: Boolean, default: false },
    lastMessageAt: { type: Date, default: null },
    // A bounded plaintext copy of the most recent text/caption is useful when
    // inspecting the parent chat document. Full history remains encrypted in
    // WhatsAppMessage, rather than growing this record without limit.
    lastMessageId: { type: String, default: null },
    lastMessageText: { type: String, default: null },
    lastMessageType: { type: String, default: null },
    lastMessageFromMe: { type: Boolean, default: false },
    memory: {
      hasIngestedMessages: { type: Boolean, default: false },
      ingestedMessageCount: { type: Number, default: 0 },
      projectIds: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
      lastIngestedAt: { type: Date, default: null },
      lastIngestedMessageId: { type: String, default: null },
      // The full, per-message Chunk relationship lives on WhatsAppMessage;
      // this is only a bounded summary for the parent chat record.
      lastMemoryChunkIds: [{ type: Schema.Types.ObjectId, ref: 'Chunk' }],
    },
  },
  { timestamps: true }
);

whatsappChatSchema.index({ integrationId: 1, jid: 1 }, { unique: true });

module.exports = model('WhatsAppChat', whatsappChatSchema);
