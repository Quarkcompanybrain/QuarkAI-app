const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const chatSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    scope: { type: String, enum: ['personal', 'project'], required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null }, // required if scope === 'project'
    title: { type: String, default: 'New chat' },
  },
  { timestamps: true }
);

chatSessionSchema.index({ userId: 1, orgId: 1 });

softDeletePlugin(chatSessionSchema);

module.exports = model('ChatSession', chatSessionSchema);
