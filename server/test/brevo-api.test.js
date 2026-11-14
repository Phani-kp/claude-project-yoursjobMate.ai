import { after, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import crypto from 'node:crypto';

// Exercise the real auth routes with local storage and mocked email delivery.
const savedEnv = { ...process.env };
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_PATH: ':memory:',
  JWT_SECRET: 'brevo-integration-test-secret',
  PASSWORD_PEPPER: 'brevo-integration-test-pepper',
  AUTH_RATE_LIMIT: '1000',
  API_RATE_LIMIT: '1000',
  BREVO_API_KEY: 'test-brevo-key',
  MAIL_FROM: 'YoursJobMate <sender@example.com>',
});
for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'BREVO_API_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ANTHROPIC_API_KEY', 'TRUST_PROXY']) {
  delete process.env[key];
}

const realFetch = globalThis.fetch;
let origin;
let sent = [];
let rejectMail = false;
const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
  if (url === 'https://api.brevo.com/v3/smtp/email') {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['api-key'], 'test-brevo-key');
    sent.push(JSON.parse(options.body));
    return rejectMail
      ? new Response(JSON.stringify({ code: 'unauthorized', message: 'Provider rejected the test key' }), { status: 401 })
      : new Response(JSON.stringify({ messageId: '<test@brevo>' }), { status: 201 });
  }
  assert.equal(new URL(url).origin, origin, 'only loopback HTTP may use the real fetch');
  return realFetch(url, options);
});

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { hmac } = await import('../src/auth.js');
const { outbox } = await import('../src/mailer.js');
const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
origin = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  try {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await db.close();
  } finally {
    fetchMock.mock.restore();
    process.env = savedEnv;
  }
});
beforeEach(() => {
  sent = [];
  rejectMail = false;
});

const post = async (path, body) => {
  const response = await fetch(`${origin}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const codeFrom = (mail) => mail.subject.match(/^([0-9]{6})\b/)[1];
const lastCode = (email) => codeFrom(sent.findLast((mail) => mail.to[0].email === email));
const signup = (email) => post('signup', { name: 'Sam', email, password: 'initial-password' });
const me = async (token) => {
  const response = await fetch(`${origin}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
};
const wrongCode = (code) => code === '123456' ? '654321' : '123456';

test('one Brevo sender delivers to different users while account data stays in the app database', async () => {
  const email = 'brevo-user@gmail.com';
  const signedUp = await signup(email);
  assert.equal(signedUp.status, 201);
  assert.equal(Object.hasOwn(signedUp.body, 'devCode'), false);
  assert.equal(Object.hasOwn(signedUp.body, 'token'), false);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [{ email }]);
  assert.match(sent[0].subject, /verification code/);
  const verifyCode = codeFrom(sent[0]);
  const user = await db.get('SELECT * FROM users WHERE email = ?', email);
  assert.equal(db.kind, 'pglite');
  assert.match(user.password_hash, /^pep1\$\$2[aby]\$/);
  assert.equal(user.otp_hash, hmac(`${user.id}:verify:${verifyCode}`));
  assert.equal(user.verified, 0);
  const blocked = await post('login', { email, password: 'initial-password' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.needsVerification, true);
  assert.equal(Object.hasOwn(blocked.body, 'token'), false);
  assert.equal(Object.hasOwn(blocked.body, 'devCode'), false);
  assert.equal(sent.length, 1, 'unverified login respects the resend cooldown');
  const verified = await post('verify', { email, code: verifyCode });
  assert.equal(verified.status, 200);
  assert.equal((await post('verify', { email, code: verifyCode })).status, 400);

  const forgot = await post('forgot-password', { email });
  assert.equal(forgot.status, 200);
  assert.equal(Object.hasOwn(forgot.body, 'devCode'), false);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].to, [{ email }]);
  assert.match(sent[1].subject, /password reset code/);
  const resetCode = codeFrom(sent[1]);
  assert.equal((await db.get('SELECT otp_hash FROM users WHERE id = ?', user.id)).otp_hash, hmac(`${user.id}:reset:${resetCode}`));
  assert.equal(Object.hasOwn((await post('forgot-password', { email })).body, 'devCode'), false);
  assert.equal(sent.length, 2, 'cooldown must not resend the code');

  const reset = await post('reset-password', { email, code: resetCode, password: 'replacement-password' });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.token);
  assert.equal((await me(verified.body.token)).status, 401, 'reset revokes previously issued tokens');
  assert.equal((await me(reset.body.token)).status, 200);
  assert.equal((await post('login', { email, password: 'replacement-password' })).status, 200);
  assert.equal((await post('login', { email, password: 'initial-password' })).status, 401);
  assert.equal((await post('reset-password', { email, code: resetCode, password: 'reused-password' })).status, 400);
  assert.notEqual((await db.get('SELECT password_hash FROM users WHERE id = ?', user.id)).password_hash, user.password_hash);

  const secondEmail = 'another-user@outlook.com';
  assert.equal((await signup(secondEmail)).status, 201);
  const secondMail = sent.at(-1);
  assert.deepEqual(secondMail.to, [{ email: secondEmail }]);
  assert.deepEqual(secondMail.sender, sent[0].sender, 'all recipients use the verified application sender');
  assert.notEqual((await db.get('SELECT id FROM users WHERE email = ?', secondEmail)).id, user.id);
  assert.equal(outbox.length, 0, 'Brevo must not retain codes in the development outbox');
});

