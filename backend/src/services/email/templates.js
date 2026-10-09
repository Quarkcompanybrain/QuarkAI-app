const FONT_STACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/**
 * Shared shell for every transactional email: wordmark header, a bordered
 * card for the actual message, muted footer. Inline styles only — email
 * clients don't run our stylesheet, and most strip <style> blocks anyway.
 */
function emailLayout({ preheader = '', bodyHtml, maxWidth = 480 }) {
  return `
    <div style="font-family:${FONT_STACK};background:#FAFAFA;padding:40px 16px;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${maxWidth}px;margin:0 auto;">
        <tr>
          <td style="padding-bottom:28px;text-align:center;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr>
                <td style="width:28px;height:28px;background:#0A0A0A;border-radius:8px;text-align:center;vertical-align:middle;">
                  <div style="width:8px;height:8px;background:#FF1BCD;border-radius:50%;margin:10px auto;"></div>
                </td>
                <td style="padding-left:8px;font-size:16px;font-weight:700;color:#0A0A0A;letter-spacing:-0.2px;">Quark AI</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#FFFFFF;border:1px solid #EBEBEB;border-radius:16px;padding:36px 32px;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding-top:24px;text-align:center;font-size:12px;color:#A3A3A3;">
            Sent by Quark AI &mdash; your company brain.
          </td>
        </tr>
      </table>
    </div>
  `;
}

const OTP_COPY = {
  signup: { heading: 'Verify your email', body: "Enter this code to finish creating your account." },
  reset: { heading: 'Reset your password', body: 'Enter this code to choose a new password.' },
};

function otpEmail(code, purpose = 'signup') {
  const copy = OTP_COPY[purpose] || OTP_COPY.signup;

  return {
    subject: `${code} is your Quark AI code`,
    html: emailLayout({
      preheader: `Your code is ${code}`,
      bodyHtml: `
        <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0A0A0A;letter-spacing:-0.3px;">${copy.heading}</h1>
        <p style="margin:0 0 28px;font-size:14px;line-height:20px;color:#737373;">${copy.body}</p>
        <div style="background:#FAFAFA;border:1px solid #EBEBEB;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
          <span style="font-size:34px;font-weight:700;letter-spacing:10px;color:#FF1BCD;font-family:'Courier New',monospace;">${code}</span>
        </div>
        <p style="margin:0;font-size:13px;line-height:19px;color:#A3A3A3;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      `,
    }),
  };
}

function inviteEmail({ orgName, inviterName, acceptUrl }) {
  return {
    subject: `${inviterName} invited you to join ${orgName} on Quark AI`,
    html: emailLayout({
      preheader: `${inviterName} invited you to join ${orgName}`,
      bodyHtml: `
        <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0A0A0A;letter-spacing:-0.3px;">You're invited to ${orgName}</h1>
        <p style="margin:0 0 28px;font-size:14px;line-height:20px;color:#737373;">${inviterName} invited you to join their team's company brain on Quark AI.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
          <tr>
            <td style="background:#FF1BCD;border-radius:10px;">
              <a href="${acceptUrl}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">Accept invite</a>
            </td>
          </tr>
        </table>
        <p style="margin:0;font-size:13px;line-height:19px;color:#A3A3A3;">This link expires in 7 days. If you weren't expecting this invite, you can ignore this email.</p>
      `,
    }),
  };
}

// Report content is model-written from chat messages and files, so every
// dynamic value is escaped before it reaches the HTML.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function reportList(title, items, color = '#0A0A0A') {
  if (!items?.length) return '';
  return `
    <p style="margin:16px 0 6px;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:${color};">${escapeHtml(title)}</p>
    <ul style="margin:0;padding-left:18px;font-size:14px;line-height:21px;color:#404040;">
      ${items.map((item) => `<li style="margin-bottom:4px;">${escapeHtml(item)}</li>`).join('')}
    </ul>`;
}

function reportStat(value, label) {
  return `
    <td style="padding:12px 8px;text-align:center;background:#FAFAFA;border:1px solid #EBEBEB;border-radius:12px;">
      <div style="font-size:22px;font-weight:700;color:#0A0A0A;">${escapeHtml(value)}</div>
      <div style="font-size:11px;color:#737373;margin-top:2px;">${escapeHtml(label)}</div>
    </td>`;
}

