import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPluginData } from '../src/books';
import { openDb, type Db } from '../src/db';
import { getFoco } from '../src/foco';

const TZ = 'America/Fortaleza';
const NOW = Date.parse('2026-10-03T15:00:00Z'); // noon in Fortaleza

let db: Db;

const mkBook = (md5: string, pages: number): PluginBook => ({
  id: 0, md5, title: md5, authors: '', series: '', language: 'pt', pages, last_open: 0,
});

// Pages `from..to` read at noon (Fortaleza) of `day`, one minute each
function read(md5: string, pages: number, day: string, from: number, to: number): PluginPageStat[] {
  const base = Date.parse(`${day}T15:00:00Z`) / 1000;
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    book_md5: md5, device_id: 'kindle', page: from + i, start_time: base + i * 60, duration: 60, total_pages: pages,
  }));
}

function seed(books: PluginBook[], stats: PluginPageStat[]) {
  importPluginData(db, books, stats);
}

function setFila(md5s: string[]) {
  md5s.forEach((md5, i) => db.prepare('INSERT INTO fila (md5, posicao) VALUES (?, ?)').run(md5, i));
}

const foco = (year = 2026) => getFoco(db, year, TZ, NOW);

beforeEach(() => {
  db = openDb(':memory:');
});

describe('getFoco', () => {
  // two books read yesterday (lendo) and two read in January (pausado)
  function seedQueueBooks(lendo: string[]) {
    seed(
      ['L1', 'L2', 'A', 'B'].map((m) => mkBook(m, 100)),
      [...lendo.flatMap((m) => read(m, 100, '2026-10-02', 1, 10)), ...read('A', 100, '2026-01-10', 1, 5), ...read('B', 100, '2026-01-10', 1, 5)],
    );
  }

  it('releases only the first queue item and only when there is room', () => {
    seedQueueBooks(['L1', 'L2']);
    setFila(['A', 'B']);
    expect(foco().fila.map((f) => f.liberado)).toEqual([false, false]);

    db = openDb(':memory:');
    seedQueueBooks(['L1']);
    setFila(['A', 'B']);
    expect(foco().fila.map((f) => f.liberado)).toEqual([true, false]);
  });

  it('never releases a finished book at the head of the queue', () => {
    seed([mkBook('F', 10), mkBook('A', 100)], [...read('F', 10, '2026-03-01', 1, 10), ...read('A', 100, '2026-01-10', 1, 5)]);
    setFila(['F', 'A']);
    expect(foco().fila.map((f) => f.liberado)).toEqual([false, false]);
  });

  it('applies the queue rule to a head that is already lendo', () => {
    seedQueueBooks(['L1', 'L2']);
    setFila(['L1']);
    expect(foco().fila[0].liberado).toBe(false);

    db = openDb(':memory:');
    seedQueueBooks(['L1']);
    setFila(['L1']);
    expect(foco().fila[0].liberado).toBe(true);
  });

  it('puts a pausado book in the cemetery only after the deadline', () => {
    seed(
      [mkBook('P45', 100), mkBook('P46', 100), mkBook('ARQ', 100), mkBook('NUNCA', 100)],
      [...read('P45', 100, '2026-08-19', 1, 5), ...read('P46', 100, '2026-08-18', 1, 5), ...read('ARQ', 100, '2026-06-25', 1, 5)],
    );
    db.prepare("UPDATE book SET arquivado_em = '2026-07-01' WHERE md5 = 'ARQ'").run();
    expect(foco().cemiterio.map((c) => ({ md5: c.book.md5, diasParado: c.diasParado, vencidoHa: c.vencidoHa })))
      .toEqual([{ md5: 'P46', diasParado: 46, vencidoHa: 1 }]);
  });

  it('counts days stalled from the last real session, ignoring brief opens', () => {
    // 5 minutes of reading on 08-18, then a 1-minute peek yesterday
    seed([mkBook('P', 100)], [...read('P', 100, '2026-08-18', 1, 5), ...read('P', 100, '2026-10-02', 6, 6)]);
    expect(foco().cemiterio.map((c) => ({ md5: c.book.md5, diasParado: c.diasParado })))
      .toEqual([{ md5: 'P', diasParado: 46 }]);
  });

  it('forecasts from the last 14 days and returns null without recent reading', () => {
    // one page a day, in a 5-minute session, from 09-20 to 10-03 (14 days), on top of 16 pages read on 09-01
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10));
    seed(
      [mkBook('R', 100), mkBook('S', 100)],
      [
        ...read('R', 100, '2026-09-01', 1, 16),
        ...days.flatMap((day, i) => read('R', 100, day, 17 + i, 17 + i).map((s) => ({ ...s, duration: 300 }))),
        ...read('S', 100, '2026-09-10', 1, 5),
      ],
    );
    const abertos = foco().abertos;
    expect(abertos.find((b) => b.md5 === 'R')).toMatchObject({ progress: 30, previsao: '2026-12-12', minutosRestantes: 350 });
    expect(abertos.find((b) => b.md5 === 'S')).toMatchObject({ previsao: null, minutosRestantes: null });
  });

  it('returns null forecast for a book without page count', () => {
    seed([mkBook('Z', 0)], read('Z', 0, '2026-10-02', 1, 5));
    expect(foco().abertos[0]).toMatchObject({ previsao: null, minutosRestantes: null });
  });

  it('orders reta final first among abertos', () => {
    seed([mkBook('R80', 10), mkBook('R20', 50)], [...read('R80', 10, '2026-10-01', 1, 8), ...read('R20', 50, '2026-10-02', 1, 10)]);
    expect(foco().abertos.map((b) => b.progress)).toEqual([80, 20]);
  });

  it('computes completion rate for books started in the chosen year', () => {
    seed(
      [mkBook('LIDO', 10), mkBook('ARQ', 100), mkBook('VELHO', 10)],
      [...read('LIDO', 10, '2026-03-01', 1, 10), ...read('ARQ', 100, '2026-02-01', 1, 3), ...read('VELHO', 10, '2025-05-01', 1, 10)],
    );
    db.prepare("UPDATE book SET arquivado_em = '2026-02-05' WHERE md5 = 'ARQ'").run();
    expect(foco(2026).taxaConclusao).toEqual({ lidos: 1, abandonados: 1, percentual: 50 });
    expect(foco(2024).taxaConclusao).toEqual({ lidos: 0, abandonados: 0, percentual: null });
  });

  it('does not count an archived book as open even if read recently', () => {
    seed([mkBook('X', 100), mkBook('Y', 100)], [...read('X', 100, '2026-10-02', 1, 10), ...read('Y', 100, '2026-10-02', 1, 10)]);
    db.prepare("UPDATE book SET arquivado_em = '2026-10-03' WHERE md5 = 'X'").run();
    expect(foco().abertos.map((b) => b.md5)).toEqual(['Y']);
  });

  it('reads default settings', () => {
    expect(foco()).toMatchObject({ limite: 2, prazoDias: 45 });
  });
});
