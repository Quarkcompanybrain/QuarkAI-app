const Sentry = require('@sentry/node');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
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
  const ops = chats.filter((chat) => !chat.id?.endsWith('@lid')).map((chat) => ({
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

// Groups arrive with a subject in chat events. Direct chats get their saved
// contact name through Baileys contact events. Only use the stable phone JID:
// a LID is internal to WhatsApp and must never create a picker row.
async function cacheContacts(integrationId, contacts) {
  const ops = (contacts || []).flatMap((contact) => {
    const jid = contact.phoneNumber || (contact.id?.endsWith('@lid') ? null : contact.id);
    const name = contact.name || contact.notify || contact.verifiedName || contact.username;
    if (!jid || !name) return [];
    return [{
      updateOne: {
        filter: { integrationId, jid },
        update: { $set: { name, isGroup: false } },
        upsert: true,
      },
    }];
  });
  if (ops.length > 0) await WhatsAppChat.bulkWrite(ops, { ordered: false }).catch(() => {});
}

// WhatsApp does not always include every group in a light history sync. Fetch
// the connected account's participating groups on connection so the source
// picker can offer all groups, not only those that recently produced events.
async function cacheParticipatingGroups(integrationId, groups) {
  const ops = Object.values(groups || {}).map((group) => ({
    updateOne: {
      filter: { integrationId, jid: group.id },
      update: {
        $set: {
          name: group.subject || group.id,
          isGroup: true,
          lastMessageAt: group.creation ? new Date(Number(group.creation) * 1000) : undefined,
        },
      },
      upsert: true,
    },
  }));
  if (ops.length > 0) await WhatsAppChat.bulkWrite(ops, { ordered: false });
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
    // Explicitly retain the default so sends made through this linked device
    // are emitted as message events and enter the same durable pipeline.
    emitOwnEvents: true,
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

      try {
        const groups = await sock.groupFetchAllParticipating();
        await cacheParticipatingGroups(integrationId, groups);
      } catch (err) {
        Sentry.captureException(err, { tags: { pipeline: 'whatsapp_group_cache' }, extra: { integrationId: key } });
      }
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

  sock.ev.on('contacts.upsert', (contacts) => {
    cacheContacts(integrationId, contacts).catch(() => {});
  });

  sock.ev.on('contacts.update', (contacts) => {
    cacheContacts(integrationId, contacts).catch(() => {});
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    console.log('WhatsApp messages.upsert', { integrationId, type, messages: messages.map((m) => ({ id: m.key?.id, fromMe: m.key?.fromMe, jid: m.key?.remoteJid })) });
    for (const msg of messages) {
      // Baileys reports live inbound messages as `notify`. Messages sent from
      // the linked phone can arrive as either `notify` or `append`; accept the
      // latter only when authored by the connected account so we do not ingest
      // historic inbound traffic during a sync/reconnect.
      const isLiveMessage = type === 'notify';
      const isOwnAppendedMessage = type === 'append' && msg.key?.fromMe;
      if (!isLiveMessage && !isOwnAppendedMessage) continue;

      handleIncomingMessage(integrationId, msg, {
        downloadMedia: () =>
          downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: (mediaMessage) => sock.updateMediaMessage(mediaMessage) }),
      }).catch((err) => {
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
}

module.exports = { connectIntegration, disconnectIntegration, reconnectAllActiveIntegrations, subscribe };
