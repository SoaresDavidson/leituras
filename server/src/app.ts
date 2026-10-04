import type { BookPatch, HabitoPatch, PluginDevicePayload, PluginImportPayload, ReadingStatus } from '@leituras/shared';
import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { checkPassword, createSession, destroySession, loginRateLimit, requireSession } from './auth';
import { getBook, getDashboard, importPluginData, listBooks, updateBook } from './books';
import type { Config } from './config';
import { coverPath, fetchMissingCovers } from './covers';
import { dayKey } from './dates';
import type { Db } from './db';
import { getFoco, setFila, updateFocoSettings } from './foco';
import { GATILHO_MAX, getHabito, readHabitoSettings, updateHabitoSettings } from './habito';

const STATUSES: ReadingStatus[] = ['lendo', 'lido', 'pausado'];

function parsePatch(body: unknown): BookPatch | null {
  if (typeof body !== 'object' || body === null) return null;
  const { categoria, topicos, statusManual, arquivado } = body as Record<string, unknown>;
  const patch: BookPatch = {};
  if (categoria !== undefined) { if (typeof categoria !== 'string') return null; patch.categoria = categoria.trim(); }
  if (topicos !== undefined) { if (typeof topicos !== 'string') return null; patch.topicos = topicos; }
  if (statusManual !== undefined) {
    if (statusManual !== null && !STATUSES.includes(statusManual as ReadingStatus)) return null;
    patch.statusManual = statusManual as ReadingStatus | null;
  }
  if (arquivado !== undefined) { if (typeof arquivado !== 'boolean') return null; patch.arquivado = arquivado; }
  return patch;
}

const isIntIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function parseFocoPatch(body: unknown): { limite?: number; prazoDias?: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { limite, prazoDias } = body as Record<string, unknown>;
  if (limite !== undefined && !isIntIn(limite, 1, 10)) return null;
  if (prazoDias !== undefined && !isIntIn(prazoDias, 7, 365)) return null;
  return { limite: limite as number | undefined, prazoDias: prazoDias as number | undefined };
}

const HABITO_RANGES = { metaDiaMinutos: 600, metaDiaPaginas: 1000, metaMesMinutos: 18000, metaMesPaginas: 30000 } as const;

// Returns an error message (pt-BR) or the parsed patch; `current` is used to reject goals left all at 0
function parseHabitoPatch(body: unknown, current: ReturnType<typeof readHabitoSettings>): HabitoPatch | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'Ajustes inválidos';
  const input = body as Record<string, unknown>;
  const patch: HabitoPatch = {};
  for (const [field, max] of Object.entries(HABITO_RANGES)) {
    const value = input[field];
    if (value === undefined) continue;
    if (!isIntIn(value, 0, max)) return 'Meta inválida';
    patch[field as keyof typeof HABITO_RANGES] = value as number;
  }
  if (input.gatilho !== undefined) {
    if (typeof input.gatilho !== 'string' || input.gatilho.trim().length > GATILHO_MAX) return `O gatilho deve ter até ${GATILHO_MAX} caracteres`;
    patch.gatilho = input.gatilho.trim();
  }
  const { dia, mes } = current.metas;
  if ((patch.metaDiaMinutos ?? dia.minutos) === 0 && (patch.metaDiaPaginas ?? dia.paginas) === 0) return 'A meta do dia precisa de minutos ou páginas';
  if ((patch.metaMesMinutos ?? mes.minutos) === 0 && (patch.metaMesPaginas ?? mes.paginas) === 0) return 'A meta do mês precisa de minutos ou páginas';
  return patch;
}

