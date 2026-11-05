const { JWT } = require('google-auth-library');
const GoogleFileClaim = require('../../models/GoogleFileClaim');
const env = require('../../config/env');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/documents'];
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DOCS_API = 'https://docs.googleapis.com/v1/documents';
const MAX_READ_ROWS = 500;
const MAX_READ_CHARS = 40_000;
const MAX_WRITE_CELLS = 2_000;

let credentials;
let client;

/** A problem the model should relay to the user (no access, bad link…), not a server failure. */
class GoogleWorkspaceError extends Error {}

function loadCredentials() {
  if (credentials !== undefined) return credentials;
  credentials = null;
  if (env.googleServiceAccountKeyBase64) {
    const key = JSON.parse(Buffer.from(env.googleServiceAccountKeyBase64, 'base64').toString('utf8'));
    credentials = { email: key.client_email, privateKey: key.private_key };
  }
  return credentials;
}

function serviceAccountEmail() {
  return loadCredentials()?.email || null;
}

function getClient() {
  if (client) return client;
  const creds = loadCredentials();
  if (!creds) throw new GoogleWorkspaceError('Google Sheets and Docs access is not set up on this Quark server yet.');
  client = new JWT({ email: creds.email, key: creds.privateKey, scopes: SCOPES });
  return client;
}

