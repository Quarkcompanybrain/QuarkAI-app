const Sentry = require('@sentry/node');
const bcrypt = require('bcryptjs');
const Org = require('../models/Org');
const OrgMembership = require('../models/OrgMembership');
const Invite = require('../models/Invite');
const User = require('../models/User');
const { generateInviteToken, inviteExpiry } = require('../services/auth/invite.service');
const { sendMail } = require('../services/email/mailer');
const { inviteEmail } = require('../services/email/templates');
const { signToken } = require('../services/auth/token.service');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');
const env = require('../config/env');

const createOrg = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw new ApiError(400, 'name is required.');

  const org = await Org.create({ name, createdBy: req.user.id });
  await OrgMembership.create({ userId: req.user.id, orgId: org._id, role: 'admin' });
  await User.findByIdAndUpdate(req.user.id, { lastActiveOrgId: org._id });

  const token = signToken({ userId: req.user.id, orgId: org._id });
  Sentry.logger.info('Org created', { orgId: String(org._id), createdBy: req.user.id });
  res.status(201).json({ org: { id: org._id, name: org.name }, token, activeOrg: { orgId: org._id, role: 'admin' } });
});

const listMembers = asyncHandler(async (req, res) => {
  const memberships = await OrgMembership.find({ orgId: req.org.id }).populate('userId', 'email name');
  res.json({
    members: memberships.map((m) => ({
      userId: m.userId._id,
      email: m.userId.email,
      name: m.userId.name,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  });
});

const inviteMember = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, 'email is required.');

  const normalizedEmail = email.toLowerCase();

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    const alreadyMember = await OrgMembership.findOne({ userId: existingUser._id, orgId: req.org.id });
    if (alreadyMember) throw new ApiError(409, 'This person is already a member of the org.');
  }

  const org = await Org.findById(req.org.id);
  const inviter = await User.findById(req.user.id);

  const token = generateInviteToken();
  await Invite.create({
    email: normalizedEmail,
    orgId: req.org.id,
    invitedBy: req.user.id,
    token,
    expiresAt: inviteExpiry(),
  });

  const acceptUrl = `${env.clientUrl}/invite/${token}`;
  const { subject, html } = inviteEmail({ orgName: org.name, inviterName: inviter.name || inviter.email, acceptUrl });
  await sendMail({ to: normalizedEmail, subject, html });

  Sentry.logger.info('Org invite sent', { orgId: req.org.id, email: normalizedEmail });
  res.status(201).json({ message: 'Invite sent.' });
});

const listPendingInvites = asyncHandler(async (req, res) => {
  const invites = await Invite.find({ orgId: req.org.id, status: 'pending' }).sort({ createdAt: -1 });
  res.json({
    invites: invites.map((i) => ({
      id: i._id,
      email: i.email,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      expired: i.expiresAt < new Date(),
    })),
  });
});

const getInvite = asyncHandler(async (req, res) => {
  const invite = await Invite.findOne({ token: req.params.token }).populate('orgId', 'name');
  if (!invite) throw new ApiError(404, 'Invite not found.');
  if (invite.status !== 'pending') throw new ApiError(410, 'This invite has already been used.');
  if (invite.expiresAt < new Date()) throw new ApiError(410, 'This invite has expired.');

  const existingUser = await User.findOne({ email: invite.email });

  res.json({
    email: invite.email,
    orgName: invite.orgId.name,
    requiresPassword: !existingUser || !existingUser.hashedPassword,
  });
});

const acceptInvite = asyncHandler(async (req, res) => {
  const invite = await Invite.findOne({ token: req.params.token });
  if (!invite) throw new ApiError(404, 'Invite not found.');
  if (invite.status !== 'pending') throw new ApiError(410, 'This invite has already been used.');
  if (invite.expiresAt < new Date()) throw new ApiError(410, 'This invite has expired.');

  let user = await User.findOne({ email: invite.email });

  if (!user || !user.hashedPassword) {
    const { name, password } = req.body;
    if (!password) throw new ApiError(400, 'password is required to set up your account.');
    const hashedPassword = await bcrypt.hash(password, 10);

    if (user) {
      user.hashedPassword = hashedPassword;
      user.name = name || user.name;
      await user.save();
    } else {
      user = await User.create({ email: invite.email, hashedPassword, name: name || '' });
    }
  }

  const existingMembership = await OrgMembership.findOne({ userId: user._id, orgId: invite.orgId });
  if (!existingMembership) {
    await OrgMembership.create({ userId: user._id, orgId: invite.orgId, role: 'member' });
  }

  invite.status = 'accepted';
  await invite.save();

  await User.findByIdAndUpdate(user._id, { lastActiveOrgId: invite.orgId });

  const token = signToken({ userId: user._id, orgId: invite.orgId });
  Sentry.logger.info('Org invite accepted', { orgId: String(invite.orgId), userId: String(user._id) });
  res.json({ token, activeOrg: { orgId: invite.orgId, role: 'member' } });
});

module.exports = { createOrg, listMembers, inviteMember, listPendingInvites, getInvite, acceptInvite };
