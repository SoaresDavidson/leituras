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

const mkBook = (md5: string, extra: Partial<PluginBook> = {}): PluginBook => ({
  id: 0, md5, title: `Livro ${md5}`, authors: 'Autora', series: '', language: 'pt', pages: 10, last_open: 0, ...extra,
});

function pageStats(md5: string, n: number, start = 1_759_000_000): PluginPageStat[] {
  return Array.from({ length: n }, (_, i) => ({
    book_md5: md5, device_id: 'kindle', page: i + 1, start_time: start + i * 60, duration: 60, total_pages: 10,
  }));
}

let db: Db;
let app: ReturnType<typeof createApp>;
let fetchCalls: string[];
let fetchImpl: (url: string) => Promise<Response>;

const sendImport = (body: object) => request(app).post('/api/plugin/import').send({ version: '0.3.0', ...body });
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

async function login() {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ password: PASSWORD }).expect(204);
  return agent;
}

beforeEach(async () => {
  db = openDb(':memory:');
  await setPassword(db, PASSWORD);
  fetchCalls = [];
  fetchImpl = async () => Response.json({ docs: [] });
  const fetchFn = ((url: string) => {
    fetchCalls.push(String(url));
    return fetchImpl(String(url));
  }) as typeof fetch;
  app = createApp(db, config, { fetchCovers: false, fetchFn });
});