test('Brevo errors are logged safely and a failed signup email can be retried immediately', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  rejectMail = true;
  const email = 'brevo-retry@gmail.com';
  const failed = await post('signup', { name: 'Retry', email, password: 'initial-password' });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "We couldn't send the email. Please try again in a moment.");
  assert.equal(Object.hasOwn(failed.body, 'devCode'), false);
  assert.ok(logs.some((line) => line.includes('Provider rejected the test key')));
  assert.doesNotMatch(JSON.stringify(failed.body), /Provider rejected|unauthorized|test-brevo-key/);
  const original = await db.get('SELECT id, otp_sent_at FROM users WHERE email = ?', email);
  assert.equal(original.otp_sent_at, null);
  await db.run('UPDATE profiles SET headline = ? WHERE user_id = ?', 'Keep this profile', original.id);

  rejectMail = false;
  const retry = await signup(email);
  assert.equal(retry.status, 201);
  assert.equal(Object.hasOwn(retry.body, 'devCode'), false);
  assert.equal(sent.length, 2);
  assert.equal((await db.get('SELECT id FROM users WHERE email = ?', email)).id, original.id);
  assert.equal((await db.get('SELECT headline FROM profiles WHERE user_id = ?', original.id)).headline, 'Keep this profile');
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM users WHERE email = ?', email)).count, 1);
  assert.equal((await post('verify', { email, code: codeFrom(sent[1]) })).status, 200);
  assert.equal(outbox.length, 0);
});

test('verification and reset codes are bound to an account and purpose and expire', async (t) => {
  let nextCode = 610000;
  t.mock.method(crypto, 'randomInt', () => ++nextCode);
  const first = 'bound-first@gmail.com';
  const second = 'bound-second@gmail.com';
  await signup(first);
  const firstCode = lastCode(first);
  await signup(second);
  const secondCode = lastCode(second);
  assert.notEqual(firstCode, secondCode);
  assert.equal((await post('verify', { email: second, code: firstCode })).status, 400);
  assert.equal((await db.get('SELECT verified FROM users WHERE email = ?', second)).verified, 0);
  assert.equal((await post('reset-password', { email: first, code: firstCode, password: 'replacement-password' })).status, 400);

  await post('forgot-password', { email: first });
  const resetCode = lastCode(first);
  assert.equal((await post('verify', { email: first, code: resetCode })).status, 400);
  assert.equal((await post('reset-password', { email: second, code: resetCode, password: 'replacement-password' })).status, 400);

  await db.run('UPDATE users SET otp_expires_at = 0 WHERE email = ?', second);
  assert.equal((await post('verify', { email: second, code: secondCode })).status, 400);
  await db.run('UPDATE users SET otp_expires_at = 0 WHERE email = ?', first);
  assert.equal((await post('reset-password', { email: first, code: resetCode, password: 'replacement-password' })).status, 400);
});

test('verification codes enforce five attempts and a resend cooldown before issuing a fresh code', async () => {
  const email = 'attempts@gmail.com';
  await signup(email);
  const code = lastCode(email);
  const cooldown = await post('resend-otp', { email });
  assert.equal(cooldown.status, 429);
  assert.ok(cooldown.body.retryAfter > 0);
  assert.equal(sent.length, 1);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await post('verify', { email, code: wrongCode(code) })).status, 400);
  }
  assert.equal((await post('verify', { email, code })).status, 429);
  assert.equal((await db.get('SELECT otp_attempts FROM users WHERE email = ?', email)).otp_attempts, 5);

  await db.run('UPDATE users SET otp_sent_at = 0 WHERE email = ?', email);
  assert.equal((await post('resend-otp', { email })).status, 200);
  assert.equal(sent.length, 2);
  assert.equal((await db.get('SELECT otp_attempts FROM users WHERE email = ?', email)).otp_attempts, 0);
  assert.equal((await post('verify', { email, code: lastCode(email) })).status, 200);
});

