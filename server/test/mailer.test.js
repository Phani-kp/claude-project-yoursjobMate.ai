import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

// Each import re-reads only this test's mail settings. Never use local credentials or real network calls.
const defaults = {
  NODE_ENV: 'test',
  APP_NAME: 'YoursJobMate',
  BREVO_API_KEY: '  test-brevo-key  ',
  BREVO_API_URL: undefined,
  MAIL_FROM: 'YoursJobMate <sender@example.com>',
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
};
let fresh = 0;
async function importWithEnv(overrides = {}) {
  const env = { ...defaults, ...overrides };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  function apply(values) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  apply(env);
  try {
    return await import(`../src/mailer.js?test=${++fresh}`);
  } finally {
    apply(saved);
  }
}

const mailer = await importWithEnv();
let calls;
let reply;
beforeEach((t) => {
  calls = [];
  reply = () => new Response(JSON.stringify({ messageId: '<abc@brevo>' }), { status: 201 });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return reply(url, init);
  });
});

test('Brevo mode is chosen when BREVO_API_KEY is set', () => {
  assert.equal(mailer.mailMode, 'brevo');
  assert.equal(mailer.mailEnabled(), true);
});

for (const { name, send, code, subject } of [
  { name: 'sign-up verification', send: mailer.sendVerificationEmail, code: '654321', subject: 'verification code' },
  { name: 'password reset', send: mailer.sendPasswordResetEmail, code: '123456', subject: 'password reset code' },
]) {
  test(`sends a ${name} code through the Brevo API`, async () => {
    await send('user@gmail.com', 'Sam & Jo', code, 10);
    assert.equal(calls.length, 1);
    const [{ url, init, body }] = calls;
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['api-key'], 'test-brevo-key', 'key is trimmed');
    assert.equal(init.headers['content-type'], 'application/json');
    assert.equal(init.headers.accept, 'application/json');
    assert.equal(Object.keys(init.headers).some((key) => key.toLowerCase() === 'x-sib-sandbox'), false, 'normal email delivery must not use sandbox/drop mode');
    assert.ok(init.signal instanceof AbortSignal, 'provider request has a timeout');
    assert.equal(init.redirect, 'error', 'credentials cannot be forwarded through a redirect');
    assert.deepEqual(body.sender, { name: 'YoursJobMate', email: 'sender@example.com' });
    assert.deepEqual(body.to, [{ email: 'user@gmail.com' }]);
    assert.equal(body.subject, `${code} is your YoursJobMate ${subject}`);
    assert.match(body.textContent, new RegExp(code));
    assert.match(body.htmlContent, new RegExp(code));
    assert.match(body.textContent, /10 minutes/);
    assert.match(body.htmlContent, /Sam &amp; Jo/);
    assert.equal(mailer.outbox.length, 0, 'codes are not exposed through the console fallback');
  });
}

test("a failed send logs and throws Brevo's own error message", async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  reply = () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 });
  await assert.rejects(mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }), /Brevo API error 401 \(unauthorized\): Key not found/);
  assert.ok(log.mock.calls.some(({ arguments: args }) => /Brevo.*send failed:.*Key not found/.test(args.join(' '))));
  assert.equal(mailer.outbox.length, 0, 'provider failures must not fall back to printing codes');
});

test('a non-JSON error retains the provider response', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  reply = () => new Response('Upstream service unavailable', { status: 503, statusText: 'Service Unavailable' });
  await assert.rejects(mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' }), /Brevo API error 503.*Upstream service unavailable/);
  assert.match(log.mock.calls.at(-1).arguments.join(' '), /Upstream service unavailable/);
});

test('an empty provider error falls back to its HTTP status text', async (t) => {
  t.mock.method(console, 'error', () => {});
  reply = () => new Response('', { status: 502, statusText: 'Bad Gateway' });
  await assert.rejects(mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' }), /Brevo API error 502.*Bad Gateway/);
});

test('a network failure is logged and reported as a Brevo request failure', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  reply = () => { throw new TypeError('fetch failed'); };
  await assert.rejects(mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }), /Brevo request failed: fetch failed/);
  assert.match(log.mock.calls.at(-1).arguments.join(' '), /Brevo.*send failed:.*fetch failed/);
});

test('verifyMailer checks transactional access without requiring account-read permission or sending an email', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  reply = (url) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=1');
    return new Response(JSON.stringify({ requests: 0, delivered: 0 }), { status: 200 });
  };
  await mailer.verifyMailer();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=1');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['api-key'], 'test-brevo-key');
  assert.equal(calls[0].body, undefined);
  assert.ok(log.mock.calls.some(({ arguments: args }) => /Mode: Brevo API ready.*sender@example\.com/.test(args.join(' '))));
  assert.match(log.mock.calls.at(-1).arguments.join(' '), /transactional API access checked; sender and delivery still need verification/);
});

