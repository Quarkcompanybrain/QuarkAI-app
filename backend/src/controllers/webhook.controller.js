const Sentry = require('@sentry/node');
const Integration = require('../models/Integration');
const ProjectSource = require('../models/ProjectSource');
const CheerioEvent = require('../models/CheerioEvent');
const { normalizeCheerioPayload } = require('../services/cheerio/payload');
const { triggerCheerioIngestion } = require('../services/cheerio/ingest.service');
const { hashToken } = require('../utils/crypto');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

async function findCheerioIntegration(token) {
  if (!token || token.length > 100) return null;
  return Integration.findOne({ type: 'cheerio', status: 'connected', 'cheerio.webhookTokenHash': hashToken(token) });
}

// Lets a "test URL" button in a workflow builder confirm the URL works.
const checkCheerioWebhook = asyncHandler(async (req, res) => {
  const integration = await findCheerioIntegration(req.params.token);
  if (!integration) throw new ApiError(404, 'This webhook URL is not active.');
  res.json({ ok: true, message: 'Quark AI is ready to receive Cheerio events at this URL. Send them with POST.' });
});

/**
 * Receives one call from a Cheerio "send webhook" workflow step. The secret
 * in the URL is the only credential. The event is stored with a pending
 * entry per linked project and ingested by the Cheerio worker; a connection
 * that feeds no project is acknowledged without storing anything.
 */
const receiveCheerioWebhook = asyncHandler(async (req, res) => {
  const integration = await findCheerioIntegration(req.params.token);
  if (!integration) throw new ApiError(404, 'This webhook URL is not active.');

  await Integration.updateOne({ _id: integration._id }, { $set: { 'cheerio.lastEventAt': new Date(), lastError: null } });
  const sources = await ProjectSource.find({ integrationId: integration._id, sourceType: 'cheerio' }).select('_id projectId').lean();
  if (!sources.length) {
    return res.status(202).json({ received: true, stored: false, reason: 'Link this Cheerio connection to a project in Quark AI to start learning from it.' });
  }

  const event = normalizeCheerioPayload(req.body);
  if (!event) return res.status(202).json({ received: true, stored: false, reason: 'The request body had no readable content.' });

  try {
    const record = await CheerioEvent.create({
      ...event,
      integrationId: integration._id,
      projectIngestions: sources.map((source) => ({ projectId: source.projectId, sourceId: source._id, status: 'pending' })),
    });
    Sentry.logger.info('Cheerio webhook event stored', { integrationId: String(integration._id), eventId: String(record._id), channel: event.channel, direction: event.direction, projectCount: sources.length });
  } catch (err) {
    if (err?.code === 11000) return res.json({ received: true, stored: false, duplicate: true });
    throw err;
  }

  triggerCheerioIngestion();
  res.status(202).json({ received: true, stored: true });
});

module.exports = { checkCheerioWebhook, receiveCheerioWebhook };
