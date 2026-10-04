import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPluginData } from '../src/books';
import { openDb, type Db } from '../src/db';
import { getRetroPeriodo, getRetrospectiva, periodRange, updateRetroSettings } from '../src/retrospectiva';

const TZ = 'America/Fortaleza';
const NOW = Date.parse('2026-10-03T15:00:00Z'); // Saturday, noon in Fortaleza

let db: Db;

const mkBook = (md5: string, pages: number): PluginBook => ({
  id: 0, md5, title: md5, authors: '', series: '', language: 'pt', pages, last_open: 0,
});

// Pages `from..to` of `md5` on `day`, starting at `at` UTC, `secs` seconds each, back to back
function read(md5: string, pages: number, day: string, from: number, to: number, at = '15:00', secs = 60): PluginPageStat[] {
  const base = Date.parse(`${day}T${at}:00Z`) / 1000;
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    book_md5: md5, device_id: 'kindle', page: from + i, start_time: base + i * secs, duration: secs, total_pages: pages,
  }));
}

const periodo = (tipo: 'semana' | 'mes', offset = 0) => getRetroPeriodo(db, tipo, offset, TZ, NOW);
const retro = () => getRetrospectiva(db, TZ, NOW);

beforeEach(() => {
  db = openDb(':memory:');
});

describe('periodRange', () => {
  it('uses Monday-to-Sunday weeks and calendar months', () => {
    expect(periodRange('semana', 0, '2026-10-03')).toEqual({ inicio: '2026-09-28', fim: '2026-10-04' });
    expect(periodRange('semana', 1, '2026-10-03')).toEqual({ inicio: '2026-09-21', fim: '2026-09-27' });
    expect(periodRange('semana', 0, '2026-09-28')).toEqual({ inicio: '2026-09-28', fim: '2026-10-04' });
    expect(periodRange('semana', 0, '2026-10-04')).toEqual({ inicio: '2026-09-28', fim: '2026-10-04' });
    expect(periodRange('mes', 0, '2026-10-03')).toEqual({ inicio: '2026-10-01', fim: '2026-10-31' });
    expect(periodRange('mes', 1, '2026-10-03')).toEqual({ inicio: '2026-09-01', fim: '2026-09-30' });
    expect(periodRange('mes', 10, '2026-10-03')).toEqual({ inicio: '2025-12-01', fim: '2025-12-31' });
    expect(periodRange('mes', 8, '2026-03-15')).toEqual({ inicio: '2025-07-01', fim: '2025-07-31' });
    expect(periodRange('mes', 1, '2024-03-31')).toEqual({ inicio: '2024-02-01', fim: '2024-02-29' });
  });
});

