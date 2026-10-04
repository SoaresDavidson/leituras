import type { BookSummary, Investido, MetaAno, RetroPeriodo, RetroTipo, RetroTotais, Retrospectiva } from '@leituras/shared';
import { listBooks } from './books';
import { addDays, dayKey, daysBetween } from './dates';
import type { Db } from './db';
import { SESSION_GAP_SECONDS } from './stats';

export const DEFAULT_META_ANO_PAGINAS = 6000;
export const MAX_OFFSET = 520;
// Books and months with less reading than this give meaningless speeds
const MIN_SECONDS_FOR_PACE = 10 * 60;
const SPEED_MONTHS = 24;

/**
 * Fun equivalences for "Quanto já investi". quantidade = total / valor.
 * - filmes: an average feature film lasts about 2 h.
 * - voos: a direct São Paulo (GRU) to Lisbon (LIS) flight takes about 10 h.
 * - dias: a whole 24 h day.
 * - livros: an average-size book of 300 pages.
 */
export const EQUIVALENCIAS = [
  { id: 'filmes', rotulo: 'filmes de 2 h', base: 'minutos', valor: 120 },
  { id: 'voos', rotulo: 'voos São Paulo–Lisboa', base: 'minutos', valor: 600 },
  { id: 'dias', rotulo: 'dias inteiros sem parar', base: 'minutos', valor: 1440 },
  { id: 'livros', rotulo: 'livros de 300 páginas', base: 'paginas', valor: 300 },
] as const;

// One page_stat row = one page read, like the dashboard totals; rows of missing books are skipped
type Row = { md5: string; start: number; seconds: number; day: string };

function loadRows(db: Db, timeZone: string): Row[] {
  const rows = db.prepare('SELECT book_md5, start_time, duration FROM page_stat JOIN book ON book.md5 = page_stat.book_md5 ORDER BY start_time').all() as
    { book_md5: string; start_time: number; duration: number }[];
  return rows.map((r) => ({ md5: r.book_md5, start: r.start_time, seconds: r.duration, day: dayKey(r.start_time, timeZone) }));
}

const minutes = (seconds: number) => Math.round(seconds / 60);
const pagesPerHour = (pages: number, seconds: number) => Math.round(pages / (seconds / 3600));

export function readMetaAnoPaginas(db: Db): number {
  const row = db.prepare("SELECT value FROM setting WHERE key = 'retrospectiva.meta_ano_paginas'").get() as { value: string } | undefined;
  return Number(row?.value ?? DEFAULT_META_ANO_PAGINAS);
}

export function updateRetroSettings(db: Db, patch: { metaAnoPaginas: number }): void {
  db.prepare("INSERT INTO setting (key, value) VALUES ('retrospectiva.meta_ano_paginas', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(patch.metaAnoPaginas));
}

// Week = Monday..Sunday; offset 0 = the period containing `today`
export function periodRange(tipo: RetroTipo, offset: number, today: string): { inicio: string; fim: string } {
  if (tipo === 'semana') {
    const sinceMonday = (new Date(Date.parse(today)).getUTCDay() + 6) % 7;
    const inicio = addDays(today, -sinceMonday - 7 * offset);
    return { inicio, fim: addDays(inicio, 6) };
  }
  const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - offset;
  const first = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
  return { inicio: first(index), fim: addDays(first(index + 1), -1) };
}

function totals(rows: Row[], finished: BookSummary[]): RetroTotais {
  return {
    minutos: minutes(rows.reduce((sum, r) => sum + r.seconds, 0)),
    paginas: rows.length,
    diasLidos: new Set(rows.map((r) => r.day)).size,
    livrosTocados: new Set(rows.map((r) => r.md5)).size,
    livrosTerminados: finished.length,
  };
}

// Sessions per book, same gap rule as stats.ts; each one belongs to the day it starts
function sessions(rows: Row[]): { md5: string; day: string; seconds: number }[] {
  const result: { md5: string; day: string; seconds: number }[] = [];
  const open = new Map<string, { session: (typeof result)[number]; end: number }>();
  for (const r of rows) {
    const current = open.get(r.md5);
    if (current && r.start - current.end <= SESSION_GAP_SECONDS) {
      current.session.seconds += r.seconds;
      current.end = r.start + r.seconds;
    } else {
      const session = { md5: r.md5, day: r.day, seconds: r.seconds };
      result.push(session);
      open.set(r.md5, { session, end: r.start + r.seconds });
    }
  }
  return result;
}

export function getRetroPeriodo(db: Db, tipo: RetroTipo, offset: number, timeZone: string, now = Date.now()): RetroPeriodo {
  const today = dayKey(now / 1000, timeZone);
  const books = new Map(listBooks(db, timeZone, now).map((b) => [b.md5, b]));
  const rows = loadRows(db, timeZone).filter((r) => books.has(r.md5));
  const within = (day: string | null, r: { inicio: string; fim: string }) => day != null && day >= r.inicio && day <= r.fim;
  const finishedIn = (r: { inicio: string; fim: string }) => [...books.values()].filter((b) => b.status === 'lido' && within(b.finishedAt, r));

  const range = periodRange(tipo, offset, today);
  const prev = periodRange(tipo, offset + 1, today);
  const inRange = rows.filter((r) => within(r.day, range));
  const finished = finishedIn(range);

  const byDay = new Map<string, number>();
  for (const r of inRange) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.seconds);
  const [bestDay] = [...byDay].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const [longest] = sessions(rows).filter((s) => within(s.day, range)).sort((a, b) => b.seconds - a.seconds || a.day.localeCompare(b.day));

  const byBook = new Map<string, { seconds: number; pages: number }>();
  for (const r of inRange) {
    const acc = byBook.get(r.md5) ?? { seconds: 0, pages: 0 };
    acc.seconds += r.seconds;
    acc.pages++;
    byBook.set(r.md5, acc);
  }
  const livros = [...byBook]
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .flatMap(([md5, acc]) => {
      const book = books.get(md5);
      return book ? [{ book, minutos: minutes(acc.seconds), paginas: acc.pages, terminou: finished.some((b) => b.md5 === md5) }] : [];
    });
  const longestBook = longest && books.get(longest.md5);

  return {
    tipo,
    offset,
    ...range,
    totais: totals(inRange, finished),
    anterior: { ...prev, ...totals(rows.filter((r) => within(r.day, prev)), finishedIn(prev)) },
    melhorDia: bestDay ? { date: bestDay[0], minutos: minutes(bestDay[1]) } : null,
    maiorSessao: longest && longestBook ? { date: longest.day, minutos: minutes(longest.seconds), book: longestBook } : null,
    livros,
  };
}

