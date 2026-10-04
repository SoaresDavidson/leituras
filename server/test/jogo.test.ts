import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPluginData } from '../src/books';
import { openDb, type Db } from '../src/db';
import { cartas, contexto, desafiosMes, desafiosSemana, embaralhar, getJogo, sortear, trocarCarta } from '../src/jogo';

const TZ = 'America/Fortaleza';
const NOW = Date.parse('2026-10-03T15:00:00Z'); // Saturday, noon in Fortaleza
const DAY_MS = 86_400_000;

let db: Db;

const mkBook = (md5: string, pages: number): PluginBook => ({
  id: 0, md5, title: md5, authors: '', series: '', language: 'pt', pages, last_open: 0,
});

// Pages `from..to` of `md5`, one minute each and back to back, starting at `isoUtc`
function readAt(isoUtc: string, md5: string, pages: number, from: number, to: number): PluginPageStat[] {
  const base = Date.parse(isoUtc) / 1000;
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    book_md5: md5, device_id: 'kindle', page: from + i, start_time: base + i * 60, duration: 60, total_pages: pages,
  }));
}

// Same, at noon in Fortaleza on `day`
const read = (md5: string, pages: number, day: string, from: number, to: number) => readAt(`${day}T15:00:00Z`, md5, pages, from, to);

const seed = (books: PluginBook[], stats: PluginPageStat[]) => importPluginData(db, books, stats);
const setSetting = (key: string, value: string) => db.prepare('INSERT INTO setting (key, value) VALUES (?, ?)').run(key, value);
const jogo = (now = NOW) => getJogo(db, TZ, now);
const byId = <T extends { id: string }>(items: T[], id: string) => items.find((x) => x.id === id)!;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('sortear', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(sortear(items, 'carta:2026-10-03')).toBe(sortear(items, 'carta:2026-10-03'));
    expect(embaralhar(items, 'x').sort((a, b) => a - b)).toEqual(items);
    const draws = new Set(Array.from({ length: 30 }, (_, i) => sortear(items, `dia:${i}`)));
    expect(draws.size).toBeGreaterThan(3);
  });
});

describe('missões do dia', () => {
  it('always has three missions, the first being the daily goal', () => {
    const { missoes } = jogo();
    expect(missoes).toHaveLength(3);
    expect(missoes[0]).toMatchObject({ id: 'meta', atual: 0, alvo: 20, unidade: 'min', feito: false, md5: null });
    expect(new Set(missoes.map((m) => m.id)).size).toBe(3);
    for (const m of missoes.slice(1)) expect(['paginas', 'sessao', 'dois-momentos']).toContain(m.id);
  });

  it('uses the habit daily goal, in pages when minutes are off', () => {
    setSetting('habito.meta_dia_minutos', '10');
    seed([mkBook('A', 1000)], readAt('2026-10-03T12:00:00Z', 'A', 1000, 1, 12));
    expect(jogo().missoes[0]).toMatchObject({ atual: 12, alvo: 10, unidade: 'min', feito: true });

    db.prepare("UPDATE setting SET value = '0' WHERE key = 'habito.meta_dia_minutos'").run();
    setSetting('habito.meta_dia_paginas', '15');
    expect(jogo().missoes[0]).toMatchObject({ atual: 12, alvo: 15, unidade: 'págs', feito: false });
  });

  it('picks the book mission from what was open yesterday and counts today', () => {
    seed([mkBook('X', 100)], [...read('X', 100, '2026-10-02', 1, 80), ...readAt('2026-10-03T13:00:00Z', 'X', 100, 81, 83)]);
    expect(jogo().missoes[1]).toMatchObject({ md5: 'X', atual: 3, feito: false });
  });

  it('ignores a book first opened today', () => {
    seed([mkBook('Y', 100)], readAt('2026-10-03T13:00:00Z', 'Y', 100, 1, 5));
    expect(jogo().missoes[1].md5).toBeNull();
  });

  it('offers a rescue mission for a book stalled yesterday', () => {
    seed([mkBook('P', 100)], [...read('P', 100, '2026-07-01', 1, 10), ...readAt('2026-10-03T13:00:00Z', 'P', 100, 11, 17)]);
    expect(jogo().missoes[1]).toMatchObject({ id: 'resgate', md5: 'P', atual: 7, alvo: 5, feito: true });
  });
});

