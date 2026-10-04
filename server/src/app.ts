import type { BookPatch, PluginDevicePayload, PluginImportPayload, ReadingStatus } from '@leituras/shared';
import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { checkPassword, createSession, destroySession, loginRateLimit, requireSession } from './auth';
import { getBook, getDashboard, importPluginData, listBooks, updateBook } from './books';
import type { Config } from './config';
import { coverPath, fetchMissingCovers } from './covers';
import type { Db } from './db';

const STATUSES: ReadingStatus[] = ['lendo', 'lido', 'pausado'];

function parsePatch(body: unknown): BookPatch | null {
  if (typeof body !== 'object' || body === null) return null;
  const { categoria, topicos, statusManual } = body as Record<string, unknown>;
  const patch: BookPatch = {};
  if (categoria !== undefined) { if (typeof categoria !== 'string') return null; patch.categoria = categoria.trim(); }
  if (topicos !== undefined) { if (typeof topicos !== 'string') return null; patch.topicos = topicos; }
  if (statusManual !== undefined) {
    if (statusManual !== null && !STATUSES.includes(statusManual as ReadingStatus)) return null;
    patch.statusManual = statusManual as ReadingStatus | null;
  }
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
    if (!updateBook(db, req.params.md5, patch)) { res.status(404).json({ error: 'Livro não encontrado' }); return; }
    res.json(getBook(db, req.params.md5, config.timeZone));
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
