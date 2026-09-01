const { Schema, model } = require('mongoose');

// A lease, not a message queue. It prevents multiple PM2 processes from
// simultaneously claiming different portions of the same chat/project burst.
const whatsappIngestionBatchSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    lockId: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    lastCompletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

whatsappIngestionBatchSchema.index({ lockedUntil: 1 });

module.exports = model('WhatsAppIngestionBatch', whatsappIngestionBatchSchema);
