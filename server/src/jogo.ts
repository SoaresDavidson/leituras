import type {
  BookDetail, CartaDesafio, Chefe, ChefeDerrotado, ClasseLeitor, CorridaFantasma, Desafio, DesafioRelampago, EstadoDesafio, HabitoMeta, Jogo, Medalha, Missao,
  ProgressoJogo, ReadingStatus, Recorde, UnidadeJogo,
} from '@leituras/shared';
import { listBookDetails, toSummary } from './books';
import { addDays, dayKey, daysBetween } from './dates';
import type { Db } from './db';
import { forecast, progressAt, RETA_FINAL_PROGRESS } from './foco';
import {
  BRONZE_MINUTOS, computeStreaks, dailyTotals, DEFAULT_METAS, hourOf, meets, readHabitoSettings, weekdayOf, type PageStatRow,
} from './habito';
import {
  CARTAS, CHEFE_PAGINAS, CLASSES, CLASSES_JANELA_DIAS, MEDALHAS, RELAMPAGO_ALVOS, RELAMPAGO_PRAZOS, SESSAO_LONGA_MINUTOS,
  type CartaId, type ClasseId, type MedalhaId,
} from './jogo-dados';
import { computeBookStats, effectiveStatus, SESSION_GAP_SECONDS, type StatRow } from './stats';

const CARTA_SETTING = 'jogo.carta_trocada_em';
const RESGATE_GAP_DIAS = 30;
const VELOCISTA = { dias: 7, paginas: 100 };

// ---- seeded draws: FNV-1a hash of the seed feeds a mulberry32 generator ----

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function embaralhar<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const sortear = <T>(items: readonly T[], seed: string): T => embaralhar(items, seed)[0];

// ---- context: everything is derived from page_stat, books and settings ----

type Dia = {
  segundos: number;
  paginas: Set<string>; // book:page
  porHora: number[]; // seconds per local hour
  livros: Map<string, { segundos: number; paginas: Set<number> }>;
};
type Sessao = { dia: string; segundos: number };
type Ontem = { progress: number; lastReadAt: string | null; status: ReadingStatus; arquivado: boolean };

export type Contexto = {
  hoje: string;
  hora: number;
  metas: { dia: HabitoMeta; mes: HabitoMeta };
  dias: Map<string, Dia>; // only days with reading
  totais: (day: string) => HabitoMeta; // minutes and distinct pages, same as the habit page
  sessoes: Sessao[]; // oldest first
  sessoesPorDia: Map<string, Sessao[]>;
  livros: BookDetail[]; // sorted by md5 so draws do not depend on today's reading order
  ontem: Map<string, Ontem>; // book state at the end of yesterday
};

// A goal stored with both parts at 0 would be met by any day: use the default instead
const metaValida = (meta: HabitoMeta, padrao: HabitoMeta) => (meta.minutos === 0 && meta.paginas === 0 ? padrao : meta);

