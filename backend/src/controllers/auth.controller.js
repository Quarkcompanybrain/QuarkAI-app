const Sentry = require('@sentry/node');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const OrgMembership = require('../models/OrgMembership');
const { requestOtp, verifyOtp } = require('../services/auth/otp.service');
const { signToken } = require('../services/auth/token.service');
const { buildAvatarKey, uploadBuffer, getSignedDownloadUrl } = require('../services/storage/s3.service');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const requestSignupOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, 'email is required.');

  const existing = await User.findOne({ email: email.toLowerCase(), hashedPassword: { $ne: null } });
  if (existing) throw new ApiError(409, 'An account with this email already exists. Log in instead.');

  await requestOtp(email.toLowerCase(), 'signup');
  Sentry.logger.info('Signup OTP requested', { email: email.toLowerCase() });
  res.json({ message: 'Verification code sent.' });
});

async function resolveActiveOrg(user) {
  if (user.lastActiveOrgId) {
    const stillMember = await OrgMembership.findOne({ userId: user._id, orgId: user.lastActiveOrgId });
    if (stillMember) return { orgId: String(user.lastActiveOrgId), role: stillMember.role };
  }
  const anyMembership = await OrgMembership.findOne({ userId: user._id }).sort({ joinedAt: -1 });
  return anyMembership ? { orgId: String(anyMembership.orgId), role: anyMembership.role } : null;
}

async function serializeUser(user) {
  const avatarUrl = user.avatarKey ? await getSignedDownloadUrl(user.avatarKey) : null;
  return { id: user._id, email: user.email, name: user.name, avatarUrl };
}

const verifySignupOtp = asyncHandler(async (req, res) => {
  const { email, code, name, password } = req.body;
  if (!email || !code || !password) throw new ApiError(400, 'email, code and password are required.');

  await verifyOtp(email.toLowerCase(), code, 'signup');

  let user = await User.findOne({ email: email.toLowerCase() });
  const hashedPassword = await bcrypt.hash(password, 10);

  if (user) {
    user.hashedPassword = hashedPassword;
    user.name = name || user.name;
    await user.save();
  } else {
    user = await User.create({ email: email.toLowerCase(), hashedPassword, name: name || '' });
  }

  const activeOrg = await resolveActiveOrg(user);
  const token = signToken({ userId: user._id, orgId: activeOrg?.orgId });

  Sentry.logger.info('Signup completed', { userId: String(user._id), email: user.email });

  res.status(201).json({
    token,
    user: await serializeUser(user),
    activeOrg,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(400, 'email and password are required.');

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !user.hashedPassword) throw new ApiError(401, 'Invalid email or password.');

  const valid = await bcrypt.compare(password, user.hashedPassword);
  if (!valid) throw new ApiError(401, 'Invalid email or password.');

  const activeOrg = await resolveActiveOrg(user);
  const token = signToken({ userId: user._id, orgId: activeOrg?.orgId });

  Sentry.logger.info('User logged in', { userId: String(user._id), email: user.email });

  res.json({
    token,
    user: await serializeUser(user),
    activeOrg,
  });
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new ApiError(404, 'User not found.');

  const memberships = await OrgMembership.find({ userId: user._id }).populate('orgId', 'name');

  res.json({
    user: await serializeUser(user),
    orgs: memberships.map((m) => ({
      orgId: m.orgId._id,
      name: m.orgId.name,
      role: m.role,
    })),
  });
});

const switchOrg = asyncHandler(async (req, res) => {
  const { orgId } = req.body;
  if (!orgId) throw new ApiError(400, 'orgId is required.');

  const membership = await OrgMembership.findOne({ userId: req.user.id, orgId });
  if (!membership) throw new ApiError(403, 'You are not a member of this org.');

  await User.findByIdAndUpdate(req.user.id, { lastActiveOrgId: orgId });

  Sentry.logger.info('User switched org', { userId: req.user.id, orgId });

  const token = signToken({ userId: req.user.id, orgId });
  res.json({ token, activeOrg: { orgId, role: membership.role } });
});

const updateProfile = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'name is required.');

  const user = await User.findByIdAndUpdate(req.user.id, { name: name.trim() }, { new: true });
  if (!user) throw new ApiError(404, 'User not found.');

  Sentry.logger.info('Profile updated', { userId: req.user.id });
  res.json({ user: await serializeUser(user) });
});

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No image uploaded.');
  if (!AVATAR_MIME_TYPES.includes(req.file.mimetype)) {
    throw new ApiError(415, `Unsupported image type: ${req.file.mimetype}`);
  }

  const key = buildAvatarKey({ userId: req.user.id, filename: req.file.originalname });
  await uploadBuffer({ key, buffer: req.file.buffer, mimeType: req.file.mimetype });

  const user = await User.findByIdAndUpdate(req.user.id, { avatarKey: key }, { new: true });

  Sentry.logger.info('Avatar uploaded', { userId: req.user.id });
  res.json({ user: await serializeUser(user) });
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, 'email is required.');

  const user = await User.findOne({ email: email.toLowerCase(), hashedPassword: { $ne: null } });
  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to enumerate registered emails.
  if (user) {
    await requestOtp(email.toLowerCase(), 'reset');
    Sentry.logger.info('Password reset OTP requested', { email: email.toLowerCase() });
  }

  res.json({ message: 'If that email has an account, a reset code has been sent.' });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) throw new ApiError(400, 'email, code and newPassword are required.');

  await verifyOtp(email.toLowerCase(), code, 'reset');

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new ApiError(404, 'No account found for this email.');

  user.hashedPassword = await bcrypt.hash(newPassword, 10);
  await user.save();

  Sentry.logger.info('Password reset completed', { userId: String(user._id) });
  res.json({ message: 'Password updated. Log in with your new password.' });
});

module.exports = {
  requestSignupOtp,
  verifySignupOtp,
  login,
  me,
  switchOrg,
  updateProfile,
  uploadAvatar,
  requestPasswordReset,
  resetPassword,
};
