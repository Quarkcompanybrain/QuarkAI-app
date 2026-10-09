// Preview or manually send one org's daily brief.
//
//   node scripts/dailyReport.js --org <orgId>                  # writes the HTML preview, sends nothing
//   node scripts/dailyReport.js --org <orgId> --hours 72       # wider window, useful on quiet test data
//   node scripts/dailyReport.js --org <orgId> --send           # emails the org's admins now
//   node scripts/dailyReport.js --org <orgId> --to you@x.com   # emails one address instead of the admins
//
// Manual runs don't create a DailyReport record, so they never block or
// replace the scheduled send.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { connectDb } = require('../src/config/db');
const { buildDailyReport, orgAdminEmails } = require('../src/services/reports/dailyReport.service');
const { sendMail } = require('../src/services/email/mailer');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

async function main() {
  const orgId = arg('org');
  if (!orgId || orgId === true) throw new Error('Usage: node scripts/dailyReport.js --org <orgId> [--hours 24] [--send | --to email] [--out file.html]');
  const hours = Number(arg('hours')) || 24;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - hours * 60 * 60 * 1000);

  await connectDb();
  const { org, stats, email } = await buildDailyReport({ orgId, windowStart, windowEnd });
  console.log(`[report] ${org.name}: ${JSON.stringify(stats)}`);
  if (!email) {
    console.log('[report] No project activity in this window; nothing to send.');
    return;
  }

  const out = path.resolve(typeof arg('out') === 'string' ? arg('out') : `daily-report-${orgId}.html`);
  fs.writeFileSync(out, `<!doctype html><meta charset="utf-8">${email.html}`);
  console.log(`[report] Preview written to ${out}`);

  const to = typeof arg('to') === 'string' ? [arg('to')] : arg('send') ? await orgAdminEmails(orgId) : null;
  if (!to) return;
  if (!to.length) throw new Error('This org has no admins with an email address.');
  await sendMail({ to, subject: email.subject, html: email.html });
  console.log(`[report] Sent to ${to.join(', ')}`);
}

main()
  .catch((err) => {
    console.error('[report] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