export function contexto(db: Db, timeZone: string, now = Date.now()): Contexto {
  const hoje = dayKey(now / 1000, timeZone);
  const rows = db.prepare('SELECT book_md5, page, start_time, duration FROM page_stat ORDER BY start_time').all() as PageStatRow[];

  const dias = new Map<string, Dia>();
  const sessoes: Sessao[] = [];
  let lastEnd = -Infinity;
  for (const row of rows) {
    const day = dayKey(row.start_time, timeZone);
    let dia = dias.get(day);
    if (!dia) {
      dia = { segundos: 0, paginas: new Set(), porHora: Array<number>(24).fill(0), livros: new Map() };
      dias.set(day, dia);
    }
    dia.segundos += row.duration;
    dia.paginas.add(`${row.book_md5}:${row.page}`);
    dia.porHora[hourOf(row.start_time, timeZone)] += row.duration;
    let livro = dia.livros.get(row.book_md5);
    if (!livro) {
      livro = { segundos: 0, paginas: new Set() };
      dia.livros.set(row.book_md5, livro);
    }
    livro.segundos += row.duration;
    livro.paginas.add(row.page);

    if (row.start_time - lastEnd > SESSION_GAP_SECONDS) sessoes.push({ dia: day, segundos: 0 });
    sessoes.at(-1)!.segundos += row.duration;
    lastEnd = row.start_time + row.duration;
  }

  const sessoesPorDia = new Map<string, Sessao[]>();
  for (const s of sessoes) sessoesPorDia.set(s.dia, [...(sessoesPorDia.get(s.dia) ?? []), s]);

  const livros = listBookDetails(db, timeZone, now).sort((a, b) => a.md5.localeCompare(b.md5));
  // Yesterday's state comes only from dated data: the manual status has no date, so it is ignored here,
  // and an archive counts only if it was made before today
  const arquivadoEm = new Map((db.prepare('SELECT md5, arquivado_em FROM book').all() as { md5: string; arquivado_em: string | null }[])
    .map((r) => [r.md5, r.arquivado_em]));
  const ontemDia = addDays(hoje, -1);
  // Yesterday's state runs the same stats and status rule on the stats recorded before today
  const statsAntes = new Map<string, StatRow[]>();
  for (const row of db.prepare('SELECT book_md5, page, start_time, duration, total_pages FROM page_stat').all() as (StatRow & { book_md5: string })[]) {
    if (dayKey(row.start_time, timeZone) >= hoje) continue;
    const list = statsAntes.get(row.book_md5);
    if (list) list.push(row);
    else statsAntes.set(row.book_md5, [row]);
  }
  const ontem = new Map(livros.map((b): [string, Ontem] => {
    const { progress, lastReadAt, lastActiveAt } = computeBookStats(statsAntes.get(b.md5) ?? [], b.pages, timeZone);
    const em = arquivadoEm.get(b.md5) ?? null;
    const { status, arquivado } = effectiveStatus({
      progress, lastActiveAt, today: ontemDia, statusManual: null, arquivadoEm: em != null && em < hoje ? em : null,
    });
    return [b.md5, { progress, lastReadAt, arquivado, status }];
  }));

  const { metas } = readHabitoSettings(db);
  return {
    hoje,
    hora: hourOf(now / 1000, timeZone),
    metas: { dia: metaValida(metas.dia, DEFAULT_METAS.dia), mes: metaValida(metas.mes, DEFAULT_METAS.mes) },
    dias,
    totais: dailyTotals(rows, timeZone).diaDe,
    sessoes,
    sessoesPorDia,
    livros,
    ontem,
  };
}

// ---- helpers ----

const range = (from: string, to: string) => (from > to ? [] : Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i)));
const minutos = (segundos: number) => Math.round(segundos / 60);
const totais = (ctx: Contexto, day: string): HabitoMeta => ctx.totais(day);
const soma = (ctx: Contexto, days: string[]) =>
  days.map((d) => totais(ctx, d)).reduce((a, t) => ({ minutos: a.minutos + t.minutos, paginas: a.paginas + t.paginas }), { minutos: 0, paginas: 0 });
const leu = (t: HabitoMeta) => t.minutos > 0 || t.paginas > 0;
const prog = (atual: number, alvo: number, unidade: UnidadeJogo, feito = atual >= alvo): ProgressoJogo => ({ atual, alvo, unidade, feito });
const fmtMeta = (m: HabitoMeta) => [m.minutos && `${m.minutos} min`, m.paginas && `${m.paginas} págs`].filter(Boolean).join(' e ');

// Goal progress in minutes when that part is on, else pages; done only when every part is met
const metaProgresso = (meta: HabitoMeta, t: HabitoMeta): ProgressoJogo =>
  meta.minutos > 0 ? prog(t.minutos, meta.minutos, 'min', meets(t, meta)) : prog(t.paginas, meta.paginas, 'págs', meets(t, meta));

