import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../../client/src/api.js';

let reply;
let requests;
let stored;
let redirects;
beforeEach((t) => {
  stored = new Map([['jobmate_token', 'fixture-token']]);
  redirects = [];
  requests = [];
  reply = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const browser = {
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    window: { location: { assign: url => redirects.push(url) } },
  };
  for (const [key, value] of Object.entries(browser)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return reply();
  });
});

test('JSON email delivery errors retain the exact server message, status and data', async () => {
  const data = { error: "We couldn't send the email. Please try again in a moment." };
  reply = () => new Response(JSON.stringify(data), { status: 502, headers: { 'content-type': 'application/json' } });
  await assert.rejects(api('/auth/signup', { method: 'POST', body: { email: 'fixture@example.invalid' } }), error => {
    assert.equal(error.message, data.error);
    assert.equal(error.status, 502);
    assert.deepEqual(error.data, data);
    return true;
  });
});

test('empty and HTML gateway errors show service availability guidance without exposing proxy details', async () => {
  for (const status of [502, 503, 504]) {
    for (const body of ['', '<html>Bad Gateway: http://localhost:4000/internal</html>']) {
      reply = () => new Response(body, { status, headers: { 'content-type': body ? 'text/html' : 'text/plain' } });
      await assert.rejects(api('/auth/signup'), error => {
        assert.equal(error.message, 'The service is temporarily unavailable. Please try again shortly.');
        assert.equal(error.status, status);
        assert.deepEqual(error.data, {});
        assert.doesNotMatch(error.message, /localhost|internal|<html>/);
        return true;
      });
    }
  }
});

test('successful JSON requests keep their URL, method, token and payload', async () => {
  assert.deepEqual(await api('/profile', { method: 'PUT', body: { headline: 'Fixture headline' } }), { ok: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/profile');
  assert.equal(requests[0].options.method, 'PUT');
  assert.deepEqual(requests[0].options.headers, { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(requests[0].options.body), { headline: 'Fixture headline' });
});

test('a successful no-content response still returns null', async () => {
  reply = () => new Response(null, { status: 204 });
  assert.equal(await api('/saved/1', { method: 'DELETE' }), null);
});

test('unauthorized protected requests still sign out while auth failures leave session handling unchanged', async () => {
  const data = { error: 'Invalid token' };
  reply = () => new Response(JSON.stringify(data), { status: 401 });
  await assert.rejects(api('/me'), error => error.status === 401 && error.message === data.error);
  assert.equal(stored.has('jobmate_token'), false);
  assert.deepEqual(redirects, ['/login']);

  stored.set('jobmate_token', 'fixture-token');
  await assert.rejects(api('/auth/login'), error => error.status === 401 && error.message === data.error);
  assert.equal(stored.get('jobmate_token'), 'fixture-token');
  assert.deepEqual(redirects, ['/login']);
});

test('network failures show connection guidance and retain the original cause', async () => {
  const failure = new TypeError('Connection failed at http://internal-host.invalid');
  reply = () => { throw failure; };
  await assert.rejects(api('/auth/signup'), error => {
    assert.equal(error.message, 'Unable to connect. Please check your connection and try again.');
    assert.equal(error.cause, failure);
    assert.equal(error.status, undefined);
    assert.equal(error.data, undefined);
    assert.doesNotMatch(error.message, /internal-host/);
    return true;
  });
});
