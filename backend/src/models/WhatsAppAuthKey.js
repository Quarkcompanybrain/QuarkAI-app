const { Schema, model } = require('mongoose');

// Baileys' signal-protocol key store (pre-keys, sessions, sender-keys, etc.),
// backed by Mongo instead of the library's default filesystem store so
// sessions survive across deploys/restarts. Values are encrypted at rest —
// this data is equivalent to full WhatsApp session access.
const whatsappAuthKeySchema = new Schema(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: 'Integration', required: true },
    category: { type: String, required: true },
    keyId: { type: String, required: true },
    valueEncrypted: { type: String, required: true },
  },
  { timestamps: true }
);

whatsappAuthKeySchema.index({ integrationId: 1, category: 1, keyId: 1 }, { unique: true });

module.exports = model('WhatsAppAuthKey', whatsappAuthKeySchema);