const ultimoDia = (ym: string) => addDays(`${addDays(`${ym}-28`, 4).slice(0, 7)}-01`, -1);
const mesAnterior = (ym: string) => addDays(`${ym}-01`, -1).slice(0, 7);
const mesAnoAnterior = (ym: string) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;

const sessoesDoDia = (ctx: Contexto, day: string) => ctx.sessoesPorDia.get(day) ?? [];
const maiorSessaoHoje = (ctx: Contexto) => Math.max(0, ...sessoesDoDia(ctx, ctx.hoje).map((s) => minutos(s.segundos)));
const minutosHoje = (ctx: Contexto, hora: (h: number) => boolean) =>
  minutos(ctx.dias.get(ctx.hoje)?.porHora.reduce((a, s, h) => a + (hora(h) ? s : 0), 0) ?? 0);
const livroHoje = (ctx: Contexto, md5: string) => ctx.dias.get(ctx.hoje)?.livros.get(md5);

const abertosOntem = (ctx: Contexto) => ctx.livros.filter((b) => ctx.ontem.get(b.md5)!.status === 'lendo');
const paradosOntem = (ctx: Contexto) => ctx.livros.filter((b) => {
  const o = ctx.ontem.get(b.md5)!;
  return o.status === 'pausado' && !o.arquivado && o.lastReadAt != null;
});

// First item with the best value; ties keep the earliest
function melhor<T>(items: T[], valor: (t: T) => number, menor = false): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (best === undefined || (menor ? valor(item) < valor(best) : valor(item) > valor(best))) best = item;
  }
  return best;
}

// ---- missions and challenges ----

function missoes(ctx: Contexto): Missao[] {
  const meta: Missao = { id: 'meta', titulo: `Bater a meta do dia (${fmtMeta(ctx.metas.dia)})`, md5: null, ...metaProgresso(ctx.metas.dia, totais(ctx, ctx.hoje)) };

  const abertos = abertosOntem(ctx);
  const deLivro: { id: string; candidatos: BookDetail[]; montar: (b: BookDetail) => Missao }[] = [
    {
      id: 'livro-paginas',
      candidatos: abertos,
      montar: (b) => ({ id: 'livro-paginas', titulo: `Avançar 10 páginas em ${b.title}`, md5: b.md5, ...prog(livroHoje(ctx, b.md5)?.paginas.size ?? 0, 10, 'págs') }),
    },
    {
      id: 'reta-final',
      candidatos: abertos.filter((b) => ctx.ontem.get(b.md5)!.progress >= RETA_FINAL_PROGRESS),
      montar: (b) => ({ id: 'reta-final', titulo: `Ler 10 min de ${b.title}, na reta final`, md5: b.md5, ...prog(minutos(livroHoje(ctx, b.md5)?.segundos ?? 0), 10, 'min') }),
    },
    {
      id: 'resgate',
      candidatos: paradosOntem(ctx),
      montar: (b) => ({ id: 'resgate', titulo: `Resgatar ${b.title}: ler 5 min`, md5: b.md5, ...prog(minutos(livroHoje(ctx, b.md5)?.segundos ?? 0), 5, 'min') }),
    },
  ];
  const seed = `missao-livro:${ctx.hoje}`;
  const livro = deLivro.filter((t) => t.candidatos.length > 0).map((t) => t.montar(sortear(t.candidatos, `${seed}:${t.id}`)));

  const hoje = totais(ctx, ctx.hoje);
  const gerais: Missao[] = [
    { id: 'paginas', titulo: 'Ler 20 páginas hoje', md5: null, ...prog(hoje.paginas, 20, 'págs') },
    { id: 'sessao', titulo: 'Uma sessão de 30 min sem pausa', md5: null, ...prog(maiorSessaoHoje(ctx), 30, 'min') },
    { id: 'dois-momentos', titulo: 'Ler em dois momentos do dia', md5: null, ...prog(sessoesDoDia(ctx, ctx.hoje).length, 2, 'sessões') },
  ];
  const segunda = livro.length > 0 ? sortear(livro, seed) : sortear(gerais, `missao-geral-extra:${ctx.hoje}`);
  const terceira = sortear(gerais.filter((m) => m !== segunda), `missao-geral:${ctx.hoje}`);
  return [meta, segunda, terceira];
}

