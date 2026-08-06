// Plain text / Markdown / CSV — already text, no conversion needed.
async function extract({ buffer }) {
  return { kind: 'text', text: buffer.toString('utf-8') };
}

module.exports = { extract };
