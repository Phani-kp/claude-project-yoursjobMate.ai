import nodemailer from 'nodemailer';

/**
 * Email delivery, in order of preference:
 * - BREVO_API_KEY set: Brevo's HTTP API (free tier, no personal mailbox needed; the MAIL_FROM sender must be verified in Brevo).
 * - SMTP_HOST set: any SMTP server via nodemailer.
 * - Neither: emails are printed to the console and kept in `outbox` (development and tests only).
 */
const NODE_ENV = process.env.NODE_ENV;
const IS_PRODUCTION = NODE_ENV === 'production';
const { SMTP_USER, SMTP_PASS } = process.env;
const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = process.env.SMTP_PORT?.trim();
const BREVO_API_KEY = process.env.BREVO_API_KEY?.trim();
const BREVO_URL = process.env.BREVO_API_URL?.trim().replace(/\/+$/, '') || 'https://api.brevo.com/v3';
const PORT = SMTP_PORT ? Number(SMTP_PORT) : 465;
export const APP_NAME = process.env.APP_NAME || 'YoursJobMate';
const FROM = process.env.MAIL_FROM?.trim() || (SMTP_USER?.includes('@') ? `${APP_NAME} <${SMTP_USER}>` : `${APP_NAME} <no-reply@yoursjobmate.local>`);

