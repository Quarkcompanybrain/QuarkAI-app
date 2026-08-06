const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const fileSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null }, // null => personal
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    s3Key: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'done', 'failed'],
      default: 'pending',
    },
    failureReason: { type: String, default: null },
  },
  { timestamps: true }
);

fileSchema.index({ orgId: 1, projectId: 1 });
fileSchema.index({ orgId: 1, ownerId: 1 });

softDeletePlugin(fileSchema);

module.exports = model('File', fileSchema);
