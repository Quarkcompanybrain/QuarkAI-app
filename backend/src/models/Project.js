const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    websiteUrl: { type: String, trim: true, default: '', maxlength: 2048 },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

projectSchema.index({ orgId: 1 });

softDeletePlugin(projectSchema);

module.exports = model('Project', projectSchema);
