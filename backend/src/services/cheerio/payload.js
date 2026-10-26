const crypto = require('crypto');

// Cheerio's "send webhook" step lets the customer write the request body
// themselves, so the payload has no fixed shape. The Integrations page
// suggests a template (contact_name, contact_phone, message, ...); these
// aliases also cover the common names a customer might pick instead.
const FIELD_ALIASES = {
  eventId: ['event_id', 'eventid', 'message_id', 'messageid', 'wamid', 'id'],
  text: ['message', 'text', 'body', 'content', 'message_text', 'messagetext', 'message_body', 'last_message', 'reply', 'user_message', 'msg'],
  contactName: ['contact_name', 'contactname', 'customer_name', 'full_name', 'fullname', 'name', 'first_name', 'user_name', 'username'],
  contactPhone: ['contact_phone', 'contactphone', 'phone', 'phone_number', 'phonenumber', 'mobile', 'mobile_number', 'whatsapp_number', 'wa_id', 'number', 'from'],
  contactEmail: ['contact_email', 'contactemail', 'email', 'email_address'],
  channel: ['channel', 'platform', 'source'],
  direction: ['direction', 'message_direction'],
  timestamp: ['timestamp', 'time', 'sent_at', 'created_at', 'date'],
  conversationId: ['conversation_id', 'conversationid', 'chat_id', 'ticket_id'],
};
const MAX_TEXT_CHARS = 8000;
const MAX_PAYLOAD_CHARS = 16000;
const MAX_DEPTH = 3;

// An unfilled template variable, e.g. "{{name}}" left as typed.
function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && (!value.trim() || /^\s*\{\{[^}]*\}\}\s*$/.test(value)));
}

/** Every scalar value in the payload, shallowest first, keyed by its lowercased leaf name. */
function scalarLeaves(payload) {
  const leaves = [];
  const walk = (value, path, depth) => {
    if (depth > MAX_DEPTH || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.slice(0, 20).forEach((item, index) => walk(item, [...path, String(index)], depth + 1));
    } else if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key], depth + 1);
    } else if (!isBlank(value)) {
      leaves.push({ key: path[path.length - 1].toLowerCase(), path: path.join('.'), depth, value: String(value).trim() });
    }
  };
  walk(payload, [], 0);
  return leaves.sort((a, b) => a.depth - b.depth);
}

function pick(leaves, field) {
  for (const alias of FIELD_ALIASES[field]) {
    const leaf = leaves.find((entry) => entry.key === alias);
    if (leaf) return leaf.value;
  }
  return null;
}

function parseDirection(value) {
  const normalized = String(value || '').toLowerCase();
  if (/out|sent|agent|bot|business/.test(normalized)) return 'outbound';
  if (/in|received|customer|user|contact/.test(normalized)) return 'inbound';
  return 'unknown';
}

function parseTimestamp(value) {
  if (!value) return new Date();
  const numeric = Number(value);
  // Unix seconds or milliseconds, or any date string Date understands.
  const date = Number.isFinite(numeric) ? new Date(numeric < 1e12 ? numeric * 1000 : numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Turns one webhook body into the fields we store, or null when it carries
 * nothing readable. A body without a recognisable message field (say, a
 * "lead tagged" step) is kept as its key/value lines so it can still be evaluated.
 */
function normalizeCheerioPayload(body) {
  let payload = body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = { message: payload };
    }
  }
  if (!payload || typeof payload !== 'object') return null;

  const leaves = scalarLeaves(payload);
  if (!leaves.length) return null;

  const text = pick(leaves, 'text') || leaves.map((leaf) => `${leaf.path}: ${leaf.value}`).join('\n');
  const contactPhone = pick(leaves, 'contactPhone');
  const contactEmail = pick(leaves, 'contactEmail');
  const conversationId = pick(leaves, 'conversationId');
  const eventId = pick(leaves, 'eventId');
  const payloadJson = JSON.stringify(payload);

  return {
    eventKey: eventId ? `id:${eventId.slice(0, 200)}` : `sha256:${crypto.createHash('sha256').update(payloadJson).digest('hex')}`,
    channel: pick(leaves, 'channel')?.slice(0, 50).toLowerCase() || null,
    direction: parseDirection(pick(leaves, 'direction')),
    contactName: pick(leaves, 'contactName')?.slice(0, 200) || null,
    contactPhone: contactPhone?.slice(0, 50) || null,
    contactEmail: contactEmail?.slice(0, 200).toLowerCase() || null,
    conversationKey: (conversationId || contactPhone || contactEmail)?.slice(0, 200) || null,
    text: text.slice(0, MAX_TEXT_CHARS),
    payloadJson: payloadJson.slice(0, MAX_PAYLOAD_CHARS),
    occurredAt: parseTimestamp(pick(leaves, 'timestamp')),
  };
}

module.exports = { normalizeCheerioPayload };
