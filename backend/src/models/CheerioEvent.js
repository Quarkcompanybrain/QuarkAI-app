const { Schema, model } = require('mongoose');

// Per-project ingestion state for one Cheerio event. Each project linked to
// the connection evaluates the event independently, like emails.
const projectIngestionSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    sourceId: { type: Schema.Types.ObjectId, ref: 'ProjectSource', required: true },
    status: { type: String, enum: ['pending', 'processing', 'skipped', 'ingested', 'failed'], required: true },
    reason: { type: String, default: null },
    memoryChunkIds: [{ type: Schema.Types.ObjectId, ref: 'Chunk' }],
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    claimId: { type: String, default: null },
    processingExpiresAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
  },
  { _id: false }
);

// One durable record per webhook call from a Cheerio AI workflow ("send
// webhook" step). Cheerio lets the customer shape the request body, so the
// fields here are what we could recognise in it; payloadJson keeps the
// original (capped). Calls for a connection that feeds no project are
// acknowledged but never stored.
const cheerioEventSchema = new Schema(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: 'Integration', required: true },
    // Cheerio's own message/event id when the payload has one, otherwise a
    // hash of the body, so a repeated delivery is stored only once.
    eventKey: { type: String, required: true },
    channel: { type: String, default: null },
    direction: { type: String, enum: ['inbound', 'outbound', 'unknown'], default: 'unknown' },
    contactName: { type: String, default: null },
    contactPhone: { type: String, default: null },
    contactEmail: { type: String, default: null },
    // Groups events from the same customer conversation for context.
    conversationKey: { type: String, default: null },
    text: { type: String, required: true },
    payloadJson: { type: String, default: '' },
    occurredAt: { type: Date, required: true },
    ingestionStatus: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending' },
    hasIngestedMemory: { type: Boolean, default: false },
    projectIngestions: { type: [projectIngestionSchema], default: [] },
  },
  { timestamps: true }
);

cheerioEventSchema.index({ integrationId: 1, eventKey: 1 }, { unique: true });
cheerioEventSchema.index({ integrationId: 1, conversationKey: 1, occurredAt: -1 });
cheerioEventSchema.index({ 'projectIngestions.status': 1, 'projectIngestions.nextAttemptAt': 1 });

module.exports = model('CheerioEvent', cheerioEventSchema);