describe('getRetroPeriodo', () => {
  function seedWeek() {
    importPluginData(db, [mkBook('A', 100), mkBook('B', 10)], [
      ...read('A', 100, '2026-09-22', 41, 60),
      ...read('A', 100, '2026-09-29', 1, 10),
      ...read('B', 10, '2026-09-30', 1, 10),
      ...read('A', 100, '2026-10-01', 11, 40),
    ]);
  }

  it('sums the period and the previous one', () => {
    seedWeek();
    const p = periodo('semana');
    expect(p).toMatchObject({ tipo: 'semana', offset: 0, inicio: '2026-09-28', fim: '2026-10-04' });
    expect(p.totais).toEqual({ minutos: 50, paginas: 50, diasLidos: 3, livrosTocados: 2, livrosTerminados: 1 });
    expect(p.anterior).toEqual({ inicio: '2026-09-21', fim: '2026-09-27', minutos: 20, paginas: 20, diasLidos: 1, livrosTocados: 1, livrosTerminados: 0 });
    expect(p.livros.map((l) => [l.book.md5, l.minutos, l.paginas, l.terminou])).toEqual([['A', 40, 40, false], ['B', 10, 10, true]]);
  });

  it('finds the best day and the longest session', () => {
    seedWeek();
    const p = periodo('semana');
    expect(p.melhorDia).toEqual({ date: '2026-10-01', minutos: 30 });
    expect(p.maiorSessao).toMatchObject({ date: '2026-10-01', minutos: 30, book: { md5: 'A' } });
  });

  it('splits sessions on gaps longer than 30 minutes', () => {
    importPluginData(db, [mkBook('A', 100)], [
      ...read('A', 100, '2026-09-29', 1, 5, '15:00'),
      ...read('A', 100, '2026-09-29', 6, 8, '15:36'),
      ...read('A', 100, '2026-09-30', 9, 12, '15:00'),
      ...read('A', 100, '2026-09-30', 13, 15, '15:20'),
    ]);
    expect(periodo('semana').maiorSessao).toMatchObject({ date: '2026-09-30', minutos: 7 });
  });

  it('returns nulls for an empty period', () => {
    const p = periodo('mes', 3);
    expect(p).toMatchObject({ inicio: '2026-07-01', fim: '2026-07-31', melhorDia: null, maiorSessao: null, livros: [] });
    expect(p.totais).toEqual({ minutos: 0, paginas: 0, diasLidos: 0, livrosTocados: 0, livrosTerminados: 0 });
  });

  it('counts days in the configured time zone', () => {
    // 23:30 on Sunday 2026-09-27 in Fortaleza is already Monday in UTC
    importPluginData(db, [mkBook('A', 100)], read('A', 100, '2026-09-28', 1, 5, '02:30'));
    expect(periodo('semana').totais.minutos).toBe(0);
    expect(periodo('semana', 1).totais.minutos).toBe(5);
    expect(periodo('semana', 1).melhorDia?.date).toBe('2026-09-27');
  });

  it('groups by calendar month', () => {
    seedWeek();
    expect(periodo('mes').totais).toMatchObject({ minutos: 30, diasLidos: 1, livrosTocados: 1 });
    expect(periodo('mes').anterior).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-30', minutos: 40, diasLidos: 3, livrosTocados: 2, livrosTerminados: 1 });
    expect(periodo('mes', 1).anterior).toMatchObject({ inicio: '2026-08-01', fim: '2026-08-31', minutos: 0 });
  });
});

describe('getRetrospectiva', () => {
  function seedYears() {
    importPluginData(db, [mkBook('A', 300)], [...read('A', 300, '2025-06-10', 1, 180), ...read('A', 300, '2026-03-01', 181, 240)]);
  }

  it('totals the investment all-time and per year with equivalences', () => {
    seedYears();
    const { investimento } = retro();
    expect(investimento.total).toMatchObject({ minutos: 240, paginas: 240 });
    const q = Object.fromEntries(investimento.total.equivalencias.map((e) => [e.id, e.quantidade]));
    expect(q).toEqual({ filmes: 2, voos: 0.4, dias: 0.2, livros: 0.8 });
    expect(investimento.anos.map((a) => [a.ano, a.minutos, a.paginas])).toEqual([[2026, 60, 60], [2025, 180, 180]]);
  });

  it('computes pages per day to reach the yearly goal and the linear pace', () => {
    seedYears();
    expect(retro().meta).toEqual({
      ano: 2026, metaPaginas: 6000, lidas: 60, restantes: 5940, diasRestantes: 90, paginasPorDia: 66,
      esperadoHoje: 4537, diferenca: -4477,
    });
    updateRetroSettings(db, { metaAnoPaginas: 100 });
    expect(retro().meta).toMatchObject({ metaPaginas: 100, restantes: 40, paginasPorDia: 1, esperadoHoje: 76, diferenca: -16 });
  });

  it('never asks for negative pages once the goal is reached', () => {
    importPluginData(db, [mkBook('A', 300)], read('A', 300, '2026-03-01', 1, 150));
    updateRetroSettings(db, { metaAnoPaginas: 100 });
    expect(retro().meta).toMatchObject({ lidas: 150, restantes: 0, paginasPorDia: 0, diferenca: 74 });
  });

  it('computes pages per hour per book, ignoring books with under 10 minutes', () => {
    seedYears();
    importPluginData(db, [mkBook('C', 50), mkBook('D', 50)], [
      ...read('C', 50, '2026-09-01', 1, 5),
      ...read('D', 50, '2026-09-10', 1, 30, '15:00', 30),
    ]);
    expect(retro().ritmoLivros.map((r) => [r.book.md5, r.minutos, r.paginas, r.paginasPorHora])).toEqual([
      ['D', 15, 30, 120],
      ['A', 240, 240, 60],
    ]);
  });

  it('tracks reading speed per month over the last 24 months', () => {
    seedYears();
    importPluginData(db, [mkBook('C', 50)], read('C', 50, '2026-09-01', 1, 5));
    const v = retro().velocidadeMensal;
    expect(v).toHaveLength(24);
    expect(v[0].month).toBe('2024-11');
    expect(v.at(-1)!.month).toBe('2026-10');
    const byMonth = Object.fromEntries(v.map((m) => [m.month, m.paginasPorHora]));
    expect(byMonth['2025-06']).toBe(60);
    expect(byMonth['2026-03']).toBe(60);
    expect(byMonth['2026-09']).toBeNull(); // only 5 minutes
    expect(byMonth['2026-01']).toBeNull();
  });
});

