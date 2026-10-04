import type { PluginBook, PluginPageStat } from '@leituras/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { addNota, deleteNota, getAprendizado, getLivroAprendizado, revisarNota, setArea, setTrilhaItem } from '../src/aprendizado';
import { importPluginData } from '../src/books';
import { addDays } from '../src/dates';
import { openDb, type Db } from '../src/db';

const TZ = 'America/Fortaleza';
const NOW = Date.parse('2026-10-03T15:00:00Z'); // noon in Fortaleza
const TODAY = '2026-10-03';

let db: Db;

const mkBook = (md5: string, pages: number): PluginBook => ({
  id: 0, md5, title: `Livro ${md5}`, authors: '', series: '', language: 'pt', pages, last_open: 0,
});

// Pages `from..to` read at noon (Fortaleza) of `day`, one minute each
function read(md5: string, pages: number, day: string, from: number, to: number): PluginPageStat[] {
  const base = Date.parse(`${day}T15:00:00Z`) / 1000;
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    book_md5: md5, device_id: 'kindle', page: from + i, start_time: base + i * 60, duration: 60, total_pages: pages,
  }));
}

const seed = (books: PluginBook[], stats: PluginPageStat[] = []) => importPluginData(db, books, stats);
const setCol = (md5: string, col: 'categoria' | 'topicos' | 'area', value: string) =>
  db.prepare(`UPDATE book SET ${col} = ? WHERE md5 = ?`).run(value, md5);
const aprendizado = () => getAprendizado(db, TZ, NOW);

beforeEach(() => {
  db = openDb(':memory:');
});

describe('notas e revisão espaçada', () => {
  it('schedules a new note for tomorrow and lists it in the journal', () => {
    seed([mkBook('A', 10)]);
    const nota = addNota(db, 'A', 'Invariantes de laço', TODAY)!;
    expect(nota).toMatchObject({ md5: 'A', bookTitle: 'Livro A', texto: 'Invariantes de laço', criadoEm: TODAY, etapa: 0, proximaRevisao: '2026-10-04', revisadoEm: null });
    expect(aprendizado().notas.map((n) => n.id)).toEqual([nota.id]);
  });

  it('returns undefined for an unknown book', () => {
    expect(addNota(db, 'X', 'algo', TODAY)).toBeUndefined();
  });

  it('advances through the intervals on lembrei and stops at the last one', () => {
    seed([mkBook('A', 10)]);
    const { id } = addNota(db, 'A', 'x', TODAY)!;
    const gaps = Array.from({ length: 7 }, () => {
      const n = revisarNota(db, id, true, TODAY)!;
      expect(n.revisadoEm).toBe(TODAY);
      return n.proximaRevisao;
    });
    expect(gaps).toEqual([3, 7, 14, 30, 60, 120, 120].map((d) => addDays(TODAY, d)));
  });

  it('resets to one day on esqueci', () => {
    seed([mkBook('A', 10)]);
    const { id } = addNota(db, 'A', 'x', TODAY)!;
    revisarNota(db, id, true, TODAY);
    revisarNota(db, id, true, TODAY);
    expect(revisarNota(db, id, false, TODAY)).toMatchObject({ etapa: 0, proximaRevisao: '2026-10-04' });
    expect(revisarNota(db, 9999, true, TODAY)).toBeUndefined();
  });

  it('lists only due notes in revisarHoje, most overdue first, and the journal newest first', () => {
    seed([mkBook('A', 10)]);
    const velha = addNota(db, 'A', 'velha', '2026-09-01')!;
    const ontem = addNota(db, 'A', 'ontem', '2026-10-02')!;
    const hoje = addNota(db, 'A', 'hoje', TODAY)!;
    const a = aprendizado();
    expect(a.hoje).toBe(TODAY);
    expect(a.revisarHoje.map((n) => n.id)).toEqual([velha.id, ontem.id]);
    expect(a.notas.map((n) => n.id)).toEqual([hoje.id, ontem.id, velha.id]);
  });

  it('deletes a note', () => {
    seed([mkBook('A', 10)]);
    const { id } = addNota(db, 'A', 'x', TODAY)!;
    expect(deleteNota(db, id)).toBe(true);
    expect(deleteNota(db, id)).toBe(false);
    expect(aprendizado().notas).toEqual([]);
  });
});

