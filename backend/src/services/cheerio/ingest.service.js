const Sentry = require('@sentry/node');
const { randomUUID } = require('crypto');
const CheerioEvent = require('../../models/CheerioEvent');
const ProjectSource = require('../../models/ProjectSource');
const Integration = require('../../models/Integration');
const Project = require('../../models/Project');
const { decideAndStore } = require('../memory/ingest.service');
const { splitFileIntoChunks } = require('../memory/split.service');
const { isAiPaused, nextRetry, shouldReport } = require('../../utils/aiErrors');
const env = require('../../config/env');

const CLAIM_MS = 10 * 60 * 1000;
const MAX_UNSPLIT_CHARS = 8000;
const CONTEXT_EVENTS = 5;
const CONTEXT_CHARS = 600;
const DUE_BATCH_SIZE = 20;

let running = false;
let workerTimer = null;

function dueFilter(now) {
  return { status: 'pending', $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] };
}

function directionLabel(direction) {
  if (direction === 'inbound') return 'received from the contact';
  if (direction === 'outbound') return 'sent to the contact by the business';
  return 'unknown';
}

function eventCandidate(event, connectionName, body, earlier, part) {
  const contact = [event.contactName, event.contactPhone, event.contactEmail].filter(Boolean);
  const context = earlier.length
    ? `\n\nEarlier in this conversation (context only — already evaluated, don't save it again):\n${earlier
        .map((previous) => {
          const who = previous.direction === 'outbound' ? 'Business' : previous.direction === 'inbound' ? 'Contact' : 'Message';
          const text = previous.text.length > CONTEXT_CHARS ? `${previous.text.slice(0, CONTEXT_CHARS)}…` : previous.text;
          return `[${previous.occurredAt.toISOString()}] ${who}: ${text}`;
        })
        .join('\n')}`
    : '';
  return `Cheerio AI event (a customer conversation or workflow step from Cheerio's WhatsApp, SMS, email, Instagram, or other channels):
- Connection: ${connectionName || 'Cheerio'}
- Channel: ${event.channel || 'unknown'}
- Direction: ${directionLabel(event.direction)}
- Contact: ${contact.join(', ') || 'unknown'}
- At: ${event.occurredAt.toISOString()}${part.total > 1 ? `\n- Part ${part.index + 1} of ${part.total} of a long event` : ''}${context}

New content of this event:
${body}`;
}

async function ingestEventForProject({ event, source, integration, project, traceId }) {
  const earlier = event.conversationKey
    ? await CheerioEvent.find({
        integrationId: event.integrationId,
        conversationKey: event.conversationKey,
        _id: { $ne: event._id },
        occurredAt: { $lte: event.occurredAt },
      })
        .sort({ occurredAt: -1 })
        .limit(CONTEXT_EVENTS)
        .select('direction text occurredAt')
        .lean()
        .then((events) => events.reverse())
    : [];
  const pieces = event.text.length <= MAX_UNSPLIT_CHARS
    ? [event.text]
    : await splitFileIntoChunks({ kind: 'text', text: event.text }, 'Cheerio event', { traceId });

  const chunkIds = [];
  for (const [index, piece] of pieces.entries()) {
    const outcome = await decideAndStore({
      orgId: source.orgId,
      projectId: source.projectId,
      ownerId: integration.userId,
      sourceType: 'cheerio',
      text: eventCandidate(event, integration.cheerio?.name, piece, earlier, { index, total: pieces.length }),
      projectContext: { name: project.name, description: project.description, websiteUrl: project.websiteUrl },
      metadata: {
        integrationId: integration._id,
        cheerioEventId: event._id,
        cheerioConnection: integration.cheerio?.name,
        cheerioChannel: event.channel,
        contactName: event.contactName,
        contactPhone: event.contactPhone,
        messageTimestamp: event.occurredAt,
        chunkIndex: index,
        traceId,
      },
    });
    if (outcome.chunkId) chunkIds.push(outcome.chunkId);
  }
  return chunkIds;
}

async function refreshEventSummary(eventId) {
  const event = await CheerioEvent.findById(eventId).select('projectIngestions').lean();
  if (!event) return;
  const entries = event.projectIngestions;
  const pending = entries.some((entry) => entry.status === 'pending' || entry.status === 'processing');
  await CheerioEvent.updateOne(
    { _id: eventId },
    {
      $set: {
        hasIngestedMemory: entries.some((entry) => entry.memoryChunkIds?.length),
        ingestionStatus: pending ? 'pending' : entries.some((entry) => entry.status === 'failed') ? 'failed' : 'processed',
      },
    }
  );
}

async function finishEntry(eventId, projectId, claimId, fields) {
  await CheerioEvent.updateOne(
    { _id: eventId, projectIngestions: { $elemMatch: { projectId, status: 'processing', claimId } } },
    {
      $set: Object.fromEntries(
        Object.entries({ ...fields, claimId: null, processingExpiresAt: null }).map(([key, value]) => [`projectIngestions.$.${key}`, value])
      ),
    }
  );
  await refreshEventSummary(eventId);
}

