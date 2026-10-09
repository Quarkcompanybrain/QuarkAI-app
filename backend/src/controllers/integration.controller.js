const Sentry = require('@sentry/node');
const Integration = require('../models/Integration');
const ProjectSource = require('../models/ProjectSource');
const WhatsAppChat = require('../models/WhatsAppChat');
const { connectIntegration, disconnectIntegration, subscribe } = require('../services/whatsapp/connectionManager');
const { resolveImapServer, inspectMailbox } = require('../services/emailIngest/imap');
const { encryptJson } = require('../utils/crypto');
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
      emailAddress: i.emailAddress,
      lastConnectedAt: i.lastConnectedAt,
      lastSyncedAt: i.email?.lastSyncedAt || null,
      lastError: i.lastError,
      authKeyStats: {
        keyCount: i.authKeyStats?.keyCount || 0,
        encryptedBytes: i.authKeyStats?.encryptedBytes || 0,
        categories: i.authKeyStats?.categories || {},
        updatedAt: i.authKeyStats?.updatedAt || null,
      },
    })),
  });
});

// One WhatsApp account per user — disconnect first to switch numbers.
const connectWhatsapp = asyncHandler(async (req, res) => {
  const existing = await Integration.findOne({ userId: req.user.id, type: 'whatsapp' });
  if (existing) throw new ApiError(409, 'You already have a WhatsApp account connected. Disconnect it first to connect another.');

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

  // Flush an SSE comment immediately. Without an initial response body, a
  // reverse proxy/browser can wait for the first QR event before exposing the
  // stream, leaving the integration UI stuck on “Generating QR code…”.
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MAILBOXES_PER_USER = 5;

// A user can connect up to MAX_MAILBOXES_PER_USER mailboxes. Credentials are verified
// with a real IMAP sign-in before anything is stored, then kept encrypted at rest.
const connectEmail = asyncHandler(async (req, res) => {
  const emailAddress = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!EMAIL_PATTERN.test(emailAddress)) throw new ApiError(400, 'Enter a valid email address.');
  if (!password) throw new ApiError(400, 'Enter the mailbox password or app password.');

  const existing = await Integration.findOne({ userId: req.user.id, type: 'email', emailAddress });
  if (existing) throw new ApiError(409, 'This mailbox is already connected.');
  const mailboxCount = await Integration.countDocuments({ userId: req.user.id, type: 'email' });
  if (mailboxCount >= MAX_MAILBOXES_PER_USER) {
    throw new ApiError(409, `You can connect up to ${MAX_MAILBOXES_PER_USER} mailboxes. Disconnect one to add another.`);
  }

  const server = await resolveImapServer(emailAddress, { host: req.body.host, port: req.body.port, secure: req.body.secure });
  // Some providers sign in with a username that isn't the address.
  const credentials = { user: String(req.body.username || '').trim() || emailAddress, pass: password };
  const folders = await inspectMailbox(server, credentials);

  const integration = await Integration.create({
    userId: req.user.id,
    type: 'email',
    status: 'connected',
    emailAddress,
    credsEncrypted: encryptJson(credentials),
    email: { ...server, folders },
    lastConnectedAt: new Date(),
  });

  Sentry.logger.info('Email integration connected', { integrationId: String(integration._id), host: server.host, folders: folders.map((folder) => folder.path) });
  res.status(201).json({ integration: { id: integration._id, type: 'email', status: integration.status, emailAddress } });
});

const disconnectIntegrationHandler = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({ _id: req.params.id, userId: req.user.id });
  if (!integration) throw new ApiError(404, 'Integration not found.');

  if (integration.type === 'whatsapp') {
    await disconnectIntegration(integration._id);
  } else {
    integration.status = 'disconnected';
    integration.credsEncrypted = null;
  }
  const disconnectedAt = new Date();
  const [sourceCleanup] = await Promise.all([
    ProjectSource.updateMany(
      { integrationId: integration._id, deletedAt: null },
      { $set: { deletedAt: disconnectedAt, deletedBy: req.user.id } }
    ),
    integration.softDelete(req.user.id),
  ]);

  Sentry.logger.info('Integration disconnected', {
    integrationId: String(integration._id),
    type: integration.type,
    removedProjectSourceCount: sourceCleanup.modifiedCount,
  });
  res.json({ message: 'Disconnected.' });
});

const listChats = asyncHandler(async (req, res) => {
  const integration = await Integration.findOne({ _id: req.params.id, userId: req.user.id, type: 'whatsapp' });
  if (!integration) throw new ApiError(404, 'Integration not found.');

  // A LID is a WhatsApp-internal identifier, not a useful source label. The
  // picker uses the stable phone/group JID cached from chat history instead.
  const chats = await WhatsAppChat.find({ integrationId: integration._id, jid: { $not: /@lid$/ } }).sort({ lastMessageAt: -1 });
  res.json({
    chats: chats.map((c) => ({
      jid: c.jid,
      name: c.name,
      isGroup: c.isGroup,
      lastMessageAt: c.lastMessageAt,
      lastMessageId: c.lastMessageId || null,
      lastMessageText: c.lastMessageText || null,
      lastMessageType: c.lastMessageType || null,
      lastMessageFromMe: c.lastMessageFromMe || false,
      hasIngestedMessages: c.memory?.hasIngestedMessages || false,
      ingestedMessageCount: c.memory?.ingestedMessageCount || 0,
      linkedProjectIds: c.memory?.projectIds || [],
      lastIngestedAt: c.memory?.lastIngestedAt || null,
      lastMemoryChunkIds: c.memory?.lastMemoryChunkIds || [],
    })),
  });
});

module.exports = { listIntegrations, connectWhatsapp, connectEmail, streamStatus, disconnectIntegration: disconnectIntegrationHandler, listChats };
