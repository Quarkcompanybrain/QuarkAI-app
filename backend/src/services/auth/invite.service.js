const crypto = require('crypto');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateInviteToken() {
  return crypto.randomBytes(32).toString('hex');
}

function inviteExpiry() {
  return new Date(Date.now() + INVITE_TTL_MS);
}

module.exports = { generateInviteToken, inviteExpiry };
