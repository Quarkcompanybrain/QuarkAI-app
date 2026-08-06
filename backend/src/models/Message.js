const { Schema, model } = require('mongoose');

const messageSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'ChatSession', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    citedChunkIds: [{ type: Schema.Types.ObjectId, ref: 'Chunk' }],
  },
  { timestamps: true }
);

messageSchema.index({ sessionId: 1, createdAt: 1 });

module.exports = model('Message', messageSchema);
