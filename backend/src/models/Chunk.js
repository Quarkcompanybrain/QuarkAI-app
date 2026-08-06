const { Schema, model } = require('mongoose');
const { softDeletePlugin } = require('../utils/softDeletePlugin');

const chunkSchema = new Schema(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null }, // null => personal
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true }, // indexed by an Atlas Vector Search index (see docs/atlas-vector-index.json)
    metadata: {
      filename: String,
      chunkIndex: Number,
    },
  },
  { timestamps: true }
);

chunkSchema.index({ orgId: 1, projectId: 1 });
chunkSchema.index({ orgId: 1, ownerId: 1 });
chunkSchema.index({ fileId: 1 });

softDeletePlugin(chunkSchema);

module.exports = model('Chunk', chunkSchema);
