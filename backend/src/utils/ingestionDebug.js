const env = require('../config/env');

// Full content diagnostics are intentionally opt-in. Ingestion receives
// private chat messages and file text, so normal production logs must not
// contain any of that source material or model responses.
function ingestionDebug(level, event, details) {
  if (!env.ingestionDebugLogs) return;
  console[level](`[ingestion] ${event}`, details);
}

module.exports = { ingestionDebug };
