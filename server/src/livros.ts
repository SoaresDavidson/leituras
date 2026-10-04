import type { BlacklistEntry, LivroExtras, Livros, Metadados, MetadadosPatch, PluginBook, PluginPageStat } from '@leituras/shared';
import { rm } from 'node:fs/promises';
import { listBooks } from './books';
import { coverPath } from './covers';
import type { Db } from './db';

const METADATA_TIMEOUT_MS = 8000;
const MAX_ASSUNTOS = 8;
const MAX_ASSUNTOS_PATCH = 50;
const MAX_ASSUNTO_LEN = 200;

const bookExists = (db: Db, md5: string) => db.prepare('SELECT 1 FROM book WHERE md5 = ?').get(md5) !== undefined;

export function getLivros(db: Db, timeZone: string, now = Date.now()): Livros {
  const maisTarde = new Set((db.prepare('SELECT md5 FROM mais_tarde').all() as { md5: string }[]).map((r) => r.md5));
  const blacklist = db
    .prepare('SELECT md5, title, authors, excluido_em AS excluidoEm FROM blacklist ORDER BY excluido_em DESC, rowid DESC')
    .all() as BlacklistEntry[];
  return {
    books: listBooks(db, timeZone, now).map((b) => ({ ...b, maisTarde: maisTarde.has(b.md5) })),
    blacklist,
  };
}

export function getLivroExtras(db: Db, md5: string): LivroExtras | undefined {
  const row = db
    .prepare('SELECT b.ano_publicacao AS ano, m.md5 IS NOT NULL AS mt FROM book b LEFT JOIN mais_tarde m ON m.md5 = b.md5 WHERE b.md5 = ?')
    .get(md5) as { ano: number | null; mt: number } | undefined;
  return row && { maisTarde: row.mt === 1, anoPublicacao: row.ano };
}

export function setMaisTarde(db: Db, md5: string, maisTarde: boolean, today: string): boolean {
  if (!bookExists(db, md5)) return false;
  if (maisTarde) db.prepare('INSERT OR IGNORE INTO mais_tarde (md5, adicionado_em) VALUES (?, ?)').run(md5, today);
  else db.prepare('DELETE FROM mais_tarde WHERE md5 = ?').run(md5);
  return true;
}

// Deletes the book (stats, fila and mais_tarde cascade) and blacklists its md5 so imports skip it
export async function deleteBook(db: Db, md5: string, today: string, dataPath: string): Promise<boolean> {
  const deleted = db.transaction(() => {
    const book = db.prepare('SELECT title, authors FROM book WHERE md5 = ?').get(md5) as { title: string; authors: string } | undefined;
    if (!book) return false;
    db.prepare('INSERT OR REPLACE INTO blacklist (md5, title, authors, excluido_em) VALUES (?, ?, ?, ?)').run(md5, book.title, book.authors, today);
    db.prepare('DELETE FROM book WHERE md5 = ?').run(md5);
    return true;
  })();
  if (!deleted) return false;
  await rm(coverPath(dataPath, md5), { force: true }).catch(() => {});
  return true;
}

export function removeFromBlacklist(db: Db, md5: string): boolean {
  return db.prepare('DELETE FROM blacklist WHERE md5 = ?').run(md5).changes > 0;
}

