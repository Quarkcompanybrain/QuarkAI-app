const Sentry = require('@sentry/node');
const File = require('../../models/File');
const { getObjectBuffer } = require('../storage/s3.service');
const { resolveHandler } = require('../file_handlers/registry');
const { chunkWithHaiku } = require('../chunking/haiku.service');
const { embedTexts } = require('../embeddings/openai.service');
const { insertChunks } = require('../vectorstore/atlas.service');

/**
 * Fire-and-forget async processing, tracked entirely through File.status
 * (pending -> in_progress -> done|failed). No queue infra at this scale;
 * add one (BullMQ + Redis) only if upload volume later requires it.
 */
async function processFile(fileId) {
  const file = await File.findById(fileId);
  if (!file) return;

  try {
    file.status = 'in_progress';
    await file.save();

    const buffer = await getObjectBuffer(file.s3Key);
    const handler = resolveHandler(file.mimeType);
    const handlerOutput = await handler.extract({ buffer, mimeType: file.mimeType });

    const chunkTexts = await chunkWithHaiku(handlerOutput, file.filename);
    if (chunkTexts.length === 0) throw new Error('No extractable content found in this file.');

    const embeddings = await embedTexts(chunkTexts);

    const chunkDocs = chunkTexts.map((text, index) => ({
      fileId: file._id,
      orgId: file.orgId,
      projectId: file.projectId,
      ownerId: file.ownerId,
      text,
      embedding: embeddings[index],
      metadata: { filename: file.filename, chunkIndex: index },
    }));

    await insertChunks(chunkDocs);

    file.status = 'done';
    await file.save();

    Sentry.logger.info('File processed', {
      fileId: String(file._id),
      filename: file.filename,
      chunkCount: chunkDocs.length,
    });
  } catch (err) {
    file.status = 'failed';
    file.failureReason = err.message?.slice(0, 500) || 'Unknown processing error';
    await file.save();

    Sentry.captureException(err, {
      tags: { pipeline: 'file_processing' },
      extra: { fileId: String(file._id), filename: file.filename, mimeType: file.mimeType },
    });
  }
}

module.exports = { processFile };
