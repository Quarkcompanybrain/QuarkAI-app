const rateLimit = require('express-rate-limit');

// 5 OTP requests per email/IP per hour
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${(req.body.email || '').toLowerCase()}`,
  message: { error: 'Too many verification code requests. Try again later.' },
});

// 5 verify attempts per email/IP per 10 minutes (mirrors OTP TTL)
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${(req.body.email || '').toLowerCase()}`,
  message: { error: 'Too many attempts. Request a new code.' },
});

// 10 invite sends per admin per hour
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.ip}:${req.user?.id || 'anon'}`,
  message: { error: 'Too many invites sent. Try again later.' },
});

module.exports = { otpRequestLimiter, otpVerifyLimiter, inviteLimiter };
