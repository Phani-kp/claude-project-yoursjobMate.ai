import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBrevoConfiguration } from '../scripts/check-mail.js';

const configuration = { apiKey: '  fixture-key  ', sender: { name: 'YoursJobMate', email: 'sender@example.com' } };
beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Tests must not make real network requests'));
});

test('mail diagnostic checks transactional access and drops the sandbox message without exposing response data', async () => {
  const calls = [];
  const result = await checkBrevoConfiguration({ ...configuration, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(JSON.stringify({ requests: 99, delivered: 98 }), { status: 200 })
      : new Response(JSON.stringify({ messageId: '<sandbox-fixture>' }), { status: 201 });
  } });
  assert.deepEqual(result, { transactionalReadAccepted: true, sandboxRequestAccepted: true, noEmailSent: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=1');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[1].options.method, 'POST');
  for (const { url, options } of calls) {
    assert.equal(options.headers['api-key'], 'fixture-key');
    assert.equal(options.headers.accept, 'application/json');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(url.includes('fixture-key'), false);
  }
  assert.equal(calls[1].options.headers['content-type'], 'application/json');
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body.sender, configuration.sender);
  assert.deepEqual(body.to, [{ email: 'diagnostic@example.invalid' }]);
  assert.deepEqual(body.headers, { 'X-Sib-Sandbox': 'drop' }, 'sandbox header must be in the JSON body');
  assert.match(body.textContent, /Sandbox diagnostic only/);
  assert.doesNotMatch(JSON.stringify(body), /\b\d{6}\b/);
});

test('IP authorization failure stops the diagnostic before its sandbox request', async () => {
  let calls = 0;
  await assert.rejects(checkBrevoConfiguration({ ...configuration, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ code: 'blockedIP', message: 'Unrecognised IP address' }), { status: 401 });
  } }), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.code, 'blockedIP');
    assert.match(error.message, /Unrecognised IP address/);
    return true;
  });
  assert.equal(calls, 1);
});

test('read access alone does not pass when sandbox POST permission is denied', async () => {
  let calls = 0;
  await assert.rejects(checkBrevoConfiguration({ ...configuration, fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('{}', { status: 200 })
      : new Response(JSON.stringify({ code: 'permission_denied', message: 'Required permission missing' }), { status: 403 });
  } }), (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, 'permission_denied');
    assert.match(error.message, /Required permission missing/);
    return true;
  });
  assert.equal(calls, 2);
});

test('mail diagnostic reports network and non-JSON provider failures', async () => {
  await assert.rejects(checkBrevoConfiguration({ ...configuration, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), /Brevo diagnostic request failed: fetch failed/);
  await assert.rejects(checkBrevoConfiguration({ ...configuration, fetchImpl: async () => new Response('Service unavailable', { status: 503 }) }), /Brevo API error 503: Service unavailable/);
});

test('invalid configuration fails before making any request', async () => {
  const fetchImpl = () => assert.fail('Invalid configuration must not issue requests');
  for (const apiKey of [undefined, '', '   ']) {
    await assert.rejects(checkBrevoConfiguration({ ...configuration, apiKey, fetchImpl }), /BREVO_API_KEY must be set/);
  }
  for (const sender of [null, {}, { email: 'invalid' }, { email: 'sender@example.com', name: 'Bad\nName' }]) {
    await assert.rejects(checkBrevoConfiguration({ ...configuration, sender, fetchImpl }), /MAIL_FROM must be a valid sender/);
  }
});
