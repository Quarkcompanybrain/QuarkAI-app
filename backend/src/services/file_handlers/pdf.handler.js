// Native format — Claude reads PDF text + layout directly, no extraction library needed.
async function extract({ buffer, mimeType }) {
  return { kind: 'file', mediaType: mimeType, base64: buffer.toString('base64') };
}

module.exports = { extract };
