const FONT_STACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/**
 * Shared shell for every transactional email: wordmark header, a bordered
 * card for the actual message, muted footer. Inline styles only — email
 * clients don't run our stylesheet, and most strip <style> blocks anyway.
 */
function emailLayout({ preheader = '', bodyHtml }) {
  return `
    <div style="font-family:${FONT_STACK};background:#FAFAFA;padding:40px 16px;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">
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

module.exports = { otpEmail, inviteEmail };
