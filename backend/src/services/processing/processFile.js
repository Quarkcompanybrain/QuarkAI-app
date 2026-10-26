const Sentry = require('@sentry/node');
const { randomUUID } = require('crypto');
const File = require('../../models/File');
const Project = require('../../models/Project');
const { getObjectBuffer } = require('../storage/s3.service');
const { resolveHandler } = require('../file_handlers/registry');
const { splitFileIntoChunks } = require('../memory/split.service');
const { decideAndStore } = require('../memory/ingest.service');
const { isAiPaused, nextRetry, shouldReport } = require('../../utils/aiErrors');

const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const WORKER_POLL_MS = 60 * 1000;
const WORKER_BATCH_SIZE = 10;
// WhatsApp attachments are retried through their message's project
// ingestion, which reprocesses the same File, so the file worker leaves them alone.
const WORKER_SOURCE_TYPES = ['upload', 'email'];

let workerTimer = null;
let workerRunning = false;

/**
 * Async processing, tracked entirely through File.status
 * (pending -> in_progress -> done|failed). No queue infra at this scale;
 * add one (BullMQ + Redis) only if upload volume later requires it.
 *
 * Splitting and the save/edit decision are separate steps: splitting just
 * breaks the document into candidate pieces, then each one goes through the
 * same decideAndStore used for WhatsApp messages, so a re-uploaded/updated
 * document can correct existing memory instead of just duplicating it.
 *
 * A temporary AI failure (rate limit, out of credits, outage) puts the File
 * back to pending with a retry time instead of failing it; the file worker
 * picks it up then. The error is still thrown so callers know this attempt failed.
 */
async function processFile(fileId, { traceId = randomUUID() } = {}) {
  const now = new Date();
  // Claiming atomically keeps two processes (or a retry and a recovery)
  // from processing the same File at once.
  const file = await File.findOneAndUpdate(
    { _id: fileId, deletedAt: null, $or: [{ status: { $ne: 'in_progress' } }, { processingExpiresAt: { $lte: now } }] },
    { $set: { status: 'in_progress', nextAttemptAt: null, processingExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS) }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!file) {
    if (!(await File.exists({ _id: fileId, deletedAt: null }))) return { chunkIds: [] };
    throw Object.assign(new Error('This file is already being processed.'), { retryable: true });
  }

  try {
    Sentry.logger.info('File AI processing started', { traceId, file });

    const buffer = await getObjectBuffer(file.s3Key);
    Sentry.logger.info('File AI processing downloaded storage object', { traceId, fileId: String(file._id), bytes: buffer.length });
    const handler = resolveHandler(file.mimeType);
    const handlerOutput = await handler.extract({ buffer, mimeType: file.mimeType });
    Sentry.logger.info('File AI processing extracted content', {
      traceId,
      fileId: String(file._id),
      handlerOutput: handlerOutput.kind === 'file'
        ? { kind: handlerOutput.kind, mediaType: handlerOutput.mediaType, base64Length: handlerOutput.base64?.length || 0 }
        : handlerOutput,
    });

    const candidateChunks = await splitFileIntoChunks(handlerOutput, file.filename, { traceId });
    if (candidateChunks.length === 0) throw new Error('No extractable content found in this file.');
    Sentry.logger.info('File AI processing split candidates', { traceId, fileId: String(file._id), candidateChunks });

    let savedCount = 0;
    let editedCount = 0;
    const chunkIds = [];
    const project = file.projectId ? await Project.findById(file.projectId).select('name description websiteUrl').lean() : null;

    for (const [index, text] of candidateChunks.entries()) {
      const outcome = await decideAndStore({
        orgId: file.orgId,
        projectId: file.projectId,
        ownerId: file.ownerId,
        sourceType: ['whatsapp', 'email'].includes(file.sourceType) ? file.sourceType : 'file',
        fileId: file._id,
        text,
        metadata: {
          filename: file.filename,
          chunkIndex: index,
          traceId,
          ...(file.sourceType === 'whatsapp' ? file.whatsapp.toObject?.() || file.whatsapp : {}),
          ...(file.sourceType === 'email'
            ? {
                integrationId: file.email.integrationId,
                emailMessageId: file.email.emailMessageId,
                mailbox: file.email.mailbox,
                emailSubject: file.email.subject,
                emailFrom: file.email.from,
                messageTimestamp: file.email.sentAt,
              }
            : {}),
        },
        projectContext: project ? { name: project.name, description: project.description, websiteUrl: project.websiteUrl } : null,
      });
      if (outcome.action === 'saved') savedCount++;
      if (outcome.action === 'edited') editedCount++;
      if (outcome.chunkId) chunkIds.push(outcome.chunkId);
      Sentry.logger.info('File AI candidate ingestion completed', { traceId, fileId: String(file._id), chunkIndex: index, candidateText: text, outcome });
    }

    file.status = 'done';
    // A readable file can legitimately yield no durable knowledge (for
    // example, a decorative image). That is a completed evaluation, not a
    // processing failure; only extraction/parsing errors should fail the File.
    file.failureReason = null;
    file.processingExpiresAt = null;
    await file.save();

    Sentry.logger.info('File processed', {
      fileId: String(file._id),
      filename: file.filename,
      candidateCount: candidateChunks.length,
      savedCount,
      editedCount,
      traceId,
    });
    return { chunkIds, savedCount, editedCount };
  } catch (err) {
    const retry = nextRetry(err, file.attempts);
    file.status = retry ? 'pending' : 'failed';
    file.nextAttemptAt = retry?.at || null;
    if (retry && !retry.countsAsAttempt) file.attempts -= 1;
    file.processingExpiresAt = null;
    file.failureReason = err.message?.slice(0, 500) || 'Unknown processing error';
    await file.save();

    if (shouldReport(err)) {
      Sentry.captureException(err, {
        tags: { pipeline: 'file_processing' },
        extra: { traceId, fileId: String(file._id), filename: file.filename, mimeType: file.mimeType, attempts: file.attempts, retryAt: retry?.at || null },
      });
    }
    throw err;
  }
}

/** Recovers Files whose processing lease ran out, then retries the ones that are due. */
async function processDueFiles() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const now = new Date();
    const recovered = await File.updateMany(
      { status: 'in_progress', deletedAt: null, $or: [{ processingExpiresAt: null }, { processingExpiresAt: { $lte: now } }] },
      { $set: { status: 'pending', nextAttemptAt: now, processingExpiresAt: null, failureReason: 'Recovered after interrupted processing.' } }
    );
    if (recovered.modifiedCount) Sentry.logger.info('File processing recovered expired leases', { count: recovered.modifiedCount });
    if (isAiPaused()) return;

    const due = await File.find({ status: 'pending', sourceType: { $in: WORKER_SOURCE_TYPES }, nextAttemptAt: { $ne: null, $lte: now } })
      .sort({ nextAttemptAt: 1 })
      .limit(WORKER_BATCH_SIZE)
      .select('_id')
      .lean();
    for (const { _id } of due) {
      if (isAiPaused()) return;
      // processFile records the outcome on the File and reports to Sentry.
      await processFile(_id).catch(() => {});
    }
  } finally {
    workerRunning = false;
  }
}

function startFileWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    processDueFiles().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'file_worker' } }));
  }, WORKER_POLL_MS);
  workerTimer.unref?.();
  processDueFiles().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'file_worker_start' } }));
}

module.exports = { processFile, startFileWorker };
