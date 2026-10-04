import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { setPassword } from '../src/auth';
import type { Config } from '../src/config';
import { openDb, type Db } from '../src/db';

const PASSWORD = 'senha-forte-123';

const config: Config = {
  port: 0,
  host: '127.0.0.1',
  dataPath: mkdtempSync(path.join(tmpdir(), 'leituras-')),
  timeZone: 'America/Fortaleza',
  webDistPath: '/nonexistent',
};

const book: PluginBook = {
  id: 1, md5: 'abc123', title: 'Duna', authors: 'Frank Herbert', series: '', language: 'pt', pages: 10, last_open: 1_759_000_000,
};

// One page turn per page 1..n, a minute each, starting at `start`
function pageStats(n: number, start = 1_759_000_000): PluginPageStat[] {
  return Array.from({ length: n }, (_, i) => ({
    book_md5: 'abc123', device_id: 'kindle', page: i + 1, start_time: start + i * 60, duration: 60, total_pages: 10,
  }));
}

let db: Db;
let app: ReturnType<typeof createApp>;

const sendImport = (body: object) =>
  request(app).post('/api/plugin/import').send({ version: '0.3.0', ...body });

async function login() {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ password: PASSWORD }).expect(204);
  return agent;
}

beforeEach(async () => {
  db = openDb(':memory:');
  await setPassword(db, PASSWORD);
  app = createApp(db, config, { fetchCovers: false });
});

describe('plugin import', () => {
  it('ignores duplicated stats when the plugin resends its full history', async () => {
    await sendImport({ books: [book], stats: pageStats(5) }).expect(200);
    await sendImport({ books: [book], stats: pageStats(5) }).expect(200);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM page_stat').get() as { n: number };
    expect(n).toBe(5);
  });

  it('accepts an empty object as empty stats (Lua encodes empty tables as {})', async () => {
    await sendImport({ books: [book], stats: {} }).expect(200);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM book').get() as { n: number };
    expect(n).toBe(1);
  });

  it('accepts an empty object as empty books', async () => {
    await sendImport({ books: {}, stats: [] }).expect(200);
  });

  it('still rejects non-array, non-empty values for books and stats', async () => {
    await sendImport({ books: [book], stats: { a: 1 } }).expect(400);
    await sendImport({ books: [book], stats: 'x' }).expect(400);
  });

  it('keeps user-owned fields when the book is imported again', async () => {
    await sendImport({ books: [book], stats: [] }).expect(200);
    const agent = await login();
    await agent.patch('/api/books/abc123').send({ categoria: 'computação', topicos: 'grafos' }).expect(200);
    await sendImport({ books: [{ ...book, title: 'Duna (ed. revisada)' }], stats: [] }).expect(200);
    const res = await agent.get('/api/books/abc123').expect(200);
    expect(res.body).toMatchObject({ title: 'Duna (ed. revisada)', categoria: 'computação', topicos: 'grafos' });
  });
});

describe('web api', () => {
  it('requires a session', async () => {
    await request(app).get('/api/books').expect(401);
    await request(app).get('/api/dashboard').expect(401);
  });

  it('rate limits login attempts', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/login').send({ password: 'x' }).expect(401);
    await request(app).post('/api/login').send({ password: PASSWORD }).expect(429);
  });

  it('logout invalidates the session', async () => {
    const agent = await login();
    await agent.get('/api/me').expect(200);
    await agent.post('/api/logout').expect(204);
    await agent.get('/api/me').expect(401);
  });

  it('computes progress and lets status_manual override the status', async () => {
    await sendImport({ books: [book], stats: pageStats(10) }).expect(200);
    const agent = await login();
    const before = await agent.get('/api/books/abc123').expect(200);
    expect(before.body.progress).toBe(100);
    expect(before.body.status).toBe('lido');

    const after = await agent.patch('/api/books/abc123').send({ statusManual: 'pausado' }).expect(200);
    expect(after.body.status).toBe('pausado');
  });

  it('rejects an invalid status', async () => {
    await sendImport({ books: [book], stats: [] }).expect(200);
    const agent = await login();
    await agent.patch('/api/books/abc123').send({ statusManual: 'abandonado' }).expect(400);
  });
});
