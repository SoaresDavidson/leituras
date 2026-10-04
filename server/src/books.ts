import type { BookDetail, BookPatch, BookSummary, Dashboard, PluginBook, PluginPageStat, ReadingStatus } from '@leituras/shared';
import { addDays, dayKey } from './dates';
import type { Db } from './db';
import { computeBookStats, computeStatus, type StatRow } from './stats';

type BookRow = {
  md5: string;
  title: string;
  authors: string;
  series: string;
  pages: number;
  categoria: string;
  status_manual: ReadingStatus | null;
  topicos: string;
  cover_status: string;
  arquivado_em: string | null;
};

export function importPluginData(db: Db, books: PluginBook[], stats: PluginPageStat[]): void {
  // User-owned columns (categoria, status_manual, topicos) are never in the UPDATE list
  const upsertBook = db.prepare(`
    INSERT INTO book (md5, title, authors, series, language, pages, last_open)
    VALUES (@md5, @title, @authors, @series, @language, @pages, @last_open)
    ON CONFLICT(md5) DO UPDATE SET
      title = excluded.title, authors = excluded.authors, series = excluded.series,
      language = excluded.language, pages = excluded.pages,
      last_open = MAX(book.last_open, excluded.last_open)
  `);
  // The plugin resends its whole history on every sync: duplicates are ignored
  const insertStat = db.prepare(`
    INSERT OR IGNORE INTO page_stat (book_md5, device_id, page, start_time, duration, total_pages)
    VALUES (@book_md5, @device_id, @page, @start_time, @duration, @total_pages)
  `);

  db.transaction(() => {
    for (const b of books) {
      upsertBook.run({
        md5: b.md5,
        title: b.title || 'Sem título',
        authors: b.authors ?? '',
        series: b.series ?? '',
        language: b.language ?? '',
        pages: b.pages ?? 0,
        last_open: b.last_open ?? 0,
      });
    }
    const known = new Set((db.prepare('SELECT md5 FROM book').all() as { md5: string }[]).map((r) => r.md5));
    for (const s of stats) {
      if (known.has(s.book_md5)) insertStat.run(s);
    }
  })();
}

function loadBooks(db: Db, md5?: string): BookRow[] {
  const sql = 'SELECT md5, title, authors, series, pages, categoria, status_manual, topicos, cover_status, arquivado_em FROM book';
  return (md5 ? db.prepare(`${sql} WHERE md5 = ?`).all(md5) : db.prepare(sql).all()) as BookRow[];
}

function loadStats(db: Db, md5: string): StatRow[] {
  return db.prepare('SELECT page, start_time, duration, total_pages FROM page_stat WHERE book_md5 = ?').all(md5) as StatRow[];
}

function buildDetail(db: Db, row: BookRow, timeZone: string, today: string): BookDetail {
  const stats = computeBookStats(loadStats(db, row.md5), row.pages, timeZone);
  return {
    md5: row.md5,
    title: row.title,
    authors: row.authors,
    series: row.series,
    pages: row.pages,
    progress: stats.progress,
    status: computeStatus({ progress: stats.progress, lastReadAt: stats.lastReadAt, today, statusManual: row.status_manual }),
    statusManual: row.status_manual,
    categoria: row.categoria,
    startedAt: stats.startedAt,
    finishedAt: stats.finishedAt,
    lastReadAt: stats.lastReadAt,
    totalMinutes: Math.round(stats.totalSeconds / 60),
    hasCover: row.cover_status === 'ok',
    arquivado: row.arquivado_em != null && (stats.lastReadAt == null || stats.lastReadAt <= row.arquivado_em),
    topicos: row.topicos,
    sessions: stats.sessions,
    daily: [...stats.daily].map(([date, seconds]) => ({ date, minutes: Math.round(seconds / 60) })),
    progressTimeline: stats.progressTimeline,
  };
}

function toSummary({ topicos, sessions, daily, progressTimeline, ...summary }: BookDetail): BookSummary {
  return summary;
}

export function listBooks(db: Db, timeZone: string, now = Date.now()): BookSummary[] {
  const today = dayKey(now / 1000, timeZone);
  return loadBooks(db)
    .map((row) => toSummary(buildDetail(db, row, timeZone, today)))
    .sort((a, b) => (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? ''));
}

export function getBook(db: Db, md5: string, timeZone: string, now = Date.now()): BookDetail | undefined {
  const [row] = loadBooks(db, md5);
  return row && buildDetail(db, row, timeZone, dayKey(now / 1000, timeZone));
}

export function updateBook(db: Db, md5: string, patch: BookPatch, today: string): boolean {
  const sets: string[] = [];
  const values: Record<string, unknown> = { md5 };
  if (patch.categoria !== undefined) { sets.push('categoria = @categoria'); values.categoria = patch.categoria; }
  if (patch.topicos !== undefined) { sets.push('topicos = @topicos'); values.topicos = patch.topicos; }
  if (patch.statusManual !== undefined) { sets.push('status_manual = @status'); values.status = patch.statusManual; }
  if (patch.arquivado !== undefined) { sets.push('arquivado_em = @arquivado'); values.arquivado = patch.arquivado ? today : null; }
  if (sets.length === 0) return db.prepare('SELECT 1 FROM book WHERE md5 = ?').get(md5) !== undefined;
  return db.prepare(`UPDATE book SET ${sets.join(', ')} WHERE md5 = @md5`).run(values).changes > 0;
}

export function getDashboard(db: Db, year: number, timeZone: string, now = Date.now()): Dashboard {
  const today = dayKey(now / 1000, timeZone);
  const yearPrefix = String(year);

  const minutesByDay = new Map<string, number>();
  for (const row of db.prepare('SELECT start_time, duration FROM page_stat').all() as { start_time: number; duration: number }[]) {
    const day = dayKey(row.start_time, timeZone);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + row.duration / 60);
  }
  const pagesThisYear = (db.prepare('SELECT start_time FROM page_stat').all() as { start_time: number }[])
    .filter((r) => dayKey(r.start_time, timeZone).startsWith(yearPrefix)).length;

  const books = listBooks(db, timeZone, now);
  const finished = books.filter((b) => b.status === 'lido' && b.finishedAt?.startsWith(yearPrefix));

  const daily = Array.from({ length: 365 }, (_, i) => {
    const date = addDays(today, i - 364);
    return { date, minutes: Math.round(minutesByDay.get(date) ?? 0) };
  });

  const finishedPerMonth = Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { month, count: finished.filter((b) => b.finishedAt!.startsWith(month)).length };
  });

  const yearMinutes = [...minutesByDay].filter(([d]) => d.startsWith(yearPrefix)).reduce((sum, [, m]) => sum + m, 0);

  return {
    year,
    totals: { booksFinished: finished.length, minutes: Math.round(yearMinutes), pages: pagesThisYear },
    daily,
    finishedPerMonth,
    readingNow: books.filter((b) => b.status === 'lendo'),
  };
}
