import { PAINEL_ITENS } from '@leituras/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { setPassword } from '../src/auth';
import type { Config } from '../src/config';
import { openDb, type Db } from '../src/db';
import { getPainelConfig, resetPainelConfig, updatePainelConfig } from '../src/painel';

const config: Config = {
  port: 0, host: '127.0.0.1', dataPath: mkdtempSync(path.join(tmpdir(), 'leituras-')), timeZone: 'America/Fortaleza', webDistPath: '/nonexistent',
};
const allOn = Object.fromEntries(PAINEL_ITENS.map((i) => [i, true]));
const saved = (db: Db) => db.prepare("SELECT COUNT(*) AS n FROM setting WHERE key LIKE 'painel.%'").get();

describe('painel config', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('shows everything when nothing is saved', () => {
    expect(getPainelConfig(db)).toEqual(allOn);
  });

  it('persists a partial patch and keeps the other items visible', () => {
    updatePainelConfig(db, { horas: false });
    expect(getPainelConfig(db)).toEqual({ ...allOn, horas: false });
    updatePainelConfig(db, { horas: true, foco: false });
    expect(getPainelConfig(db)).toEqual({ ...allOn, foco: false });
  });

  it('resets to the default by removing saved preferences', () => {
    updatePainelConfig(db, { horas: false, paginas: false });
    resetPainelConfig(db);
    expect(getPainelConfig(db)).toEqual(allOn);
    expect(saved(db)).toEqual({ n: 0 });
  });

  it('ignores corrupt stored values', () => {
    db.prepare("INSERT INTO setting (key, value) VALUES ('painel.horas', 'banana')").run();
    expect(getPainelConfig(db).horas).toBe(true);
  });
});

describe('painel api', () => {
  let db: Db;
  let agent: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request>;
  beforeEach(async () => {
    db = openDb(':memory:');
    await setPassword(db, 'senha-forte-123');
    const app = createApp(db, config, { fetchCovers: false });
    agent = request.agent(app);
    anon = request(app);
    await agent.post('/api/login').send({ password: 'senha-forte-123' }).expect(204);
  });

  it('requires a session', async () => {
    await anon.get('/api/painel/config').expect(401);
    await anon.patch('/api/painel/config').send({ horas: false }).expect(401);
    await anon.delete('/api/painel/config').expect(401);
  });

  it('defaults to all visible, patches, and restores', async () => {
    expect((await agent.get('/api/painel/config').expect(200)).body).toEqual(allOn);
    expect((await agent.patch('/api/painel/config').send({ atividade: false }).expect(200)).body).toEqual({ ...allOn, atividade: false });
    expect((await agent.get('/api/painel/config').expect(200)).body.atividade).toBe(false);
    expect((await agent.delete('/api/painel/config').expect(200)).body).toEqual(allOn);
  });

  it('rejects unknown keys and non-boolean values without saving', async () => {
    for (const body of [{ x: true }, { horas: 'false' }, { horas: 0 }, { horas: null }, [], 'x', { horas: false, x: true }]) {
      await agent.patch('/api/painel/config').send(body as object).expect(400);
    }
    expect(saved(db)).toEqual({ n: 0 });
  });
});
