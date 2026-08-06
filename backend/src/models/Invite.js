const { Schema, model } = require('mongoose');

const inviteSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    token: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'accepted', 'expired'], default: 'pending' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

inviteSchema.index({ token: 1 }, { unique: true });
inviteSchema.index({ email: 1, orgId: 1 });

module.exports = model('Invite', inviteSchema);