describe('excluir livro', () => {
  it('deletes the book with its stats, queue and mais tarde, and blacklists it', async () => {
    await sendImport({ books: [mkBook('a1'), mkBook('b2')], stats: [...pageStats('a1', 3), ...pageStats('b2', 2)] }).expect(200);
    const agent = await login();
    await agent.put('/api/fila').send({ md5s: ['a1', 'b2'] }).expect(200);
    await agent.put('/api/livros/a1/mais-tarde').send({ maisTarde: true }).expect(200);

    const res = await agent.delete('/api/livros/a1').expect(200);
    expect(res.body.books.map((b: { md5: string }) => b.md5)).toEqual(['b2']);
    expect(res.body.blacklist).toEqual([{ md5: 'a1', title: 'Livro a1', authors: 'Autora', excluidoEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);
    expect(count('page_stat')).toBe(2);
    expect(db.prepare('SELECT md5 FROM fila').all()).toEqual([{ md5: 'b2' }]);
    expect(count('mais_tarde')).toBe(0);
    await agent.get('/api/books/a1').expect(404);
  });

  it('returns 404 for an unknown book', async () => {
    const agent = await login();
    await agent.delete('/api/livros/nada').expect(404);
  });

  it('drops stats-only payloads for a blacklisted md5', async () => {
    await sendImport({ books: [mkBook('a1')], stats: pageStats('a1', 3) }).expect(200);
    const agent = await login();
    await agent.delete('/api/livros/a1').expect(200);
    await sendImport({ stats: pageStats('a1', 5) }).expect(200);
    expect(count('page_stat')).toBe(0);
    expect(count('book')).toBe(0);
  });

  it('rejects import payloads whose items are not objects', async () => {
    await sendImport({ books: [null], stats: [] }).expect(400);
    await sendImport({ books: [], stats: ['x'] }).expect(400);
    await sendImport({ books: [mkBook('a1'), 3], stats: [] }).expect(400);
    expect(count('book')).toBe(0);
  });

  it('silently skips blacklisted books and stats on import', async () => {
    await sendImport({ books: [mkBook('a1')], stats: pageStats('a1', 3) }).expect(200);
    const agent = await login();
    await agent.delete('/api/livros/a1').expect(200);

    await sendImport({ books: [mkBook('a1'), mkBook('b2')], stats: [...pageStats('a1', 3), ...pageStats('b2', 2)] }).expect(200);
    expect(db.prepare('SELECT md5 FROM book').all()).toEqual([{ md5: 'b2' }]);
    expect(count('page_stat')).toBe(2);
  });

  it('brings the book back on the next import after removing it from the blacklist', async () => {
    await sendImport({ books: [mkBook('a1')], stats: pageStats('a1', 3) }).expect(200);
    const agent = await login();
    await agent.delete('/api/livros/a1').expect(200);
    const res = await agent.delete('/api/livros/blacklist/a1').expect(200);
    expect(res.body.blacklist).toEqual([]);
    await agent.delete('/api/livros/blacklist/a1').expect(404);

    await sendImport({ books: [mkBook('a1')], stats: pageStats('a1', 3) }).expect(200);
    expect(count('page_stat')).toBe(3);
    expect((await agent.get('/api/livros').expect(200)).body.books.map((b: { md5: string }) => b.md5)).toEqual(['a1']);
  });
});

describe('ler mais tarde', () => {
  it('toggles the flag and lists it', async () => {
    await sendImport({ books: [mkBook('a1'), mkBook('b2')], stats: [] }).expect(200);
    const agent = await login();
    expect((await agent.get('/api/livros/a1').expect(200)).body).toEqual({ maisTarde: false, anoPublicacao: null });

    expect((await agent.put('/api/livros/a1/mais-tarde').send({ maisTarde: true }).expect(200)).body.maisTarde).toBe(true);
    const list = (await agent.get('/api/livros').expect(200)).body.books as { md5: string; maisTarde: boolean }[];
    expect(Object.fromEntries(list.map((b) => [b.md5, b.maisTarde]))).toEqual({ a1: true, b2: false });

    await sendImport({ books: [mkBook('a1')], stats: pageStats('a1', 2) }).expect(200);
    expect((await agent.get('/api/livros/a1').expect(200)).body.maisTarde).toBe(true);

    expect((await agent.put('/api/livros/a1/mais-tarde').send({ maisTarde: false }).expect(200)).body.maisTarde).toBe(false);
  });

  it('rejects an invalid body and unknown books', async () => {
    await sendImport({ books: [mkBook('a1')], stats: [] }).expect(200);
    const agent = await login();
    await agent.put('/api/livros/a1/mais-tarde').send({ maisTarde: 'sim' }).expect(400);
    await agent.put('/api/livros/a1/mais-tarde').send({}).expect(400);
    await agent.put('/api/livros/zz/mais-tarde').send({ maisTarde: true }).expect(404);
    await agent.get('/api/livros/zz').expect(404);
  });

  it('requires a session', async () => {
    await request(app).get('/api/livros').expect(401);
    await request(app).delete('/api/livros/a1').expect(401);
  });
});

describe('metadados', () => {
  const doc = {
    title: 'Duna',
    author_name: ['Frank Herbert', 'Outro'],
    number_of_pages_median: 412,
    first_publish_year: 1965,
    subject: ['Ficção científica', 'Desertos', 'Política', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
  };

  it('looks the book up on Open Library by title and first author', async () => {
    await sendImport({ books: [mkBook('a1', { title: 'Duna', authors: 'Frank Herbert\nX' })], stats: [] }).expect(200);
    fetchImpl = async () => Response.json({ docs: [doc] });
    const agent = await login();
    const res = await agent.get('/api/livros/a1/metadados').expect(200);
    expect(res.body.resultado).toEqual({
      titulo: 'Duna', autores: 'Frank Herbert\nOutro', paginas: 412, anoPublicacao: 1965,
      assuntos: ['Ficção científica', 'Desertos', 'Política', 'a', 'b', 'c', 'd', 'e'],
    });
    const url = new URL(fetchCalls[0]);
    expect(url.origin + url.pathname).toBe('https://openlibrary.org/search.json');
    expect(url.searchParams.get('title')).toBe('Duna');
    expect(url.searchParams.get('author')).toBe('Frank Herbert');
  });

  it('returns null when nothing is found and 502 when the lookup fails', async () => {
    await sendImport({ books: [mkBook('a1')], stats: [] }).expect(200);
    const agent = await login();
    expect((await agent.get('/api/livros/a1/metadados').expect(200)).body).toEqual({ resultado: null });

    fetchImpl = async () => { throw new Error('offline'); };
    expect((await agent.get('/api/livros/a1/metadados').expect(502)).body.error).toEqual(expect.any(String));

    fetchImpl = async () => new Response('boom', { status: 500 });
    await agent.get('/api/livros/a1/metadados').expect(502);
    await agent.get('/api/livros/zz/metadados').expect(404);
  });

  it('applies chosen fields and keeps them across imports', async () => {
    await sendImport({ books: [mkBook('a1', { authors: '', pages: 0 })], stats: [] }).expect(200);
    const agent = await login();
    await agent.patch('/api/books/a1').send({ topicos: 'Desertos' }).expect(200);

    const res = await agent.post('/api/livros/a1/metadados')
      .send({ authors: 'Frank Herbert', pages: 412, anoPublicacao: 1965, assuntos: ['Desertos', 'Política', ' '] })
      .expect(200);
    expect(res.body).toEqual({ maisTarde: false, anoPublicacao: 1965 });
    expect((await agent.get('/api/books/a1').expect(200)).body).toMatchObject({
      authors: 'Frank Herbert', pages: 412, topicos: 'Desertos\nPolítica',
    });

    await sendImport({ books: [mkBook('a1', { authors: '', pages: 0 })], stats: [] }).expect(200);
    expect((await agent.get('/api/books/a1').expect(200)).body).toMatchObject({ authors: 'Frank Herbert', pages: 412 });
    expect((await agent.get('/api/livros/a1').expect(200)).body.anoPublicacao).toBe(1965);

    await sendImport({ books: [mkBook('a1', { authors: 'F. Herbert', pages: 400 })], stats: [] }).expect(200);
    expect((await agent.get('/api/books/a1').expect(200)).body).toMatchObject({ authors: 'F. Herbert', pages: 400 });
  });

  it('lets the user override a page count the plugin already set', async () => {
    await sendImport({ books: [mkBook('a1', { pages: 10 })], stats: [] }).expect(200);
    const agent = await login();
    await agent.post('/api/livros/a1/metadados').send({ pages: 320 }).expect(200);
    expect((await agent.get('/api/books/a1').expect(200)).body.pages).toBe(320);
  });

  it('drops malformed fields from an odd Open Library response instead of failing', async () => {
    await sendImport({ books: [mkBook('a1')], stats: [] }).expect(200);
    fetchImpl = async () => Response.json({
      docs: [{ title: 42, author_name: 'Frank Herbert', number_of_pages_median: -3, first_publish_year: 1965.5, subject: { a: 1 } }],
    });
    const agent = await login();
    expect((await agent.get('/api/livros/a1/metadados').expect(200)).body.resultado)
      .toEqual({ titulo: '', autores: '', paginas: null, anoPublicacao: null, assuntos: [] });

    fetchImpl = async () => Response.json({
      docs: [{ title: 'Duna', author_name: ['Frank Herbert', 7, ''], number_of_pages_median: 412, first_publish_year: 0, subject: ['Política', null] }],
    });
    expect((await agent.get('/api/livros/a1/metadados').expect(200)).body.resultado)
      .toEqual({ titulo: 'Duna', autores: 'Frank Herbert', paginas: 412, anoPublicacao: null, assuntos: ['Política'] });

    fetchImpl = async () => Response.json({ docs: 'nope' });
    expect((await agent.get('/api/livros/a1/metadados').expect(200)).body).toEqual({ resultado: null });
  });

  it('rejects invalid metadata patches', async () => {
    await sendImport({ books: [mkBook('a1')], stats: [] }).expect(200);
    const agent = await login();
    for (const body of [{}, { authors: '' }, { pages: 0 }, { pages: '10' }, { anoPublicacao: 1.5 }, { assuntos: 'x' }, { assuntos: [1] }]) {
      await agent.post('/api/livros/a1/metadados').send(body).expect(400);
    }
    const many = Array.from({ length: 51 }, (_, i) => `assunto ${i}`);
    await agent.post('/api/livros/a1/metadados').send({ assuntos: many }).expect(400);
    await agent.post('/api/livros/a1/metadados').send({ assuntos: ['x'.repeat(201)] }).expect(400);
    await agent.post('/api/livros/a1/metadados').send({ assuntos: [...many.slice(0, 50)], authors: 'A' }).expect(200);
    await agent.post('/api/livros/a1/metadados').send({ assuntos: ['x'.repeat(200)] }).expect(200);
    await agent.post('/api/livros/zz/metadados').send({ anoPublicacao: 2000 }).expect(404);
  });
});
