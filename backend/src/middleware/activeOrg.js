const OrgMembership = require('../models/OrgMembership');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Resolves which org the request is acting in and verifies the caller
 * actually belongs to it. Never trusts a client-supplied orgId on its own —
 * every value here is checked against OrgMembership.
 */
const requireOrgContext = asyncHandler(async (req, res, next) => {
  const requestedOrgId = req.headers['x-org-id'] || req.tokenOrgId;

  if (!requestedOrgId) {
    throw new ApiError(400, 'No active org. Select an org (x-org-id header).');
  }

  const membership = await OrgMembership.findOne({
    userId: req.user.id,
    orgId: requestedOrgId,
  });

  if (!membership) throw new ApiError(403, 'You are not a member of this org.');

  req.org = { id: String(membership.orgId), role: membership.role };
  next();
});

function requireOrgAdmin(req, res, next) {
  if (req.org?.role !== 'admin') {
    return next(new ApiError(403, 'Admin role required.'));
  }
  next();
}

module.exports = { requireOrgContext, requireOrgAdmin };
