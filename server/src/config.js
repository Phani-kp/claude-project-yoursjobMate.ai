const placeholder = /change[-_ ]?me|dev-(?:secret|pepper)|\[YOUR[^\]]*\]|<[^>]+>|replace[-_ ]?me/i;
const required = (env, key) => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} must be set in production`);
  return value;
};

/** Database-only commands, such as sync-jobs, do not need authentication or mail secrets. */
export function validateDatabaseConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const database = required(env, 'DATABASE_URL');
  let url;
  let password;
  try {
    url = new URL(database);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2
    || placeholder.test(database) || placeholder.test(password)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL with real database settings');
  }
}

export function validateAuthConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const secret = required(env, 'JWT_SECRET');
  const pepper = required(env, 'PASSWORD_PEPPER');
  for (const [key, value] of [['JWT_SECRET', secret], ['PASSWORD_PEPPER', pepper]]) {
    if (value.length < 32 || placeholder.test(value)) {
      throw new Error(`${key} must contain at least 32 random characters and must not be a placeholder`);
    }
  }
  if (secret === pepper) throw new Error('JWT_SECRET and PASSWORD_PEPPER must be different secrets');
}

/** Validate the complete server before opening the database or accepting requests. */
export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  validateDatabaseConfig(env);
  validateAuthConfig(env);
  if (!env.BREVO_API_KEY?.trim() && !env.SMTP_HOST?.trim()) {
    throw new Error('Set BREVO_API_KEY (or SMTP_HOST) in production so verification emails can be delivered');
  }
  required(env, 'MAIL_FROM');

  for (const origin of (env.CORS_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean)) {
    let parsed;
    try { parsed = new URL(origin); } catch { /* handled below */ }
    if (!parsed || parsed.protocol !== 'https:' || parsed.origin !== origin) {
      throw new Error('CORS_ORIGIN must contain only HTTPS origins without paths or trailing slashes in production');
    }
  }
  if (/^(?:true|false)$/i.test(env.TRUST_PROXY?.trim() || '')) {
    throw new Error('TRUST_PROXY must specify the proxy hop count or trusted proxy addresses, not true/false');
  }
}