/** Recognises a Google Sheets or Docs link and extracts the file id (and sheet tab id, if any). */
function parseGoogleUrl(url) {
  const match = /docs\.google\.com\/(spreadsheets|document)\/d\/([a-zA-Z0-9_-]{20,})/.exec(String(url || ''));
  if (!match) throw new GoogleWorkspaceError('That is not a Google Sheets or Google Docs link.');
  const gid = /[#&?]gid=(\d+)/.exec(String(url))?.[1];
  return { kind: match[1] === 'spreadsheets' ? 'sheet' : 'doc', fileId: match[2], gid: gid ? Number(gid) : null };
}

function accessHelp(kind, needsEdit) {
  return `Quark AI can't open this ${kind === 'sheet' ? 'Google Sheet' : 'Google Doc'}. Share it with ${serviceAccountEmail()} as ${needsEdit ? 'an Editor' : 'a Viewer (or Editor, to let Quark change it)'}, then try again.`;
}

async function googleRequest({ url, method = 'GET', data, kind, needsEdit = false }) {
  try {
    const res = await getClient().request({ url, method, data });
    return res.data;
  } catch (err) {
    const status = err?.response?.status ?? err?.status;
    if (status === 403 || status === 404) throw new GoogleWorkspaceError(accessHelp(kind, needsEdit));
    if (status === 400) throw new GoogleWorkspaceError(`Google rejected the request: ${err?.response?.data?.error?.message || err.message}`);
    throw err;
  }
}

/** First org to use a file owns it in Quark; any other org is refused. */
async function claimFile({ fileId, kind, title, orgId, userId }) {
  const claim = await GoogleFileClaim.findOneAndUpdate(
    { fileId },
    { $setOnInsert: { fileId, kind, orgId, claimedBy: userId, title } },
    { upsert: true, new: true }
  ).lean();
  if (String(claim.orgId) !== String(orgId)) {
    throw new GoogleWorkspaceError('This file is already connected to a different organization in Quark, so it can’t be used here.');
  }
}

function quoteSheetName(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

async function openSheet(url, { orgId, userId, needsEdit }) {
  const { kind, fileId, gid } = parseGoogleUrl(url);
  if (kind !== 'sheet') throw new GoogleWorkspaceError('That link is a Google Doc, not a Google Sheet.');
  const meta = await googleRequest({
    url: `${SHEETS_API}/${fileId}?fields=properties.title,sheets.properties(sheetId,title,gridProperties)`,
    kind,
    needsEdit,
  });
  await claimFile({ fileId, kind, title: meta.properties?.title || '', orgId, userId });
  const tabs = (meta.sheets || []).map((sheet) => sheet.properties);
  const defaultTab = tabs.find((tab) => tab.sheetId === gid) || tabs[0];
  return { fileId, title: meta.properties?.title || '', tabs, defaultTab };
}

/** A1 range with the tab name; a bare range like "A1:D20" applies to the linked tab. */
function resolveRange(range, defaultTab) {
  const value = String(range || '').trim();
  if (!value) return quoteSheetName(defaultTab.title);
  return value.includes('!') ? value : `${quoteSheetName(defaultTab.title)}!${value}`;
}

async function readSheet({ url, range }, ctx) {
  const sheet = await openSheet(url, { ...ctx, needsEdit: false });
  const a1 = resolveRange(range, sheet.defaultTab);
  const data = await googleRequest({ url: `${SHEETS_API}/${sheet.fileId}/values/${encodeURIComponent(a1)}?valueRenderOption=FORMATTED_VALUE`, kind: 'sheet' });
  const rows = data.values || [];
  const lines = [];
  let chars = 0;
  for (const row of rows.slice(0, MAX_READ_ROWS)) {
    const line = row.map((cell) => String(cell).replace(/\t|\n/g, ' ')).join('\t');
    if (chars + line.length > MAX_READ_CHARS) break;
    lines.push(line);
    chars += line.length + 1;
  }
  return {
    title: sheet.title,
    tabs: sheet.tabs.map((tab) => `${tab.title} (${tab.gridProperties?.rowCount || '?'} rows × ${tab.gridProperties?.columnCount || '?'} cols)`),
    range: data.range,
    rowCount: rows.length,
    truncated: lines.length < rows.length,
    // Tab-separated, first row first; row N of the output is row N of the range.
    rows: lines.join('\n'),
  };
}

async function writeSheet({ url, range, values, mode }, ctx) {
  if (!Array.isArray(values) || !values.length || !values.every(Array.isArray)) {
    throw new GoogleWorkspaceError('values must be a list of rows, each a list of cell values.');
  }
  const cellCount = values.reduce((total, row) => total + row.length, 0);
  if (cellCount > MAX_WRITE_CELLS) throw new GoogleWorkspaceError(`Write at most ${MAX_WRITE_CELLS} cells at a time.`);
  const sheet = await openSheet(url, { ...ctx, needsEdit: true });
  const a1 = resolveRange(range, sheet.defaultTab);
  const rows = values.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : cell)));
  const data = mode === 'append'
    ? await googleRequest({
        url: `${SHEETS_API}/${sheet.fileId}/values/${encodeURIComponent(a1)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        method: 'POST',
        data: { values: rows },
        kind: 'sheet',
        needsEdit: true,
      })
    : await googleRequest({
        url: `${SHEETS_API}/${sheet.fileId}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`,
        method: 'PUT',
        data: { values: rows },
        kind: 'sheet',
        needsEdit: true,
      });
  const updates = data.updates || data;
  return { title: sheet.title, updatedRange: updates.updatedRange, updatedRows: updates.updatedRows, updatedCells: updates.updatedCells };
}

function docText(content) {
  const parts = [];
  for (const element of content || []) {
    if (element.paragraph) {
      parts.push((element.paragraph.elements || []).map((run) => run.textRun?.content || '').join(''));
    } else if (element.table) {
      for (const row of element.table.tableRows || []) {
        parts.push(`${(row.tableCells || []).map((cell) => docText(cell.content).replace(/\n+/g, ' ').trim()).join(' | ')}\n`);
      }
    } else if (element.tableOfContents) {
      parts.push(docText(element.tableOfContents.content));
    }
  }
  return parts.join('');
}

async function openDoc(url, { orgId, userId, needsEdit }) {
  const { kind, fileId } = parseGoogleUrl(url);
  if (kind !== 'doc') throw new GoogleWorkspaceError('That link is a Google Sheet, not a Google Doc.');
  const doc = await googleRequest({ url: `${DOCS_API}/${fileId}`, kind, needsEdit });
  await claimFile({ fileId, kind, title: doc.title || '', orgId, userId });
  return { fileId, doc };
}

async function readDoc({ url }, ctx) {
  const { doc } = await openDoc(url, { ...ctx, needsEdit: false });
  const text = docText(doc.body?.content);
  return {
    title: doc.title,
    truncated: text.length > MAX_READ_CHARS,
    text: text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}…` : text,
  };
}

async function editDoc({ url, action, text, findText }, ctx) {
  if (typeof text !== 'string') throw new GoogleWorkspaceError('text is required.');
  const { fileId, doc } = await openDoc(url, { ...ctx, needsEdit: true });
  let requests;
  if (action === 'append') {
    requests = [{ insertText: { endOfSegmentLocation: {}, text: text.startsWith('\n') ? text : `\n${text}` } }];
  } else if (action === 'replace_text') {
    if (!findText) throw new GoogleWorkspaceError('findText is required to replace text.');
    requests = [{ replaceAllText: { containsText: { text: findText, matchCase: true }, replaceText: text } }];
  } else {
    throw new GoogleWorkspaceError('action must be append or replace_text.');
  }
  const result = await googleRequest({ url: `${DOCS_API}/${fileId}:batchUpdate`, method: 'POST', data: { requests }, kind: 'doc', needsEdit: true });
  const replaced = result.replies?.[0]?.replaceAllText?.occurrencesChanged;
  return { title: doc.title, action, ...(action === 'replace_text' ? { occurrencesChanged: replaced || 0 } : {}) };
}

module.exports = { GoogleWorkspaceError, serviceAccountEmail, parseGoogleUrl, readSheet, writeSheet, readDoc, editDoc, docText };
