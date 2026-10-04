import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPluginData } from '../src/books';
import { openDb, type Db } from '../src/db';
import { computeStreaks, getHabito } from '../src/habito';

const TZ = 'America/Fortaleza';
const NOW = Date.parse('2026-10-03T15:00:00Z'); // Saturday, noon in Fortaleza
const TODAY = '2026-10-03';

let db: Db;

const mkBook = (md5: string): PluginBook => ({
  id: 0, md5, title: md5, authors: '', series: '', language: 'pt', pages: 1000, last_open: 0,
});

// Pages `from..to`, one minute each, starting at `isoUtc`
function readAt(isoUtc: string, from: number, to: number, md5 = 'A'): PluginPageStat[] {
  const base = Date.parse(isoUtc) / 1000;
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    book_md5: md5, device_id: 'kindle', page: from + i, start_time: base + i * 60, duration: 60, total_pages: 1000,
  }));
}

// `minutes` pages (one minute each) read at noon in Fortaleza on `day`
const read = (day: string, minutes: number, firstPage = 1) => readAt(`${day}T15:00:00Z`, firstPage, firstPage + minutes - 1);

function seed(stats: PluginPageStat[]) {
  importPluginData(db, [mkBook('A'), mkBook('B')], stats);
}

const setSetting = (key: string, value: string) => db.prepare('INSERT INTO setting (key, value) VALUES (?, ?)').run(key, value);
const habito = () => getHabito(db, TZ, NOW);
const nivel = (n: string) => habito().niveis.find((x) => x.nivel === n)!;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('computeStreaks', () => {
  it('tolerates a single missed day', () => {
    expect(computeStreaks(['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02'], TODAY)).toEqual({
      atual: { inicio: '2026-09-28', fim: '2026-10-02', dias: 4 },
      recorde: { inicio: '2026-09-28', fim: '2026-10-02', dias: 4 },
      historico: [],
    });
  });

  it('breaks after two missed days in a row and lists closed streaks newest first', () => {
    const r = computeStreaks(['2026-09-20', '2026-09-21', '2026-09-24', '2026-09-25', '2026-09-26'], TODAY);
    expect(r.atual).toBeNull();
    expect(r.historico).toEqual([
      { inicio: '2026-09-24', fim: '2026-09-26', dias: 3 },
      { inicio: '2026-09-20', fim: '2026-09-21', dias: 2 },
    ]);
    expect(r.recorde).toEqual({ inicio: '2026-09-24', fim: '2026-09-26', dias: 3 });
  });

  it('keeps the current streak alive until two days pass without reading', () => {
    expect(computeStreaks(['2026-10-01'], TODAY).atual).toEqual({ inicio: '2026-10-01', fim: '2026-10-01', dias: 1 });
    expect(computeStreaks(['2026-09-30'], TODAY).atual).toBeNull();
    expect(computeStreaks(['2026-09-30'], TODAY).historico).toHaveLength(1);
  });

  it('ignores duplicates, order and days after today', () => {
    expect(computeStreaks(['2026-10-02', '2026-10-01', '2026-10-02', '2026-10-05'], TODAY).atual)
      .toEqual({ inicio: '2026-10-01', fim: '2026-10-02', dias: 2 });
  });

  it('returns nothing for no days and keeps the oldest streak on a tie', () => {
    expect(computeStreaks([], TODAY)).toEqual({ atual: null, recorde: null, historico: [] });
    expect(computeStreaks(['2026-01-01', '2026-02-01'], TODAY).recorde).toEqual({ inicio: '2026-01-01', fim: '2026-01-01', dias: 1 });
  });
});

