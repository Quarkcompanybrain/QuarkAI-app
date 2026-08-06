const { verifyToken } = require('../services/auth/token.service');
const { ApiError } = require('../utils/ApiError');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return next(new ApiError(401, 'Missing auth token.'));

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub };
    req.tokenOrgId = payload.orgId || null;
    next();
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired token.'));
  }
}

module.exports = { requireAuth };