describe('ferrugem por categoria', () => {
  it('is 0% up to 7 days, 100% from 90 days and linear in between; reviews refresh the area', () => {
    seed(
      ['C1', 'C2', 'C3', 'C4', 'SEM'].map((m) => mkBook(m, 100)),
      [
        ...read('C1', 100, '2026-09-26', 1, 2), // 7 days
        ...read('C2', 100, '2026-07-05', 1, 2), // 90 days
        ...read('C3', 100, '2026-08-15', 1, 2), // 49 days
        ...read('C4', 100, '2025-01-10', 1, 2), // long ago, but reviewed 2 days ago
        ...read('SEM', 100, '2025-01-10', 1, 2), // no categoria
      ],
    );
    for (const m of ['C1', 'C2', 'C3', 'C4']) setCol(m, 'categoria', `cat-${m}`);
    const { id } = addNota(db, 'C4', 'x', '2026-09-01')!;
    revisarNota(db, id, true, '2026-10-01');

    expect(aprendizado().ferrugem).toEqual([
      { area: 'cat-C2', dias: 90, ferrugem: 100, ultimaAtividade: '2026-07-05' },
      { area: 'cat-C3', dias: 49, ferrugem: 51, ultimaAtividade: '2026-08-15' },
      { area: 'cat-C1', dias: 7, ferrugem: 0, ultimaAtividade: '2026-09-26' },
      { area: 'cat-C4', dias: 2, ferrugem: 0, ultimaAtividade: '2026-10-01' },
    ]);
  });

  it('uses the most recent book of the category and skips categories without activity', () => {
    seed([mkBook('A', 100), mkBook('B', 100), mkBook('N', 100)], [...read('A', 100, '2026-05-01', 1, 2), ...read('B', 100, '2026-10-01', 1, 2)]);
    setCol('A', 'categoria', 'redes');
    setCol('B', 'categoria', 'redes');
    setCol('N', 'categoria', 'nunca lida');
    expect(aprendizado().ferrugem).toEqual([{ area: 'redes', dias: 2, ferrugem: 0, ultimaAtividade: '2026-10-01' }]);
  });
});

describe('árvore de habilidades', () => {
  it('sums minutes and finished books per node and into the root, with levels from points', () => {
    seed(
      [mkBook('G', 10), mkBook('C', 100)],
      [...read('G', 10, '2026-09-01', 1, 10), ...read('C', 100, '2026-09-02', 1, 60)],
    );
    setCol('G', 'area', 'grafos'); // 10 min, lido -> 5.17 points
    setCol('C', 'area', 'complexidade'); // 60 min -> 1 point
    const algoritmos = aprendizado().arvore.find((n) => n.id === 'algoritmos')!;
    expect(algoritmos).toMatchObject({ nome: 'Algoritmos', minutos: 70, livrosLidos: 1, nivel: 2 });
    const filho = (id: string) => algoritmos.filhos.find((f) => f.id === id);
    expect(filho('grafos')).toMatchObject({ minutos: 10, livrosLidos: 1, nivel: 2, filhos: [] });
    expect(filho('complexidade')).toMatchObject({ minutos: 60, livrosLidos: 0, nivel: 1 });
    expect(filho('programacao-dinamica')).toMatchObject({ minutos: 0, livrosLidos: 0, nivel: 0 });
  });

  it('sets and clears the node of a book', () => {
    seed([mkBook('A', 10)]);
    expect(setArea(db, 'A', 'compiladores')).toBe('ok');
    expect(getLivroAprendizado(db, 'A')).toEqual({ area: 'compiladores', notas: [] });
    expect(setArea(db, 'A', 'nao-existe')).toBe('invalid');
    expect(setArea(db, 'X', 'compiladores')).toBe('not-found');
    expect(setArea(db, 'A', null)).toBe('ok');
    expect(getLivroAprendizado(db, 'A')?.area).toBeNull();
    expect(getLivroAprendizado(db, 'X')).toBeUndefined();
  });
});

