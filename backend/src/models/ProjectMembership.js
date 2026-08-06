const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const projectMembershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

projectMembershipSchema.index({ userId: 1, projectId: 1 }, { unique: true });

softDeletePlugin(projectMembershipSchema);

module.exports = model('ProjectMembership', projectMembershipSchema);
