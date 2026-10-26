const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/webhook.controller');

const router = express.Router();

// Public endpoints: the secret token in the URL authenticates the caller.
// JSON is already parsed app-wide; workflow builders may also send form or plain-text bodies.
router.use(express.urlencoded({ extended: true, limit: '100kb' }));
router.use(express.text({ type: 'text/*', limit: '100kb' }));

const cheerioLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => `cheerio:${req.params.token || req.ip}`,
  message: { error: 'Too many webhook calls. Slow down and try again shortly.' },
});

router.get('/cheerio/:token', cheerioLimiter, ctrl.checkCheerioWebhook);
router.post('/cheerio/:token', cheerioLimiter, ctrl.receiveCheerioWebhook);

module.exports = router;
