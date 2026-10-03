import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';

const config = loadConfig();
if (!config.pluginToken) {
  console.error('PLUGIN_TOKEN is not set. Generate one with: openssl rand -hex 32');
  process.exit(1);
}

mkdirSync(config.dataPath, { recursive: true });
const db = openDb(path.join(config.dataPath, 'leituras.sqlite3'));
const server = createApp(db, config).listen(config.port, config.host, () => {
  console.info(`Leituras running on http://${config.host}:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
