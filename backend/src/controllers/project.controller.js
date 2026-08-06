const Sentry = require('@sentry/node');
const Project = require('../models/Project');
const ProjectMembership = require('../models/ProjectMembership');
const OrgMembership = require('../models/OrgMembership');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const createProject = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw new ApiError(400, 'name is required.');

  const project = await Project.create({ name, orgId: req.org.id, createdBy: req.user.id });
  await ProjectMembership.create({ userId: req.user.id, projectId: project._id, orgId: req.org.id });

  Sentry.logger.info('Project created', { projectId: String(project._id), orgId: req.org.id });
  res.status(201).json({ project: { id: project._id, name: project.name, orgId: project.orgId } });
});

// Only projects the caller is a member of, within the active org.
const listMyProjects = asyncHandler(async (req, res) => {
  const memberships = await ProjectMembership.find({ userId: req.user.id, orgId: req.org.id }).populate(
    'projectId',
    'name createdBy createdAt'
  );

  res.json({
    projects: memberships
      .filter((m) => m.projectId)
      .map((m) => ({
        id: m.projectId._id,
        name: m.projectId.name,
        createdBy: m.projectId.createdBy,
        createdAt: m.projectId.createdAt,
      })),
  });
});

const getProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.projectId, orgId: req.org.id });
  if (!project) throw new ApiError(404, 'Project not found.');
  res.json({ project: { id: project._id, name: project.name, createdBy: project.createdBy, createdAt: project.createdAt } });
});

const updateProject = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw new ApiError(400, 'name is required.');

  const project = await Project.findOne({ _id: req.projectId, orgId: req.org.id });
  if (!project) throw new ApiError(404, 'Project not found.');

  project.name = name;
  await project.save();

  Sentry.logger.info('Project renamed', { projectId: String(project._id) });
  res.json({ project: { id: project._id, name: project.name } });
});

const listProjectMembers = asyncHandler(async (req, res) => {
  const memberships = await ProjectMembership.find({ projectId: req.projectId }).populate('userId', 'email name');
  res.json({
    members: memberships.map((m) => ({
      userId: m.userId._id,
      email: m.userId.email,
      name: m.userId.name,
      joinedAt: m.joinedAt,
    })),
  });
});

// Any org member can invite any other org member into a project they're in.
const addProjectMember = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId) throw new ApiError(400, 'userId is required.');

  const targetIsOrgMember = await OrgMembership.findOne({ userId, orgId: req.org.id });
  if (!targetIsOrgMember) throw new ApiError(400, 'That user is not a member of this org.');

  const existing = await ProjectMembership.findOne({ userId, projectId: req.projectId });
  if (existing) throw new ApiError(409, 'That user is already on the project.');

  await ProjectMembership.create({ userId, projectId: req.projectId, orgId: req.org.id });
  Sentry.logger.info('Project member added', { projectId: req.projectId, userId });
  res.status(201).json({ message: 'Added to project.' });
});

const removeProjectMember = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const membership = await ProjectMembership.findOne({ userId, projectId: req.projectId });
  if (!membership) throw new ApiError(404, 'That user is not on this project.');

  await membership.softDelete(req.user.id);
  Sentry.logger.info('Project member removed', { projectId: req.projectId, userId });
  res.json({ message: 'Removed from project.' });
});

module.exports = {
  createProject,
  listMyProjects,
  getProject,
  updateProject,
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
};
