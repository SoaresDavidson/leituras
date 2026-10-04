import type { BookDetail, BookSummary, Foco, FocoBook } from '@leituras/shared';
import { listBookDetails, toSummary } from './books';
import { addDays, dayKey, daysBetween } from './dates';
import type { Db } from './db';

export const DEFAULT_LIMITE = 2;
export const DEFAULT_PRAZO_DIAS = 45;
export const RETA_FINAL_PROGRESS = 75;
const FORECAST_WINDOW_DAYS = 14;

export function readFocoSettings(db: Db): { limite: number; prazoDias: number } {
  const get = (key: string) => (db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  return {
    limite: Number(get('foco.limite') ?? DEFAULT_LIMITE),
    prazoDias: Number(get('foco.prazo_dias') ?? DEFAULT_PRAZO_DIAS),
  };
}

// Pace = distinct pages gained over the last 14 calendar days, read off the progress timeline
// Progress (0-100) at the end of `day`, read off the progress timeline
export const progressAt = (book: BookDetail, day: string) => [...book.progressTimeline].reverse().find((p) => p.date <= day)?.progress ?? 0;

export function forecast(book: BookDetail, today: string): { previsao: string | null; minutosRestantes: number | null } {
  const since = addDays(today, -FORECAST_WINDOW_DAYS);
  const pagesRecent = (book.pages * (book.progress - progressAt(book, since))) / 100;
  if (book.pages <= 0 || pagesRecent <= 0) return { previsao: null, minutosRestantes: null };

  const minutesRecent = book.daily.filter((d) => d.date > since).reduce((sum, d) => sum + d.minutes, 0);
  const remaining = (book.pages * (100 - book.progress)) / 100;
  return {
    previsao: addDays(today, Math.ceil(remaining / (pagesRecent / FORECAST_WINDOW_DAYS))),
    minutosRestantes: Math.round((remaining * minutesRecent) / pagesRecent),
  };
}

export function getFoco(db: Db, year: number, timeZone: string, now = Date.now()): Foco {
  const today = dayKey(now / 1000, timeZone);
  const { limite, prazoDias } = readFocoSettings(db);
  const details = listBookDetails(db, timeZone, now);
  const summaries = new Map(details.map((d) => [d.md5, toSummary(d)]));

  const isRetaFinal = (b: BookSummary) => Number(b.progress >= RETA_FINAL_PROGRESS);
  const abertos: FocoBook[] = details
    .filter((d) => d.status === 'lendo')
    .map((d) => ({ ...toSummary(d), ...forecast(d, today) }))
    .sort((a, b) => isRetaFinal(b) - isRetaFinal(a) || (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? ''));

  const diasParado = (b: BookSummary) => (b.lastReadAt == null ? null : daysBetween(b.lastReadAt, today));
  const inCemetery = (b: BookSummary) => b.status === 'pausado' && !b.arquivado && (diasParado(b) ?? 0) > prazoDias;
  const cemiterio = [...summaries.values()]
    .filter(inCemetery)
    .map((book) => ({ book, diasParado: diasParado(book)!, vencidoHa: diasParado(book)! - prazoDias }))
    .sort((a, b) => b.vencidoHa - a.vencidoHa);

  const filaRows = db.prepare('SELECT md5 FROM fila ORDER BY posicao').all() as { md5: string }[];
  const fila = filaRows.map(({ md5 }, i) => {
    const book = summaries.get(md5)!;
    return { book, liberado: i === 0 && book.status !== 'lido' && abertos.length < limite };
  });

  const started = [...summaries.values()].filter((b) => b.startedAt?.startsWith(String(year)));
  const lidos = started.filter((b) => b.status === 'lido').length;
  const abandonados = started.filter((b) => b.status !== 'lido' && (b.arquivado || inCemetery(b))).length;
  const total = lidos + abandonados;

  return {
    limite,
    prazoDias,
    abertos,
    fila,
    cemiterio,
    taxaConclusao: { lidos, abandonados, percentual: total === 0 ? null : Math.round((lidos / total) * 100) },
  };
}

// Replaces the whole queue; position = index in `md5s`
export function setFila(db: Db, md5s: string[]): 'ok' | 'unknown' | 'duplicate' {
  if (new Set(md5s).size !== md5s.length) return 'duplicate';
  const exists = db.prepare('SELECT 1 FROM book WHERE md5 = ?');
  if (md5s.some((md5) => exists.get(md5) === undefined)) return 'unknown';
  const insert = db.prepare('INSERT INTO fila (md5, posicao) VALUES (?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM fila').run();
    md5s.forEach((md5, i) => insert.run(md5, i));
  })();
  return 'ok';
}

export function updateFocoSettings(db: Db, patch: { limite?: number; prazoDias?: number }): void {
  const upsert = db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    if (patch.limite !== undefined) upsert.run('foco.limite', String(patch.limite));
    if (patch.prazoDias !== undefined) upsert.run('foco.prazo_dias', String(patch.prazoDias));
  })();
}
