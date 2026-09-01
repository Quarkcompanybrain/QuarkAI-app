const Sentry = require('@sentry/node');
const Chunk = require('../models/Chunk');
const { embedText } = require('../services/embeddings/openai.service');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const updateProjectChunk = asyncHandler(async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) throw new ApiError(400, 'text is required.');
  if (text.length > 50000) throw new ApiError(400, 'text must be 50,000 characters or fewer.');

  const chunk = await Chunk.findOne({ _id: req.params.chunkId, projectId: req.projectId, orgId: req.org.id });
  if (!chunk) throw new ApiError(404, 'Knowledge entry not found.');

  chunk.text = text;
  chunk.embedding = await embedText(text, { operation: 'project_chunk_admin_edit', projectId: req.projectId, chunkId: String(chunk._id), userId: req.user.id });
  await chunk.save();

  Sentry.logger.info('Project knowledge entry updated', { projectId: req.projectId, chunkId: String(chunk._id), userId: req.user.id });
  res.json({ chunk: { id: chunk._id, text: chunk.text } });
});

const deleteProjectChunk = asyncHandler(async (req, res) => {
  const chunk = await Chunk.findOne({ _id: req.params.chunkId, projectId: req.projectId, orgId: req.org.id });
  if (!chunk) throw new ApiError(404, 'Knowledge entry not found.');

  await chunk.softDelete(req.user.id);

  Sentry.logger.info('Project knowledge entry deleted', { projectId: req.projectId, chunkId: String(chunk._id), userId: req.user.id });
  res.json({ message: 'Knowledge entry deleted.' });
});

module.exports = { updateProjectChunk, deleteProjectChunk };
