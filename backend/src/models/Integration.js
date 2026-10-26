const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

// One per user per connected account — WhatsApp (via Baileys), email (via
// IMAP) and Cheerio AI (via its "send webhook" workflow step) are personal,
// not org-wide, so this is deliberately not scoped to an org. A user has at
// most one WhatsApp account, up to five mailboxes and up to five Cheerio
// connections. Projects pick which of a user's chats, mailboxes or Cheerio
// connections feed them (see ProjectSource).
const emailFolderSchema = new Schema(
  {
    path: { type: String, required: true },
    role: { type: String, enum: ['inbox', 'sent'], required: true },
    // UIDs are only meaningful within one UIDVALIDITY; if the server resets
    // it, the cursor restarts from the folder's current end.
    uidValidity: { type: String, default: null },
    lastUid: { type: Number, default: null },
  },
  { _id: false }
);

const integrationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['whatsapp', 'email', 'cheerio'], required: true },
    status: { type: String, enum: ['pending', 'connected', 'disconnected', 'failed'], default: 'pending' },
    phoneNumber: { type: String, default: null },
    credsEncrypted: { type: String, default: null }, // Baileys auth creds, IMAP { user, pass } or Cheerio { webhookToken } JSON, AES-256-GCM encrypted
    emailAddress: { type: String, default: null, lowercase: true, trim: true },
    email: {
      host: { type: String, default: null },
      port: { type: Number, default: 993 },
      secure: { type: Boolean, default: true },
      folders: { type: [emailFolderSchema], default: [] },
      lastSyncedAt: { type: Date, default: null },
      // Sync lease, so only one PM2 process polls a mailbox at a time.
      syncLockId: { type: String, default: null },
      syncLockedUntil: { type: Date, default: null },
    },
    cheerio: {
      name: { type: String, default: null, trim: true },
      // Webhooks are looked up by a hash of the secret in their URL; the
      // secret itself is kept encrypted so the URL can be shown again.
      webhookTokenHash: { type: String, default: null },
      lastEventAt: { type: Date, default: null },
    },
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
integrationSchema.index({ 'cheerio.webhookTokenHash': 1 }, { sparse: true });

softDeletePlugin(integrationSchema);

module.exports = model('Integration', integrationSchema);
