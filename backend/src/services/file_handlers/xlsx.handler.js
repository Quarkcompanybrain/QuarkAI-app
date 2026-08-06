const XLSX = require('xlsx');

async function extract({ buffer }) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const text = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return `# Sheet: ${sheetName}\n${csv}`;
  }).join('\n\n');

  return { kind: 'text', text };
}

module.exports = { extract };