export function desafiosSemana(ctx: Contexto): Desafio[] {
  const inicio = addDays(ctx.hoje, -weekdayOf(ctx.hoje));
  const periodo = { inicio, fim: addDays(inicio, 6) };
  const dias = range(inicio, ctx.hoje).map((d) => totais(ctx, d));
  // 1.1 × the weekly average of the 4 previous weeks, rounded up to tens (integer math avoids 1.1 float noise)
  const antes = soma(ctx, range(addDays(inicio, -28), addDays(inicio, -1))).paginas;
  const alvoPaginas = Math.max(50, Math.ceil((antes * 11) / 400) * 10);
  const longas = range(inicio, ctx.hoje).flatMap((d) => sessoesDoDia(ctx, d)).filter((s) => minutos(s.segundos) >= SESSAO_LONGA_MINUTOS).length;
  return [
    { id: 'dias-meta', titulo: 'Bater a meta do dia em 5 dias', ...periodo, ...prog(dias.filter((t) => meets(t, ctx.metas.dia)).length, 5, 'dias') },
    { id: 'paginas', titulo: `Ler ${alvoPaginas} páginas na semana`, ...periodo, ...prog(dias.reduce((a, t) => a + t.paginas, 0), alvoPaginas, 'págs') },
    { id: 'sessoes-longas', titulo: `Fazer 3 sessões de ${SESSAO_LONGA_MINUTOS}+ min`, ...periodo, ...prog(longas, 3, 'sessões') },
    { id: 'todo-dia', titulo: 'Ler em 6 dos 7 dias', ...periodo, ...prog(dias.filter(leu).length, 6, 'dias') },
  ];
}

export function desafiosMes(ctx: Contexto): Desafio[] {
  const ym = ctx.hoje.slice(0, 7);
  const periodo = { inicio: `${ym}-01`, fim: ultimoDia(ym) };
  const dias = range(periodo.inicio, ctx.hoje);
  const total = soma(ctx, dias);
  const antes = soma(ctx, range(`${mesAnterior(mesAnterior(mesAnterior(ym)))}-01`, addDays(periodo.inicio, -1))).minutos;
  const horas = Math.max(5, Math.ceil((antes * 11) / (3 * 10 * 60)));
  const terminados = ctx.livros.filter((b) => b.status === 'lido' && b.finishedAt != null && b.finishedAt >= periodo.inicio && b.finishedAt <= ctx.hoje).length;
  return [
    { id: 'fechamentos', titulo: 'Mês de fechamentos: terminar 2 livros', ...periodo, ...prog(terminados, 2, 'livros') },
    { id: 'horas', titulo: `Ler ${horas} h no mês`, ...periodo, ...prog(total.minutos, horas * 60, 'min') },
    { id: 'dias', titulo: 'Ler em 20 dias do mês', ...periodo, ...prog(dias.filter((d) => leu(totais(ctx, d))).length, 20, 'dias') },
    { id: 'meta-mes', titulo: `Bater a meta do mês (${fmtMeta(ctx.metas.mes)})`, ...periodo, ...metaProgresso(ctx.metas.mes, total) },
  ];
}

// A challenge with a deadline hour is lost once that hour arrives unfinished
const estadoPrazo = (feito: boolean, hora: number, prazoHora?: number): EstadoDesafio =>
  feito ? 'feito' : prazoHora !== undefined && hora >= prazoHora ? 'perdido' : 'ativo';