describe('desafios da semana e do mês', () => {
  // 60 pages in one 60-minute session each day from Monday 09-28 to today, plus 100 pages on 09-14 and 09-21
  function seedSemana() {
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
    seed([mkBook('A', 2000)], [
      ...read('A', 2000, '2026-09-14', 1, 100),
      ...read('A', 2000, '2026-09-21', 101, 200),
      ...days.flatMap((d, i) => read('A', 2000, d, 201 + i * 60, 260 + i * 60)),
    ]);
  }

  it('evaluates every weekly challenge over Monday..Sunday', () => {
    seedSemana();
    const all = desafiosSemana(contexto(db, TZ, NOW));
    expect(all.map((d) => [d.id, d.atual, d.alvo, d.feito])).toEqual([
      ['dias-meta', 6, 5, true],
      ['paginas', 360, 60, true], // 200 pages over the 4 previous weeks: 50/week × 1.1, up to the next ten
      ['sessoes-longas', 6, 3, true],
      ['todo-dia', 6, 6, true],
    ]);
    expect(all.every((d) => d.inicio === '2026-09-28' && d.fim === '2026-10-04')).toBe(true);
    expect(all.map((d) => d.id)).toContain(jogo().semana.id);
  });

  it('evaluates every monthly challenge over the calendar month', () => {
    seedSemana();
    const all = desafiosMes(contexto(db, TZ, NOW));
    expect(all.map((d) => [d.id, d.atual, d.alvo, d.feito])).toEqual([
      ['fechamentos', 0, 2, false],
      ['horas', 180, 300, false], // at least 5 h
      ['dias', 3, 20, false],
      ['meta-mes', 180, 600, false],
    ]);
    expect(all.every((d) => d.inicio === '2026-10-01' && d.fim === '2026-10-31')).toBe(true);
  });

  it('raises the hours target from the three previous months and counts finished books', () => {
    seed([mkBook('A', 2000), mkBook('F', 10)], [
      ...read('A', 2000, '2026-07-10', 1, 600),
      ...read('A', 2000, '2026-08-10', 601, 1200),
      ...read('A', 2000, '2026-09-10', 1201, 1800),
      ...read('F', 10, '2026-10-02', 1, 10),
    ]);
    const all = desafiosMes(contexto(db, TZ, NOW));
    expect(byId(all, 'horas')).toMatchObject({ alvo: 660, titulo: 'Ler 11 h no mês' });
    expect(byId(all, 'fechamentos')).toMatchObject({ atual: 1 });
  });
});

describe('carta de desafio', () => {
  it('can be swapped once a day and resets the next day', () => {
    const before = jogo().carta;
    expect(before).toMatchObject({ trocada: false, podeTrocar: true, feito: false });
    expect(trocarCarta(db, TZ, NOW)).toBe(true);
    const after = jogo().carta;
    expect(after).toMatchObject({ trocada: true, podeTrocar: false });
    expect(after.id).not.toBe(before.id);
    expect(trocarCarta(db, TZ, NOW)).toBe(false);
    expect(jogo(NOW + DAY_MS).carta).toMatchObject({ trocada: false, podeTrocar: true });
  });

  it('evaluates every card on today', () => {
    const night = Date.parse('2026-10-04T02:00:00Z'); // 23:00 on 10-03
    seed([mkBook('A', 1000), mkBook('P', 100)], [
      ...read('P', 100, '2026-08-01', 1, 10),
      ...readAt('2026-10-03T09:00:00Z', 'A', 1000, 1, 40), // 06:00
      ...readAt('2026-10-04T00:00:00Z', 'P', 100, 11, 25), // 21:00
    ]);
    const all = cartas(contexto(db, TZ, night));
    expect(all.map((c) => [c.id, c.atual, c.feito])).toEqual([
      ['antes-9h', 40, true],
      ['noite', 15, true],
      ['trinta-paginas', 55, true],
      ['sessao-25', 40, true],
      ['dois-livros', 2, true],
      ['resgate', 15, true],
    ]);
  });
});

