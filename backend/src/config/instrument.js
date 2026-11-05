// Must be required before any other module — Sentry needs to patch things
// (http, express, mongoose, etc.) before they're first loaded.
require('dotenv').config();

const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');
const { createErrorBudget } = require('./sentryBudget');

const isProd = process.env.NODE_ENV === 'production';
const allowError = createErrorBudget({
  perErrorPerHour: Number(process.env.SENTRY_MAX_EVENTS_PER_ERROR_PER_HOUR) || 2,
  totalPerHour: Number(process.env.SENTRY_MAX_ERRORS_PER_HOUR) || 6,
});

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  enabled: Boolean(process.env.SENTRY_DSN),

  integrations: [nodeProfilingIntegration()],

  // Drops repeats of the same error before they count against the error quota.
  beforeSend: (event) => (allowError(event) ? event : null),

  // Send structured logs to Sentry (Sentry.logger.*)
  enableLogs: true,

  // Tracing / profiling — sample everything in dev, dial back in prod
  tracesSampleRate: isProd ? 0.2 : 1.0,
  profileSessionSampleRate: isProd ? 0.2 : 1.0,
  profileLifecycle: 'trace',
});

module.exports = Sentry;