export function cartas(ctx: Contexto): (ProgressoJogo & { id: CartaId; titulo: string; estado: EstadoDesafio })[] {
  const dia = ctx.dias.get(ctx.hoje);
  const parados = new Set(paradosOntem(ctx).map((b) => b.md5));
  const segundosParados = [...(dia?.livros ?? [])].filter(([md5]) => parados.has(md5)).reduce((a, [, l]) => a + l.segundos, 0);
  const atual: Record<CartaId, number> = {
    'antes-9h': minutosHoje(ctx, (h) => h < 9),
    noite: minutosHoje(ctx, (h) => h >= 21),
    'trinta-paginas': dia?.paginas.size ?? 0,
    'sessao-25': maiorSessaoHoje(ctx),
    'dois-livros': dia?.livros.size ?? 0,
    resgate: minutos(segundosParados),
  };
  return CARTAS.map((c) => {
    const p = prog(atual[c.id], c.alvo, c.unidade);
    return { id: c.id, titulo: c.titulo, ...p, estado: estadoPrazo(p.feito, ctx.hora, 'prazoHora' in c ? c.prazoHora : undefined) };
  });
}

const getSetting = (db: Db, key: string) => (db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined)?.value;

function cartaDoDia(db: Db, ctx: Contexto): CartaDesafio {
  const trocada = getSetting(db, CARTA_SETTING) === ctx.hoje;
  // Cards that need books the library does not have are left out of the deck
  const possivel: Record<CartaId, boolean> = {
    'antes-9h': true, noite: true, 'trinta-paginas': true, 'sessao-25': true,
    'dois-livros': ctx.livros.length >= 2,
    resgate: paradosOntem(ctx).length > 0,
  };
  const id = embaralhar(CARTAS.map((c) => c.id).filter((c) => possivel[c]), `carta:${ctx.hoje}`)[trocada ? 1 : 0];
  return { ...cartas(ctx).find((c) => c.id === id)!, trocada, podeTrocar: !trocada };
}

// Swaps today's card; false when it was already swapped today
export function trocarCarta(db: Db, timeZone: string, now = Date.now()): boolean {
  const hoje = dayKey(now / 1000, timeZone);
  if (getSetting(db, CARTA_SETTING) === hoje) return false;
  db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(CARTA_SETTING, hoje);
  return true;
}

function relampago(ctx: Contexto): DesafioRelampago {
  const prazoHora = sortear(RELAMPAGO_PRAZOS, `relampago-prazo:${ctx.hoje}`);
  const alvo = sortear(RELAMPAGO_ALVOS, `relampago-alvo:${ctx.hoje}`);
  const p = prog(minutosHoje(ctx, (h) => h < prazoHora), alvo, 'min');
  return { titulo: `Ler ${alvo} min antes das ${prazoHora}h`, prazoHora, ...p, estado: estadoPrazo(p.feito, ctx.hora, prazoHora) };
}

// ---- bosses and ghost race ----

function chefes(ctx: Contexto): { chefes: Chefe[]; chefesDerrotados: ChefeDerrotado[] } {
  const vivos = ctx.livros
    .filter((b) => b.status === 'lendo' && b.pages >= CHEFE_PAGINAS)
    .map((b) => {
      const danoPorDia = range(addDays(ctx.hoje, -6), ctx.hoje).map((date) => ({
        date,
        dano: Math.round((b.pages * (progressAt(b, date) - progressAt(b, addDays(date, -1)))) / 100),
      }));
      const recentes = (b.pages * (b.progress - progressAt(b, addDays(ctx.hoje, -14)))) / 100;
      return {
        book: toSummary(b),
        vida: Math.round((b.pages * (100 - b.progress)) / 100),
        vidaMax: b.pages,
        danoPorDia,
        danoMedio: recentes > 0 ? Math.round((recentes / 14) * 10) / 10 : null,
        previsao: forecast(b, ctx.hoje).previsao,
      };
    })
    .sort((a, b) => a.vida - b.vida);
  const derrotados = ctx.livros
    .filter((b) => b.status === 'lido' && b.pages >= CHEFE_PAGINAS)
    .map((b) => ({ book: toSummary(b), derrotadoEm: b.finishedAt }))
    .sort((a, b) => (b.derrotadoEm ?? '').localeCompare(a.derrotadoEm ?? ''));
  return { chefes: vivos, chefesDerrotados: derrotados };
}

