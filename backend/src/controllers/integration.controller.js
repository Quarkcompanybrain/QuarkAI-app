const Sentry = require('@sentry/node');
const Integration = require('../models/Integration');
const WhatsAppChat = require('../models/WhatsAppChat');
const { connectIntegration, disconnectIntegration, subscribe } = require('../services/whatsapp/connectionManager');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const listIntegrations = asyncHandler(async (req, res) => {
  const integrations = await Integration.find({ userId: req.user.id });
  res.json({
    integrations: integrations.map((i) => ({
      id: i._id,
      type: i.type,
      status: i.status,
      phoneNumber: i.phoneNumber,
      lastConnectedAt: i.lastConnectedAt,
    })),
  });
});

const connectWhatsapp = asyncHandler(async (req, res) => {
  const integration = await Integration.create({ userId: req.user.id, type: 'whatsapp', status: 'pending' });

  connectIntegration(integration._id).catch((err) => {
    Sentry.captureException(err, { tags: { pipeline: 'whatsapp_connect' } });
  });

  Sentry.logger.info('WhatsApp connect initiated', { integrationId: String(integration._id), userId: req.user.id });
  res.status(201).json({ integration: { id: integration._id, status: integration.status } });
});

// SSE stream of connection lifecycle events (qr / connected / disconnected) for one integration.
const streamStatus = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({ _id: req.params.id, userId: req.user.id });
  if (!integration) throw new ApiError(404, 'Integration not found.');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // If it's already connected by the time the client subscribes, say so immediately.
  if (integration.status === 'connected') {
    sendEvent('connected', { phoneNumber: integration.phoneNumber });
  }

  const unsubscribe = subscribe(integration._id, (event) => sendEvent(event.type, event));

  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});

const disconnectWhatsapp = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({ _id: req.params.id, userId: req.user.id });
  if (!integration) throw new ApiError(404, 'Integration not found.');

  await disconnectIntegration(integration._id);
  await integration.softDelete(req.user.id);

  Sentry.logger.info('WhatsApp integration disconnected', { integrationId: String(integration._id) });
  res.json({ message: 'Disconnected.' });
});

const listChats = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({ _id: req.params.id, userId: req.user.id });
  if (!integration) throw new ApiError(404, 'Integration not found.');

  const chats = await WhatsAppChat.find({ integrationId: integration._id }).sort({ lastMessageAt: -1 });
  res.json({
    chats: chats.map((c) => ({ jid: c.jid, name: c.name, isGroup: c.isGroup, lastMessageAt: c.lastMessageAt })),
  });
});

module.exports = { listIntegrations, connectWhatsapp, streamStatus, disconnectWhatsapp, listChats };
