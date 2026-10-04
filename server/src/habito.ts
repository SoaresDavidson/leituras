import type { Habito, HabitoDia, HabitoJanela, HabitoMeta, HabitoPatch, NivelSequencia, Sequencia } from '@leituras/shared';
import { addDays, dayKey, daysBetween } from './dates';
import type { Db } from './db';

export const DEFAULT_METAS = { dia: { minutos: 20, paginas: 0 }, mes: { minutos: 600, paginas: 0 } };
export const BRONZE_MINUTOS = 5;
export const GATILHO_MAX = 140;
const CALENDAR_DAYS = 365;
const PATTERN_DAYS = 90;
const WINDOW_DAYS = 30;
const HISTORY_LIMIT = 10;
// A streak survives one missed day; two in a row (a gap of 3+ days between reading days) break it
const MAX_GAP = 2;

const SETTING_KEYS = {
  metaDiaMinutos: 'habito.meta_dia_minutos',
  metaDiaPaginas: 'habito.meta_dia_paginas',
  metaMesMinutos: 'habito.meta_mes_minutos',
  metaMesPaginas: 'habito.meta_mes_paginas',
  gatilho: 'habito.gatilho',
} as const;

type Dia = { minutos: number; paginas: number };

export function computeStreaks(days: Iterable<string>, today: string): { atual: Sequencia | null; recorde: Sequencia | null; historico: Sequencia[] } {
  const sorted = [...new Set(days)].filter((d) => d <= today).sort();
  const runs: Sequencia[] = [];
  for (const day of sorted) {
    const last = runs.at(-1);
    if (last && daysBetween(last.fim, day) <= MAX_GAP) {
      last.fim = day;
      last.dias++;
    } else {
      runs.push({ inicio: day, fim: day, dias: 1 });
    }
  }
  const last = runs.at(-1);
  const atual = last && daysBetween(last.fim, today) <= MAX_GAP ? last : null;
  const recorde = runs.reduce<Sequencia | null>((best, r) => (best == null || r.dias > best.dias ? r : best), null);
  const historico = (atual ? runs.slice(0, -1) : runs).reverse();
  return { atual, recorde, historico };
}

export function readHabitoSettings(db: Db): { metas: { dia: HabitoMeta; mes: HabitoMeta }; gatilho: string } {
  const get = (key: string) => (db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const num = (key: string, fallback: number) => Number(get(key) ?? fallback);
  return {
    metas: {
      dia: { minutos: num(SETTING_KEYS.metaDiaMinutos, DEFAULT_METAS.dia.minutos), paginas: num(SETTING_KEYS.metaDiaPaginas, DEFAULT_METAS.dia.paginas) },
      mes: { minutos: num(SETTING_KEYS.metaMesMinutos, DEFAULT_METAS.mes.minutos), paginas: num(SETTING_KEYS.metaMesPaginas, DEFAULT_METAS.mes.paginas) },
    },
    gatilho: get(SETTING_KEYS.gatilho) ?? '',
  };
}

export function updateHabitoSettings(db: Db, patch: HabitoPatch): void {
  const upsert = db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [field, key] of Object.entries(SETTING_KEYS)) {
      const value = patch[field as keyof HabitoPatch];
      if (value !== undefined) upsert.run(key, String(value));
    }
  })();
}

// A goal part set to 0 is off; every part that is on must be reached
const meets = (dia: Dia, meta: HabitoMeta, factor = 1) =>
  (meta.minutos === 0 || dia.minutos >= meta.minutos * factor) && (meta.paginas === 0 || dia.paginas >= meta.paginas * factor);

const NIVEIS: { nivel: NivelSequencia; cumpre: (dia: Dia, meta: HabitoMeta) => boolean }[] = [
  { nivel: 'bronze', cumpre: (dia) => dia.minutos >= BRONZE_MINUTOS },
  { nivel: 'prata', cumpre: (dia, meta) => meets(dia, meta) },
  { nivel: 'ouro', cumpre: (dia, meta) => meets(dia, meta, 2) },
];

const hourFormatters = new Map<string, Intl.DateTimeFormat>();
function hourOf(epochSeconds: number, timeZone: string): number {
  let fmt = hourFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    hourFormatters.set(timeZone, fmt);
  }
  return Number(fmt.format(new Date(epochSeconds * 1000)));
}

// 0 = Monday .. 6 = Sunday
const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

const range = (from: string, to: string) => Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
const pct = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 100));

