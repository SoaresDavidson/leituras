import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { setPassword } from './auth';
import { loadConfig } from './config';
import { openDb } from './db';
import { seed } from './seed';

const config = loadConfig();
const [command] = process.argv.slice(2);

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
} else if (command === 'seed') {
  mkdirSync(config.dataPath, { recursive: true });
  const file = path.join(config.dataPath, 'leituras.sqlite3');
  const db = openDb(file);
  try {
    const { books, stats } = seed(db);
    console.info(`Seed em ${file}: ${books} livros, ${stats} registros de página.`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
} else {
  console.error('Uso: cli.ts set-password | seed');
  process.exit(1);
}
