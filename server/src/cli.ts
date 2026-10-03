import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { setPassword } from './auth';
import { loadConfig } from './config';
import { openDb } from './db';

const config = loadConfig();
const [command] = process.argv.slice(2);

const luaString = (value: string) => JSON.stringify(value); // JSON string escaping is valid Lua

if (command === 'set-password') {
  const rl = createInterface({ input: stdin, output: stdout });
  const password = await rl.question('Nova senha: ');
  rl.close();
  if (password.length < 8) {
    console.error('A senha precisa ter pelo menos 8 caracteres.');
    process.exit(1);
  }
  mkdirSync(config.dataPath, { recursive: true });
  const db = openDb(path.join(config.dataPath, 'leituras.sqlite3'));
  await setPassword(db, password);
  db.close();
  console.info('Senha definida. Sessões abertas foram encerradas.');
} else if (command === 'build-plugin') {
  if (!config.publicUrl || !config.pluginToken) {
    console.error('Defina PUBLIC_URL e PLUGIN_TOKEN no .env antes de gerar o plugin.');
    process.exit(1);
  }
  const target = path.resolve(import.meta.dirname, '../../plugin/leituras.koplugin/leituras_config.lua');
  writeFileSync(target, `return {\n  server_url = ${luaString(config.publicUrl)},\n  token = ${luaString(config.pluginToken)},\n}\n`);
  console.info(`Gerado ${target}. Copie a pasta plugin/leituras.koplugin para koreader/plugins/ no Kindle.`);
} else {
  console.error('Uso: cli.ts set-password | build-plugin');
  process.exit(1);
}