const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Returns null when an item is not an object (the route answers 400)
export function dropBlacklisted(db: Db, books: PluginBook[], stats: PluginPageStat[]): { books: PluginBook[]; stats: PluginPageStat[] } | null {
  if (!books.every(isObject) || !stats.every(isObject)) return null;
  const blocked = new Set((db.prepare('SELECT md5 FROM blacklist').all() as { md5: string }[]).map((r) => r.md5));
  if (blocked.size === 0) return { books, stats };
  return { books: books.filter((b) => !blocked.has(b.md5)), stats: stats.filter((s) => !blocked.has(s.book_md5)) };
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
const positiveInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

// Open Library lookup by title and first author; throws on network error, timeout or non-2xx
export async function fetchMetadados(db: Db, md5: string, fetchFn: typeof fetch = fetch): Promise<Metadados | null | undefined> {
  const book = db.prepare('SELECT title, authors FROM book WHERE md5 = ?').get(md5) as { title: string; authors: string } | undefined;
  if (!book) return undefined;
  const params = new URLSearchParams({
    title: book.title,
    limit: '1',
    fields: 'title,author_name,number_of_pages_median,first_publish_year,subject',
  });
  if (book.authors) params.set('author', book.authors.split('\n')[0]);
  const res = await fetchFn(`https://openlibrary.org/search.json?${params}`, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open Library HTTP ${res.status}`);
  // Malformed fields are dropped, never trusted
  const docs = ((await res.json()) as { docs?: unknown } | null)?.docs;
  const doc = Array.isArray(docs) ? docs[0] : undefined;
  if (!isObject(doc)) return null;
  const d = doc as Record<string, unknown>;
  return {
    titulo: typeof d.title === 'string' ? d.title : '',
    autores: strings(d.author_name).join('\n'),
    paginas: positiveInt(d.number_of_pages_median),
    anoPublicacao: positiveInt(d.first_publish_year),
    assuntos: strings(d.subject).slice(0, MAX_ASSUNTOS),
  };
}

const isIntIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function parseMetadadosPatch(body: unknown): MetadadosPatch | null {
  if (typeof body !== 'object' || body === null) return null;
  const { authors, pages, anoPublicacao, assuntos } = body as Record<string, unknown>;
  const patch: MetadadosPatch = {};
  if (authors !== undefined) {
    if (typeof authors !== 'string' || !authors.trim()) return null;
    patch.authors = authors.trim();
  }
  if (pages !== undefined) { if (!isIntIn(pages, 1, 100_000)) return null; patch.pages = pages as number; }
  if (anoPublicacao !== undefined) { if (!isIntIn(anoPublicacao, 1, 9999)) return null; patch.anoPublicacao = anoPublicacao as number; }
  if (assuntos !== undefined) {
    if (!Array.isArray(assuntos) || assuntos.length > MAX_ASSUNTOS_PATCH) return null;
    if (!assuntos.every((a) => typeof a === 'string' && a.length <= MAX_ASSUNTO_LEN)) return null;
    patch.assuntos = assuntos;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

// Subjects are appended to topicos one per line, skipping blanks and lines already there (case-insensitive)
export function applyMetadados(db: Db, md5: string, patch: MetadadosPatch): boolean {
  const row = db.prepare('SELECT topicos FROM book WHERE md5 = ?').get(md5) as { topicos: string } | undefined;
  if (!row) return false;
  const sets: string[] = [];
  const values: Record<string, unknown> = { md5 };
  if (patch.authors !== undefined) { sets.push('authors = @authors'); values.authors = patch.authors; }
  if (patch.pages !== undefined) { sets.push('pages = @pages'); values.pages = patch.pages; }
  if (patch.anoPublicacao !== undefined) { sets.push('ano_publicacao = @ano'); values.ano = patch.anoPublicacao; }
  if (patch.assuntos !== undefined) {
    const seen = new Set(row.topicos.split('\n').map((l) => l.trim().toLowerCase()));
    const added: string[] = [];
    for (const a of patch.assuntos.map((s) => s.trim()).filter(Boolean)) {
      if (!seen.has(a.toLowerCase())) { added.push(a); seen.add(a.toLowerCase()); }
    }
    const base = row.topicos.trimEnd();
    sets.push('topicos = @topicos');
    values.topicos = added.length === 0 ? row.topicos : [...(base ? [base] : []), ...added].join('\n');
  }
  db.prepare(`UPDATE book SET ${sets.join(', ')} WHERE md5 = @md5`).run(values);
  return true;
}
