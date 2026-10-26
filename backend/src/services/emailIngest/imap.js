const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');
const { ImapFlow } = require('imapflow');
const { ApiError } = require('../../utils/ApiError');

// Known IMAP servers, matched by the address's domain first and its MX host
// second (which also covers custom domains on Google Workspace, Zoho, etc.).
const DOMAIN_SERVERS = {
  'gmail.com': 'imap.gmail.com',
  'googlemail.com': 'imap.gmail.com',
  'yahoo.com': 'imap.mail.yahoo.com',
  'ymail.com': 'imap.mail.yahoo.com',
  'icloud.com': 'imap.mail.me.com',
  'me.com': 'imap.mail.me.com',
  'mac.com': 'imap.mail.me.com',
  'zoho.com': 'imap.zoho.com',
  'zohomail.com': 'imap.zoho.com',
  'zoho.in': 'imap.zoho.in',
  'zohomail.in': 'imap.zoho.in',
};

const MX_SERVERS = [
  [/(^|\.)(google|googlemail)\.com$/, 'imap.gmail.com'],
  [/(^|\.)zoho\.in$/, 'imap.zoho.in'],
  [/(^|\.)zoho\.eu$/, 'imap.zoho.eu'],
  [/(^|\.)(zoho|zohomail)\.com$/, 'imap.zoho.com'],
  [/(^|\.)yahoodns\.net$/, 'imap.mail.yahoo.com'],
  [/(^|\.)icloud\.com$/, 'imap.mail.me.com'],
  [/(^|\.)titan\.email$/, 'imap.titan.email'],
  [/(^|\.)secureserver\.net$/, 'imap.secureserver.net'],
  [/(^|\.)hostinger\.com$/, 'imap.hostinger.com'],
];

// Microsoft has turned off password (basic auth) IMAP for Outlook.com and
// Microsoft 365, so these mailboxes need OAuth, which this integration doesn't do.
const MICROSOFT_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com']);
const MICROSOFT_MX = /(^|\.)(outlook\.com|protection\.outlook\.com)$/;
const MICROSOFT_UNSUPPORTED = 'Outlook and Microsoft 365 mailboxes no longer allow password-based IMAP, so they can’t be connected this way yet.';

async function lookupMxHosts(domain) {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MX lookup timed out')), 5000)),
    ]);
    return records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange.toLowerCase());
  } catch {
    return [];
  }
}

const IMAP_PORTS = new Set([993, 143]);

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

// A user-entered host must be a public IMAP server: otherwise the backend
// could be pointed at internal services (e.g. the cloud metadata endpoint).
async function assertPublicImapHost(host, port) {
  if (!IMAP_PORTS.has(port)) throw new ApiError(400, 'IMAP port must be 993 (SSL/TLS) or 143 (STARTTLS).');
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new ApiError(400, 'The IMAP server address could not be found.');
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ApiError(400, 'That IMAP server address is not allowed.');
  }
}

function acceptsTls(host, port) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout: 5000 }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// Shared hosting (cPanel, Hostinger, mail relays like MailChannels) usually
// serves IMAP at imap.<domain> or mail.<domain>, with a valid TLS certificate.
async function guessDomainImapHost(domain) {
  for (const candidate of [`imap.${domain}`, `mail.${domain}`]) {
    try {
      await assertPublicImapHost(candidate, 993);
      if (await acceptsTls(candidate, 993)) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Picks the IMAP server for an address, honouring an explicit host when the user gave one. */
async function resolveImapServer(emailAddress, { host, port, secure } = {}) {
  const explicitPort = Number(port) || 993;
  const explicitSecure = typeof secure === 'boolean' ? secure : explicitPort === 993;
  if (host) {
    const explicitHost = String(host).trim().toLowerCase();
    await assertPublicImapHost(explicitHost, explicitPort);
    return { host: explicitHost, port: explicitPort, secure: explicitSecure };
  }

  const domain = emailAddress.split('@')[1];
  if (MICROSOFT_DOMAINS.has(domain)) throw new ApiError(400, MICROSOFT_UNSUPPORTED);
  if (DOMAIN_SERVERS[domain]) return { host: DOMAIN_SERVERS[domain], port: 993, secure: true };

  const mxHosts = await lookupMxHosts(domain);
  if (mxHosts.some((mx) => MICROSOFT_MX.test(mx))) throw new ApiError(400, MICROSOFT_UNSUPPORTED);
  for (const mx of mxHosts) {
    const match = MX_SERVERS.find(([pattern]) => pattern.test(mx));
    if (match) return { host: match[1], port: 993, secure: true };
  }
  const guessed = await guessDomainImapHost(domain);
  if (guessed) return { host: guessed, port: 993, secure: true };
  throw new ApiError(400, `We couldn't detect the IMAP server for ${domain}. Enter it under advanced settings (your email provider lists it in its IMAP setup guide).`);
}

function createClient({ host, port, secure }, { user, pass }) {
  return new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    // The EC2 host has no IPv6 route. Left to Node's dual-stack connect, a
    // slow IPv4 attempt is abandoned for an unreachable IPv6 address and the
    // sync fails, so mail servers are always reached over IPv4.
    tls: { family: 4 },
  });
}

function friendlyImapError(err) {
  if (err?.authenticationFailed) {
    return 'Sign-in failed. For Gmail and Google Workspace, use an app password (needs 2-Step Verification) and make sure IMAP is enabled; for other providers, check the password and that IMAP access is turned on.';
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(err?.code)) return 'The IMAP server address could not be found.';
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(err?.code) || /timeout/i.test(err?.message || '')) {
    return 'Could not reach the IMAP server. Check the server address and port.';
  }
  return err?.responseText || err?.message || 'Could not connect to the mailbox.';
}

/**
 * Finds the inbox and sent folders and their current end, so ingestion starts
 * from "now" — like WhatsApp, only mail that arrives after connecting is read.
 */
async function discoverFolders(client) {
  const list = await client.list();
  const sent = list.find((folder) => folder.specialUse === '\\Sent');
  const folders = [{ path: 'INBOX', role: 'inbox' }, ...(sent ? [{ path: sent.path, role: 'sent' }] : [])];
  for (const folder of folders) {
    const status = await client.status(folder.path, { uidNext: true, uidValidity: true });
    folder.uidValidity = String(status.uidValidity);
    folder.lastUid = Math.max(0, (status.uidNext || 1) - 1);
  }
  return folders;
}

/** Signs in once to verify credentials and returns the folders to sync. */
async function inspectMailbox(server, credentials) {
  const client = createClient(server, credentials);
  client.on('error', () => {}); // surfaced through the awaited calls instead
  try {
    await client.connect();
    return await discoverFolders(client);
  } catch (err) {
    throw new ApiError(400, friendlyImapError(err));
  } finally {
    await client.logout().catch(() => client.close());
  }
}

module.exports = { resolveImapServer, createClient, inspectMailbox, friendlyImapError };
