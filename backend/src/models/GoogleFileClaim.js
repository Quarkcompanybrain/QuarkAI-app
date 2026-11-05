const { Schema, model } = require('mongoose');

// Every Quark org uses the same Google service account, so a file shared with
// it is reachable from any org that has its link. The first org to use a file
// claims it; the bot refuses that file to every other org.
const googleFileClaimSchema = new Schema(
  {
    fileId: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['sheet', 'doc'], required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = model('GoogleFileClaim', googleFileClaimSchema);
