// Must be the very first require — Sentry needs to patch modules before
// anything else loads them.
const Sentry = require('./src/config/instrument');

const env = require('./src/config/env');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { connectDb, ensureVectorIndex } = require('./src/config/db');
const routes = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');

const app = express();

// In dev, allow any localhost origin (Vite may pick a different port than
// CLIENT_URL if the default is taken) — production stays locked to CLIENT_URL.
const corsOrigin =
  env.nodeEnv === 'production'
    ? env.clientUrl
    : (origin, callback) => callback(null, !origin || /^https?:\/\/localhost(:\d+)?$/.test(origin));

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', routes);

// Captures request-cycle errors (5xx only — 4xx client errors are filtered
// out automatically). Must come after all routes, before other error middleware.
Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

async function start() {
  await connectDb();
  await ensureVectorIndex();
  app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
    Sentry.logger.info('Server started', { port: env.port, env: env.nodeEnv });
  });
}

start().catch(async (err) => {
  console.error('[server] failed to start', err);
  Sentry.captureException(err);
  await Sentry.close(2000);
  process.exit(1);
});
