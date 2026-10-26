// Shared retry policy for the ingestion workers (WhatsApp, email, Cheerio,
// files). It separates a temporary AI outage (rate limit, out of credits, 5xx,
// network) from a request that will never succeed, and pauses all ingestion
// in this process while the provider account is out of credits, so a
// backlog doesn't hammer the API and flood Sentry with the same error.
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const CREDITS_PAUSE_MS = 10 * 60 * 1000;
const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

let pausedUntil = 0;

class AiPausedError extends Error {
  constructor(resumeAt) {
    super(`AI ingestion is paused until ${resumeAt.toISOString()} because the provider account is out of credits.`);
    this.name = 'AiPausedError';
    this.outOfCredits = true;
  }
}

function isOutOfCredits(err) {
  if (err?.outOfCredits) return true;
  return err?.code === 'insufficient_quota' || /no credits remaining|exceeded your current quota|credit balance is too low/i.test(String(err?.message || ''));
}

function isRetryable(err) {
  if (err?.retryable || isOutOfCredits(err)) return true;
  const status = Number(err?.status);
  if (status === 429) return !/request too large/i.test(String(err?.message || ''));
  if (status === 408 || status === 409 || status >= 500) return true;
  if (err?.name === 'APIConnectionError' || err?.name === 'APIConnectionTimeoutError') return true;
  return NETWORK_ERROR_CODES.has(err?.code) || NETWORK_ERROR_CODES.has(err?.cause?.code);
}

/** Call from every AI call site's catch; an out-of-credits error pauses ingestion. */
function noteAiError(err) {
  if (isOutOfCredits(err) && !(err instanceof AiPausedError)) {
    pausedUntil = Math.max(pausedUntil, Date.now() + CREDITS_PAUSE_MS);
  }
}

function isAiPaused() {
  return Date.now() < pausedUntil;
}

/** Throws before an ingestion step spends an AI call while ingestion is paused. */
function assertAiAvailable() {
  if (isAiPaused()) throw new AiPausedError(new Date(pausedUntil));
}

/**
 * When a failed attempt should run again, or null to give up. Running out of
 * credits waits for the pause to end and doesn't use up an attempt, so a
 * long outage can't exhaust the retries of everything that arrived during it.
 */
function nextRetry(err, attempts) {
  if (!isRetryable(err)) return null;
  if (isOutOfCredits(err)) return { at: new Date(Math.max(pausedUntil, Date.now() + RETRY_BASE_MS)), countsAsAttempt: false };
  if (attempts >= MAX_ATTEMPTS) return null;
  return { at: new Date(Date.now() + Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS)), countsAsAttempt: true };
}

/** A paused attempt never reached the provider, so there's nothing new to report. */
function shouldReport(err) {
  return !(err instanceof AiPausedError);
}

module.exports = { AiPausedError, isRetryable, isOutOfCredits, noteAiError, isAiPaused, assertAiAvailable, nextRetry, shouldReport, MAX_ATTEMPTS };