describe('desafio relâmpago', () => {
  it('is active before the deadline, done when reached and lost after it', () => {
    const r = jogo(Date.parse('2026-10-03T13:00:00Z')).relampago; // 10:00
    expect(r).toMatchObject({ estado: 'ativo', atual: 0 });
    expect([12, 18, 22]).toContain(r.prazoHora);
    expect([15, 20, 30]).toContain(r.alvo);
    expect(r.titulo).toBe(`Ler ${r.alvo} min antes das ${r.prazoHora}h`);

    expect(jogo(Date.parse('2026-10-04T02:30:00Z')).relampago.estado).toBe('perdido'); // 23:30

    seed([mkBook('A', 1000)], readAt('2026-10-03T09:00:00Z', 'A', 1000, 1, 40));
    expect(jogo().relampago).toMatchObject({ estado: 'feito', atual: 40 });
  });
});

describe('chefes', () => {
  it('turns long open books into bosses with life and damage per day', () => {
    seed([mkBook('B', 500), mkBook('S', 399), mkBook('D', 600)], [
      ...read('B', 500, '2026-10-02', 1, 50),
      ...readAt('2026-10-03T13:00:00Z', 'B', 500, 51, 70),
      ...readAt('2026-10-03T14:00:00Z', 'S', 399, 1, 10),
      ...read('D', 600, '2026-05-01', 1, 600),
    ]);
    const { chefes, chefesDerrotados } = jogo();
    expect(chefes.map((c) => c.book.md5)).toEqual(['B']);
    expect(chefes[0]).toMatchObject({ vida: 430, vidaMax: 500 });
    expect(chefes[0].danoPorDia).toHaveLength(7);
    expect(chefes[0].danoPorDia.slice(-2)).toEqual([{ date: '2026-10-02', dano: 50 }, { date: '2026-10-03', dano: 20 }]);
    expect(chefes[0].danoMedio).toBe(5); // 70 pages over 14 days
    expect(chefesDerrotados.map((c) => [c.book.md5, c.derrotadoEm])).toEqual([['D', '2026-05-01']]);
  });
});

describe('corrida contra o fantasma', () => {
  it('races cumulative pages against last month and the same month last year', () => {
    seed([mkBook('A', 1000)], [
      ...read('A', 1000, '2026-09-01', 1, 10),
      ...read('A', 1000, '2026-09-02', 11, 20),
      ...read('A', 1000, '2026-10-01', 21, 25),
      ...read('A', 1000, '2026-10-03', 26, 30),
      ...read('A', 1000, '2025-10-02', 31, 37),
    ]);
    const [mes, ano] = jogo().fantasma;
    expect(mes).toMatchObject({ id: 'mes-passado', mes: '2026-10', mesFantasma: '2026-09', voce: 10, fantasma: 20 });
    expect(mes.dias).toHaveLength(31);
    expect(mes.dias.slice(0, 4)).toEqual([
      { dia: 1, voce: 5, fantasma: 10 },
      { dia: 2, voce: 5, fantasma: 20 },
      { dia: 3, voce: 10, fantasma: 20 },
      { dia: 4, voce: null, fantasma: 20 },
    ]);
    expect(mes.dias[30]).toEqual({ dia: 31, voce: null, fantasma: 20 });
    expect(ano).toMatchObject({ id: 'ano-passado', mesFantasma: '2025-10', voce: 10, fantasma: 7 });
  });
});

describe('classes de leitor', () => {
  it('has no class without reading in the last 90 days', () => {
    const { classe, classes } = jogo();
    expect(classe).toBeNull();
    expect(classes.map((c) => c.id)).toEqual(['maratonista', 'constante', 'noturno', 'madrugador', 'explorador', 'finalizador']);
    expect(classes.every((c) => c.pontuacao === 0)).toBe(true);
  });

  it('makes long sessions a maratonista', () => {
    seed([mkBook('A', 2000)], ['2026-09-01', '2026-09-10', '2026-09-20'].flatMap((d, i) => read('A', 2000, d, 1 + i * 90, 90 + i * 90)));
    const { classe, classes } = jogo();
    expect(classe).toMatchObject({ id: 'maratonista', valor: 90, pontuacao: 100 });
    expect(byId(classes, 'constante')).toMatchObject({ valor: 3, pontuacao: 4 }); // 3% of days, 80% scores 100
  });

  it('makes late reading noturno and counts categories', () => {
    // 10 minutes at 22:00 on 30 days
    const stats = Array.from({ length: 30 }, (_, i) =>
      readAt(new Date(Date.parse('2026-09-04T01:00:00Z') + i * DAY_MS).toISOString(), i % 2 ? 'A' : 'B', 1000, 1 + i * 10, 10 + i * 10)).flat();
    seed([mkBook('A', 1000), mkBook('B', 1000)], stats);
    db.prepare("UPDATE book SET categoria = md5").run();
    const { classe, classes } = jogo();
    expect(classe).toMatchObject({ id: 'noturno', pontuacao: 100 });
    expect(byId(classes, 'explorador')).toMatchObject({ valor: 2, pontuacao: 50 });
  });
});

