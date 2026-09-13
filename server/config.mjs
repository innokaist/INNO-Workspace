import { randomBytes } from 'node:crypto';
import path from 'node:path';

function generatedToken() {
  return randomBytes(32).toString('base64url');
}

function port(value) {
  const parsed = value === undefined ? 4173 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new Error('INNO_PORT must be a valid TCP port');
  return parsed;
}

function origins(value) {
  if (!value) return [];
  return String(value).split(',').map(item => item.trim()).filter(Boolean).map(item => {
    const url = new URL(item);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== item.replace(/\/$/, '')) {
      throw new Error('INNO_CORS_ORIGINS must contain comma-separated HTTP origins');
    }
    return url.origin;
  });
}

export function readServerConfig(env = process.env, options = {}) {
  const randomToken = options.randomToken ?? generatedToken;
  const token = env.INNO_ACCESS_TOKEN || randomToken();
  if (typeof token !== 'string' || token.length < 24) throw new Error('INNO_ACCESS_TOKEN must contain at least 24 characters');
  const cwd = options.cwd ?? process.cwd();
  return {
    host: env.INNO_HOST || '127.0.0.1',
    port: port(env.INNO_PORT),
    token,
    corsOrigins: origins(env.INNO_CORS_ORIGINS),
    databasePath: path.resolve(cwd, env.INNO_DB_PATH || '.inno/tasks.sqlite'),
    publicDir: path.resolve(cwd, env.INNO_PUBLIC_DIR || 'public'),
    executorWorkspace: path.resolve(cwd, env.INNO_EXECUTOR_WORKSPACE || '.inno/executor-workspace'),
    claudeRoutineUrl: env.CLAUDE_ROUTINE_URL || '',
    claudeRoutineToken: env.CLAUDE_ROUTINE_TOKEN || '',
  };
}

export function localOnboardingUrl({host, port, token}) {
  const displayHost = ['0.0.0.0', '::', '::0'].includes(host) ? '127.0.0.1' : host;
  const formattedHost = displayHost.includes(':') ? `[${displayHost}]` : displayHost;
  return `http://${formattedHost}:${port}/#token=${encodeURIComponent(token)}`;
}
