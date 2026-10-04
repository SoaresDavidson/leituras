import type { BookPatch, PluginDevicePayload, PluginImportPayload, ReadingStatus } from '@leituras/shared';
import express, { type Request, type Response } from 'express';
import { addNota, deleteNota, getAprendizado, getLivroAprendizado, revisarNota, setArea, setTrilhaItem } from './aprendizado';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { checkPassword, createSession, destroySession, loginRateLimit, requireSession } from './auth';
import { getBook, getDashboard, importPluginData, listBooks, updateBook } from './books';
import type { Config } from './config';
import { coverPath, fetchMissingCovers } from './covers';
import { dayKey } from './dates';
import type { Db } from './db';
import { getFoco, setFila, updateFocoSettings } from './foco';

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

const MAX_NOTA = 2000;

// Note ids come from the URL; anything that is not a positive integer is an unknown note
const parseId = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : null);

function parseNota(body: unknown): { md5: string; texto: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { md5, texto } = body as Record<string, unknown>;
  if (typeof md5 !== 'string' || typeof texto !== 'string') return null;
  const trimmed = texto.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NOTA) return null;
  return { md5, texto: trimmed };
}

function parseFocoPatch(body: unknown): { limite?: number; prazoDias?: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { limite, prazoDias } = body as Record<string, unknown>;
  if (limite !== undefined && !isIntIn(limite, 1, 10)) return null;
  if (prazoDias !== undefined && !isIntIn(prazoDias, 7, 365)) return null;
  return { limite: limite as number | undefined, prazoDias: prazoDias as number | undefined };
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
    // Lua encodes empty tables as {} on some JSON encoders
    const emptyObjectAsArray = (v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0 ? [] : v;
    const body = req.body as PluginImportPayload;
    const books = emptyObjectAsArray(body.books ?? []) as PluginImportPayload['books'];
    const stats = emptyObjectAsArray(body.stats ?? []) as PluginImportPayload['stats'];
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

  // ---- aprendizado ----
  const today = () => dayKey(Date.now() / 1000, config.timeZone);

  api.get('/aprendizado', (_req, res) => { res.json(getAprendizado(db, config.timeZone)); });

  api.get('/aprendizado/livros/:md5', (req, res) => {
    const livro = getLivroAprendizado(db, req.params.md5);
    if (!livro) { res.status(404).json({ error: 'Livro não encontrado' }); return; }
    res.json(livro);
  });

  api.put('/aprendizado/livros/:md5/area', (req, res) => {
    const { area } = (req.body ?? {}) as { area?: unknown };
    if (area !== null && typeof area !== 'string') { res.status(400).json({ error: 'Área inválida' }); return; }
    const result = setArea(db, req.params.md5, area);
    if (result === 'invalid') { res.status(400).json({ error: 'Área inválida' }); return; }
    if (result === 'not-found') { res.status(404).json({ error: 'Livro não encontrado' }); return; }
    res.json(getLivroAprendizado(db, req.params.md5));
  });

  api.post('/aprendizado/notas', (req, res) => {
    const input = parseNota(req.body);
    if (!input) { res.status(400).json({ error: `Escreva o aprendizado (até ${MAX_NOTA} caracteres)` }); return; }
    const nota = addNota(db, input.md5, input.texto, today());
    if (!nota) { res.status(404).json({ error: 'Livro não encontrado' }); return; }
    res.status(201).json(nota);
  });

  api.delete('/aprendizado/notas/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id == null || !deleteNota(db, id)) { res.status(404).json({ error: 'Aprendizado não encontrado' }); return; }
    res.status(204).end();
  });

  api.post('/aprendizado/notas/:id/revisao', (req, res) => {
    const { lembrei } = (req.body ?? {}) as { lembrei?: unknown };
    const id = parseId(req.params.id);
    if (id == null) { res.status(404).json({ error: 'Aprendizado não encontrado' }); return; }
    if (typeof lembrei !== 'boolean') { res.status(400).json({ error: 'Resposta inválida' }); return; }
    const nota = revisarNota(db, id, lembrei, today());
    if (!nota) { res.status(404).json({ error: 'Aprendizado não encontrado' }); return; }
    res.json(nota);
  });

  api.put('/aprendizado/trilhas/:trilha/itens/:item', (req, res) => {
    const { trilha, item } = req.params;
    const { md5s } = (req.body ?? {}) as { md5s?: unknown };
    if (!Array.isArray(md5s) || !md5s.every((m) => typeof m === 'string')) { res.status(400).json({ error: 'Lista de livros inválida' }); return; }
    const result = setTrilhaItem(db, trilha, item, md5s);
    if (result === 'not-found') { res.status(404).json({ error: 'Item de trilha não encontrado' }); return; }
    if (result === 'unknown') { res.status(400).json({ error: 'Livro não encontrado' }); return; }
    if (result === 'duplicate') { res.status(400).json({ error: 'Livro repetido no item' }); return; }
    res.json(getAprendizado(db, config.timeZone).trilhas.find((t) => t.id === trilha));
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
