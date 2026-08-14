const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

// Which external chats/knowledge sources feed a project's memory. Looked up
// by (integrationId, chatJid) whenever a new WhatsApp message arrives, to
// find every project that should evaluate it for ingestion.
const projectSourceSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    sourceType: { type: String, enum: ['whatsapp'], required: true },
    integrationId: { type: Schema.Types.ObjectId, ref: 'Integration', required: true },
    chatJid: { type: String, required: true },
    chatName: { type: String, default: '' },
    isGroup: { type: Boolean, default: false },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

projectSourceSchema.index({ projectId: 1 });
projectSourceSchema.index({ integrationId: 1, chatJid: 1 });

softDeletePlugin(projectSourceSchema);

module.exports = model('ProjectSource', projectSourceSchema);
