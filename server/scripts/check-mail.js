import { pathToFileURL } from 'node:url';

/** Check transactional API access and sandbox request acceptance without sending an email. */
export async function checkBrevoConfiguration({ apiKey, sender, fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('BREVO_API_KEY must be set for this diagnostic');
  if (!sender || typeof sender.email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender.email)
    || /[\u0000-\u001f\u007f]/.test(sender.name || '')) throw new Error('MAIL_FROM must be a valid sender address');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  async function request(path, body) {
    let response;
    let raw;
    try {
      response = await fetchImpl(`https://api.brevo.com/v3${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'api-key': apiKey.trim(), accept: 'application/json', ...(body && { 'content-type': 'application/json' }) },
        ...(body && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
      raw = await response.text();
    } catch (error) {
      throw new Error(`Brevo diagnostic request failed: ${error.message}`);
    }
    if (!response.ok) {
      let data;
      try { data = JSON.parse(raw) ?? {}; } catch { data = {}; }
      const code = typeof data.code === 'string' && /^[a-z_]{1,64}$/i.test(data.code) ? data.code : undefined;
      const message = typeof data.message === 'string' && data.message.trim() ? data.message : raw.trim() || response.statusText || 'Request failed';
      throw Object.assign(new Error(`Brevo API error ${response.status}${code ? ` (${code})` : ''}: ${message}`), { status: response.status, ...(code && { code }) });
    }
  }

  await request('/smtp/statistics/aggregatedReport?days=1');
  await request('/smtp/email', {
    sender,
    to: [{ email: 'diagnostic@example.invalid' }],
    subject: 'YoursJobMate mail configuration diagnostic',
    textContent: 'Sandbox diagnostic only. This message must not be delivered.',
    headers: { 'X-Sib-Sandbox': 'drop' },
  });
  return { transactionalReadAccepted: true, sandboxRequestAccepted: true, noEmailSent: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let logMailError;
  try {
    const mailer = await import('../src/mailer.js');
    logMailError = mailer.logMailError;
    if (mailer.mailMode !== 'brevo') throw new Error('Set BREVO_API_KEY to use this Brevo diagnostic');
    await checkBrevoConfiguration({ apiKey: process.env.BREVO_API_KEY, sender: mailer.parseAddress(process.env.MAIL_FROM) });
    console.log('[mail:check] Transactional API access accepted; sandbox request accepted. No email was sent.');
    console.log('[mail:check] Sandbox validates request format only. Sender authorization, account activation and inbox delivery still need verification.');
  } catch (error) {
    if (logMailError) logMailError('Configuration diagnostic failed', error);
    else console.error('[mail:check] Could not load mail configuration. Check BREVO_API_KEY and MAIL_FROM.');
    process.exitCode = 1;
  }
}