async function processEntry(eventId, projectId) {
  const claimId = randomUUID();
  const now = new Date();
  const claimed = await CheerioEvent.findOneAndUpdate(
    { _id: eventId, projectIngestions: { $elemMatch: { projectId, ...dueFilter(now) } } },
    {
      $set: {
        'projectIngestions.$.status': 'processing',
        'projectIngestions.$.claimId': claimId,
        'projectIngestions.$.processingExpiresAt': new Date(now.getTime() + CLAIM_MS),
      },
      $inc: { 'projectIngestions.$.attempts': 1 },
    },
    { new: true }
  ).lean();
  const entry = claimed?.projectIngestions.find((item) => item.claimId === claimId);
  if (!entry) return;

  const traceId = randomUUID();
  try {
    const [source, integration, project] = await Promise.all([
      ProjectSource.findOne({ _id: entry.sourceId, sourceType: 'cheerio' }).lean(),
      Integration.findOne({ _id: claimed.integrationId, type: 'cheerio' }).select('userId cheerio.name').lean(),
      Project.findById(entry.projectId).select('name description websiteUrl').lean(),
    ]);
    if (!source || !integration || !project) {
      const reason = !source ? 'Cheerio connection is no longer linked to this project.' : !integration ? 'Cheerio connection was removed.' : 'Project is no longer available.';
      await finishEntry(eventId, projectId, claimId, { status: 'skipped', reason, processedAt: new Date() });
      return;
    }

    const chunkIds = await ingestEventForProject({ event: claimed, source, integration, project, traceId });
    await finishEntry(eventId, projectId, claimId, {
      status: chunkIds.length ? 'ingested' : 'skipped',
      reason: chunkIds.length ? null : 'No lasting information found.',
      memoryChunkIds: chunkIds,
      processedAt: new Date(),
      nextAttemptAt: null,
    });
    Sentry.logger.info('Cheerio event ingested for project', { traceId, eventId: String(eventId), projectId: String(projectId), chunkCount: chunkIds.length });
  } catch (err) {
    const retry = nextRetry(err, entry.attempts);
    await finishEntry(eventId, projectId, claimId, {
      status: retry ? 'pending' : 'failed',
      reason: err.message?.slice(0, 500) || 'Ingestion failed.',
      nextAttemptAt: retry?.at || null,
      processedAt: retry ? null : new Date(),
      ...(retry && !retry.countsAsAttempt ? { attempts: entry.attempts - 1 } : {}),
    });
    if (shouldReport(err)) {
      Sentry.captureException(err, { tags: { pipeline: 'cheerio_ingest' }, extra: { traceId, eventId: String(eventId), projectId: String(projectId), attempts: entry.attempts, retryAt: retry?.at || null } });
    }
  }
}

async function recoverExpiredClaims() {
  const now = new Date();
  await CheerioEvent.updateMany(
    { projectIngestions: { $elemMatch: { status: 'processing', processingExpiresAt: { $lte: now } } } },
    {
      $set: {
        'projectIngestions.$[entry].status': 'pending',
        'projectIngestions.$[entry].claimId': null,
        'projectIngestions.$[entry].processingExpiresAt': null,
        'projectIngestions.$[entry].nextAttemptAt': now,
        'projectIngestions.$[entry].reason': 'Recovered after an interrupted worker.',
      },
    },
    { arrayFilters: [{ 'entry.status': 'processing', 'entry.processingExpiresAt': { $lte: now } }] }
  );
}

/** Evaluates every pending (event, project) pair, oldest first. Safe to call from several processes. */
async function processDueCheerioEvents() {
  if (running) return;
  running = true;
  try {
    await recoverExpiredClaims();
    // Bounded so one call can't monopolise the worker; the next poll continues.
    for (let round = 0; round < 10; round++) {
      if (isAiPaused()) return;
      const now = new Date();
      const due = await CheerioEvent.find({ projectIngestions: { $elemMatch: dueFilter(now) } })
        .sort({ occurredAt: 1 })
        .limit(DUE_BATCH_SIZE)
        .select('projectIngestions.projectId projectIngestions.status projectIngestions.nextAttemptAt')
        .lean();
      if (!due.length) return;
      for (const event of due) {
        for (const entry of event.projectIngestions) {
          if (isAiPaused()) return;
          if (entry.status === 'pending' && (!entry.nextAttemptAt || entry.nextAttemptAt <= now)) {
            await processEntry(event._id, entry.projectId);
          }
        }
      }
      if (due.length < DUE_BATCH_SIZE) return;
    }
  } finally {
    running = false;
  }
}

/** Starts a pass right away, e.g. after a webhook stores a new event. */
function triggerCheerioIngestion() {
  processDueCheerioEvents().catch((err) => Sentry.captureException(err, { tags: { pipeline: 'cheerio_ingest_worker' } }));
}

function startCheerioWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(triggerCheerioIngestion, Math.max(1_000, env.cheerioIngestionPollMs));
  workerTimer.unref?.();
  triggerCheerioIngestion();
}

module.exports = { startCheerioWorker, triggerCheerioIngestion };
