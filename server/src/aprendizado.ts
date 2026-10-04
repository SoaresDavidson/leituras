import type { Aprendizado, BookDetail, LivroAprendizado, NoArvore, Nota, TrilhaProgresso } from '@leituras/shared';
import {
  ARVORE, BASE_ACM, INTERVALOS, NIVEIS, PONTOS_POR_LIVRO, RUST_FULL_DAYS, RUST_GRACE_DAYS, TRILHAS, type NoSemente,
} from './aprendizado-dados';
import { listBookDetails } from './books';
import { addDays, dayKey, daysBetween } from './dates';
import type { Db } from './db';

type NotaRow = {
  id: number; md5: string; title: string; texto: string; criado_em: string;
  etapa: number; proxima_revisao: string; revisado_em: string | null;
};

const NOTA_SQL = `
  SELECT a.id, a.md5, b.title, a.texto, a.criado_em, a.etapa, a.proxima_revisao, a.revisado_em
  FROM aprendizado a JOIN book b ON b.md5 = a.md5`;

const toNota = (r: NotaRow): Nota => ({
  id: r.id, md5: r.md5, bookTitle: r.title, texto: r.texto, criadoEm: r.criado_em,
  etapa: r.etapa, proximaRevisao: r.proxima_revisao, revisadoEm: r.revisado_em,
});

const getNota = (db: Db, id: number) => {
  const row = db.prepare(`${NOTA_SQL} WHERE a.id = ?`).get(id) as NotaRow | undefined;
  return row && toNota(row);
};

const bookExists = (db: Db, md5: string) => db.prepare('SELECT 1 FROM book WHERE md5 = ?').get(md5) !== undefined;

// ---- notes and spaced review ----

export function addNota(db: Db, md5: string, texto: string, today: string): Nota | undefined {
  if (!bookExists(db, md5)) return undefined;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO aprendizado (md5, texto, criado_em, etapa, proxima_revisao) VALUES (?, ?, ?, 0, ?)')
    .run(md5, texto, today, addDays(today, INTERVALOS[0]));
  return getNota(db, Number(lastInsertRowid));
}

export function deleteNota(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM aprendizado WHERE id = ?').run(id).changes > 0;
}

// lembrei advances one step (capped at the last interval); esqueci goes back to the first
export function revisarNota(db: Db, id: number, lembrei: boolean, today: string): Nota | undefined {
  const nota = getNota(db, id);
  if (!nota) return undefined;
  const etapa = lembrei ? Math.min(nota.etapa + 1, INTERVALOS.length - 1) : 0;
  db.prepare('UPDATE aprendizado SET etapa = ?, proxima_revisao = ?, revisado_em = ? WHERE id = ?')
    .run(etapa, addDays(today, INTERVALOS[etapa]), today, id);
  return getNota(db, id);
}

// ---- book mapping ----

const NODE_IDS = new Set(ARVORE.flatMap((n) => [n.id, ...(n.filhos ?? []).map((f) => f.id)]));

export function getLivroAprendizado(db: Db, md5: string): LivroAprendizado | undefined {
  const row = db.prepare('SELECT area FROM book WHERE md5 = ?').get(md5) as { area: string | null } | undefined;
  if (!row) return undefined;
  const notas = (db.prepare(`${NOTA_SQL} WHERE a.md5 = ? ORDER BY a.criado_em DESC, a.id DESC`).all(md5) as NotaRow[]).map(toNota);
  return { area: row.area, notas };
}

export function setArea(db: Db, md5: string, area: string | null): 'ok' | 'not-found' | 'invalid' {
  if (area !== null && !NODE_IDS.has(area)) return 'invalid';
  return db.prepare('UPDATE book SET area = ? WHERE md5 = ?').run(area, md5).changes > 0 ? 'ok' : 'not-found';
}

// Replaces the books marked on one trail item
export function setTrilhaItem(db: Db, trilha: string, item: string, md5s: string[]): 'ok' | 'not-found' | 'unknown' | 'duplicate' {
  if (!TRILHAS.find((t) => t.id === trilha)?.itens.some((i) => i.id === item)) return 'not-found';
  if (new Set(md5s).size !== md5s.length) return 'duplicate';
  if (md5s.some((md5) => !bookExists(db, md5))) return 'unknown';
  const insert = db.prepare('INSERT INTO trilha_livro (trilha, item, md5) VALUES (?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM trilha_livro WHERE trilha = ? AND item = ?').run(trilha, item);
    for (const md5 of md5s) insert.run(trilha, item, md5);
  })();
  return 'ok';
}

// ---- computed views ----

export function rustPercent(dias: number): number {
  if (dias <= RUST_GRACE_DAYS) return 0;
  if (dias >= RUST_FULL_DAYS) return 100;
  return Math.round(((dias - RUST_GRACE_DAYS) / (RUST_FULL_DAYS - RUST_GRACE_DAYS)) * 100);
}

const nivel = (minutos: number, livrosLidos: number) => {
  const pontos = minutos / 60 + PONTOS_POR_LIVRO * livrosLidos;
  return NIVEIS.filter((n) => pontos >= n).length;
};