function corrida(ctx: Contexto, id: CorridaFantasma['id'], mesFantasma: string): CorridaFantasma {
  const mes = ctx.hoje.slice(0, 7);
  const hojeIdx = Number(ctx.hoje.slice(8)) - 1;
  const acumulado = (ym: string) => {
    let total = 0;
    return range(`${ym}-01`, ultimoDia(ym)).map((d) => (total += ctx.dias.get(d)?.paginas.size ?? 0));
  };
  const voce = acumulado(mes);
  const fantasma = acumulado(mesFantasma);
  const fantasmaEm = (i: number) => fantasma[Math.min(i, fantasma.length - 1)];
  return {
    id,
    mes,
    mesFantasma,
    dias: voce.map((v, i) => ({ dia: i + 1, voce: i <= hojeIdx ? v : null, fantasma: fantasmaEm(i) })),
    voce: voce[hojeIdx],
    fantasma: fantasmaEm(hojeIdx),
  };
}

// ---- reader classes ----

function classes(ctx: Contexto): ClasseLeitor[] {
  const inicio = addDays(ctx.hoje, -(CLASSES_JANELA_DIAS - 1));
  const dias = range(inicio, ctx.hoje).flatMap((d) => ctx.dias.get(d) ?? []);
  const sessoes = range(inicio, ctx.hoje).flatMap((d) => sessoesDoDia(ctx, d));
  const total = dias.reduce((a, d) => a + d.segundos, 0);
  const share = (hora: (h: number) => boolean) =>
    total === 0 ? 0 : (100 * dias.reduce((a, d) => a + d.porHora.reduce((s, v, h) => s + (hora(h) ? v : 0), 0), 0)) / total;
  const categoria = new Map(ctx.livros.map((b) => [b.md5, b.categoria]));
  const categorias = new Set(dias.flatMap((d) => [...d.livros.keys()].map((md5) => categoria.get(md5) ?? '')).filter(Boolean));

  const valores: Record<ClasseId, number> = {
    maratonista: sessoes.length === 0 ? 0 : sessoes.reduce((a, s) => a + s.segundos, 0) / 60 / sessoes.length,
    constante: (100 * dias.length) / CLASSES_JANELA_DIAS,
    noturno: share((h) => h >= 21 || h < 5),
    madrugador: share((h) => h >= 5 && h < 9),
    explorador: categorias.size,
    finalizador: ctx.livros.filter((b) => b.status === 'lido' && b.finishedAt != null && b.finishedAt >= inicio && b.finishedAt <= ctx.hoje).length,
  };
  return CLASSES.map((c) => ({
    id: c.id,
    nome: c.nome,
    criterio: c.criterio,
    referencia: c.referencia,
    unidade: c.unidade,
    valor: Math.round(valores[c.id]),
    pontuacao: Math.min(100, Math.round((100 * valores[c.id]) / c.referencia)),
  }));
}

// ---- medals and records ----