test('signup retry cannot replace pending credentials until a fresh verification code can be issued', async (t) => {
  let nextCode = 620000;
  t.mock.method(crypto, 'randomInt', () => ++nextCode);
  const email = 'pending-signup@gmail.com';
  await signup(email);
  const oldCode = lastCode(email);
  const original = await db.get('SELECT * FROM users WHERE email = ?', email);
  const replacement = { email, name: 'Replacement', password: 'replacement-password' };
  const blocked = await post('signup', replacement);
  assert.equal(blocked.status, 429);
  const pending = await db.get('SELECT * FROM users WHERE email = ?', email);
  assert.equal(pending.name, original.name);
  assert.equal(pending.password_hash, original.password_hash);
  assert.equal(pending.otp_hash, original.otp_hash);
  assert.equal(sent.length, 1);

  await db.run('UPDATE users SET otp_sent_at = 0 WHERE email = ?', email);
  assert.equal((await post('signup', replacement)).status, 201);
  const refreshed = await db.get('SELECT * FROM users WHERE email = ?', email);
  assert.equal(refreshed.id, original.id);
  assert.equal(refreshed.name, replacement.name);
  assert.notEqual(refreshed.password_hash, original.password_hash);
  assert.equal((await post('verify', { email, code: oldCode })).status, 400);
  assert.equal((await post('verify', { email, code: lastCode(email) })).status, 200);
  assert.equal((await post('login', { email, password: replacement.password })).status, 200);
});

test('forgot-password gives the same public result for known, unknown, throttled and provider-failed accounts', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const email = 'private-reset@gmail.com';
  await signup(email);
  await post('verify', { email, code: lastCode(email) });
  const unknown = await post('forgot-password', { email: 'unknown@gmail.com' });
  const before = sent.length;
  const known = await post('forgot-password', { email });
  assert.deepEqual(known, unknown);
  assert.equal(sent.length, before + 1);
  const throttled = await post('forgot-password', { email });
  assert.deepEqual(throttled, unknown);
  assert.equal(sent.length, before + 1);

  await db.run('UPDATE users SET otp_sent_at = 0 WHERE email = ?', email);
  rejectMail = true;
  const failed = await post('forgot-password', { email });
  assert.equal(failed.status, 200);
  assert.deepEqual(failed, unknown, 'provider failures must not reveal that an account exists');
  assert.equal(Object.hasOwn(failed.body, 'devCode'), false);
  assert.doesNotMatch(JSON.stringify(failed.body), /Provider|unauthorized|test-brevo-key/);
  assert.ok(logs.length > 0, 'delivery failures remain observable on the server');
  rejectMail = false;
  assert.deepEqual(await post('forgot-password', { email }), unknown);
  assert.equal(sent.length, before + 3, 'provider failure permits immediate retry');
});

test('concurrent verification and reset attempts consume each one-time code once', async () => {
  const email = 'concurrent-consume@gmail.com';
  await signup(email);
  const code = lastCode(email);
  const verifies = await Promise.all([
    post('verify', { email, code }),
    post('verify', { email, code }),
  ]);
  assert.deepEqual(verifies.map((result) => result.status).sort(), [200, 400]);
  const oldToken = verifies.find((result) => result.status === 200).body.token;
  await post('forgot-password', { email });
  const resetCode = lastCode(email);
  const resets = await Promise.all([
    post('reset-password', { email, code: resetCode, password: 'first-replacement' }),
    post('reset-password', { email, code: resetCode, password: 'second-replacement' }),
  ]);
  assert.deepEqual(resets.map((result) => result.status).sort(), [200, 400]);
  assert.equal((await me(oldToken)).status, 401);
  assert.equal((await me(resets.find((result) => result.status === 200).body.token)).status, 200);
  assert.equal((await db.get('SELECT token_version FROM users WHERE email = ?', email)).token_version, 1);
});

test('concurrent resend requests send a single new code', async () => {
  const email = 'concurrent-resend@gmail.com';
  await signup(email);
  await db.run('UPDATE users SET otp_sent_at = 0 WHERE email = ?', email);
  sent = [];
  const results = await Promise.all([
    post('resend-otp', { email }),
    post('resend-otp', { email }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 429]);
  assert.equal(sent.length, 1);
  assert.equal((await post('verify', { email, code: lastCode(email) })).status, 200);
});

test('concurrent incorrect guesses cannot exceed the five-attempt limit', async () => {
  const email = 'concurrent-guesses@gmail.com';
  await signup(email);
  const code = lastCode(email);
  const results = await Promise.all(Array.from({ length: 7 }, () => post('verify', { email, code: wrongCode(code) })));
  assert.equal(results.filter((result) => result.status === 400).length, 5);
  assert.equal(results.filter((result) => result.status === 429).length, 2);
  assert.equal((await db.get('SELECT otp_attempts FROM users WHERE email = ?', email)).otp_attempts, 5);
  assert.equal((await post('verify', { email, code })).status, 429);
});
