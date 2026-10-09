const { Schema, model } = require('mongoose');

// One record per org per local report date. The unique index doubles as the
// send lease: whichever PM2 process inserts it first owns that day's report,
// so admins never get the same brief twice.
const dailyReportSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    reportDate: { type: String, required: true }, // YYYY-MM-DD in DAILY_REPORT_TIMEZONE
    status: { type: String, enum: ['processing', 'sent', 'skipped', 'failed'], required: true },
    reason: { type: String, default: null },
    // Fixed on first claim so a retry covers exactly the same window.
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    recipients: { type: [String], default: [] },
    sentAt: { type: Date, default: null },
    stats: {
      activeProjectCount: { type: Number, default: 0 },
      newMemoryCount: { type: Number, default: 0 },
      updatedMemoryCount: { type: Number, default: 0 },
      fileCount: { type: Number, default: 0 },
      whatsappMessageCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

dailyReportSchema.index({ orgId: 1, reportDate: 1 }, { unique: true });
dailyReportSchema.index({ orgId: 1, windowEnd: -1 });

module.exports = model('DailyReport', dailyReportSchema);