describe('getHabito', () => {
  it('counts a late-night reading on the local day, not the UTC day', () => {
    seed(readAt('2026-10-03T02:30:00Z', 1, 5)); // 23:30 on 10-02 in Fortaleza
    const h = habito();
    expect(h.daily.find((d) => d.date === '2026-10-02')).toMatchObject({ minutes: 5, pages: 5 });
    expect(h.daily.at(-1)).toMatchObject({ date: TODAY, minutes: 0 });
    expect(h.daily).toHaveLength(365);
  });

  it('feeds bronze with a weak day, silver with the goal and gold with twice the goal', () => {
    seed([...read('2026-10-01', 40, 1), ...read('2026-10-02', 10, 100), ...read(TODAY, 10, 200)]);
    expect(nivel('bronze').atual).toEqual({ inicio: '2026-10-01', fim: TODAY, dias: 3 });
    expect(nivel('prata').atual).toEqual({ inicio: '2026-10-01', fim: '2026-10-01', dias: 1 });
    expect(nivel('ouro').atual).toEqual({ inicio: '2026-10-01', fim: '2026-10-01', dias: 1 });
    expect(habito().daily.at(-1)?.metaBatida).toBe(false);
  });

  it('supports a page goal and counts distinct pages per day', () => {
    setSetting('habito.meta_dia_minutos', '0');
    setSetting('habito.meta_dia_paginas', '15');
    // 10-02: pages 1..10 twice (10 distinct); today: 20 distinct pages
    seed([...read('2026-10-02', 10), ...readAt('2026-10-02T18:00:00Z', 1, 10), ...read(TODAY, 20, 50)]);
    const h = habito();
    expect(h.daily.find((d) => d.date === '2026-10-02')).toMatchObject({ minutes: 20, pages: 10, metaBatida: false });
    expect(h.daily.at(-1)).toMatchObject({ pages: 20, metaBatida: true });
    expect(h.metas.dia).toEqual({ minutos: 0, paginas: 15 });
  });

  it('reports progress for today and the current month', () => {
    seed([...read('2026-09-30', 30), ...read('2026-10-01', 15, 100), ...read(TODAY, 12, 200)]);
    const h = habito();
    expect(h.progresso).toEqual({ dia: { minutos: 12, paginas: 12 }, mes: { minutos: 27, paginas: 27 } });
    expect(h.metas).toEqual({ dia: { minutos: 20, paginas: 0 }, mes: { minutos: 600, paginas: 0 } });
    expect(h.gatilho).toBe('');
  });

  it('builds the hour histogram and the weekday average over the last 90 days', () => {
    seed([
      ...readAt('2026-10-02T00:00:00Z', 1, 5), // 21:00 on 10-01 in Fortaleza
      ...read(TODAY, 13, 100), // noon on a Saturday
      ...read('2026-06-01', 30, 300), // outside the window
    ]);
    const h = habito();
    expect(h.porHora).toHaveLength(24);
    expect(h.porHora[21]).toBe(5);
    expect(h.porHora[12]).toBe(13);
    expect(h.porHora.reduce((a, b) => a + b)).toBe(18);
    // the 90-day window (07-06..10-03) has 13 Saturdays
    expect(h.porDiaSemana[5]).toBe(1);
    expect(h.porDiaSemana[3]).toBe(0); // 10-01 is a Thursday: 5 / 13 min rounds to 0
    expect(h.porDiaSemana.every(Number.isInteger)).toBe(true);
  });

  it('compares this week with last week up to the same weekday', () => {
    seed([...read('2026-09-28', 10), ...read(TODAY, 20, 100), ...read('2026-09-21', 15, 200), ...read('2026-09-27', 50, 300)]);
    expect(habito().semana).toEqual({ atual: [10, 0, 0, 0, 0, 20, 0], anterior: [15, 0, 0, 0, 0, 0, 50], variacao: 100 });
  });

  it('returns a null week variation when last week had no reading up to today', () => {
    seed(read('2026-09-28', 10));
    expect(habito().semana.variacao).toBeNull();
  });

  it('handles a week seen from a Monday and from a Sunday', () => {
    seed([...read('2026-09-28', 10), ...read('2026-09-21', 20, 100), ...read('2026-09-22', 30, 200)]);
    expect(getHabito(db, TZ, Date.parse('2026-09-28T15:00:00Z')).semana)
      .toEqual({ atual: [10, 0, 0, 0, 0, 0, 0], anterior: [20, 30, 0, 0, 0, 0, 0], variacao: -50 });

    db = openDb(':memory:');
    seed([...read('2026-09-28', 10), ...read('2026-10-04', 20, 100), ...read('2026-09-21', 15, 200), ...read('2026-09-27', 15, 300)]);
    expect(getHabito(db, TZ, Date.parse('2026-10-04T15:00:00Z')).semana)
      .toEqual({ atual: [10, 0, 0, 0, 0, 0, 20], anterior: [15, 0, 0, 0, 0, 0, 15], variacao: 0 });
  });

  it('keeps the current streak alive when the last day was the day before yesterday, not three days ago', () => {
    seed(read('2026-10-01', 20));
    expect(nivel('prata').atual).toEqual({ inicio: '2026-10-01', fim: '2026-10-01', dias: 1 });

    db = openDb(':memory:');
    seed(read('2026-09-30', 20));
    expect(nivel('prata').atual).toBeNull();
    expect(nivel('prata').historico).toEqual([{ inicio: '2026-09-30', fim: '2026-09-30', dias: 1 }]);
  });

  it('requires twice the page goal for ouro', () => {
    setSetting('habito.meta_dia_minutos', '0');
    setSetting('habito.meta_dia_paginas', '10');
    seed([...readAt('2026-10-02T15:00:00Z', 1, 15), ...readAt('2026-10-03T12:00:00Z', 100, 119)]); // 15 pages, then 20 pages at 9:00
    expect(nivel('prata').atual).toEqual({ inicio: '2026-10-02', fim: TODAY, dias: 2 });
    expect(nivel('ouro').atual).toEqual({ inicio: TODAY, fim: TODAY, dias: 1 });
  });

  it('falls back to the default goal when a stored value is not an integer', () => {
    setSetting('habito.meta_dia_minutos', 'abc');
    setSetting('habito.meta_mes_minutos', '2.5');
    setSetting('habito.meta_dia_paginas', '');
    expect(habito().metas).toEqual({ dia: { minutos: 20, paginas: 0 }, mes: { minutos: 600, paginas: 0 } });
  });

  it('compares the last 30 days with the 30 days ending 90 days ago', () => {
    seed([...read('2026-09-04', 25), ...read('2026-09-03', 60, 100), ...read('2026-06-06', 10, 200), ...read('2026-07-05', 5, 300)]);
    expect(habito().vsPassado).toEqual({
      atual: { inicio: '2026-09-04', fim: TODAY, minutos: 25, paginas: 25, diasComLeitura: 1, diasComMeta: 1 },
      antes: { inicio: '2026-06-06', fim: '2026-07-05', minutos: 15, paginas: 15, diasComLeitura: 2, diasComMeta: 0 },
    });
  });

  it('scores consistency and leaves today out until there is reading', () => {
    seed([...read('2026-10-02', 20), ...read('2026-10-01', 5, 100)]);
    expect(habito().consistencia).toEqual({ pontuacao: 5, diasComMeta: 1, diasComLeitura: 2, inicio: '2026-09-03', fim: '2026-10-02' });
    seed(read(TODAY, 20, 200));
    expect(habito().consistencia).toEqual({ pontuacao: 8, diasComMeta: 2, diasComLeitura: 3, inicio: '2026-09-04', fim: TODAY });
  });
});