test('verifyMailer logs a rejected Brevo key without exposing the key', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  reply = () => new Response(JSON.stringify({ message: 'Key not found' }), { status: 401 });
  await mailer.verifyMailer();
  const message = log.mock.calls.at(-1).arguments.join(' ');
  assert.match(message, /Mode: Brevo API.*transactional API check failed: Brevo API error 401: Key not found/);
  assert.doesNotMatch(message, /test-brevo-key/);
});

test('a blocked server IP is diagnosed without mislabeling it as an invalid API key', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  reply = () => new Response(JSON.stringify({ code: 'unauthorized', message: 'We have detected you are using an unrecognised IP address 203.0.113.1' }), { status: 401 });
  await mailer.verifyMailer();
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=1');
  const message = log.mock.calls[0].arguments.join(' ');
  assert.match(message, /Brevo API error 401 \(unauthorized\).*unrecognised IP address/);
  assert.match(message, /Authorize this server's outbound IP in Brevo: https:\/\/app\.brevo\.com\/security\/authorised_ips/);
  assert.doesNotMatch(message, /invalid.*key|key.*invalid|test-brevo-key/i);
});

test('permission failures explain the transactional API scope required by the application', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  for (const providerMessage of [
    'Access denied for resource "smtp". The API key does not include the required permission.',
    'api key is not authorized for resource "smtp"',
  ]) {
    reply = () => new Response(JSON.stringify({ code: 'permission_denied', message: providerMessage }), { status: 403 });
    await mailer.verifyMailer();
    const message = log.mock.calls.at(-1).arguments.join(' ');
    assert.ok(message.includes(providerMessage));
    assert.match(message, /All access to Transactional email/);
  }
});

test('an unverified sender failure points the operator to MAIL_FROM', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  reply = () => new Response(JSON.stringify({ code: 'invalid_parameter', message: 'The sender email address you have entered is not verified.' }), { status: 400 });
  await assert.rejects(mailer.sendMail({ to: 'a@b.com', subject: 's', text: 't' }), (err) => err.status === 400 && err.code === 'invalid_parameter');
  assert.match(log.mock.calls[0].arguments.join(' '), /Set MAIL_FROM to an active sender verified/);
});

test('parseAddress handles "Name <email>" and bare addresses', () => {
  assert.deepEqual(mailer.parseAddress('Jobs Team <jobs@example.com>'), { name: 'Jobs Team', email: 'jobs@example.com' });
  assert.deepEqual(mailer.parseAddress('"Jobs Team" <jobs@example.com>'), { name: 'Jobs Team', email: 'jobs@example.com' });
  assert.deepEqual(mailer.parseAddress('jobs@example.com'), { name: 'YoursJobMate', email: 'jobs@example.com' });
  assert.equal(mailer.parseAddress('not an address'), null);
  assert.equal(mailer.parseAddress(''), null);
  assert.deepEqual(mailer.parseAddress('"Jobs, Team" <jobs@example.com>'), { name: 'Jobs, Team', email: 'jobs@example.com' });
  for (const address of ['a@b@c.com', 'a..b@example.com', '.a@example.com', 'a@-example.com', 'a@example..com', 'a@example.com, b@example.com', 'Name\r\nBcc: a@example.com <jobs@example.com>']) {
    assert.equal(mailer.parseAddress(address), null, address);
  }
});

test('a bare MAIL_FROM address is used as the Brevo sender', async () => {
  const bare = await importWithEnv({ MAIL_FROM: 'jobs@example.com' });
  await bare.sendMail({ to: 'user@gmail.com', subject: 'Hello', text: 'Message' });
  assert.deepEqual(calls[0].body.sender, { name: 'YoursJobMate', email: 'jobs@example.com' });
});

test('Brevo without a valid MAIL_FROM refuses to start', async () => {
  for (const MAIL_FROM of [undefined, '', 'not an address']) {
    await assert.rejects(importWithEnv({ MAIL_FROM }), /MAIL_FROM must be set/);
  }
});

test('Brevo wins over SMTP when both are set', async (t) => {
  const createTransport = t.mock.method(nodemailer, 'createTransport', () => { throw new Error('SMTP should not be initialized'); });
  const both = await importWithEnv({ SMTP_HOST: 'smtp.example.com' });
  assert.equal(both.mailMode, 'brevo');
  assert.equal(createTransport.mock.callCount(), 0);
  await both.sendMail({ to: 'user@gmail.com', subject: 'Hello', text: 'Message' });
  assert.equal(calls.length, 1);
});