describe('calendar edges', () => {
  const at = (day: string) => Date.parse(`${day}T15:00:00Z`);

  it('handles year boundaries and leap years in period ranges', () => {
    expect(periodRange('mes', 1, '2026-01-15')).toEqual({ inicio: '2025-12-01', fim: '2025-12-31' });
    expect(periodRange('mes', 0, '2028-02-10')).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' });
    expect(periodRange('semana', 0, '2027-01-01')).toEqual({ inicio: '2026-12-28', fim: '2027-01-03' });
    expect(periodRange('semana', 0, '2026-12-31')).toEqual({ inicio: '2026-12-28', fim: '2027-01-03' });
  });

  it('computes the goal on the last and first day of the year', () => {
    importPluginData(db, [mkBook('A', 300)], read('A', 300, '2026-03-01', 1, 100));
    expect(getRetrospectiva(db, TZ, at('2026-12-31')).meta).toMatchObject({
      diasRestantes: 1, restantes: 5900, paginasPorDia: 5900, esperadoHoje: 6000, diferenca: -5900,
    });
    expect(getRetrospectiva(db, TZ, at('2027-01-01')).meta).toMatchObject({
      ano: 2027, lidas: 0, diasRestantes: 365, paginasPorDia: 17, esperadoHoje: 16, diferenca: -16,
    });
  });

  it('uses 366 days in a leap year', () => {
    updateRetroSettings(db, { metaAnoPaginas: 3660 });
    expect(getRetrospectiva(db, TZ, at('2028-01-10')).meta).toMatchObject({ diasRestantes: 357, esperadoHoje: 100 });
  });

  it('compares with an empty previous period', () => {
    importPluginData(db, [mkBook('A', 100)], read('A', 100, '2026-09-29', 1, 10));
    expect(periodo('semana').anterior).toEqual({
      inicio: '2026-09-21', fim: '2026-09-27', minutos: 0, paginas: 0, diasLidos: 0, livrosTocados: 0, livrosTerminados: 0,
    });
  });

  it('skips stats whose book no longer exists', () => {
    importPluginData(db, [mkBook('A', 100)], read('A', 100, '2026-09-29', 1, 10));
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO page_stat (book_md5, device_id, page, start_time, duration, total_pages) VALUES ('GONE', 'k', 1, ?, 3600, 10)")
      .run(Date.parse('2026-09-30T15:00:00Z') / 1000);
    const p = periodo('semana');
    expect(p.totais).toMatchObject({ minutos: 10, livrosTocados: 1 });
    expect(p.livros.map((l) => l.book.md5)).toEqual(['A']);
    expect(p.maiorSessao?.book.md5).toBe('A');
    expect(retro().investimento.total.minutos).toBe(10);
  });
});
