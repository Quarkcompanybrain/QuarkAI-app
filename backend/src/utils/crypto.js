const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const hex = env.integrationEncryptionKey;
  if (!hex) throw new Error('INTEGRATION_ENCRYPTION_KEY is not set — required to store integration credentials.');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
  }
  return key;
}

/**
 * Encrypts arbitrary text (we use it for Baileys creds/signal keys, which
 * amount to full WhatsApp session access) with AES-256-GCM. Output is a
 * single base64 string: iv + authTag + ciphertext, self-contained for decrypt.
 */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decrypt(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function encryptJson(value) {
  return encrypt(JSON.stringify(value));
}

function decryptJson(encoded) {
  return JSON.parse(decrypt(encoded));
}

/** One-way hash for looking up a secret (e.g. a webhook URL token) without storing it in plaintext. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson, hashToken };
