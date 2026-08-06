const Sentry = require('@sentry/node');
const File = require('../models/File');
const Chunk = require('../models/Chunk');
const ProjectMembership = require('../models/ProjectMembership');
const { buildKey, uploadBuffer, getSignedDownloadUrl } = require('../services/storage/s3.service');
const { SUPPORTED_MIME_TYPES } = require('../services/file_handlers/registry');
const { processFile } = require('../services/processing/processFile');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded.');
  if (!SUPPORTED_MIME_TYPES.includes(req.file.mimetype)) {
    throw new ApiError(415, `Unsupported file type: ${req.file.mimetype}`);
  }

  const { projectId } = req.body; // absent => personal

  const key = buildKey({
    orgId: req.org.id,
    projectId: projectId || null,
    ownerId: req.user.id,
    filename: req.file.originalname,
  });
  await uploadBuffer({ key, buffer: req.file.buffer, mimeType: req.file.mimetype });

  const file = await File.create({
    orgId: req.org.id,
    projectId: projectId || null,
    ownerId: req.user.id,
    s3Key: key,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    status: 'pending',
  });

  Sentry.logger.info('File uploaded', {
    fileId: String(file._id),
    filename: file.filename,
    mimeType: file.mimeType,
    projectId: projectId || null,
  });

  processFile(file._id).catch((err) => {
    console.error(`[file ${file._id}] processing error`, err);
    Sentry.captureException(err, { tags: { pipeline: 'file_processing_unhandled' } });
  });

  res.status(201).json({ file: { id: file._id, filename: file.filename, status: file.status } });
});

const listFiles = asyncHandler(async (req, res) => {
  const { projectId } = req.query;

  const filter = projectId
    ? { orgId: req.org.id, projectId }
    : { orgId: req.org.id, projectId: null, ownerId: req.user.id };

  const files = await File.find(filter).sort({ createdAt: -1 });
  res.json({
    files: files.map((f) => ({
      id: f._id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      status: f.status,
      failureReason: f.failureReason,
      createdAt: f.createdAt,
    })),
  });
});

// A file is visible to its owner (personal) or to members of the project it
// belongs to — never both. Shared by every single-file route below.
async function assertFileAccess(file, userId) {
  if (file.projectId) {
    const membership = await ProjectMembership.findOne({ userId, projectId: file.projectId });
    if (!membership) throw new ApiError(403, 'You are not a member of this project.');
  } else if (String(file.ownerId) !== String(userId)) {
    throw new ApiError(403, 'Not your file.');
  }
}

const getFile = asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.fileId, orgId: req.org.id });
  if (!file) throw new ApiError(404, 'File not found.');
  await assertFileAccess(file, req.user.id);

  const downloadUrl = await getSignedDownloadUrl(file.s3Key);
  res.json({
    id: file._id,
    filename: file.filename,
    status: file.status,
    failureReason: file.failureReason,
    downloadUrl,
  });
});

// The chunks a file was split into — lets a user see exactly what's stored
// in memory for a given upload.
const getFileChunks = asyncHandler(async (req, res) => {
  const file = await File.findOne({ _id: req.params.fileId, orgId: req.org.id });
  if (!file) throw new ApiError(404, 'File not found.');
  await assertFileAccess(file, req.user.id);

  const chunks = await Chunk.find({ fileId: file._id }).sort({ 'metadata.chunkIndex': 1 });
  res.json({
    chunks: chunks.map((c) => ({ id: c._id, text: c.text, chunkIndex: c.metadata?.chunkIndex ?? 0 })),
  });
});

module.exports = { uploadFile, listFiles, getFile, getFileChunks };
