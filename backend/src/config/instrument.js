// Must be required before any other module — Sentry needs to patch things
// (http, express, mongoose, etc.) before they're first loaded.
require('dotenv').config();

const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

const isProd = process.env.NODE_ENV === 'production';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  enabled: Boolean(process.env.SENTRY_DSN),

  integrations: [nodeProfilingIntegration()],

  // Send structured logs to Sentry (Sentry.logger.*)
  enableLogs: true,

  // Tracing / profiling — sample everything in dev, dial back in prod
  tracesSampleRate: isProd ? 0.2 : 1.0,
  profileSessionSampleRate: isProd ? 0.2 : 1.0,
  profileLifecycle: 'trace',
});

module.exports = Sentry;
