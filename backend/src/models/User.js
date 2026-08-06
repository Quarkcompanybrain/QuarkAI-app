const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    hashedPassword: { type: String, default: null },
    name: { type: String, default: '' },
    avatarKey: { type: String, default: null }, // S3 key; signed URL generated on read
    lastActiveOrgId: { type: Schema.Types.ObjectId, ref: 'Org', default: null },
  },
  { timestamps: true }
);

softDeletePlugin(userSchema);

module.exports = model('User', userSchema);
