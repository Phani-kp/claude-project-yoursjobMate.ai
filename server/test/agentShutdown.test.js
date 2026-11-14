import { after, test } from 'node:test';
import assert from 'node:assert/strict';

// An isolated in-memory database; no local env file, credentials, persistent data, or network.
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: ':memory:', JWT_SECRET: 'agent-shutdown-test', PASSWORD_PEPPER: 'agent-shutdown-test-pepper' });
for (const key of ['DATABASE_URL', 'BREVO_API_KEY', 'SMTP_HOST', 'ANTHROPIC_API_KEY']) delete process.env[key];
const { db } = await import('../src/db.js');
const { startAgent, stopAgent } = await import('../src/agent.js');
after(() => db.close());

test('stopping the agent drains its first in-flight tick before storage can close', async (t) => {
  let finishQuery;
  const pendingQuery = new Promise((resolve) => { finishQuery = resolve; });
  const all = t.mock.method(db, 'all', () => pendingQuery);
  const timer = startAgent({ intervalMs: 60_000, syncEveryMs: 0 });
  t.after(() => stopAgent(timer));
  let drained = false;
  const stopped = stopAgent(timer).then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false, 'active database work must finish before shutdown resolves');
  finishQuery([]);
  await stopped;
  assert.equal(drained, true);
  assert.equal(all.mock.callCount(), 1, 'shutdown must not start another tick');
});
