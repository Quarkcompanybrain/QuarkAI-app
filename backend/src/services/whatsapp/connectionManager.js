const Sentry = require('@sentry/node');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('baileys');
const { useMongoAuthState, clearAuthState } = require('./authState');
const Integration = require('../../models/Integration');
const WhatsAppChat = require('../../models/WhatsAppChat');
const { handleIncomingMessage } = require('./ingest.service');

const logger = pino({ level: 'silent' });

// Live sockets and their per-connection SSE subscribers, keyed by integrationId.
// Not persisted — rebuilt from Integration docs on server boot.
const sockets = new Map();
const listeners = new Map(); // integrationId -> Set<(event) => void>
const explicitlyDisconnected = new Set();

function emit(integrationId, event) {
  const subs = listeners.get(String(integrationId));
  if (!subs) return;
  for (const fn of subs) fn(event);
}

function subscribe(integrationId, fn) {
  const key = String(integrationId);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

function jidToChatName(jid, pushName) {
  if (jid?.endsWith('@g.us')) return pushName || jid;
  return pushName || jid?.split('@')[0] || jid;
}

async function cacheChats(integrationId, chats) {
  if (!chats?.length) return;
  const ops = chats.map((chat) => ({
    updateOne: {
      filter: { integrationId, jid: chat.id },
      update: {
        $set: {
          name: chat.name || chat.subject || undefined,
          isGroup: chat.id?.endsWith('@g.us') || false,
          lastMessageAt: chat.conversationTimestamp ? new Date(Number(chat.conversationTimestamp) * 1000) : undefined,
        },
      },
      upsert: true,
    },
  }));
  await WhatsAppChat.bulkWrite(ops, { ordered: false }).catch(() => {});
}

async function connectIntegration(integrationId) {
  const key = String(integrationId);
  if (sockets.has(key)) return sockets.get(key);

  explicitlyDisconnected.delete(key);
  const { state, saveCreds } = await useMongoAuthState(integrationId);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sockets.set(key, sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      emit(integrationId, { type: 'qr', qrDataUrl });
    }

    if (connection === 'open') {
      const phoneNumber = sock.user?.id?.split(':')[0] || null;
      await Integration.findByIdAndUpdate(integrationId, {
        status: 'connected',
        phoneNumber,
        lastConnectedAt: new Date(),
        lastError: null,
      });
      emit(integrationId, { type: 'connected', phoneNumber });
      Sentry.logger.info('WhatsApp integration connected', { integrationId: key, phoneNumber });
    }

    if (connection === 'close') {
      sockets.delete(key);
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut || explicitlyDisconnected.has(key)) {
        explicitlyDisconnected.delete(key);
        await clearAuthState(integrationId);
        await Integration.findByIdAndUpdate(integrationId, { status: 'disconnected' });
        emit(integrationId, { type: 'disconnected' });
      } else {
        // Unexpected drop — reconnect using the still-valid stored session.
        Sentry.logger.info('WhatsApp connection dropped, reconnecting', { integrationId: key, statusCode });
        connectIntegration(integrationId).catch((err) => {
          Sentry.captureException(err, { tags: { pipeline: 'whatsapp_reconnect' } });
        });
      }
    }
  });

  sock.ev.on('messaging-history.set', ({ chats }) => {
    cacheChats(integrationId, chats).catch(() => {});
  });

  sock.ev.on('chats.upsert', (chats) => {
    cacheChats(integrationId, chats).catch(() => {});
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      handleIncomingMessage(integrationId, msg).catch((err) => {
        Sentry.captureException(err, { tags: { pipeline: 'whatsapp_ingest' } });
      });
    }
  });

  return sock;
}

async function disconnectIntegration(integrationId) {
  const key = String(integrationId);
  explicitlyDisconnected.add(key);
  const sock = sockets.get(key);
  if (sock) {
    try {
      await sock.logout();
    } catch {
      // Already disconnected on the WhatsApp side — clean up our state regardless.
    }
    sockets.delete(key);
  } else {
    await clearAuthState(integrationId);
    await Integration.findByIdAndUpdate(integrationId, { status: 'disconnected' });
  }
}

/** Called on server boot to re-establish sockets for accounts that were connected before restart. */
async function reconnectAllActiveIntegrations() {
  const active = await Integration.find({ type: 'whatsapp', status: 'connected' });
  for (const integration of active) {
    connectIntegration(integration._id).catch((err) => {
      Sentry.captureException(err, { tags: { pipeline: 'whatsapp_boot_reconnect' } });
    });
  }
  if (active.length > 0) {
    console.log(`[whatsapp] reconnecting ${active.length} previously connected account(s)`);
  }
}

module.exports = { connectIntegration, disconnectIntegration, reconnectAllActiveIntegrations, subscribe };
