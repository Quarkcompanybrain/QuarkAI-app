const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const orgMembershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

orgMembershipSchema.index({ userId: 1, orgId: 1 }, { unique: true });

softDeletePlugin(orgMembershipSchema);

module.exports = model('OrgMembership', orgMembershipSchema);
