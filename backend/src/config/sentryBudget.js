// Keeps error events inside Sentry's free quota (5k errors a month, about 7 an
// hour). A failing dependency, such as a revoked API key or an AI provider
// outage, raises the same error on every request and every worker retry, and
// that used up the whole month's quota in days. Each process sends only the
// first few occurrences of each distinct error per hour, under an hourly
// ceiling for all errors together; the rest are dropped before sending.
const HOUR_MS = 60 * 60 * 1000;

function createErrorBudget({ perErrorPerHour, totalPerHour, now = () => Date.now() }) {
  let windowStart = now();
  let total = 0;
  const perKey = new Map();

  function keyFor(event) {
    const exception = event.exception?.values?.[event.exception.values.length - 1];
    const message = `${exception?.type || 'message'}: ${exception?.value || event.message || ''}`
      // ids, hex, numbers and quoted values vary between occurrences of the same error
      .replace(/[0-9a-f]{12,}/gi, '#')
      .replace(/\d+/g, '#')
      .replace(/"[^"]*"|'[^']*'/g, '"…"')
      .slice(0, 300);
    return `${event.tags?.pipeline || ''}|${message}`;
  }

  /** Returns true when this event may be sent. */
  return function allow(event) {
    if (now() - windowStart >= HOUR_MS) {
      windowStart = now();
      total = 0;
      perKey.clear();
    }
    const key = keyFor(event);
    const seen = perKey.get(key) || 0;
    if (seen >= perErrorPerHour || total >= totalPerHour) return false;
    perKey.set(key, seen + 1);
    total += 1;
    return true;
  };
}

module.exports = { createErrorBudget };
