const Sentry = require('@sentry/node');
const Project = require('../models/Project');
const ProjectMembership = require('../models/ProjectMembership');
const OrgMembership = require('../models/OrgMembership');
const ProjectSource = require('../models/ProjectSource');
const File = require('../models/File');
const Chunk = require('../models/Chunk');
const ChatSession = require('../models/ChatSession');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const createProject = asyncHandler(async (req, res) => {
  const { name, description = '' } = req.body;
  if (!name) throw new ApiError(400, 'name is required.');

  const project = await Project.create({ name, description, orgId: req.org.id, createdBy: req.user.id });
  await ProjectMembership.create({ userId: req.user.id, projectId: project._id, orgId: req.org.id });

  Sentry.logger.info('Project created', { projectId: String(project._id), orgId: req.org.id });
  res.status(201).json({ project: { id: project._id, name: project.name, description: project.description, orgId: project.orgId } });
});

// Only projects the caller is a member of, within the active org.
const listMyProjects = asyncHandler(async (req, res) => {
  const memberships = await ProjectMembership.find({ userId: req.user.id, orgId: req.org.id }).populate(
    'projectId',
    'name description createdBy createdAt'
  );

  res.json({
    projects: memberships
      .filter((m) => m.projectId)
      .map((m) => ({
        id: m.projectId._id,
        name: m.projectId.name,
        description: m.projectId.description,
        createdBy: m.projectId.createdBy,
        createdAt: m.projectId.createdAt,
      })),
  });
});

const getProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.projectId, orgId: req.org.id });
  if (!project) throw new ApiError(404, 'Project not found.');
  res.json({ project: { id: project._id, name: project.name, description: project.description, createdBy: project.createdBy, createdAt: project.createdAt } });
});

const updateProject = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  if (name === undefined && description === undefined) throw new ApiError(400, 'name or description is required.');
  if (name !== undefined && !String(name).trim()) throw new ApiError(400, 'name cannot be empty.');

  const project = await Project.findOne({ _id: req.projectId, orgId: req.org.id });
  if (!project) throw new ApiError(404, 'Project not found.');

  if (name !== undefined) project.name = name;
  if (description !== undefined) project.description = description;
  await project.save();

  Sentry.logger.info('Project updated', { projectId: String(project._id) });
  res.json({ project: { id: project._id, name: project.name, description: project.description } });
});

// Project deletion is recoverable: every project-owned record is soft deleted
// together so it no longer appears in navigation, retrieval, or ingestion.
// Only its creator can remove shared workspaces.
const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.projectId, orgId: req.org.id });
  if (!project) throw new ApiError(404, 'Project not found.');
  if (String(project.createdBy) !== String(req.user.id)) {
    throw new ApiError(403, 'Only the project creator can delete this project.');
  }

  const deletedAt = new Date();
  const deletedBy = req.user.id;
  await project.softDelete(deletedBy);
  await Promise.all([
    ProjectMembership.updateMany({ projectId: project._id }, { $set: { deletedAt, deletedBy } }),
    ProjectSource.updateMany({ projectId: project._id }, { $set: { deletedAt, deletedBy } }),
    File.updateMany({ projectId: project._id }, { $set: { deletedAt, deletedBy } }),
    Chunk.updateMany({ projectId: project._id }, { $set: { deletedAt, deletedBy } }),
    ChatSession.updateMany({ projectId: project._id }, { $set: { deletedAt, deletedBy } }),
  ]);

  Sentry.logger.info('Project deleted', { projectId: String(project._id), orgId: String(req.org.id) });
  res.json({ message: 'Project deleted.' });
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
  deleteProject,
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
};