type BookArea = BookDetail & { area: string | null };

function ferrugem(books: BookArea[], notas: Nota[], today: string): Aprendizado['ferrugem'] {
  const latest = new Map<string, string>();
  const bump = (area: string, day: string | null) => {
    if (!area || !day) return;
    if (day > (latest.get(area) ?? '')) latest.set(area, day);
  };
  const categoriaOf = new Map(books.map((b) => [b.md5, b.categoria]));
  for (const b of books) bump(b.categoria, b.lastReadAt);
  for (const n of notas) bump(categoriaOf.get(n.md5) ?? '', n.revisadoEm);
  return [...latest]
    .map(([area, ultimaAtividade]) => {
      const dias = daysBetween(ultimaAtividade, today);
      return { area, dias, ferrugem: rustPercent(dias), ultimaAtividade };
    })
    .sort((a, b) => b.dias - a.dias || a.area.localeCompare(b.area));
}

function arvore(books: BookArea[]): NoArvore[] {
  const totals = (ids: string[]) => {
    const inNode = books.filter((b) => b.area != null && ids.includes(b.area));
    const minutos = inNode.reduce((sum, b) => sum + b.totalMinutes, 0);
    const livrosLidos = inNode.filter((b) => b.status === 'lido').length;
    return { minutos, livrosLidos, nivel: nivel(minutos, livrosLidos) };
  };
  const build = (n: NoSemente): NoArvore => {
    const filhos = (n.filhos ?? []).map(build);
    return { id: n.id, nome: n.nome, ...totals([n.id, ...filhos.map((f) => f.id)]), filhos };
  };
  return ARVORE.map(build);
}

function lacunas(books: BookArea[]): Aprendizado['lacunas'] {
  // ACM areas covered by each node: its own plus its root's
  const acmOf = new Map<string, Set<string>>();
  for (const root of ARVORE) {
    acmOf.set(root.id, new Set(root.acm));
    for (const f of root.filhos ?? []) acmOf.set(f.id, new Set([...root.acm, ...f.acm]));
  }
  return BASE_ACM.map(({ id, nome }) => {
    const minutos = books
      .filter((b) => b.area != null && acmOf.get(b.area)?.has(id))
      .reduce((sum, b) => sum + b.totalMinutes, 0);
    return { id, nome, minutos, coberta: minutos > 0 };
  });
}

function trilhas(db: Db, books: BookArea[]): TrilhaProgresso[] {
  const byMd5 = new Map(books.map((b) => [b.md5, b]));
  const rows = db.prepare('SELECT trilha, item, md5 FROM trilha_livro').all() as { trilha: string; item: string; md5: string }[];
  return TRILHAS.map((t) => {
    const itens = t.itens.map((i) => {
      const livros = rows
        .filter((r) => r.trilha === t.id && r.item === i.id)
        .map((r) => byMd5.get(r.md5)!)
        .map(({ md5, title, status }) => ({ md5, title, status }));
      const estado = livros.some((l) => l.status === 'lido') ? 'feito' as const : livros.length > 0 ? 'andamento' as const : 'vazio' as const;
      return { ...i, estado, livros };
    });
    const feitos = itens.filter((i) => i.estado === 'feito').length;
    return { id: t.id, nome: t.nome, progresso: Math.round((feitos / itens.length) * 100), itens };
  });
}

export function splitTopicos(topicos: string): string[] {
  return topicos.split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
}

function topicos(books: BookArea[]): Aprendizado['topicos'] {
  const acc = new Map<string, { topico: string; minutos: number; livros: number }>();
  for (const b of books) {
    const seen = new Set<string>();
    for (const t of splitTopicos(b.topicos)) {
      const key = t.toLocaleLowerCase('pt-BR');
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = acc.get(key) ?? { topico: t, minutos: 0, livros: 0 };
      entry.minutos += b.totalMinutes;
      entry.livros += 1;
      acc.set(key, entry);
    }
  }
  return [...acc.values()].sort((a, b) => b.minutos - a.minutos || a.topico.localeCompare(b.topico, 'pt-BR'));
}

export function getAprendizado(db: Db, timeZone: string, now = Date.now()): Aprendizado {
  const today = dayKey(now / 1000, timeZone);
  const areas = new Map((db.prepare('SELECT md5, area FROM book').all() as { md5: string; area: string | null }[]).map((r) => [r.md5, r.area]));
  const books: BookArea[] = listBookDetails(db, timeZone, now).map((b) => ({ ...b, area: areas.get(b.md5) ?? null }));
  const notas = (db.prepare(`${NOTA_SQL} ORDER BY a.criado_em DESC, a.id DESC`).all() as NotaRow[]).map(toNota);
  const revisarHoje = notas
    .filter((n) => n.proximaRevisao <= today)
    .sort((a, b) => a.proximaRevisao.localeCompare(b.proximaRevisao) || a.id - b.id);

  return {
    hoje: today,
    notas,
    revisarHoje,
    ferrugem: ferrugem(books, notas, today),
    arvore: arvore(books),
    trilhas: trilhas(db, books),
    lacunas: lacunas(books),
    topicos: topicos(books),
  };
}
