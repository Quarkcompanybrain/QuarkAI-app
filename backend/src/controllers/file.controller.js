const Sentry = require('@sentry/node');
const { Types } = require('mongoose');
const File = require('../models/File');
const Chunk = require('../models/Chunk');
const ProjectMembership = require('../models/ProjectMembership');
const { buildKey, uploadBuffer, getSignedDownloadUrl } = require('../services/storage/s3.service');
const { SUPPORTED_MIME_TYPES } = require('../services/file_handlers/registry');
const { processFile } = require('../services/processing/processFile');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');
const { parseListQuery, findPage } = require('../utils/listQuery');

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

const FILE_SOURCES = ['upload', 'whatsapp', 'email'];

/** Where a file came from, for the list: the WhatsApp chat or email it was attached to. */
function fileSourceLabel(file) {
  if (file.sourceType === 'whatsapp') return file.whatsapp?.chatName || file.whatsapp?.senderName || 'WhatsApp';
  if (file.sourceType === 'email') return file.email?.subject || file.email?.from || 'Email';
  return null;
}

// Paged newest first, with optional ?source=upload|whatsapp|email,
// ?status=failed and ?q= filename search. The first page also carries totals
// per source and of failed files, for the filter chips.
const listFiles = asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const page = parseListQuery(req.query);

  const scope = projectId
    ? { orgId: req.org.id, projectId }
    : { orgId: req.org.id, projectId: null, ownerId: req.user.id };
  const filter = { ...scope };
  if (FILE_SOURCES.includes(req.query.source)) filter.sourceType = req.query.source;
  if (req.query.status === 'failed') filter.status = 'failed';
  if (page.search) filter.filename = page.search;

  const [{ rows, hasMore }, countRows] = await Promise.all([
    findPage(File, filter, page),
    page.before
      ? null
      : File.aggregate([
          // aggregate() doesn't cast ids or apply the soft-delete filter, so both are explicit here.
          {
            $match: {
              orgId: new Types.ObjectId(String(req.org.id)),
              ...(projectId ? { projectId: new Types.ObjectId(String(projectId)) } : { projectId: null, ownerId: new Types.ObjectId(String(req.user.id)) }),
              deletedAt: null,
            },
          },
          { $group: { _id: '$sourceType', count: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
        ]),
  ]);

  res.json({
    files: rows.map((f) => ({
      id: f._id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      status: f.status,
      failureReason: f.failureReason,
      createdAt: f.createdAt,
      sourceType: f.sourceType || 'upload',
      sourceLabel: fileSourceLabel(f),
    })),
    hasMore,
    ...(countRows
      ? {
          counts: {
            // Files created before sourceType existed have no value and are uploads.
            ...Object.fromEntries(FILE_SOURCES.map((source) => [source, countRows.filter((row) => (row._id || 'upload') === source).reduce((total, row) => total + row.count, 0)])),
            failed: countRows.reduce((total, row) => total + row.failed, 0),
          },
        }
      : {}),
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
