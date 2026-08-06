const jwt = require('jsonwebtoken');
const env = require('../../config/env');

function signToken({ userId, orgId }) {
  return jwt.sign({ sub: userId, orgId: orgId || null }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = { signToken, verifyToken };