test('SMTP remains available when the Brevo key is blank', async (t) => {
  const sent = [];
  let verified = false;
  t.mock.method(nodemailer, 'createTransport', (options) => {
    assert.equal(options.host, 'smtp.example.com');
    assert.equal(options.port, 587);
    assert.equal(options.secure, false);
    assert.deepEqual(options.auth, { user: 'smtp-user', pass: 'smtp-test-key' });
    return {
      verify: async () => { verified = true; },
      sendMail: async (message) => { sent.push(message); },
    };
  });
  const log = t.mock.method(console, 'log', () => {});
  const smtp = await importWithEnv({ BREVO_API_KEY: '  ', SMTP_HOST: '  smtp.example.com  ', SMTP_PORT: '587', SMTP_USER: 'smtp-user', SMTP_PASS: 'smtp-test-key' });
  assert.equal(smtp.mailMode, 'smtp');
  assert.equal(smtp.mailEnabled(), true);
  await smtp.verifyMailer();
  assert.equal(verified, true);
  assert.match(log.mock.calls.at(-1).arguments.join(' '), /Mode: SMTP ready.*smtp\.example\.com:587/);
  await smtp.sendMail({ to: 'user@gmail.com', subject: 'Hello', text: 'Message', html: '<p>Message</p>' });
  assert.deepEqual(sent, [{ from: defaults.MAIL_FROM, to: 'user@gmail.com', subject: 'Hello', text: 'Message', html: '<p>Message</p>' }]);
  assert.equal(calls.length, 0, 'SMTP must not call the Brevo API');
});

test('console mode remains available when neither provider is configured', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const none = await importWithEnv({ BREVO_API_KEY: undefined, SMTP_HOST: undefined });
  assert.equal(none.mailMode, 'console');
  assert.equal(none.mailEnabled(), false);
  await none.verifyMailer();
  assert.match(log.mock.calls.at(-1).arguments.join(' '), /Mode: console/);
  await none.sendVerificationEmail('user@gmail.com', 'Sam', '654321', 10);
  assert.equal(none.outbox.length, 1);
  assert.equal(none.outbox[0].to, 'user@gmail.com');
  assert.match(none.outbox[0].text, /654321/);
  assert.equal(calls.length, 0);
});

test('production refuses to start with no email service', async () => {
  await assert.rejects(importWithEnv({ NODE_ENV: 'production', BREVO_API_KEY: undefined, SMTP_HOST: undefined }), /Set BREVO_API_KEY \(or SMTP_HOST\) in production/);
  await assert.rejects(importWithEnv({ NODE_ENV: 'production', BREVO_API_KEY: ' ', SMTP_HOST: '  ' }), /Set BREVO_API_KEY \(or SMTP_HOST\) in production/);
});

test('production SMTP requires an explicit valid MAIL_FROM instead of inferring a sender from the login', async () => {
  for (const MAIL_FROM of [undefined, '', 'bad sender', 'a@b@c.com']) {
    await assert.rejects(importWithEnv({ NODE_ENV: 'production', BREVO_API_KEY: undefined, SMTP_HOST: 'smtp.example.com', SMTP_USER: 'fallback@example.com', MAIL_FROM }), /MAIL_FROM must be set to a valid sender address/);
  }
});

test('SMTP rejects an invalid explicit port', async () => {
  for (const SMTP_PORT of ['oops', '0', '65536', '1.5', '-1', '1e3']) {
    await assert.rejects(importWithEnv({ BREVO_API_KEY: undefined, SMTP_HOST: 'smtp.example.com', SMTP_PORT }), /SMTP_PORT must be an integer between 1 and 65535/);
  }
});

test('production cannot send the Brevo key to an overridden API endpoint', async () => {
  for (const BREVO_API_URL of ['http://api.brevo.com/v3', 'https://evil.example/v3', 'https://api.brevo.com.evil.example/v3']) {
    await assert.rejects(importWithEnv({ NODE_ENV: 'production', BREVO_API_URL }), /BREVO_API_URL must use the official/);
  }
  assert.equal(calls.length, 0);
});

