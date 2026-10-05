import { createHash } from 'node:crypto';
import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { importPluginData } from './books';
import type { Db } from './db';

const DEVICE = { id: 'seed-kindle', model: 'Kindle Paperwhite (seed)' };

// [title, authors, pages, share of the book read (1 = finished), tipo, read in the last weeks (shows under Abertos)]
const BOOKS: [string, string, number, number, 'estudo' | 'ficcao', boolean?][] = [
  ['Dom Casmurro', 'Machado de Assis', 256, 1, 'ficcao'],
  ['Memórias Póstumas de Brás Cubas', 'Machado de Assis', 288, 1, 'ficcao'],
  ['Vidas Secas', 'Graciliano Ramos', 176, 1, 'ficcao'],
  ['A Hora da Estrela', 'Clarice Lispector', 88, 1, 'ficcao'],
  ['Grande Sertão: Veredas', 'João Guimarães Rosa', 624, 0.42, 'ficcao', true],
  ['O Cortiço', 'Aluísio Azevedo', 304, 0.18, 'ficcao'],
  ['Clean Code', 'Robert C. Martin', 464, 1, 'estudo'],
  ['Designing Data-Intensive Applications', 'Martin Kleppmann', 616, 0.63, 'estudo', true],
  ['The Pragmatic Programmer', 'David Thomas, Andrew Hunt', 352, 1, 'estudo'],
  ['Structure and Interpretation of Computer Programs', 'Harold Abelson, Gerald Jay Sussman', 657, 0.09, 'estudo'],
  ['Rápido e Devagar', 'Daniel Kahneman', 608, 0.77, 'estudo'],
  ['Sapiens', 'Yuval Noah Harari', 472, 1, 'estudo'],
];

// Deterministic PRNG (mulberry32): the same seed always yields the same history
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fills an empty database with fake books and ~14 months of page stats, through the same path as a plugin import. */
export function seed(db: Db, now = Date.now()): { books: number; stats: number } {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM book').get() as { n: number };
  if (n > 0) throw new Error(`O banco já tem ${n} livro(s); o seed só roda em banco vazio.`);

  const rand = rng(42);
  const day = 86_400;
  const end = Math.floor(now / 1000);
  // Books are read one after another, spread from ~420 days ago up to today
  let cursor = end - 420 * day;
  const span = (420 * day) / BOOKS.filter((b) => !b[5]).length;

  const books: PluginBook[] = [];
  const stats: PluginPageStat[] = [];
  BOOKS.forEach(([title, authors, pages, share, , recente], i) => {
    const md5 = createHash('md5').update(title).digest('hex');
    const target = Math.round(pages * share);
    let page = 1;
    // Current reads run over the last ~3 weeks, alongside the sequential history
    let t = recente ? end - 21 * day : cursor;
    while (page <= target && t < end) {
      // Skip some days entirely so the heatmap has gaps
      if (rand() < 0.3) { t += day; continue; }
      // One evening session of 5–60 pages, ~40–120 s per page
      let s = t + (19 + Math.floor(rand() * 4)) * 3600;
      const len = 5 + Math.floor(rand() * 55);
      for (let k = 0; k < len && page <= target && s < end; k++, page++) {
        const duration = 40 + Math.floor(rand() * 80);
        stats.push({ book_md5: md5, device_id: DEVICE.id, page, start_time: s, duration, total_pages: pages });
        s += duration;
      }
      t += day;
    }
    books.push({ id: i + 1, md5, title, authors, series: '', language: 'pt', pages, last_open: t });
    if (!recente) cursor = Math.max(cursor + span, t);
  });

  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO device (id, model) VALUES (?, ?)').run(DEVICE.id, DEVICE.model);
    importPluginData(db, books, stats);
    // tipo is user-owned (imports never set it): fill it the way the user would in the UI
    const setTipo = db.prepare('UPDATE book SET tipo = ? WHERE md5 = ?');
    BOOKS.forEach(([, , , , tipo], i) => setTipo.run(tipo, books[i].md5));
  })();
  return { books: books.length, stats: stats.length };
}
