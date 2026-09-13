import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { localOnboardingUrl, readServerConfig } from './config.mjs';
import { createInnoServer } from './http.mjs';
import { createClaudeRoutineRunner, createCodexRunner } from './runners.mjs';
import { SqliteTaskStore } from './store.mjs';

export async function startLocalServer({env = process.env, logger = console} = {}) {
  const config = readServerConfig(env);
  mkdirSync(path.dirname(config.databasePath), {recursive: true});
  mkdirSync(config.executorWorkspace, {recursive: true});
  const store = new SqliteTaskStore(config.databasePath);
  let localMcpUrl = '';
  const runners = {
    codex: createCodexRunner({
      cwd: config.executorWorkspace,
      mcpUrl: () => localMcpUrl,
      mcpToken: config.token,
    }),
    claude: createClaudeRoutineRunner({url: config.claudeRoutineUrl, token: config.claudeRoutineToken}),
  };
  const app = createInnoServer({
    store,
    token: config.token,
    corsOrigins: config.corsOrigins,
    publicDir: config.publicDir,
    runners,
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, resolve);
  });
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : config.port;
  localMcpUrl = `http://127.0.0.1:${actualPort}/mcp`;
  const onboardingUrl = localOnboardingUrl({...config, port: actualPort});
  logger.log(`INNO Workspace is ready: ${onboardingUrl}`);
  logger.log('The URL fragment is an onboarding secret. The browser removes it after storing the token in session storage.');

  const close = async () => {
    for (const active of app.activeRuns.values()) active.controller.abort(new Error('server shutting down'));
    await new Promise(resolve => app.server.close(resolve));
    store.close();
  };
  return {...app, config, onboardingUrl, close};
}

const mainPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (mainPath === import.meta.url) {
  const app = await startLocalServer();
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
