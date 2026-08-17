const pdfHandler = require('./pdf.handler');
const imageHandler = require('./image.handler');
const textHandler = require('./text.handler');
const docxHandler = require('./docx.handler');
const pptxHandler = require('./pptx.handler');
const xlsxHandler = require('./xlsx.handler');
const { ApiError } = require('../../utils/ApiError');

// Every supported format maps to a handler behind the same extract({buffer, mimeType}) interface.
// Adding a new format later means adding one entry here, not touching the pipeline.
const HANDLERS_BY_MIME = {
  'application/pdf': pdfHandler,

  'image/png': imageHandler,
  'image/jpeg': imageHandler,
  'image/gif': imageHandler,
  'image/webp': imageHandler,

  'text/plain': textHandler,
  'text/markdown': textHandler,
  'text/csv': textHandler,
  'application/csv': textHandler,

  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': docxHandler,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': pptxHandler,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': xlsxHandler,
  'application/vnd.ms-excel': xlsxHandler,
};

const SUPPORTED_MIME_TYPES = Object.keys(HANDLERS_BY_MIME);

function resolveHandler(mimeType) {
  const handler = HANDLERS_BY_MIME[mimeType];
  if (!handler) throw new ApiError(415, `Unsupported file type: ${mimeType}`);
  return handler;
}

module.exports = { resolveHandler, SUPPORTED_MIME_TYPES };
