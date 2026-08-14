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
  },
  { timestamps: true }
);

whatsappChatSchema.index({ integrationId: 1, jid: 1 }, { unique: true });

module.exports = model('WhatsAppChat', whatsappChatSchema);