test('production Brevo failures redact echoed codes, mail contents, and credentials before logging or throwing', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const secrets = { SMTP_PASS: 'smtp-secret-value', JWT_SECRET: 'jwt-secret-value', PASSWORD_PEPPER: 'pepper-secret-value', DATABASE_URL: 'postgresql://user:privatepassword@db.example/app' };
  const production = await importWithEnv({ NODE_ENV: 'production', ...secrets });
  const message = { to: 'recipient@example.com', subject: 'PRIVATE SUBJECT 123456', text: 'PRIVATE body 123456\nAnother private sentence', html: '<p>PRIVATE HTML 123456</p>' };
  reply = (_url, init) => new Response(JSON.stringify({ code: 'invalid_parameter', message: `Sender not verified; echoed ${init.body}; api-key=${init.headers['api-key']}; ${Object.values(secrets).join('; ')}` }), { status: 400 });
  let failure;
  await assert.rejects(production.sendMail(message), (err) => {
    failure = err;
    assert.match(err.message, /Sender not verified/);
    assert.equal(err.status, 400);
    assert.equal(err.code, 'invalid_parameter');
    assert.equal(err.cause, undefined, 'a raw provider error must not survive as a cause');
    return true;
  });
  production.logMailError('verification code send failed', failure);
  assert.equal(logs.mock.callCount(), 1, 'the caller must not log the same error twice');
  const output = `${failure.stack}\n${logs.mock.calls.map(({ arguments: args }) => args.join(' ')).join('\n')}`;
  for (const secret of ['123456', 'PRIVATE', 'Another private sentence', 'test-brevo-key', ...Object.values(secrets)]) {
    assert.equal(output.includes(secret), false, `must redact ${secret}`);
  }
  assert.equal(production.outbox.length, 0);
});

test('production network failures redact echoed mail bodies and keys', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const production = await importWithEnv({ NODE_ENV: 'production' });
  reply = (_url, init) => { throw new Error(`Connection refused; body=${init.body}; key=${init.headers['api-key']}`); };
  let failure;
  await assert.rejects(production.sendPasswordResetEmail('user@gmail.com', 'PRIVATE PERSON', '654321', 10), (err) => {
    failure = err;
    assert.match(err.message, /Connection refused/);
    return true;
  });
  const output = `${failure.stack}\n${logs.mock.calls.map(({ arguments: args }) => args.join(' ')).join('\n')}`;
  assert.doesNotMatch(output, /654321|PRIVATE PERSON|test-brevo-key|Use this code|password won't change/);
});

test('production SMTP failures redact codes, mail contents, and SMTP credentials', async (t) => {
  const SMTP_USER = 'smtp-private-user';
  const SMTP_PASS = 'smtp-private-password';
  const encodedLogin = Buffer.from(`\0${SMTP_USER}\0${SMTP_PASS}`).toString('base64');
  const logs = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  t.mock.method(nodemailer, 'createTransport', () => ({
    verify: async () => { throw new Error(`535 Authentication failed: ${SMTP_USER} ${SMTP_PASS} ${encodedLogin}`); },
    sendMail: async (message) => { throw new Error(`550 Mailbox unavailable; ${JSON.stringify(message)}; ${SMTP_PASS}`); },
  }));
  const smtp = await importWithEnv({ NODE_ENV: 'production', BREVO_API_KEY: undefined, SMTP_HOST: 'smtp.example.com', SMTP_USER, SMTP_PASS });
  await smtp.verifyMailer();
  assert.match(logs.mock.calls[0].arguments.join(' '), /Authentication failed/);
  let failure;
  await assert.rejects(smtp.sendVerificationEmail('user@gmail.com', 'PRIVATE PERSON', '123456', 10), (err) => {
    failure = err;
    assert.match(err.message, /Mailbox unavailable/);
    assert.equal(err.cause, undefined);
    return true;
  });
  smtp.logMailError('verification code send failed', failure);
  assert.equal(logs.mock.callCount(), 2, 'startup failure and delivery failure are each logged once');
  const output = `${failure.stack}\n${logs.mock.calls.map(({ arguments: args }) => args.join(' ')).join('\n')}`;
  for (const secret of [SMTP_USER, SMTP_PASS, encodedLogin, '123456', 'PRIVATE PERSON', 'Welcome to YoursJobMate!']) {
    assert.equal(output.includes(secret), false, `must redact ${secret}`);
  }
  assert.equal(smtp.outbox.length, 0);
  assert.equal(calls.length, 0);
});

test('production startup logging redacts provider-echoed secrets and never logs diagnostic response content', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const logs = t.mock.method(console, 'log', () => {});
  const production = await importWithEnv({ NODE_ENV: 'production' });
  reply = () => new Response(JSON.stringify({ message: 'Key rejected: test-brevo-key; code 123456' }), { status: 401 });
  await production.verifyMailer();
  assert.match(errors.mock.calls[0].arguments.join(' '), /Key rejected/);
  reply = () => new Response(JSON.stringify({ echo: 'test-brevo-key123456@example.com' }), { status: 200 });
  await production.verifyMailer();
  const output = [...errors.mock.calls, ...logs.mock.calls].map(({ arguments: args }) => args.join(' ')).join('\n');
  assert.doesNotMatch(output, /test-brevo-key|123456/);
});
