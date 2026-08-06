const nodemailer = require('nodemailer');
const env = require('../../config/env');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: env.gmailUser, pass: env.gmailAppPassword },
});

async function sendMail({ to, subject, html }) {
  return transporter.sendMail({
    from: `Quark AI <${env.gmailUser}>`,
    to,
    subject,
    html,
  });
}

module.exports = { sendMail };
