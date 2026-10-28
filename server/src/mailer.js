import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
const PORT = Number(SMTP_PORT) || 465;
export const APP_NAME = process.env.APP_NAME || 'YoursJobMate';
const FROM = process.env.MAIL_FROM || (SMTP_USER?.includes('@') ? `${APP_NAME} <${SMTP_USER}>` : `${APP_NAME} <no-reply@yoursjobmate.local>`);

if (process.env.NODE_ENV === 'production' && !SMTP_HOST) throw new Error('SMTP_HOST must be set in production so verification emails can be delivered');

const transport = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: PORT,
      secure: PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      pool: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

export const mailEnabled = () => !!transport;

/** Checks the SMTP login at startup so a bad configuration shows up in the logs immediately. */
export async function verifyMailer() {
  if (!transport) return console.log('[mail] SMTP not configured: emails are printed to this console (development only)');
  try {
    await transport.verify();
    console.log(`[mail] SMTP ready (${SMTP_HOST}:${PORT}) sending as ${FROM}`);
  } catch (err) {
    console.error(`[mail] SMTP check failed for ${SMTP_HOST}:${PORT}: ${err.message}`);
  }
}

// Without SMTP settings, mail is printed to the console and kept here (used by tests).
export const outbox = [];

export async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    outbox.push({ to, subject, text });
    if (outbox.length > 50) outbox.shift();
    if (process.env.NODE_ENV !== 'test') console.log(`\n[mail] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: FROM, to, subject, text, html });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const layout = (body) => `<!doctype html><html><body style="margin:0;background:#f4f5fb;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px" cellspacing="0" cellpadding="0"><tr><td>
<div style="font-weight:700;font-size:18px;margin-bottom:24px"><span style="display:inline-block;background:#4f46e5;color:#fff;border-radius:8px;width:28px;height:28px;line-height:28px;text-align:center;margin-right:8px">J</span>${escapeHtml(APP_NAME)}</div>
${body}
</td></tr></table>
<p style="color:#9ca3af;font-size:12px;margin-top:16px">${escapeHtml(APP_NAME)}: your AI job-search co-pilot</p>
</td></tr></table></body></html>`;

const codeBlock = (code) => `<div style="font-size:34px;font-weight:700;letter-spacing:10px;background:#f4f5fb;border-radius:8px;padding:16px;text-align:center;margin:20px 0">${code}</div>`;
const footnote = (s) => `<p style="color:#6b7280;font-size:13px;margin-top:24px">${s}</p>`;

export function sendVerificationEmail(to, name, code, minutes) {
  return sendMail({
    to,
    subject: `${code} is your ${APP_NAME} verification code`,
    text: `Hi ${name},\n\nWelcome to ${APP_NAME}! Your verification code is ${code}.\nIt expires in ${minutes} minutes.\n\nIf you didn't create an account, you can ignore this email.`,
    html: layout(`<p>Hi ${escapeHtml(name)},</p><p>Welcome to ${escapeHtml(APP_NAME)}! Enter this code to verify your email:</p>${codeBlock(code)}<p>It expires in ${minutes} minutes.</p>${footnote("If you didn't create an account, you can ignore this email.")}`),
  });
}

export function sendPasswordResetEmail(to, name, code, minutes) {
  return sendMail({
    to,
    subject: `${code} is your ${APP_NAME} password reset code`,
    text: `Hi ${name},\n\nUse this code to reset your ${APP_NAME} password: ${code}\nIt expires in ${minutes} minutes.\n\nIf you didn't ask to reset your password, you can ignore this email. Your password won't change.`,
    html: layout(`<p>Hi ${escapeHtml(name)},</p><p>Use this code to reset your password:</p>${codeBlock(code)}<p>It expires in ${minutes} minutes.</p>${footnote("If you didn't ask to reset your password, you can ignore this email. Your password won't change.")}`),
  });
}

export function sendPasswordChangedEmail(to, name) {
  return sendMail({
    to,
    subject: `Your ${APP_NAME} password was changed`,
    text: `Hi ${name},\n\nYour ${APP_NAME} password was just changed and all other sessions were signed out.\n\nIf this wasn't you, reset your password right away using "Forgot password" on the login page.`,
    html: layout(`<p>Hi ${escapeHtml(name)},</p><p>Your password was just changed and all other sessions were signed out.</p>${footnote('If this wasn\'t you, reset your password right away using "Forgot password" on the login page.')}`),
  });
}
