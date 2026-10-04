import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPluginData, listBooks, updateBook } from '../src/books';
import { openDb, type Db } from '../src/db';
import { getFoco } from '../src/foco';
import { contexto } from '../src/jogo';
import { computeBookStats, computeStatus, MIN_ACTIVE_SESSION_SECONDS, type StatRow } from '../src/stats';

const today = '2026-10-03';

describe('computeStatus', () => {
  it('status_manual always wins', () => {
    expect(computeStatus({ progress: 100, lastActiveAt: today, today, statusManual: 'pausado' })).toBe('pausado');
  });
  it('manual lido wins over low progress', () => {
    expect(computeStatus({ progress: 10, lastActiveAt: today, today, statusManual: 'lido' })).toBe('lido');
  });
  it('is lendo just below 95% with a recent session', () => {
    expect(computeStatus({ progress: 94, lastActiveAt: today, today, statusManual: null })).toBe('lendo');
  });
  it('is lido from 95% progress', () => {
    expect(computeStatus({ progress: 95, lastActiveAt: '2025-01-01', today, statusManual: null })).toBe('lido');
  });
  it('is lendo when read in the last 30 days', () => {
    expect(computeStatus({ progress: 40, lastActiveAt: '2026-09-10', today, statusManual: null })).toBe('lendo');
  });
  it('is pausado when not read for more than 30 days', () => {
    expect(computeStatus({ progress: 40, lastActiveAt: '2026-08-01', today, statusManual: null })).toBe('pausado');
  });
  it('counts the 30-day window in calendar days', () => {
    expect(computeStatus({ progress: 40, lastActiveAt: '2026-09-04', today, statusManual: null })).toBe('lendo');
    expect(computeStatus({ progress: 40, lastActiveAt: '2026-09-03', today, statusManual: null })).toBe('pausado');
  });
  it('is pausado when never read', () => {
    expect(computeStatus({ progress: 0, lastActiveAt: null, today, statusManual: null })).toBe('pausado');
  });
});

// ---- Issue #11: books wrongly shown as 'lendo' ----

const TZ = 'America/Fortaleza'; // UTC-3, no DST
const NOW = Date.parse('2026-10-03T15:00:00Z'); // noon in Fortaleza

// `count` stat rows of `secs` seconds each, back to back, starting at `isoUtc`
function rows(isoUtc: string, count: number, firstPage = 1, secs = 60, totalPages = 100): StatRow[] {
  const base = Date.parse(isoUtc) / 1000;
  return Array.from({ length: count }, (_, i) => ({ page: firstPage + i, start_time: base + i * secs, duration: secs, total_pages: totalPages }));
}

const asPlugin = (md5: string, stats: StatRow[]): PluginPageStat[] => stats.map((s) => ({ ...s, book_md5: md5, device_id: 'kindle' }));
const mkBook = (md5: string, pages = 100): PluginBook => ({ id: 0, md5, title: md5, authors: '', series: '', language: 'pt', pages, last_open: 0 });

describe('reading activity', () => {
  it('a brief open does not count as active reading but stays in the history', () => {
    const stats = computeBookStats([...rows('2026-08-01T15:00:00Z', 45), ...rows('2026-09-28T15:00:00Z', 1, 46, 30)], 100, TZ);
    expect(stats.lastReadAt).toBe('2026-09-28');
    expect(stats.lastActiveAt).toBe('2026-08-01');
    expect(stats.progressTimeline.at(-1)).toEqual({ date: '2026-09-28', progress: 46 });
  });

  it(`needs a session of at least ${MIN_ACTIVE_SESSION_SECONDS} seconds`, () => {
    expect(computeBookStats(rows('2026-09-28T15:00:00Z', 5), 100, TZ).lastActiveAt).toBe('2026-09-28');
    expect(computeBookStats(rows('2026-09-28T15:00:00Z', 1, 1, MIN_ACTIVE_SESSION_SECONDS - 1), 100, TZ).lastActiveAt).toBeNull();
  });

  it('does not add up short opens in separate sessions', () => {
    const opens = ['10', '12', '14', '16'].flatMap((h, i) => rows(`2026-09-28T${h}:00:00Z`, 2, 1 + i * 2));
    expect(computeBookStats(opens, 100, TZ).lastActiveAt).toBeNull();
  });

  it('dates a session crossing midnight by its last day in the configured time zone', () => {
    // 23:57 -> 00:02 in Fortaleza
    expect(computeBookStats(rows('2026-09-04T02:57:00Z', 6), 100, TZ).lastActiveAt).toBe('2026-09-04');
  });

  it('applies the 30-day window to the local day of the last active session', () => {
    // 22:00 on 2026-09-03 in Fortaleza is already 2026-09-04 in UTC
    const late = rows('2026-09-04T01:00:00Z', 10);
    const status = (tz: string) => {
      const s = computeBookStats(late, 100, tz);
      return computeStatus({ progress: s.progress, lastActiveAt: s.lastActiveAt, today: '2026-10-03', statusManual: null });
    };
    expect(status(TZ)).toBe('pausado');
    expect(status('UTC')).toBe('lendo');
  });
});

