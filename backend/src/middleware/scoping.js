const ProjectMembership = require('../models/ProjectMembership');
const Project = require('../models/Project');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Builds the Mongo filter for the three-tier isolation model:
 * org match is always required, then either projectId (project members)
 * or ownerId (personal), never both.
 */
function scopeFilter({ orgId, scope, projectId, userId }) {
  const base = { orgId };
  if (scope === 'project') {
    if (!projectId) throw new ApiError(400, 'projectId is required for project scope.');
    return { ...base, projectId };
  }
  return { ...base, projectId: null, ownerId: userId };
}

/**
 * Verifies the caller belongs to :projectId (within the active org) before
 * letting a project-scoped request through. Expects req.org to be set already.
 */
const requireProjectMember = asyncHandler(async (req, res, next) => {
  const projectId = req.params.projectId || req.body.projectId || req.query.projectId;
  if (!projectId) throw new ApiError(400, 'projectId is required.');

  const membership = await ProjectMembership.findOne({
    userId: req.user.id,
    projectId,
    orgId: req.org.id,
  });

  if (!membership) throw new ApiError(403, 'You are not a member of this project.');

  req.projectId = String(projectId);
  req.projectMembership = membership;
  next();
});

// Project creators are admins for older projects created before the explicit
// role field existed. New projects persist that role on their membership.
const requireProjectAdmin = asyncHandler(async (req, res, next) => {
  const projectId = req.projectId || req.params.projectId || req.body.projectId || req.query.projectId;
  const membership = req.projectMembership || await ProjectMembership.findOne({
    userId: req.user.id,
    projectId,
    orgId: req.org.id,
  });
  if (!membership) throw new ApiError(403, 'You are not a member of this project.');

  const project = await Project.findOne({ _id: projectId, orgId: req.org.id }).select('createdBy');
  if (!project) throw new ApiError(404, 'Project not found.');
  if (membership.role !== 'admin' && String(project.createdBy) !== String(req.user.id)) {
    throw new ApiError(403, 'Only project admins can change saved knowledge.');
  }

  req.projectIsAdmin = true;
  next();
});

/**
 * Like requireProjectMember, but treats a missing projectId as personal
 * scope (allowed) rather than an error — used on routes where the caller
 * chooses project vs personal (e.g. file upload/list).
 */
const optionalProjectScope = asyncHandler(async (req, res, next) => {
  const projectId = req.params.projectId || req.body.projectId || req.query.projectId;
  if (!projectId) return next();

  const membership = await ProjectMembership.findOne({
    userId: req.user.id,
    projectId,
    orgId: req.org.id,
  });

  if (!membership) throw new ApiError(403, 'You are not a member of this project.');

  req.projectId = String(projectId);
  req.projectMembership = membership;
  next();
});

module.exports = { scopeFilter, requireProjectMember, requireProjectAdmin, optionalProjectScope };
