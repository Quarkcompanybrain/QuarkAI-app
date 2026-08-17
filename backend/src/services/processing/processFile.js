const Sentry = require('@sentry/node');
const File = require('../../models/File');
const Project = require('../../models/Project');
const { getObjectBuffer } = require('../storage/s3.service');
const { resolveHandler } = require('../file_handlers/registry');
const { splitFileIntoChunks } = require('../memory/split.service');
const { decideAndStore } = require('../memory/ingest.service');
const { ingestionDebug } = require('../../utils/ingestionDebug');

/**
 * Fire-and-forget async processing, tracked entirely through File.status
 * (pending -> in_progress -> done|failed). No queue infra at this scale;
 * add one (BullMQ + Redis) only if upload volume later requires it.
 *
 * Splitting and the save/edit decision are separate steps: splitting just
 * breaks the document into candidate pieces, then each one goes through the
 * same decideAndStore used for WhatsApp messages, so a re-uploaded/updated
 * document can correct existing memory instead of just duplicating it.
 */
async function processFile(fileId) {
  const file = await File.findById(fileId);
  if (!file) return { chunkIds: [] };

  try {
    file.status = 'in_progress';
    await file.save();
    ingestionDebug('info', 'file processing started', { fileId: String(file._id), filename: file.filename, mimeType: file.mimeType, sourceType: file.sourceType });

    const buffer = await getObjectBuffer(file.s3Key);
    const handler = resolveHandler(file.mimeType);
    const handlerOutput = await handler.extract({ buffer, mimeType: file.mimeType });

    const candidateChunks = await splitFileIntoChunks(handlerOutput, file.filename);
    if (candidateChunks.length === 0) throw new Error('No extractable content found in this file.');

    let savedCount = 0;
    let editedCount = 0;
    const chunkIds = [];
    const project = file.projectId ? await Project.findById(file.projectId).select('name description').lean() : null;

    for (const [index, text] of candidateChunks.entries()) {
      const outcome = await decideAndStore({
        orgId: file.orgId,
        projectId: file.projectId,
        ownerId: file.ownerId,
        sourceType: file.sourceType === 'whatsapp' ? 'whatsapp' : 'file',
        fileId: file._id,
        text,
        metadata: {
          filename: file.filename,
          chunkIndex: index,
          ...(file.sourceType === 'whatsapp' ? file.whatsapp.toObject?.() || file.whatsapp : {}),
        },
        projectContext: project ? { name: project.name, description: project.description } : null,
      });
      if (outcome.action === 'saved') savedCount++;
      if (outcome.action === 'edited') editedCount++;
      if (outcome.chunkId) chunkIds.push(outcome.chunkId);
    }

    file.status = 'done';
    // A readable file can legitimately yield no durable knowledge (for
    // example, a decorative image). That is a completed evaluation, not a
    // processing failure; only extraction/parsing errors should fail the File.
    file.failureReason = null;
    await file.save();

    Sentry.logger.info('File processed', {
      fileId: String(file._id),
      filename: file.filename,
      candidateCount: candidateChunks.length,
      savedCount,
      editedCount,
    });
    ingestionDebug('info', 'file processing completed', { fileId: String(file._id), candidateCount: candidateChunks.length, savedCount, editedCount });
    return { chunkIds, savedCount, editedCount };
  } catch (err) {
    file.status = 'failed';
    file.failureReason = err.message?.slice(0, 500) || 'Unknown processing error';
    await file.save();
    ingestionDebug('warn', 'file processing failed', {
      fileId: String(file._id),
      filename: file.filename,
      mimeType: file.mimeType,
      reason: file.failureReason,
    });

    Sentry.captureException(err, {
      tags: { pipeline: 'file_processing' },
      extra: { fileId: String(file._id), filename: file.filename, mimeType: file.mimeType },
    });
    throw err;
  }
}

module.exports = { processFile };