export function createApp(db: Db, config: Config, options: { fetchCovers?: boolean } = {}) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '50mb' }));

  // ---- KOReader plugin (no auth: the port is published on the LAN IP only, see compose.yaml) ----
  const plugin = express.Router();

  plugin.post('/device', (req: Request, res: Response) => {
    const { id, model } = req.body as Partial<PluginDevicePayload>;
    if (!id || !model) {
      res.status(400).json({ error: 'Missing device ID or model' });
      return;
    }
    db.prepare('INSERT OR IGNORE INTO device (id, model) VALUES (?, ?)').run(id, model);
    res.json({ message: 'Device registered' });
  });

  plugin.post('/import', (req: Request, res: Response) => {
    const { books = [], stats = [] } = req.body as PluginImportPayload;
    if (!Array.isArray(books) || !Array.isArray(stats)) {
      res.status(400).json({ error: 'books and stats must be arrays' });
      return;
    }
    importPluginData(db, books, stats);
    // Respond first: the plugin runs on suspend and should not wait for Open Library
    res.json({ message: 'Upload successful' });
    if (options.fetchCovers !== false) {
      fetchMissingCovers(db, config.dataPath).catch((err) => console.error('Cover fetch failed:', err));
    }
  });

  app.use('/api/plugin', plugin);

  // ---- Auth ----
  app.post('/api/login', loginRateLimit(), async (req: Request, res: Response) => {
    const password = (req.body as { password?: unknown })?.password;
    if (typeof password !== 'string' || !(await checkPassword(db, password))) {
      res.status(401).json({ error: 'Senha incorreta' });
      return;
    }
    createSession(db, res);
    res.status(204).end();
  });

  app.post('/api/logout', (req: Request, res: Response) => {
    destroySession(db, req, res);
    res.status(204).end();
  });

  // ---- Web API (session) ----
  const api = express.Router();
  api.use(requireSession(db));

  api.get('/me', (_req, res) => { res.json({ ok: true }); });

  api.get('/dashboard', (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    res.json(getDashboard(db, year, config.timeZone));
  });

  api.get('/books', (_req, res) => { res.json(listBooks(db, config.timeZone)); });

  api.get('/books/:md5', (req, res) => {
    const book = getBook(db, req.params.md5, config.timeZone);
    if (!book) { res.status(404).json({ error: 'Livro não encontrado' }); return; }
    res.json(book);
  });

  api.patch('/books/:md5', (req, res) => {
    const patch = parsePatch(req.body);
    if (!patch) { res.status(400).json({ error: 'Dados inválidos' }); return; }
    if (!updateBook(db, req.params.md5, patch, dayKey(Date.now() / 1000, config.timeZone))) { res.status(404).json({ error: 'Livro não encontrado' }); return; }
    res.json(getBook(db, req.params.md5, config.timeZone));
  });

  const currentFoco = () => getFoco(db, new Date().getFullYear(), config.timeZone);

  api.put('/fila', (req, res) => {
    const { md5s } = (req.body ?? {}) as { md5s?: unknown };
    if (!Array.isArray(md5s) || !md5s.every((m) => typeof m === 'string')) { res.status(400).json({ error: 'Fila inválida' }); return; }
    const result = setFila(db, md5s);
    if (result === 'unknown') { res.status(400).json({ error: 'Livro não encontrado na fila' }); return; }
    if (result === 'duplicate') { res.status(400).json({ error: 'Livro repetido na fila' }); return; }
    res.json(currentFoco());
  });

  api.patch('/foco', (req, res) => {
    const patch = parseFocoPatch(req.body);
    if (!patch) { res.status(400).json({ error: 'Ajustes inválidos' }); return; }
    updateFocoSettings(db, patch);
    res.json(currentFoco());
  });

  api.get('/habito', (_req, res) => { res.json(getHabito(db, config.timeZone)); });

  api.patch('/habito', (req, res) => {
    const patch = parseHabitoPatch(req.body, readHabitoSettings(db));
    if (typeof patch === 'string') { res.status(400).json({ error: patch }); return; }
    updateHabitoSettings(db, patch);
    res.json(getHabito(db, config.timeZone));
  });

  api.get('/books/:md5/cover', (req, res) => {
    const file = coverPath(config.dataPath, req.params.md5);
    if (!/^[a-f0-9]+$/i.test(req.params.md5) || !existsSync(file)) { res.status(404).end(); return; }
    res.sendFile(file);
  });

  app.use('/api', api);

  // ---- React build ----
  if (existsSync(config.webDistPath)) {
    app.use(express.static(config.webDistPath));
    app.get(/^(?!\/api\/).*/, (_req, res) => { res.sendFile(path.join(config.webDistPath, 'index.html')); });
  }

  return app;
}
