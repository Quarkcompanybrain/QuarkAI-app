const mammoth = require('mammoth');

async function extract({ buffer }) {
  const { value } = await mammoth.extractRawText({ buffer });
  return { kind: 'text', text: value };
}

module.exports = { extract };
