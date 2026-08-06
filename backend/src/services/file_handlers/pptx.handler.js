const officeParser = require('officeparser');

async function extract({ buffer }) {
  const text = await officeParser.parseOfficeAsync(buffer);
  return { kind: 'text', text };
}

module.exports = { extract };
