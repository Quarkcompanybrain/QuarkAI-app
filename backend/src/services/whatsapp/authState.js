const { initAuthCreds, BufferJSON, proto } = require('baileys');
const Integration = require('../../models/Integration');
const WhatsAppAuthKey = require('../../models/WhatsAppAuthKey');
const { encrypt, decrypt } = require('../../utils/crypto');

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
      if (ops.length > 0) await WhatsAppAuthKey.bulkWrite(ops);
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
  await WhatsAppAuthKey.deleteMany({ integrationId });
  await Integration.findByIdAndUpdate(integrationId, { credsEncrypted: null });
}

module.exports = { useMongoAuthState, clearAuthState };
