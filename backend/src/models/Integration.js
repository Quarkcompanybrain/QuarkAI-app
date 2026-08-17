const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

// One per user per connected account — WhatsApp (via Baileys) is personal,
// not org-wide, so this is deliberately not scoped to an org. Projects pick
// which of a user's connected chats feed them (see ProjectSource).
const integrationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['whatsapp'], required: true },
    status: { type: String, enum: ['pending', 'connected', 'disconnected', 'failed'], default: 'pending' },
    phoneNumber: { type: String, default: null },
    credsEncrypted: { type: String, default: null }, // Baileys auth creds JSON, AES-256-GCM encrypted
    lastConnectedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    // Auth keys are required Signal-protocol state. This is observability only:
    // active keys are never automatically pruned, because that could corrupt a
    // valid WhatsApp session.
    authKeyStats: {
      keyCount: { type: Number, default: 0 },
      encryptedBytes: { type: Number, default: 0 },
      categories: { type: Map, of: Number, default: () => new Map() },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

integrationSchema.index({ userId: 1, type: 1 });

softDeletePlugin(integrationSchema);

module.exports = model('Integration', integrationSchema);