function investido(rows: Row[]): Investido {
  const seconds = rows.reduce((sum, r) => sum + r.seconds, 0);
  const totalsByBase = { minutos: seconds / 60, paginas: rows.length };
  return {
    minutos: minutes(seconds),
    paginas: rows.length,
    equivalencias: EQUIVALENCIAS.map(({ id, rotulo, base, valor }) => ({
      id,
      rotulo,
      quantidade: Math.round((totalsByBase[base] / valor) * 10) / 10,
    })),
  };
}

function metaAno(rows: Row[], metaPaginas: number, today: string): MetaAno {
  const ano = Number(today.slice(0, 4));
  const lidas = rows.filter((r) => r.day.startsWith(String(ano))).length;
  const restantes = Math.max(0, metaPaginas - lidas);
  const diasRestantes = daysBetween(today, `${ano}-12-31`) + 1;
  const diasNoAno = daysBetween(`${ano}-01-01`, `${ano + 1}-01-01`);
  const esperadoHoje = Math.round((metaPaginas * (daysBetween(`${ano}-01-01`, today) + 1)) / diasNoAno);
  return {
    ano,
    metaPaginas,
    lidas,
    restantes,
    diasRestantes,
    paginasPorDia: Math.ceil(restantes / diasRestantes),
    esperadoHoje,
    diferenca: lidas - esperadoHoje,
  };
}

export function getRetrospectiva(db: Db, timeZone: string, now = Date.now()): Retrospectiva {
  const today = dayKey(now / 1000, timeZone);
  const rows = loadRows(db, timeZone);
  const books = listBooks(db, timeZone, now);

  const years = [...new Set(rows.map((r) => Number(r.day.slice(0, 4))))].sort((a, b) => b - a);
  const anos = years.map((ano) => ({ ano, ...investido(rows.filter((r) => r.day.startsWith(String(ano)))) }));

  const byBook = new Map<string, { seconds: number; pages: number }>();
  const byMonth = new Map<string, { seconds: number; pages: number }>();
  for (const r of rows) {
    for (const [map, key] of [[byBook, r.md5], [byMonth, r.day.slice(0, 7)]] as const) {
      const acc = map.get(key) ?? { seconds: 0, pages: 0 };
      acc.seconds += r.seconds;
      acc.pages++;
      map.set(key, acc);
    }
  }

  // listBooks is already sorted by most recently read
  const ritmoLivros = books
    .filter((b) => (byBook.get(b.md5)?.seconds ?? 0) >= MIN_SECONDS_FOR_PACE)
    .map((book) => {
      const { seconds, pages } = byBook.get(book.md5)!;
      return { book, minutos: minutes(seconds), paginas: pages, paginasPorHora: pagesPerHour(pages, seconds) };
    });

  const monthIndex = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  const velocidadeMensal = Array.from({ length: SPEED_MONTHS }, (_, i) => {
    const index = monthIndex - (SPEED_MONTHS - 1) + i;
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    const acc = byMonth.get(month);
    return { month, paginasPorHora: acc && acc.seconds >= MIN_SECONDS_FOR_PACE ? pagesPerHour(acc.pages, acc.seconds) : null };
  });

  return {
    investimento: { total: investido(rows), anos },
    meta: metaAno(rows, readMetaAnoPaginas(db), today),
    ritmoLivros,
    velocidadeMensal,
  };
}