function medalhasERecordes(ctx: Contexto): { medalhas: Medalha[]; recordes: Recorde[] } {
  const diasOrdenados = [...ctx.dias.keys()].sort();
  const terminados = ctx.livros
    .filter((b) => b.status === 'lido')
    .sort((a, b) => (a.finishedAt ?? '9999').localeCompare(b.finishedAt ?? '9999'));
  const datas = (livros: BookDetail[]) => livros.map((b) => b.finishedAt).filter((d): d is string => d != null).sort();
  const nth = <T>(items: T[], n: number) => (items.length >= n ? items[n - 1] : null);

  const bronze = diasOrdenados.filter((d) => totais(ctx, d).minutos >= BRONZE_MINUTOS);
  const streaks = computeStreaks(bronze, ctx.hoje);
  const runs = [...streaks.historico].reverse().concat(streaks.atual ? [streaks.atual] : []);
  const dataSequencia = (n: number) => {
    const run = runs.find((r) => r.dias >= n);
    return run ? bronze.filter((d) => d >= run.inicio)[n - 1] : null;
  };

  let acumulado = 0;
  const dataCemHoras = diasOrdenados.find((d) => (acumulado += ctx.dias.get(d)!.segundos) >= 100 * 3600) ?? null;
  const diasComHora = (hora: (h: number) => boolean) => diasOrdenados.filter((d) => ctx.dias.get(d)!.porHora.some((s, h) => s > 0 && hora(h)));

  const comPaginas = (min: number) => ctx.livros.filter((b) => b.pages >= min);
  const chefe = (min: number) => ({
    atual: Math.max(0, ...comPaginas(min).map((b) => (b.status === 'lido' ? 100 : b.progress))),
    data: nth(datas(comPaginas(min).filter((b) => b.status === 'lido')), 1),
  });

  const categoriasAte: { data: string | null; total: number }[] = [];
  const vistas = new Set<string>();
  for (const b of terminados) {
    if (b.categoria && !vistas.has(b.categoria)) {
      vistas.add(b.categoria);
      categoriasAte.push({ data: b.finishedAt, total: vistas.size });
    }
  }

  const resgatados = terminados.filter((b) => {
    const tl = b.progressTimeline.filter((p) => b.finishedAt == null || p.date <= b.finishedAt);
    return tl.some((p, i) => i > 0 && daysBetween(tl[i - 1].date, p.date) >= RESGATE_GAP_DIAS);
  });
  const duracao = (b: BookDetail) => (b.startedAt && b.finishedAt ? daysBetween(b.startedAt, b.finishedAt) + 1 : null);
  const velozes = terminados.filter((b) => b.pages >= VELOCISTA.paginas && (duracao(b) ?? Infinity) <= VELOCISTA.dias);

  const porMes = new Map<string, string[]>();
  for (const d of diasOrdenados) porMes.set(d.slice(0, 7), [...(porMes.get(d.slice(0, 7)) ?? []), d]);
  const meses = [...porMes].map(([mes, dias]) => ({ mes, dias, paginas: dias.reduce((a, d) => a + totais(ctx, d).paginas, 0) }));
  const dataMilPaginas = (() => {
    for (const { dias } of meses) {
      let total = 0;
      const dia = dias.find((d) => (total += totais(ctx, d).paginas) >= 1000);
      if (dia) return dia;
    }
    return null;
  })();
  const maiorSessao = melhor(ctx.sessoes, (s) => minutos(s.segundos));

  const regras: Record<MedalhaId, { atual: number; data: string | null }> = {
    'primeiro-livro': { atual: terminados.length, data: nth(datas(terminados), 1) },
    estante: { atual: terminados.length, data: nth(datas(terminados), 10) },
    'primeiro-chefe': chefe(CHEFE_PAGINAS),
    'chefao-mil': chefe(1000),
    'sequencia-7': { atual: streaks.recorde?.dias ?? 0, data: dataSequencia(7) },
    'sequencia-30': { atual: streaks.recorde?.dias ?? 0, data: dataSequencia(30) },
    'cem-horas': { atual: Math.floor([...ctx.dias.values()].reduce((a, d) => a + d.segundos, 0) / 3600), data: dataCemHoras },
    maratona: { atual: maiorSessao ? minutos(maiorSessao.segundos) : 0, data: ctx.sessoes.find((s) => minutos(s.segundos) >= 180)?.dia ?? null },
    coruja: { atual: diasComHora((h) => h >= 23 || h < 4).length, data: nth(diasComHora((h) => h >= 23 || h < 4), 20) },
    madrugador: { atual: diasComHora((h) => h >= 4 && h < 7).length, data: nth(diasComHora((h) => h >= 4 && h < 7), 10) },
    polimata: { atual: vistas.size, data: categoriasAte.find((c) => c.total >= 5)?.data ?? null },
    ressurreicao: { atual: resgatados.length, data: nth(datas(resgatados), 1) },
    velocista: { atual: velozes.length, data: nth(datas(velozes), 1) },
    'mil-paginas-mes': { atual: Math.max(0, ...meses.map((m) => m.paginas)), data: dataMilPaginas },
  };
  const medalhas: Medalha[] = MEDALHAS.map((m) => {
    const { atual, data } = regras[m.id];
    const feito = atual >= m.alvo;
    return { ...m, atual, feito, desbloqueadaEm: feito ? data : null };
  });

  const recorde = (id: string, rotulo: string, unidade: UnidadeJogo, valor: number | null, data: string | null, detalhe: string | null = null): Recorde =>
    ({ id, rotulo, unidade, valor, data: valor == null ? null : data, detalhe: valor == null ? null : detalhe });
  const diaPaginas = melhor(diasOrdenados, (d) => totais(ctx, d).paginas);
  const diaMinutos = melhor(diasOrdenados, (d) => totais(ctx, d).minutos);
  const porSemana = new Map<string, number>();
  for (const d of diasOrdenados) {
    const segunda = addDays(d, -weekdayOf(d));
    porSemana.set(segunda, (porSemana.get(segunda) ?? 0) + totais(ctx, d).minutos);
  }
  const semana = melhor([...porSemana], ([, m]) => m);
  const mes = melhor(meses, (m) => m.paginas);
  const rapido = melhor(terminados.filter((b) => duracao(b) != null), (b) => duracao(b)!, true);
  const maior = melhor(terminados, (b) => b.pages);

  const recordes = [
    recorde('maior-sessao', 'Maior sessão', 'min', maiorSessao ? minutos(maiorSessao.segundos) : null, maiorSessao?.dia ?? null),
    recorde('dia-paginas', 'Mais páginas num dia', 'págs', diaPaginas ? totais(ctx, diaPaginas).paginas : null, diaPaginas ?? null),
    recorde('dia-minutos', 'Mais tempo num dia', 'min', diaMinutos ? totais(ctx, diaMinutos).minutos : null, diaMinutos ?? null),
    recorde('semana', 'Melhor semana', 'min', semana?.[1] ?? null, semana?.[0] ?? null),
    recorde('mes-paginas', 'Mais páginas num mês', 'págs', mes?.paginas ?? null, mes?.mes ?? null),
    recorde('sequencia', 'Maior sequência', 'dias', streaks.recorde?.dias ?? null, streaks.recorde?.fim ?? null),
    recorde('livro-rapido', 'Livro mais rápido', 'dias', rapido ? duracao(rapido) : null, rapido?.finishedAt ?? null, rapido?.title ?? null),
    recorde('maior-livro', 'Maior livro terminado', 'págs', maior?.pages ?? null, maior?.finishedAt ?? null, maior?.title ?? null),
  ];
  return { medalhas, recordes };
}

export function getJogo(db: Db, timeZone: string, now = Date.now()): Jogo {
  const ctx = contexto(db, timeZone, now);
  const ym = ctx.hoje.slice(0, 7);
  const listaClasses = classes(ctx);
  const topo = melhor(listaClasses, (c) => c.pontuacao);
  const { medalhas, recordes } = medalhasERecordes(ctx);
  return {
    hoje: ctx.hoje,
    missoes: missoes(ctx),
    semana: sortear(desafiosSemana(ctx), `semana:${addDays(ctx.hoje, -weekdayOf(ctx.hoje))}`),
    mes: sortear(desafiosMes(ctx), `mes:${ym}`),
    carta: cartaDoDia(db, ctx),
    relampago: relampago(ctx),
    ...chefes(ctx),
    fantasma: [corrida(ctx, 'mes-passado', mesAnterior(ym)), corrida(ctx, 'ano-passado', mesAnoAnterior(ym))],
    classe: topo && topo.pontuacao > 0 ? topo : null,
    classes: listaClasses,
    medalhas,
    proximaConquista: melhor(medalhas.filter((m) => !m.feito), (m) => m.atual / m.alvo) ?? null,
    recordes,
  };
}
