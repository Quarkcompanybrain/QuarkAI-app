// Native format — Claude's vision support reads image content directly.
async function extract({ buffer, mimeType }) {
  return { kind: 'file', mediaType: mimeType, base64: buffer.toString('base64') };
}

module.exports = { extract };
