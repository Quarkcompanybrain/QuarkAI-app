const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Otp = require('../../models/Otp');
const { sendMail } = require('../email/mailer');
const { otpEmail } = require('../email/templates');
const { ApiError } = require('../../utils/ApiError');

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function generateCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

async function requestOtp(email, purpose) {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);

  await Otp.create({
    email,
    codeHash,
    purpose,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const { subject, html } = otpEmail(code, purpose);
  await sendMail({ to: email, subject, html });
}

async function verifyOtp(email, code, purpose) {
  const otp = await Otp.findOne({ email, purpose, consumedAt: null }).sort({ createdAt: -1 });

  if (!otp) throw new ApiError(400, 'No active verification code for this email. Request a new one.');
  if (otp.expiresAt < new Date()) throw new ApiError(400, 'Code expired. Request a new one.');
  if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new ApiError(429, 'Too many attempts. Request a new code.');
  }

  const isValid = await bcrypt.compare(code, otp.codeHash);

  if (!isValid) {
    otp.attempts += 1;
    await otp.save();
    throw new ApiError(400, 'Incorrect code.');
  }

  otp.consumedAt = new Date();
  await otp.save();
}

module.exports = { requestOtp, verifyOtp };
