#!/usr/bin/env node
/**
 * Puts ingestion that failed for reasons that no longer apply back in the
 * queue: AI rate limits, the OpenAI or Anthropic account running out of credits, and two
 * request bugs fixed since (empty message content, the `max_tokens`
 * parameter). Also unsticks WhatsApp attachment entries left pending by an
 * interrupted worker, and resets the attempt counters inflated by the old
 * unbounded batch retry loop.
 *
 *   node scripts/migrations/requeue-failed-ingestion.js           (counts only)
 *   node scripts/migrations/requeue-failed-ingestion.js --apply
 *
 * Non-destructive: it only changes ingestion status fields (status, reason,
 * attempts, nextAttemptAt, and the File link on WhatsApp entries). Nothing is
 * deleted, and entries it can't retry (e.g. media that was never stored) are
 * left as they are. Re-runnable. Uses MONGODB_URI from the environment or backend/.env.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { connectDb } = require('../../src/config/db');

const RETRYABLE_REASON = /no credits remaining|credit balance is too low|rate limit reached|unsupported parameter: 'max_tokens'|user messages must have non-empty content|recovered after interrupted/i;
const REQUEUE_REASON = 'Requeued after the error that stopped it was resolved.';
const apply = process.argv.includes('--apply');

function stuckOrRetryable(entry) {
  if (entry.status === 'failed') return RETRYABLE_REASON.test(entry.reason || '');
  // Attachment entries the old single-pass ingestion left pending with no retry scheduled.
  return entry.status === 'pending' && !entry.batchEligible && !entry.nextAttemptAt;
}

async function requeueWhatsApp(db, now) {
  const messages = db.collection('whatsappmessages');
  const files = db.collection('files');
  const counts = { attachment: 0, text: 0, notRetryable: 0, attemptsReset: 0 };
  const writes = [];
  const fileIds = [];

  const cursor = messages.find(
    { projectIngestions: { $elemMatch: { $or: [{ status: 'failed', reason: RETRYABLE_REASON }, { status: 'pending', batchEligible: { $ne: true }, nextAttemptAt: null }] } } },
    { projection: { content: 1, projectIngestions: 1 } }
  );
  for await (const message of cursor) {
    const set = {};
    for (const [index, entry] of message.projectIngestions.entries()) {
      if (!stuckOrRetryable(entry)) continue;
      const path = `projectIngestions.${index}`;
      // Media can't be downloaded again, so an attachment is retried only through the File stored for it.
      const file = await files.findOne({ sourceType: 'whatsapp', 'whatsapp.sourceMessageId': message._id, projectId: entry.projectId }, { projection: { _id: 1 } });
      if (!file && !message.content) {
        counts.notRetryable++;
        continue;
      }
      Object.assign(set, {
        [`${path}.status`]: 'pending',
        [`${path}.reason`]: REQUEUE_REASON,
        [`${path}.attempts`]: 0,
        [`${path}.nextAttemptAt`]: now,
        [`${path}.processedAt`]: null,
        [`${path}.batchEligible`]: !file,
        ...(file ? { [`${path}.fileIds`]: [file._id] } : {}),
      });
      if (file) {
        fileIds.push(file._id);
        counts.attachment++;
      } else {
        counts.text++;
      }
    }
    if (Object.keys(set).length) {
      writes.push({ updateOne: { filter: { _id: message._id }, update: { $set: { ...set, ingestionStatus: 'pending' } } } });
    }
  }

  const inflated = await messages.countDocuments({ projectIngestions: { $elemMatch: { status: 'pending', attempts: { $gt: 0 } } } });
  counts.attemptsReset = inflated;
  console.log('WhatsApp entries:', counts);
  if (!apply) return;

  for (let i = 0; i < writes.length; i += 500) await messages.bulkWrite(writes.slice(i, i + 500), { ordered: false });
  // The File is reprocessed by its message's retry, so it just needs to be claimable.
  if (fileIds.length) {
    await files.updateMany({ _id: { $in: fileIds }, status: { $in: ['failed', 'in_progress'] } }, { $set: { status: 'pending', attempts: 0, nextAttemptAt: null, processingExpiresAt: null, failureReason: null } });
  }
  await messages.updateMany(
    { projectIngestions: { $elemMatch: { status: 'pending', attempts: { $gt: 0 } } } },
    { $set: { 'projectIngestions.$[entry].attempts': 0 } },
    { arrayFilters: [{ 'entry.status': 'pending', 'entry.attempts': { $gt: 0 } }] }
  );
}

async function requeueFiles(db, now) {
  // WhatsApp files are retried through their message entries above.
  const filter = { status: 'failed', sourceType: { $in: ['upload', 'email'] }, failureReason: RETRYABLE_REASON };
  console.log('Uploaded and email files:', await db.collection('files').countDocuments(filter));
  if (!apply) return;
  await db.collection('files').updateMany(filter, { $set: { status: 'pending', attempts: 0, nextAttemptAt: now, failureReason: REQUEUE_REASON } });
}

async function requeueEmails(db, now) {
  const filter = { projectIngestions: { $elemMatch: { status: 'failed', reason: RETRYABLE_REASON } } };
  console.log('Emails:', await db.collection('emailmessages').countDocuments(filter));
  if (!apply) return;
  await db.collection('emailmessages').updateMany(
    filter,
    {
      $set: {
        ingestionStatus: 'pending',
        'projectIngestions.$[entry].status': 'pending',
        'projectIngestions.$[entry].reason': REQUEUE_REASON,
        'projectIngestions.$[entry].attempts': 0,
        'projectIngestions.$[entry].nextAttemptAt': now,
        'projectIngestions.$[entry].processedAt': null,
      },
    },
    { arrayFilters: [{ 'entry.status': 'failed', 'entry.reason': RETRYABLE_REASON }] }
  );
}

(async () => {
  await connectDb();
  const db = mongoose.connection.db;
  console.log(`Database: ${db.databaseName}${apply ? '' : ' (counts only; pass --apply to requeue)'}`);
  const now = new Date();
  await requeueWhatsApp(db, now);
  await requeueFiles(db, now);
  await requeueEmails(db, now);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect();
  process.exit(1);
});