describe('medalhas e recordes', () => {
  // L: 10-page book finished on 03-01; A: 5 min a day 09-01..09-07 and a 180-minute session on 06-14
  function seedMedalhas() {
    const week = ['01', '02', '03', '04', '05', '06', '07'].map((d) => `2026-09-${d}`);
    seed([mkBook('L', 10), mkBook('A', 1000)], [
      ...read('L', 10, '2026-03-01', 1, 10),
      ...read('A', 1000, '2026-06-14', 100, 279),
      ...week.flatMap((d, i) => read('A', 1000, d, 1 + i * 5, 5 + i * 5)),
    ]);
  }

  it('unlocks medals with the date the goal was reached', () => {
    seedMedalhas();
    const { medalhas, proximaConquista } = jogo();
    expect(byId(medalhas, 'primeiro-livro')).toMatchObject({ atual: 1, alvo: 1, feito: true, desbloqueadaEm: '2026-03-01' });
    expect(byId(medalhas, 'sequencia-7')).toMatchObject({ atual: 7, feito: true, desbloqueadaEm: '2026-09-07' });
    expect(byId(medalhas, 'sequencia-30')).toMatchObject({ atual: 7, alvo: 30, feito: false, desbloqueadaEm: null });
    expect(byId(medalhas, 'maratona')).toMatchObject({ atual: 180, feito: true, desbloqueadaEm: '2026-06-14' });
    expect(byId(medalhas, 'cem-horas')).toMatchObject({ atual: 3, alvo: 100, unidade: 'h', feito: false });
    expect(byId(medalhas, 'primeiro-chefe')).toMatchObject({ atual: 22, alvo: 100, unidade: '%' });
    expect(proximaConquista?.id).toBe('sequencia-30'); // 7/30 beats 22%
  });

  it('detects rescued and fast books, and a manual lido without a date', () => {
    seed([mkBook('R', 100), mkBook('V', 120), mkBook('M', 300)], [
      ...read('R', 100, '2026-01-01', 1, 50),
      ...read('R', 100, '2026-03-01', 51, 100),
      ...read('V', 120, '2026-04-01', 1, 60),
      ...read('V', 120, '2026-04-07', 61, 120),
      ...read('M', 300, '2025-01-01', 1, 5),
    ]);
    db.prepare("UPDATE book SET status_manual = 'lido' WHERE md5 = 'M'").run();
    const { medalhas } = jogo();
    expect(byId(medalhas, 'ressurreicao')).toMatchObject({ feito: true, desbloqueadaEm: '2026-03-01' });
    expect(byId(medalhas, 'velocista')).toMatchObject({ feito: true, desbloqueadaEm: '2026-04-07' });
    expect(byId(medalhas, 'estante')).toMatchObject({ atual: 3, feito: false });
  });

  it('keeps personal records with their dates', () => {
    seedMedalhas();
    const r = Object.fromEntries(jogo().recordes.map((x) => [x.id, [x.valor, x.data, x.detalhe]]));
    expect(r).toEqual({
      'maior-sessao': [180, '2026-06-14', null],
      'dia-paginas': [180, '2026-06-14', null],
      'dia-minutos': [180, '2026-06-14', null],
      semana: [180, '2026-06-08', null],
      'mes-paginas': [180, '2026-06', null],
      sequencia: [7, '2026-09-07', null],
      'livro-rapido': [1, '2026-03-01', 'L'],
      'maior-livro': [10, '2026-03-01', 'L'],
    });
  });

  it('returns empty records without data', () => {
    expect(jogo().recordes.every((r) => r.valor === null && r.data === null)).toBe(true);
    expect(jogo().proximaConquista).not.toBeNull();
  });
});