/** Splits `Name <email@x.com>` (or a bare address) into Brevo's { name, email } sender shape. */
export function parseAddress(value) {
  const address = String(value || '').trim();
  if (/[\u0000-\u001f\u007f]/.test(address)) return null;
  const match = address.match(/^("(?:\\.|[^"\\])*"|[^<>"\\]*)\s*<([^<>]+)>$/);
  const email = (match ? match[2] : address).trim();
  const [local, domain, extra] = email.split('@');
  if (extra !== undefined || !local || local.length > 64 || email.length > 254
    || !/^[a-z\d!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z\d!#$%&'*+/=?^_`{|}~-]+)*$/i.test(local)
    || !domain || domain.length > 253 || !domain.includes('.')
    || !domain.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null;
  let name = match?.[1].trim() || APP_NAME;
  if (name.startsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
  else if (/[(),;:@]/.test(name)) return null;
  return { name: name || APP_NAME, email };
}

export const mailMode = BREVO_API_KEY ? 'brevo' : SMTP_HOST ? 'smtp' : 'console';

if (IS_PRODUCTION && mailMode === 'console') {
  throw new Error('Set BREVO_API_KEY (or SMTP_HOST) in production so verification emails can be delivered');
}
if (mailMode === 'brevo' && !parseAddress(process.env.MAIL_FROM)) {
  throw new Error('BREVO_API_KEY is set, so MAIL_FROM must be set too, e.g. MAIL_FROM="YoursJobMate <you@example.com>", using a sender verified in Brevo');
}
if (IS_PRODUCTION && mailMode === 'smtp' && !parseAddress(process.env.MAIL_FROM)) {
  throw new Error('MAIL_FROM must be set to a valid sender address when using SMTP in production');
}
if (mailMode === 'smtp' && (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535 || (SMTP_PORT && !/^\d+$/.test(SMTP_PORT)))) {
  throw new Error('SMTP_PORT must be an integer between 1 and 65535');
}
if (IS_PRODUCTION && mailMode === 'brevo' && BREVO_URL !== 'https://api.brevo.com/v3') {
  throw new Error('BREVO_API_URL must use the official https://api.brevo.com/v3 endpoint in production');
}
const BREVO_SENDER = mailMode === 'brevo' ? parseAddress(process.env.MAIL_FROM) : null;

const providerSecrets = [BREVO_API_KEY, SMTP_USER, SMTP_PASS, process.env.JWT_SECRET, process.env.PASSWORD_PEPPER, process.env.DATABASE_URL,
  SMTP_PASS && Buffer.from(SMTP_PASS).toString('base64'),
  SMTP_PASS && SMTP_USER && Buffer.from(`\0${SMTP_USER}\0${SMTP_PASS}`).toString('base64'),
  SMTP_PASS && SMTP_USER && Buffer.from(`${SMTP_USER}:${SMTP_PASS}`).toString('base64'),
].filter(Boolean);
const loggedErrors = new WeakSet();

function safeMailMessage(err, mail = {}) {
  let message = String(err?.message || err || 'Mail request failed');
  const privateContent = IS_PRODUCTION
    ? [mail.subject, mail.text, mail.html, ...String(mail.text || '').split(/\r?\n/), ...String(mail.html || '').split(/<[^>]*>/),
      ...[mail.subject, mail.text, mail.html].flatMap((value) => String(value || '').match(/\d{6}/g) || [])]
    : [];
  const values = [...providerSecrets, ...privateContent].filter((value) => typeof value === 'string' && value.trim());
  const variants = values.flatMap((value) => [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value), Buffer.from(value).toString('base64')]);
  for (const value of [...new Set(variants)].sort((a, b) => b.length - a.length)) {
    message = message.split(value).join('[redacted]');
  }
  if (IS_PRODUCTION) message = message.replace(/\d{6,}/g, '[redacted]');
  return message.replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').slice(0, 1200);
}

/** Reuse at mail call sites: provider errors are redacted and each Error is logged once. */
export function logMailError(context, err) {
  if (err && typeof err === 'object') {
    if (loggedErrors.has(err)) return;
    loggedErrors.add(err);
  }
  const message = safeMailMessage(err);
  let guidance = '';
  if (mailMode === 'brevo') {
    if (/unrecogni[sz]ed\s+(?:outbound\s+)?ip|ip\s+(?:address\s+)?(?:is\s+)?(?:not\s+authori[sz]ed|unauthori[sz]ed)/i.test(message)) {
      guidance = ' Authorize this server\'s outbound IP in Brevo: https://app.brevo.com/security/authorised_ips';
    } else if (/access denied for resource|not authori[sz]ed for resource|required permission|does not include.*permission/i.test(message)) {
      guidance = ' Give this API key All access to Transactional email in Brevo API key permissions.';
    } else if (/sender.*(?:not.*verified|unverified|inactive)|unverified.*sender/i.test(message)) {
      guidance = ' Set MAIL_FROM to an active sender verified in your Brevo account.';
    }
  }
  console.error(`[mail] ${context}: ${message}${guidance}`);
}

const transport = mailMode === 'smtp'
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

export const mailEnabled = () => mailMode !== 'console';

/** Calls the Brevo API; throws an Error carrying Brevo's own error message when the request fails. */
async function brevo(method, path, body) {
  let res;
  let responseText;
  try {
    res = await fetch(BREVO_URL + path, {
      method,
      headers: { 'api-key': BREVO_API_KEY, accept: 'application/json', ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    responseText = await res.text();
  } catch (err) {
    throw new Error(`Brevo request failed: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(responseText) ?? {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const code = typeof data.code === 'string' && data.code ? ` (${data.code})` : '';
    const message = typeof data.message === 'string' && data.message.trim()
      ? data.message : responseText.trim() || res.statusText || 'Request failed';
    throw Object.assign(new Error(`Brevo API error ${res.status}${code}: ${message}`), {
      status: res.status,
      ...(typeof data.code === 'string' && /^[a-z_]{1,64}$/i.test(data.code) ? { code: data.code } : {}),
    });
  }
  return data;
}

/** Checks the mail configuration at startup so a bad key or login shows up in the logs immediately. */
export async function verifyMailer() {
  if (mailMode === 'console') return console.log('[mail] Mode: console. No email service configured, so emails are printed to this console (development only)');
  if (mailMode === 'brevo') {
    console.log(`[mail] Mode: Brevo API. Sending as ${BREVO_SENDER.name} <${BREVO_SENDER.email}>`);
    try {
      await brevo('GET', '/smtp/statistics/aggregatedReport?days=1');
      console.log(`[mail] Mode: Brevo API ready (transactional API access checked; sender and delivery still need verification) sending as ${BREVO_SENDER.name} <${BREVO_SENDER.email}>`);
    } catch (err) {
      logMailError('Mode: Brevo API, but the transactional API check failed', err);
    }
    return;
  }
  console.log(`[mail] Mode: SMTP (${SMTP_HOST}:${PORT}). Sending as ${FROM}`);
  try {
    await transport.verify();
    console.log(`[mail] Mode: SMTP ready (${SMTP_HOST}:${PORT}) sending as ${FROM}`);
  } catch (err) {
    logMailError(`Mode: SMTP, but the check failed for ${SMTP_HOST}:${PORT}`, err);
  }
}

// Without an email service, mail is printed to the console and kept here (used by tests).
export const outbox = [];

export async function sendMail({ to, subject, text, html }) {
  if (mailMode === 'console') {
    outbox.push({ to, subject, text });
    if (outbox.length > 50) outbox.shift();
    if (NODE_ENV !== 'test') console.log(`\n[mail] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  try {
    if (mailMode === 'brevo') {
      await brevo('POST', '/smtp/email', { sender: BREVO_SENDER, to: [{ email: to }], subject, textContent: text, htmlContent: html });
    } else {
      await transport.sendMail({ from: FROM, to, subject, text, html });
    }
  } catch (err) {
    const error = IS_PRODUCTION ? Object.assign(new Error(safeMailMessage(err, { subject, text, html })), {
      ...(Number.isInteger(err.status) ? { status: err.status } : {}),
      ...(typeof err.code === 'string' && /^[a-z_]{1,64}$/i.test(err.code) ? { code: err.code } : {}),
    }) : err;
    logMailError(`${mailMode === 'brevo' ? 'Brevo API' : 'SMTP'} send failed`, error);
    throw error;
  }
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
