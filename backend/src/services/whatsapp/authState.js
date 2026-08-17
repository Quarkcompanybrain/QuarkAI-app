const { initAuthCreds, BufferJSON, proto } = require('baileys');
const Sentry = require('@sentry/node');
const Integration = require('../../models/Integration');
const WhatsAppAuthKey = require('../../models/WhatsAppAuthKey');
const { encrypt, decrypt } = require('../../utils/crypto');

const AUTH_KEY_STATS_REFRESH_MS = 60 * 1000;
const pendingStatRefreshes = new Map();

async function refreshAuthKeyStats(integrationId) {
  const grouped = await WhatsAppAuthKey.aggregate([
    { $match: { integrationId } },
    {
      $group: {
        _id: '$category',
        keyCount: { $sum: 1 },
        encryptedBytes: { $sum: { $strLenBytes: '$valueEncrypted' } },
      },
    },
  ]);

  const categories = Object.fromEntries(grouped.map((row) => [row._id, row.keyCount]));
  const keyCount = grouped.reduce((sum, row) => sum + row.keyCount, 0);
  const encryptedBytes = grouped.reduce((sum, row) => sum + row.encryptedBytes, 0);

  await Integration.findByIdAndUpdate(integrationId, {
    $set: {
      'authKeyStats.keyCount': keyCount,
      'authKeyStats.encryptedBytes': encryptedBytes,
      'authKeyStats.categories': categories,
      'authKeyStats.updatedAt': new Date(),
    },
  });

}

// Signal keys can change several times for a single message. Debouncing keeps
// the monitoring query inexpensive without ever delaying or pruning key writes.
function scheduleAuthKeyStatsRefresh(integrationId) {
  const key = String(integrationId);
  if (pendingStatRefreshes.has(key)) return;

  const timer = setTimeout(() => {
    pendingStatRefreshes.delete(key);
    refreshAuthKeyStats(integrationId).catch((err) => {
      Sentry.captureException(err, { tags: { pipeline: 'whatsapp_auth_key_stats' } });
    });
  }, AUTH_KEY_STATS_REFRESH_MS);
  pendingStatRefreshes.set(key, timer);
}

/**
 * Mongo-backed replacement for Baileys' useMultiFileAuthState — same shape
 * (state.creds, state.keys, saveCreds), but creds live on the Integration
 * doc and signal keys live in WhatsAppAuthKey, both encrypted at rest. This
 * is what lets a session survive a server restart/redeploy without
 * re-scanning the QR code.
 */
async function useMongoAuthState(integrationId) {
  const integration = await Integration.findById(integrationId);
  if (!integration) throw new Error(`Integration ${integrationId} not found.`);

  scheduleAuthKeyStatsRefresh(integrationId);

  const creds = integration.credsEncrypted
    ? JSON.parse(decrypt(integration.credsEncrypted), BufferJSON.reviver)
    : initAuthCreds();

  const keys = {
    get: async (type, ids) => {
      const docs = await WhatsAppAuthKey.find({ integrationId, category: type, keyId: { $in: ids } });
      const data = {};
      for (const doc of docs) {
        let value = JSON.parse(decrypt(doc.valueEncrypted), BufferJSON.reviver);
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        data[doc.keyId] = value;
      }
      return data;
    },
    set: async (data) => {
      const ops = [];
      for (const category of Object.keys(data)) {
        for (const keyId of Object.keys(data[category])) {
          const value = data[category][keyId];
          if (value) {
            ops.push({
              updateOne: {
                filter: { integrationId, category, keyId },
                update: { $set: { valueEncrypted: encrypt(JSON.stringify(value, BufferJSON.replacer)) } },
                upsert: true,
              },
            });
          } else {
            ops.push({ deleteOne: { filter: { integrationId, category, keyId } } });
          }
        }
      }
      if (ops.length > 0) {
        await WhatsAppAuthKey.bulkWrite(ops);
        scheduleAuthKeyStatsRefresh(integrationId);
      }
    },
  };

  const saveCreds = async () => {
    await Integration.findByIdAndUpdate(integrationId, {
      credsEncrypted: encrypt(JSON.stringify(creds, BufferJSON.replacer)),
    });
  };

  return { state: { creds, keys }, saveCreds };
}

async function clearAuthState(integrationId) {
  const key = String(integrationId);
  const pendingTimer = pendingStatRefreshes.get(key);
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingStatRefreshes.delete(key);

  await WhatsAppAuthKey.deleteMany({ integrationId });
  await Integration.findByIdAndUpdate(integrationId, {
    credsEncrypted: null,
    authKeyStats: { keyCount: 0, encryptedBytes: 0, categories: {}, updatedAt: new Date() },
  });
}

module.exports = { useMongoAuthState, clearAuthState };