describe('review fixes', () => {
  it('keeps the book mission when any candidate is read today', () => {
    const base = () => seed([mkBook('X', 100), mkBook('Y', 100)], [...read('X', 100, '2026-10-02', 1, 10), ...read('Y', 100, '2026-10-02', 1, 10)]);
    base();
    const pick = jogo().missoes[1].md5;
    for (const md5 of ['X', 'Y']) {
      db = openDb(':memory:');
      base();
      seed([], readAt('2026-10-03T13:00:00Z', md5, 100, 11, 13));
      expect(jogo().missoes[1].md5).toBe(pick);
    }
  });

  it('ignores a manual status or an archive made today when choosing the mission', () => {
    seed([mkBook('X', 100)], read('X', 100, '2026-10-02', 1, 10));
    const before = jogo().missoes[1];
    expect(before).toMatchObject({ id: 'livro-paginas', md5: 'X' });
    db.prepare("UPDATE book SET status_manual = 'pausado' WHERE md5 = 'X'").run();
    expect(jogo().missoes[1]).toMatchObject({ id: 'livro-paginas', md5: 'X' });
    db.prepare("UPDATE book SET status_manual = NULL, arquivado_em = '2026-10-03' WHERE md5 = 'X'").run();
    expect(jogo().missoes[1]).toMatchObject({ id: 'livro-paginas', md5: 'X' });
  });

  it('falls back to the default goals when a stored goal is all 0', () => {
    for (const key of ['habito.meta_dia_minutos', 'habito.meta_dia_paginas', 'habito.meta_mes_minutos', 'habito.meta_mes_paginas']) setSetting(key, '0');
    expect(jogo().missoes[0]).toMatchObject({ alvo: 20, unidade: 'min', feito: false });
    expect(byId(desafiosMes(contexto(db, TZ, NOW)), 'meta-mes')).toMatchObject({ alvo: 600, feito: false });
    expect(byId(desafiosSemana(contexto(db, TZ, NOW)), 'dias-meta')).toMatchObject({ atual: 0, feito: false });
  });

  it('never draws a card that cannot be done with the books there are', () => {
    for (let i = 0; i < 30; i++) {
      const now = NOW + i * DAY_MS;
      expect(['resgate', 'dois-livros']).not.toContain(jogo(now).carta.id);
      trocarCarta(db, TZ, now);
      expect(['resgate', 'dois-livros']).not.toContain(jogo(now).carta.id);
    }
  });

  it('carries the last ghost day into longer months, leap years included', () => {
    seed([mkBook('A', 1000)], [
      ...read('A', 1000, '2026-02-28', 1, 8),
      ...read('A', 1000, '2027-02-28', 9, 12),
      ...read('A', 1000, '2028-02-29', 13, 15),
    ]);
    const marco = jogo(Date.parse('2026-03-31T15:00:00Z')).fantasma[0];
    expect(marco).toMatchObject({ mesFantasma: '2026-02', voce: 0, fantasma: 8 });
    expect(marco.dias).toHaveLength(31);
    expect(marco.dias[30]).toEqual({ dia: 31, voce: 0, fantasma: 8 });

    const [jan, ano] = jogo(Date.parse('2028-02-29T15:00:00Z')).fantasma;
    expect(jan.dias).toHaveLength(29);
    expect(ano).toMatchObject({ mesFantasma: '2027-02', voce: 3, fantasma: 4 });
    expect(ano.dias[28]).toEqual({ dia: 29, voce: 3, fantasma: 4 });
  });

  it('closes the lightning challenge exactly at the deadline hour', () => {
    const { prazoHora, alvo } = jogo().relampago;
    const localHour = (h: number, min = 0) => Date.parse('2026-10-03T03:00:00Z') + (h * 60 + min) * 60_000; // 00:00 local + h
    expect(jogo(localHour(prazoHora - 1, 59)).relampago.estado).toBe('ativo');
    expect(jogo(localHour(prazoHora)).relampago.estado).toBe('perdido');

    // reading that starts at the deadline hour does not count
    seed([mkBook('A', 1000)], readAt(new Date(localHour(prazoHora)).toISOString(), 'A', 1000, 1, alvo));
    expect(jogo(localHour(prazoHora, 40)).relampago).toMatchObject({ atual: 0, estado: 'perdido' });
  });

  it('dates a streak medal across a one-day rest', () => {
    const days = ['01', '02', '03', '05', '06', '07', '08'].map((d) => `2026-09-${d}`);
    seed([mkBook('A', 1000)], days.flatMap((d, i) => read('A', 1000, d, 1 + i * 5, 5 + i * 5)));
    expect(byId(jogo().medalhas, 'sequencia-7')).toMatchObject({ atual: 7, feito: true, desbloqueadaEm: '2026-09-08' });
  });
});
