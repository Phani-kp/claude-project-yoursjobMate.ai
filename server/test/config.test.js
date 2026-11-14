import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDatabaseConfig, validateProductionConfig } from '../src/config.js';

// All values are test fixtures. Validation is pure and must never contact this reserved hostname.
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://fixture_user:fixture_password@db.invalid:5432/yoursjobmate?sslmode=require',
  JWT_SECRET: 'test-only-jwt-7c1ea3469b6cf40d36a2ec81',
  PASSWORD_PEPPER: 'test-only-pepper-956e327bab460c77e91f0401',
  BREVO_API_KEY: 'test-only-brevo-api-key',
  MAIL_FROM: 'YoursJobMate <sender@example.com>',
};

function rejectsConfig(overrides, expected) {
  const env = { ...production, ...overrides };
  assert.throws(() => validateProductionConfig(env), (err) => {
    assert.match(err.message, expected);
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'PASSWORD_PEPPER', 'BREVO_API_KEY']) {
      if (env[key]?.length > 6) {
        assert.equal(err.message.includes(env[key]), false, `${key} must not appear in a configuration error`);
      }
    }
    return true;
  });
}

test('production accepts a complete Brevo configuration without mutating it', () => {
  const env = Object.freeze({ ...production });
  assert.doesNotThrow(() => validateProductionConfig(env));
});

test('production retains SMTP as an alternative to Brevo', () => {
  assert.doesNotThrow(() => validateProductionConfig({
    ...production,
    BREVO_API_KEY: '',
    SMTP_HOST: 'smtp.example.com',
  }));
});

test('production accepts independent secrets at the 32-character minimum', () => {
  assert.doesNotThrow(() => validateProductionConfig({
    ...production,
    JWT_SECRET: 'fc4cdd9b3f9e54b8d7500385d11190f0',
    PASSWORD_PEPPER: '8ba0e44c7fac78d158ff15d20850381b',
  }));
});

test('production accepts postgres URLs, HTTPS origin allowlists and explicit proxy settings', () => {
  for (const TRUST_PROXY of ['', '0', '1', '127.0.0.1, ::1']) {
    assert.doesNotThrow(() => validateProductionConfig({
      ...production,
      DATABASE_URL: production.DATABASE_URL.replace('postgresql:', 'postgres:'),
      CORS_ORIGIN: 'https://app.example.com, https://admin.example.com:8443',
      TRUST_PROXY,
    }));
  }
});

test('development and test environments permit the empty default configuration', () => {
  for (const NODE_ENV of [undefined, 'development', 'test']) {
    assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV }));
  }
});

test('database-only production commands can run without server authentication or mail secrets', () => {
  assert.doesNotThrow(() => validateDatabaseConfig({
    NODE_ENV: 'production',
    DATABASE_URL: production.DATABASE_URL,
  }));
});

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'PASSWORD_PEPPER', 'MAIL_FROM']) {
  test(`production requires ${key} including non-whitespace content`, () => {
    for (const value of [undefined, '', '   ']) rejectsConfig({ [key]: value }, new RegExp(`${key} must be set`));
  });
}

test('production requires Brevo or SMTP, including non-whitespace settings', () => {
  for (const value of [undefined, '', '   ']) {
    rejectsConfig({ BREVO_API_KEY: value, SMTP_HOST: value }, /Set BREVO_API_KEY \(or SMTP_HOST\)/);
  }
});

test('production rejects malformed database URLs without echoing their credentials', () => {
  for (const DATABASE_URL of [
    'not-a-url-with-private-fixture-password',
    'postgresql://fixture_user:private-fixture-password@[broken/db',
    'postgresql://fixture_user:private-fixture-%E0%A4%A@db.invalid/db',
    'https://fixture_user:private-fixture-password@db.invalid/db',
    'postgresql:///database',
    'postgresql://db.invalid',
  ]) rejectsConfig({ DATABASE_URL }, /DATABASE_URL must be/);
});

test('production rejects database URL placeholders without echoing their credentials', () => {
  for (const password of ['[YOUR-PASSWORD]', '<replace-this-password>', 'change-me', '%5BYOUR-PASSWORD%5D']) {
    rejectsConfig({ DATABASE_URL: `postgresql://fixture_user:${password}@db.invalid/database` }, /DATABASE_URL must be/);
  }
});

for (const key of ['JWT_SECRET', 'PASSWORD_PEPPER']) {
  test(`production rejects short and placeholder ${key} values`, () => {
    for (const value of [
      'short-private-fixture-secret',
      'fc4cdd9b3f9e54b8d7500385d11190f',
      'change-me-to-a-long-random-string-more-than-32-characters',
      'dev-secret-that-is-longer-than-32-characters',
      'dev-pepper-that-is-longer-than-32-characters',
      '[YOUR-SECRET-OF-AT-LEAST-32-CHARACTERS]',
    ]) rejectsConfig({ [key]: value }, new RegExp(`${key} must contain at least 32 random characters`));
  });
}

test('production requires independent authentication secrets', () => {
  rejectsConfig({ PASSWORD_PEPPER: production.JWT_SECRET }, /JWT_SECRET and PASSWORD_PEPPER must be different/);
});

test('production rejects insecure or non-origin CORS values', () => {
  for (const CORS_ORIGIN of [
    'http://app.example.com',
    '*',
    'https://app.example.com/',
    'https://app.example.com/path',
    'https://app.example.com?token=private-fixture-token',
    'https://user:private-fixture-password@app.example.com',
    'https://app.example.com, http://admin.example.com',
  ]) rejectsConfig({ CORS_ORIGIN }, /CORS_ORIGIN must contain only HTTPS origins/);
});

test('production rejects boolean proxy settings instead of silently trusting forwarded headers', () => {
  for (const TRUST_PROXY of ['true', 'false', ' TRUE ']) {
    rejectsConfig({ TRUST_PROXY }, /TRUST_PROXY must specify the proxy hop count or trusted proxy addresses/);
  }
});

test('server startup rejects invalid production secrets before creating a database connection', () => {
  const result = spawnSync(process.execPath, [
    '--no-warnings', '--input-type=module', '--eval',
    `import pg from 'pg';
     pg.Pool = class { constructor() { throw new Error('Unexpected database connection attempt'); } };
     await import('./src/index.js');`,
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, ...production, JWT_SECRET: 'private-child-secret' },
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /JWT_SECRET must contain at least 32 random characters/);
  assert.doesNotMatch(output, /Unexpected database connection attempt/);
  for (const value of [production.DATABASE_URL, production.PASSWORD_PEPPER, production.BREVO_API_KEY, 'private-child-secret']) {
    assert.equal(output.includes(value), false, 'startup errors must not print credentials');
  }
});
