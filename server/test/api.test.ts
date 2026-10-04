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

  it('keeps arquivado_em when the book is imported again', async () => {
    await sendImport({ books: [book], stats: [] }).expect(200);
    const agent = await login();
    await agent.patch('/api/books/abc123').send({ arquivado: true }).expect(200);
    await sendImport({ books: [book], stats: [] }).expect(200);
    expect(db.prepare('SELECT arquivado_em FROM book').get()).toEqual({ arquivado_em: expect.any(String) });
    await agent.put('/api/fila').send({ md5s: ['abc123'] }).expect(200);
    await sendImport({ books: [book], stats: pageStats(2) }).expect(200);
    expect(db.prepare('SELECT md5, posicao FROM fila').all()).toEqual([{ md5: 'abc123', posicao: 0 }]);
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

  it('archives a book and unarchives it when read on a later day', async () => {
    const old = Math.floor(Date.now() / 1000) - 60 * 86_400;
    await sendImport({ books: [book], stats: pageStats(3, old) }).expect(200);
    const agent = await login();
    const archived = await agent.patch('/api/books/abc123').send({ arquivado: true }).expect(200);
    expect(archived.body.arquivado).toBe(true);

    const later = Math.floor(Date.now() / 1000) + 86_400; // reading after the archive date
    await sendImport({ books: [book], stats: pageStats(4, later).slice(3) }).expect(200);
    const after = await agent.get('/api/books/abc123').expect(200);
    expect(after.body.arquivado).toBe(false);
  });

  it('keeps a book archived when re-read on the same day it was archived', async () => {
    const now = Math.floor(Date.now() / 1000);
    // stats seconds away from now, so the test does not cross midnight
    await sendImport({ books: [book], stats: pageStats(3, now - 200) }).expect(200);
    const agent = await login();
    await agent.patch('/api/books/abc123').send({ arquivado: true }).expect(200);
    await sendImport({ books: [book], stats: pageStats(4, now - 190).slice(3) }).expect(200);
    expect((await agent.get('/api/books/abc123')).body.arquivado).toBe(true);
  });

  it('unarchives explicitly and rejects a non-boolean arquivado', async () => {
    await sendImport({ books: [book], stats: [] }).expect(200);
    const agent = await login();
    await agent.patch('/api/books/abc123').send({ arquivado: true }).expect(200);
    expect((await agent.patch('/api/books/abc123').send({ arquivado: false })).body.arquivado).toBe(false);
    await agent.patch('/api/books/abc123').send({ arquivado: 'sim' }).expect(400);
  });

  it('rejects an invalid status', async () => {
    await sendImport({ books: [book], stats: [] }).expect(200);
    const agent = await login();
    await agent.patch('/api/books/abc123').send({ statusManual: 'abandonado' }).expect(400);
  });
});

describe('foco api', () => {
  const other: PluginBook = { ...book, id: 2, md5: 'def456', title: 'Fundação' };
  const seedTwo = () => sendImport({ books: [book, other], stats: [] }).expect(200);

  it('replaces the queue in order', async () => {
    await seedTwo();
    const agent = await login();
    const res = await agent.put('/api/fila').send({ md5s: ['def456', 'abc123'] }).expect(200);
    expect(res.body.fila.map((f: { book: { md5: string } }) => f.book.md5)).toEqual(['def456', 'abc123']);
  });

  it('clears the queue with an empty list', async () => {
    await seedTwo();
    const agent = await login();
    await agent.put('/api/fila').send({ md5s: ['abc123'] }).expect(200);
    const res = await agent.put('/api/fila').send({ md5s: [] }).expect(200);
    expect(res.body.fila).toEqual([]);
  });

  it('rejects unknown, duplicated or malformed queues', async () => {
    await seedTwo();
    const agent = await login();
    await agent.put('/api/fila').send({ md5s: ['abc123'] }).expect(200);
    for (const body of [{ md5s: ['nao-existe'] }, { md5s: ['abc123', 'abc123'] }, { md5s: 'abc123' }, { md5s: [1] }]) {
      const res = await agent.put('/api/fila').send(body).expect(400);
      expect(typeof res.body.error).toBe('string');
    }
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM fila WHERE md5 = 'abc123'").get() as { n: number };
    expect(n).toBe(1);
  });

  it('updates focus settings within range', async () => {
    const agent = await login();
    const res = await agent.patch('/api/foco').send({ limite: 3, prazoDias: 30 }).expect(200);
    expect(res.body).toMatchObject({ limite: 3, prazoDias: 30 });
  });

  it('rejects out-of-range or non-integer settings', async () => {
    const agent = await login();
    for (const body of [{ limite: 0 }, { limite: 11 }, { limite: 2.5 }, { limite: '3' }, { prazoDias: 6 }, { prazoDias: 366 }]) {
      await agent.patch('/api/foco').send(body).expect(400);
    }
  });

  it('requires a session for foco routes', async () => {
    await request(app).put('/api/fila').send({ md5s: [] }).expect(401);
    await request(app).patch('/api/foco').send({ limite: 3 }).expect(401);
  });
});