describe('effective status in every consumer', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  const seed = (md5: string, stats: StatRow[], pages = 100) => importPluginData(db, [mkBook(md5, pages)], asPlugin(md5, stats));
  const book = (md5: string) => listBooks(db, TZ, NOW).find((b) => b.md5 === md5)!;
  const abertos = () => getFoco(db, 2026, TZ, NOW).abertos.map((b) => b.md5);
  const ontem = (md5: string) => contexto(db, TZ, NOW).ontem.get(md5)!;
  const statCount = () => (db.prepare('SELECT COUNT(*) AS n FROM page_stat').get() as { n: number }).n;

  it('a brief open of an old book keeps it pausado in the library, the panel and the game', () => {
    seed('OLD', [...rows('2026-08-01T15:00:00Z', 45), ...rows('2026-09-28T15:00:00Z', 1, 46, 30)]);
    expect(book('OLD')).toMatchObject({ status: 'pausado', lastReadAt: '2026-09-28', statusManual: null });
    expect(abertos()).not.toContain('OLD');
    expect(ontem('OLD').status).toBe('pausado');
    expect(statCount()).toBe(46);
  });

  it('recent real reading is lendo everywhere', () => {
    seed('NEW', rows('2026-10-02T15:00:00Z', 10));
    expect(book('NEW').status).toBe('lendo');
    expect(abertos()).toContain('NEW');
    expect(ontem('NEW').status).toBe('lendo');
  });

  it('old reading is pausado and finished books are lido', () => {
    seed('OLD', rows('2026-08-01T15:00:00Z', 45));
    seed('DONE', rows('2026-10-02T15:00:00Z', 10, 1, 60, 10), 10);
    expect(book('OLD').status).toBe('pausado');
    expect(book('DONE').status).toBe('lido');
    expect(abertos()).toEqual([]);
  });

  it('a book never read is pausado', () => {
    importPluginData(db, [mkBook('NONE')], []);
    expect(book('NONE')).toMatchObject({ status: 'pausado', lastReadAt: null });
  });

  it('never overrides a manual status', () => {
    seed('M', rows('2026-10-02T15:00:00Z', 10));
    updateBook(db, 'M', { statusManual: 'pausado' }, '2026-10-03');
    seed('M', rows('2026-10-03T12:00:00Z', 10, 11));
    expect(book('M')).toMatchObject({ status: 'pausado', statusManual: 'pausado' });
    expect(abertos()).not.toContain('M');
  });

  it('a brief open after archiving keeps the book archived; real reading reopens it', () => {
    seed('ARQ', rows('2026-09-20T15:00:00Z', 20));
    updateBook(db, 'ARQ', { arquivado: true }, '2026-09-25');
    seed('ARQ', rows('2026-09-28T15:00:00Z', 1, 21, 30));
    expect(book('ARQ')).toMatchObject({ status: 'pausado', arquivado: true });
    expect(ontem('ARQ')).toMatchObject({ status: 'pausado', arquivado: true });

    seed('ARQ', rows('2026-10-01T15:00:00Z', 10, 22));
    expect(book('ARQ')).toMatchObject({ status: 'lendo', arquivado: false });
    expect(abertos()).toContain('ARQ');
  });
});
