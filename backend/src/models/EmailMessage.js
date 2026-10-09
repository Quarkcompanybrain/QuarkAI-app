const { Schema, model } = require('mongoose');

// Per-project ingestion state for one email. Each project linked to the
// mailbox evaluates the email independently, like WhatsApp messages.
const projectIngestionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sourceId: { type: Schema.Types.ObjectId, ref: 'ProjectSource', required: true },
    status: { type: String, enum: ['pending', 'processing', 'skipped', 'ingested', 'partial', 'failed'], required: true },
    reason: { type: String, default: null },
    memoryChunkIds: [{ type: Schema.Types.ObjectId, ref: 'Chunk' }],
    fileIds: [{ type: Schema.Types.ObjectId, ref: 'File' }],
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    claimId: { type: String, default: null },
    processingExpiresAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
  },
  { _id: false }
);

const addressSchema = new Schema({ name: { type: String, default: '' }, address: { type: String, default: '' } }, { _id: false });

const attachmentSchema = new Schema(
  {
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    // Uploaded once at sync time; each project's File record points at it.
    s3Key: { type: String, default: null },
    skippedReason: { type: String, default: null },
  },
  { _id: false }
);

// One durable record per email in a linked mailbox. Only mailboxes linked to
// at least one project are fetched, so unlinked mail never reaches the DB.
const emailMessageSchema = new Schema(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: 'Integration', required: true },
    mailbox: { type: String, required: true }, // the connected address
    folder: { type: String, required: true },
    uid: { type: Number, required: true },
    messageId: { type: String, required: true }, // RFC 5322 Message-ID, or a synthetic one when absent
    threadKey: { type: String, required: true },
    inReplyTo: { type: String, default: null },
    subject: { type: String, default: '' },
    from: { type: addressSchema, default: () => ({}) },
    to: { type: [addressSchema], default: [] },
    cc: { type: [addressSchema], default: [] },
    fromMe: { type: Boolean, required: true },
    sentAt: { type: Date, required: true },
    // Plaintext body (capped) and the new part of a reply with quoted history removed.
    text: { type: String, default: '' },
    replyText: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    isAutomated: { type: Boolean, default: false },
    ingestionStatus: { type: String, enum: ['pending', 'processed', 'partial', 'failed'], default: 'pending' },
    hasIngestedMemory: { type: Boolean, default: false },
    projectIngestions: { type: [projectIngestionSchema], default: [] },
  },
  { timestamps: true }
);

// The same email can appear in INBOX and Sent (mail to yourself) or be
// refetched after a crash; Message-ID keeps it to one record per mailbox.
emailMessageSchema.index({ integrationId: 1, messageId: 1 }, { unique: true });
emailMessageSchema.index({ integrationId: 1, threadKey: 1, sentAt: -1 });
emailMessageSchema.index({ 'projectIngestions.status': 1, 'projectIngestions.nextAttemptAt': 1 });
emailMessageSchema.index({ 'projectIngestions.projectId': 1, createdAt: -1 });

module.exports = model('EmailMessage', emailMessageSchema);