export function getHabito(db: Db, timeZone: string, now = Date.now()): Habito {
  const today = dayKey(now / 1000, timeZone);
  const { metas, gatilho } = readHabitoSettings(db);

  const seconds = new Map<string, number>();
  const pages = new Map<string, Set<string>>();
  const porHora = Array<number>(24).fill(0);
  const patternStart = addDays(today, -(PATTERN_DAYS - 1));
  const rows = db.prepare('SELECT book_md5, page, start_time, duration FROM page_stat').all() as
    { book_md5: string; page: number; start_time: number; duration: number }[];
  for (const row of rows) {
    const day = dayKey(row.start_time, timeZone);
    seconds.set(day, (seconds.get(day) ?? 0) + row.duration);
    if (!pages.has(day)) pages.set(day, new Set());
    pages.get(day)!.add(`${row.book_md5}:${row.page}`);
    if (day >= patternStart && day <= today) porHora[hourOf(row.start_time, timeZone)] += row.duration / 60;
  }

  const diaDe = (day: string): Dia => ({ minutos: Math.round((seconds.get(day) ?? 0) / 60), paginas: pages.get(day)?.size ?? 0 });
  const leu = (d: Dia) => d.minutos > 0 || d.paginas > 0;

  const allDays = [...seconds.keys()];
  const niveis = NIVEIS.map(({ nivel, cumpre }) => {
    const { atual, recorde, historico } = computeStreaks(allDays.filter((d) => cumpre(diaDe(d), metas.dia)), today);
    return { nivel, atual, recorde, historico: historico.slice(0, HISTORY_LIMIT) };
  });

  const daily: HabitoDia[] = range(addDays(today, -(CALENDAR_DAYS - 1)), today).map((date) => {
    const d = diaDe(date);
    return { date, minutes: d.minutos, pages: d.paginas, metaBatida: meets(d, metas.dia) };
  });

  const sum = (days: string[]) => days.map(diaDe).reduce((a, d) => ({ minutos: a.minutos + d.minutos, paginas: a.paginas + d.paginas }), { minutos: 0, paginas: 0 });
  const janela = (inicio: string, fim: string): HabitoJanela => {
    const days = range(inicio, fim);
    return {
      inicio,
      fim,
      ...sum(days),
      diasComLeitura: days.filter((d) => leu(diaDe(d))).length,
      diasComMeta: days.filter((d) => meets(diaDe(d), metas.dia)).length,
    };
  };

  const patternDays = range(patternStart, today);
  const porDiaSemana = Array.from({ length: 7 }, (_, wd) => {
    const days = patternDays.filter((d) => weekdayOf(d) === wd);
    return days.length === 0 ? 0 : sum(days).minutos / days.length;
  });

  const monday = addDays(today, -weekdayOf(today));
  const weekMinutes = (start: string) => range(start, addDays(start, 6)).map((d) => (d <= today ? diaDe(d).minutos : 0));
  const atual = weekMinutes(monday);
  const anterior = weekMinutes(addDays(monday, -7));
  const upToToday = (week: number[]) => week.slice(0, weekdayOf(today) + 1).reduce((a, b) => a + b, 0);

  // Today only counts once there is reading: an unfinished day should not drag the score down
  const consistFim = leu(diaDe(today)) ? today : addDays(today, -1);
  const consistInicio = addDays(consistFim, -(WINDOW_DAYS - 1));
  const consistDays = range(consistInicio, consistFim).map(diaDe);
  const diasComMeta = consistDays.filter((d) => meets(d, metas.dia)).length;
  const diasComLeitura = consistDays.filter(leu).length;
  const peso = consistDays.reduce((a, d) => a + (meets(d, metas.dia) ? 1 : leu(d) ? 0.5 : 0), 0);

  return {
    hoje: today,
    metas,
    gatilho,
    progresso: { dia: diaDe(today), mes: sum(range(`${today.slice(0, 7)}-01`, today)) },
    niveis,
    daily,
    porHora: porHora.map(Math.round),
    porDiaSemana,
    semana: { atual, anterior, variacao: pct(upToToday(atual), upToToday(anterior)) },
    vsPassado: {
      atual: janela(addDays(today, -(WINDOW_DAYS - 1)), today),
      antes: janela(addDays(today, -(PATTERN_DAYS + WINDOW_DAYS - 1)), addDays(today, -PATTERN_DAYS)),
    },
    consistencia: { pontuacao: Math.round((100 * peso) / WINDOW_DAYS), diasComMeta, diasComLeitura, inicio: consistInicio, fim: consistFim },
  };
}