function projectMetricsLine(metrics) {
  const parts = [];
  if (metrics.newMemories) parts.push(`${metrics.newMemories} new ${metrics.newMemories === 1 ? 'memory' : 'memories'}`);
  if (metrics.updatedMemories) parts.push(`${metrics.updatedMemories} updated`);
  if (metrics.whatsappMessages) parts.push(plural(metrics.whatsappMessages, 'WhatsApp message'));
  if (metrics.emails) parts.push(plural(metrics.emails, 'email'));
  if (metrics.files) parts.push(plural(metrics.files, 'file'));
  if (metrics.failedFiles) parts.push(`${metrics.failedFiles} failed to process`);
  if (metrics.chatQuestions) parts.push(plural(metrics.chatQuestions, 'chat question'));
  return parts.join(' · ');
}

function dailyReportEmail({ orgName, reportDateLabel, appUrl, stats, executive, projects, quietProjects }) {
  const attention = executive.attentionItems.length
    ? `
      <div style="margin-top:20px;background:#FFF5FC;border:1px solid #FFD1F3;border-radius:12px;padding:16px 18px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#C2109A;">Needs attention</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:21px;color:#404040;">
          ${executive.attentionItems.map((entry) => `<li style="margin-bottom:4px;"><strong style="color:#0A0A0A;">${escapeHtml(entry.project)}:</strong> ${escapeHtml(entry.item)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const projectCards = projects
    .map((project) => `
      <div style="margin-top:20px;border:1px solid #EBEBEB;border-radius:12px;padding:18px 20px;">
        <a href="${escapeHtml(`${appUrl}/projects/${project.id}/memory`)}" style="font-size:16px;font-weight:700;color:#0A0A0A;text-decoration:none;">${escapeHtml(project.name)}</a>
        <p style="margin:4px 0 0;font-size:12px;color:#A3A3A3;">${escapeHtml(projectMetricsLine(project.metrics))}</p>
        <p style="margin:12px 0 0;font-size:14px;line-height:21px;color:#404040;">${escapeHtml(project.summary)}</p>
        ${reportList('Highlights', project.highlights)}
        ${reportList('Decisions', project.decisions)}
        ${reportList('Risks & blockers', project.risks, '#C2109A')}
        ${reportList('Next steps', project.nextSteps)}
      </div>`)
    .join('');

  const quiet = quietProjects.length
    ? `<p style="margin:20px 0 0;font-size:13px;line-height:19px;color:#A3A3A3;">No activity: ${quietProjects.map(escapeHtml).join(', ')}</p>`
    : '';

  return {
    subject: `${orgName} daily brief — ${reportDateLabel}`,
    html: emailLayout({
      maxWidth: 640,
      preheader: escapeHtml(executive.summary.slice(0, 140)),
      bodyHtml: `
        <p style="margin:0 0 4px;font-size:12px;color:#A3A3A3;">${escapeHtml(reportDateLabel)}</p>
        <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0A0A0A;letter-spacing:-0.3px;">${escapeHtml(orgName)} daily brief</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 -6px;">
          <tr>
            ${reportStat(stats.activeProjectCount, 'active projects')}
            ${reportStat(stats.newMemoryCount + stats.updatedMemoryCount, 'memories captured')}
            ${reportStat(stats.whatsappMessageCount + stats.emailCount, 'messages')}
            ${reportStat(stats.fileCount, 'files')}
          </tr>
        </table>
        <p style="margin:20px 0 6px;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#0A0A0A;">Executive summary</p>
        <p style="margin:0;font-size:15px;line-height:23px;color:#262626;">${escapeHtml(executive.summary)}</p>
        ${attention}
        ${projectCards}
        ${quiet}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;">
          <tr>
            <td style="background:#FF1BCD;border-radius:10px;">
              <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">Open Quark AI</a>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#A3A3A3;">You're receiving this because you're an admin of ${escapeHtml(orgName)}. Summaries are AI-generated from your projects' knowledge base and may contain mistakes.</p>
      `,
    }),
  };
}

module.exports = { otpEmail, inviteEmail, dailyReportEmail };