describe('trilhas', () => {
  it('marks items as vazio, andamento or feito and computes progress', () => {
    seed([mkBook('LIDO', 10), mkBook('LENDO', 100)], [...read('LIDO', 10, '2026-09-01', 1, 10), ...read('LENDO', 100, '2026-10-02', 1, 5)]);
    expect(setTrilhaItem(db, 'construir-linguagem', 'analise', ['LIDO', 'LENDO'])).toBe('ok');
    expect(setTrilhaItem(db, 'construir-linguagem', 'interpretador', ['LENDO'])).toBe('ok');
    const trilha = aprendizado().trilhas.find((t) => t.id === 'construir-linguagem')!;
    expect(trilha.progresso).toBe(17);
    const estado = Object.fromEntries(trilha.itens.map((i) => [i.id, i.estado]));
    expect(estado).toMatchObject({ analise: 'feito', interpretador: 'andamento', tipos: 'vazio' });
    expect(trilha.itens.find((i) => i.id === 'analise')!.livros.map((l) => l.md5).sort()).toEqual(['LENDO', 'LIDO']);

    expect(setTrilhaItem(db, 'construir-linguagem', 'analise', [])).toBe('ok');
    expect(aprendizado().trilhas.find((t) => t.id === 'construir-linguagem')!.progresso).toBe(0);
  });

  it('rejects unknown trails, items, books and duplicates', () => {
    seed([mkBook('A', 10)]);
    expect(setTrilhaItem(db, 'nao-existe', 'analise', ['A'])).toBe('not-found');
    expect(setTrilhaItem(db, 'construir-linguagem', 'nao-existe', ['A'])).toBe('not-found');
    expect(setTrilhaItem(db, 'construir-linguagem', 'analise', ['X'])).toBe('unknown');
    expect(setTrilhaItem(db, 'construir-linguagem', 'analise', ['A', 'A'])).toBe('duplicate');
  });
});

describe('lacunas', () => {
  it('covers a base area only with minutes in a book whose node lists it', () => {
    seed(
      [mkBook('COMP', 10), mkBook('REDES', 10), mkBook('SIS', 10)],
      [...read('COMP', 10, '2026-09-01', 1, 3), ...read('SIS', 10, '2026-09-01', 1, 4)],
    );
    setCol('COMP', 'area', 'compiladores');
    setCol('REDES', 'area', 'redes'); // no reading
    setCol('SIS', 'area', 'sistemas'); // root: SF, OS, AR
    const lacunas = Object.fromEntries(aprendizado().lacunas.map((l) => [l.id, l]));
    expect(lacunas.PL).toMatchObject({ minutos: 3, coberta: true });
    expect(lacunas.NC).toMatchObject({ minutos: 0, coberta: false });
    expect(lacunas.OS).toMatchObject({ minutos: 4, coberta: true });
    expect(lacunas.PD).toMatchObject({ minutos: 0, coberta: false });
    expect(lacunas.HCI.coberta).toBe(false);
  });

  it('counts a child-node book toward its root areas', () => {
    seed([mkBook('P', 10)], read('P', 10, '2026-09-01', 1, 2));
    setCol('P', 'area', 'protocolos');
    expect(aprendizado().lacunas.find((l) => l.id === 'NC')).toMatchObject({ minutos: 2, coberta: true });
  });
});

describe('mapa de tópicos', () => {
  it('splits by comma and newline, groups case-insensitively and weighs by minutes', () => {
    seed(
      [mkBook('T1', 100), mkBook('T2', 100), mkBook('T3', 100)],
      [...read('T1', 100, '2026-10-02', 1, 10), ...read('T2', 100, '2026-10-01', 1, 5)],
    );
    setCol('T1', 'topicos', 'Grafos, recursão\nHeaps');
    setCol('T2', 'topicos', 'grafos\n\n');
    setCol('T3', 'topicos', 'Heaps, heaps');
    expect(aprendizado().topicos).toEqual([
      { topico: 'Grafos', minutos: 15, livros: 2 },
      { topico: 'Heaps', minutos: 10, livros: 2 },
      { topico: 'recursão', minutos: 10, livros: 1 },
    ]);
  });
});
