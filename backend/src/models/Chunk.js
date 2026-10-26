const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const chunkSchema = new Schema(
  {
    sourceType: { type: String, enum: ['file', 'whatsapp', 'email', 'cheerio'], default: 'file' },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', default: null }, // set when sourceType === 'file'
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null }, // null => personal (file sources only)
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    // The text's embedding as a BSON float32 vector (see toStoredVector),
    // indexed by an Atlas Vector Search index (see docs/atlas-vector-index.json).
    vector: { type: Buffer, subtype: 9, required: true },
    metadata: {
      filename: String,
      chunkIndex: Number,
      // whatsapp sourceType only:
      integrationId: { type: Schema.Types.ObjectId, ref: 'Integration' },
      chatJid: String,
      chatName: String,
      sender: String,
      senderName: String,
      senderPhoneNumber: String,
      fromMe: Boolean,
      sourceMessageId: { type: Schema.Types.ObjectId, ref: 'WhatsAppMessage' },
      // A batch-derived fact can be supported by more than one message. The
      // original sourceMessageId remains for backwards-compatible callers.
      sourceMessageIds: [{ type: Schema.Types.ObjectId, ref: 'WhatsAppMessage' }],
      whatsappMessageId: String,
      messageTimestamp: Date,
      // email sourceType only (integrationId and messageTimestamp are shared):
      emailMessageId: { type: Schema.Types.ObjectId, ref: 'EmailMessage' },
      mailbox: String,
      emailSubject: String,
      emailFrom: String,
      emailThreadKey: String,
      // cheerio sourceType only (integrationId and messageTimestamp are shared):
      cheerioEventId: { type: Schema.Types.ObjectId, ref: 'CheerioEvent' },
      cheerioConnection: String,
      cheerioChannel: String,
      contactName: String,
      contactPhone: String,
    },
  },
  { timestamps: true }
);

chunkSchema.index({ orgId: 1, projectId: 1 });
chunkSchema.index({ orgId: 1, ownerId: 1 });
chunkSchema.index({ fileId: 1 });

softDeletePlugin(chunkSchema);

module.exports = model('Chunk', chunkSchema);