describe('habito api', () => {
  it('requires a session for habito routes', async () => {
    await request(app).get('/api/habito').expect(401);
    await request(app).patch('/api/habito').send({ gatilho: 'x' }).expect(401);
  });

  it('returns the habit block with default goals', async () => {
    await sendImport({ books: [book], stats: pageStats(3, Math.floor(Date.now() / 1000) - 600) }).expect(200);
    const agent = await login();
    const res = await agent.get('/api/habito').expect(200);
    expect(res.body.metas).toEqual({ dia: { minutos: 20, paginas: 0 }, mes: { minutos: 600, paginas: 0 } });
    expect(res.body.daily).toHaveLength(365);
    expect(res.body.niveis.map((n: { nivel: string }) => n.nivel)).toEqual(['bronze', 'prata', 'ouro']);
  });

  it('updates goals and trims the trigger', async () => {
    const agent = await login();
    const res = await agent.patch('/api/habito')
      .send({ metaDiaMinutos: 0, metaDiaPaginas: 15, metaMesMinutos: 900, metaMesPaginas: 0, gatilho: '  depois do café  ' })
      .expect(200);
    expect(res.body.metas).toEqual({ dia: { minutos: 0, paginas: 15 }, mes: { minutos: 900, paginas: 0 } });
    expect(res.body.gatilho).toBe('depois do café');
  });

  it('rejects invalid goals and triggers without saving anything', async () => {
    const agent = await login();
    const bodies = [
      [1], { metaDiaMinutos: -1 }, { metaDiaMinutos: 601 }, { metaDiaMinutos: 2.5 }, { metaDiaPaginas: '10' },
      { metaMesMinutos: 18001 }, { metaMesPaginas: 30001 }, { gatilho: 3 }, { gatilho: 'x'.repeat(141) },
      { metaDiaMinutos: 0 }, // the pages goal is 0 by default: nothing left to meet
      { metaMesMinutos: 0, metaMesPaginas: 0 },
    ];
    for (const body of bodies) {
      const res = await agent.patch('/api/habito').send(body).expect(400);
      expect(typeof res.body.error).toBe('string');
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM setting WHERE key LIKE 'habito.%'").get()).toEqual({ n: 0 });
  });

  it('names the field and the range in error messages', async () => {
    const agent = await login();
    const cases: [unknown, string][] = [
      [[{ metaDiaMinutos: 10 }], 'Ajustes inválidos'],
      [{ gatilho: 42 }, 'O gatilho deve ser um texto de até 140 caracteres'],
      [{ metaDiaMinutos: 601 }, 'Meta diária em minutos deve ser inteiro entre 0 e 600'],
      [{ metaDiaPaginas: 1.5 }, 'Meta diária em páginas deve ser inteiro entre 0 e 1000'],
      [{ metaMesMinutos: -1 }, 'Meta mensal em minutos deve ser inteiro entre 0 e 18000'],
      [{ metaMesPaginas: '5' }, 'Meta mensal em páginas deve ser inteiro entre 0 e 30000'],
      [{ metaDiaMinutos: 0 }, 'A meta diária precisa de minutos ou páginas'],
      [{ metaMesMinutos: 0 }, 'A meta mensal precisa de minutos ou páginas'],
    ];
    for (const [body, error] of cases) {
      const res = await agent.patch('/api/habito').send(body as object).expect(400);
      expect(res.body).toEqual({ error });
    }
  });

  it('keeps habit settings when the plugin imports again', async () => {
    const agent = await login();
    await agent.patch('/api/habito').send({ metaDiaMinutos: 30, gatilho: 'antes de dormir' }).expect(200);
    await sendImport({ books: [book], stats: pageStats(2) }).expect(200);
    const res = await agent.get('/api/habito').expect(200);
    expect(res.body).toMatchObject({ metas: { dia: { minutos: 30 } }, gatilho: 'antes de dormir' });
  });
});

describe('retrospectiva api', () => {
  it('requires a session for retrospectiva routes', async () => {
    await request(app).get('/api/retrospectiva').expect(401);
    await request(app).get('/api/retrospectiva/periodo').expect(401);
    await request(app).patch('/api/retrospectiva').send({ metaAnoPaginas: 1000 }).expect(401);
  });

  it('returns a period and rejects invalid tipo or offset', async () => {
    const agent = await login();
    const week = await agent.get('/api/retrospectiva/periodo').expect(200);
    expect(week.body).toMatchObject({ tipo: 'semana', offset: 0, melhorDia: null, maiorSessao: null, livros: [] });
    expect(Object.keys(week.body).sort()).toEqual(['anterior', 'fim', 'inicio', 'livros', 'maiorSessao', 'melhorDia', 'offset', 'tipo', 'totais']);
    expect(week.body.totais).toEqual({ minutos: 0, paginas: 0, diasLidos: 0, livrosTocados: 0, livrosTerminados: 0 });
    expect(week.body.inicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const month = await agent.get('/api/retrospectiva/periodo?tipo=mes&offset=2').expect(200);
    expect(month.body).toMatchObject({ tipo: 'mes', offset: 2 });
    await agent.get('/api/retrospectiva/periodo?offset=520').expect(200);
    for (const q of ['tipo=ano', 'offset=-1', 'offset=1.5', 'offset=abc', 'offset=521', 'tipo=semana&tipo=mes', 'offset=1&offset=2']) {
      const res = await agent.get(`/api/retrospectiva/periodo?${q}`).expect(400);
      expect(res.body.error).toBeTypeOf('string');
    }
  });

  it('saves the yearly goal and rejects invalid values', async () => {
    const agent = await login();
    expect((await agent.get('/api/retrospectiva').expect(200)).body.meta.metaPaginas).toBe(6000);
    for (const metaAnoPaginas of [99, 100_001, '1000', 1000.5, null, 0]) {
      const res = await agent.patch('/api/retrospectiva').send({ metaAnoPaginas }).expect(400);
      expect(res.body.error).toBe('Meta inválida');
    }
    await agent.patch('/api/retrospectiva').send({ metaAnoPaginas: 100 }).expect(200);
    await agent.patch('/api/retrospectiva').send({ metaAnoPaginas: 100_000 }).expect(200);
    await agent.patch('/api/retrospectiva').send({}).expect(400);
    const res = await agent.patch('/api/retrospectiva').send({ metaAnoPaginas: 3650 }).expect(200);
    expect(res.body.meta.metaPaginas).toBe(3650);
  });

  it('keeps the yearly goal across plugin imports', async () => {
    const agent = await login();
    await agent.patch('/api/retrospectiva').send({ metaAnoPaginas: 1200 }).expect(200);
    await sendImport({ books: [book], stats: pageStats(5) }).expect(200);
    expect((await agent.get('/api/retrospectiva').expect(200)).body.meta.metaPaginas).toBe(1200);
  });
});

describe('aprendizado api', () => {
  const seedBook = () => sendImport({ books: [book], stats: [] }).expect(200);

  it('requires a session', async () => {
    await request(app).get('/api/aprendizado').expect(401);
    await request(app).post('/api/aprendizado/notas').send({ md5: 'abc123', texto: 'x' }).expect(401);
  });

  it('creates, reviews and deletes a note', async () => {
    await seedBook();
    const agent = await login();
    const created = await agent.post('/api/aprendizado/notas').send({ md5: 'abc123', texto: '  Especiaria  ' }).expect(201);
    expect(created.body).toMatchObject({ md5: 'abc123', bookTitle: 'Duna', texto: 'Especiaria', etapa: 0 });
    const reviewed = await agent.post(`/api/aprendizado/notas/${created.body.id}/revisao`).send({ lembrei: true }).expect(200);
    expect(reviewed.body.etapa).toBe(1);
    expect((await agent.get('/api/aprendizado/livros/abc123').expect(200)).body.notas).toHaveLength(1);
    expect((await agent.get('/api/aprendizado').expect(200)).body.notas).toHaveLength(1);
    await agent.delete(`/api/aprendizado/notas/${created.body.id}`).expect(204);
    await agent.delete(`/api/aprendizado/notas/${created.body.id}`).expect(404);
  });

  it('validates notes and reviews', async () => {
    await seedBook();
    const agent = await login();
    for (const body of [{ md5: 'abc123' }, { md5: 'abc123', texto: '   ' }, { md5: 'abc123', texto: 'x'.repeat(2001) }, { md5: 1, texto: 'x' }]) {
      const res = await agent.post('/api/aprendizado/notas').send(body).expect(400);
      expect(typeof res.body.error).toBe('string');
    }
    await agent.post('/api/aprendizado/notas').send({ md5: 'nao-existe', texto: 'x' }).expect(404);
    const { body } = await agent.post('/api/aprendizado/notas').send({ md5: 'abc123', texto: 'x' }).expect(201);
    await agent.post(`/api/aprendizado/notas/${body.id}/revisao`).send({ lembrei: 'sim' }).expect(400);
    await agent.post('/api/aprendizado/notas/9999/revisao').send({ lembrei: true }).expect(404);
    await agent.post('/api/aprendizado/notas/abc/revisao').send({ lembrei: true }).expect(404);
  });

  it('sets the skill tree node of a book', async () => {
    await seedBook();
    const agent = await login();
    expect((await agent.put('/api/aprendizado/livros/abc123/area').send({ area: 'compiladores' }).expect(200)).body.area).toBe('compiladores');
    await agent.put('/api/aprendizado/livros/abc123/area').send({ area: 'nao-existe' }).expect(400);
    await agent.put('/api/aprendizado/livros/abc123/area').send({}).expect(400);
    await agent.put('/api/aprendizado/livros/nao-existe/area').send({ area: null }).expect(404);
    await agent.get('/api/aprendizado/livros/nao-existe').expect(404);
    expect((await agent.put('/api/aprendizado/livros/abc123/area').send({ area: null }).expect(200)).body.area).toBeNull();
  });

  it('marks books on a trail item', async () => {
    await seedBook();
    const agent = await login();
    const res = await agent.put('/api/aprendizado/trilhas/construir-linguagem/itens/analise').send({ md5s: ['abc123'] }).expect(200);
    expect(res.body.itens.find((i: { id: string }) => i.id === 'analise').estado).toBe('andamento');
    await agent.put('/api/aprendizado/trilhas/nao-existe/itens/analise').send({ md5s: [] }).expect(404);
    for (const body of [{ md5s: 'abc123' }, { md5s: [1] }, { md5s: ['abc123', 'abc123'] }, { md5s: ['nao-existe'] }]) {
      await agent.put('/api/aprendizado/trilhas/construir-linguagem/itens/analise').send(body).expect(400);
    }
  });

  it('accepts 2000 characters and rejects 2001', async () => {
    await seedBook();
    const agent = await login();
    await agent.post('/api/aprendizado/notas').send({ md5: 'abc123', texto: 'x'.repeat(2000) }).expect(201);
    await agent.post('/api/aprendizado/notas').send({ md5: 'abc123', texto: 'x'.repeat(2001) }).expect(400);
  });

  it('returns 404 for a non-numeric note id', async () => {
    const agent = await login();
    await agent.delete('/api/aprendizado/notas/abc').expect(404);
    await agent.post('/api/aprendizado/notas/1.5/revisao').send({ lembrei: true }).expect(404);
  });

  it('distinguishes unknown trail items (404) from bad books (400)', async () => {
    await seedBook();
    const agent = await login();
    await agent.put('/api/aprendizado/trilhas/nao-existe/itens/analise').send({ md5s: ['abc123'] }).expect(404);
    await agent.put('/api/aprendizado/trilhas/construir-linguagem/itens/nao-existe').send({ md5s: ['abc123'] }).expect(404);
    await agent.put('/api/aprendizado/trilhas/construir-linguagem/itens/analise').send({ md5s: ['nao-existe'] }).expect(400);
    await agent.put('/api/aprendizado/trilhas/construir-linguagem/itens/analise').send({ md5s: ['abc123', 'abc123'] }).expect(400);
  });

  it('keeps area, notes and trails when the plugin imports again', async () => {
    await seedBook();
    const agent = await login();
    await agent.put('/api/aprendizado/livros/abc123/area').send({ area: 'grafos' }).expect(200);
    await agent.post('/api/aprendizado/notas').send({ md5: 'abc123', texto: 'x' }).expect(201);
    await agent.put('/api/aprendizado/trilhas/ia-do-zero/itens/matematica').send({ md5s: ['abc123'] }).expect(200);
    await sendImport({ books: [{ ...book, title: 'Duna 2' }], stats: pageStats(3) }).expect(200);
    expect((await agent.get('/api/aprendizado/livros/abc123')).body).toMatchObject({ area: 'grafos', notas: [{ texto: 'x' }] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM trilha_livro').get()).toEqual({ n: 1 });
  });
});
