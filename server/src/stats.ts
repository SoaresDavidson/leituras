import type { ReadingStatus } from '@leituras/shared';
import { daysBetween, dayKey } from './dates';

export type StatRow = { page: number; start_time: number; duration: number; total_pages: number };

export type BookStats = {
  progress: number; // 0-100, distinct pages read / book pages
  startedAt: string | null;
  finishedAt: string | null; // day progress first reached FINISHED_PROGRESS
  lastReadAt: string | null; // any recorded page, even a brief open
  lastActiveAt: string | null; // last day of the latest session of at least MIN_ACTIVE_SESSION_SECONDS
  totalSeconds: number;
  sessions: number;
  daily: Map<string, number>; // day -> seconds
  progressTimeline: { date: string; progress: number }[];
};

export const FINISHED_PROGRESS = 95;
export const READING_WINDOW_DAYS = 30;
// Page turns further apart than this start a new reading session
export const SESSION_GAP_SECONDS = 30 * 60;
// A session shorter than this (opening a book to look something up, browsing the library)
// is kept in the history but does not make the book 'lendo'
export const MIN_ACTIVE_SESSION_SECONDS = 5 * 60;

// KOReader page numbers depend on font/layout at read time, so each stat is
// rescaled from its own total_pages to the book's current page count.
function normalizedPage(stat: StatRow, bookPages: number): number {
  if (!stat.total_pages || stat.total_pages === bookPages) return stat.page;
  return Math.max(1, Math.round((stat.page / stat.total_pages) * bookPages));
}

export function computeBookStats(stats: StatRow[], bookPages: number, timeZone: string): BookStats {
  const sorted = [...stats].sort((a, b) => a.start_time - b.start_time);
  const seen = new Set<number>();
  const daily = new Map<string, number>();
  const progressTimeline: BookStats['progressTimeline'] = [];
  let finishedAt: string | null = null;
  let totalSeconds = 0;
  let sessions = 0;
  let lastEnd = -Infinity;
  let sessionSeconds = 0;
  let lastActiveAt: string | null = null;

  for (const stat of sorted) {
    const day = dayKey(stat.start_time, timeZone);
    totalSeconds += stat.duration;
    daily.set(day, (daily.get(day) ?? 0) + stat.duration);
    if (stat.start_time - lastEnd > SESSION_GAP_SECONDS) {
      sessions++;
      sessionSeconds = 0;
    }
    lastEnd = stat.start_time + stat.duration;
    sessionSeconds += stat.duration;
    if (sessionSeconds >= MIN_ACTIVE_SESSION_SECONDS) lastActiveAt = day;

    if (bookPages > 0) seen.add(normalizedPage(stat, bookPages));
    const progress = bookPages > 0 ? Math.min(100, Math.round((seen.size / bookPages) * 100)) : 0;

    const last = progressTimeline.at(-1);
    if (last?.date === day) last.progress = progress;
    else progressTimeline.push({ date: day, progress });

    if (!finishedAt && progress >= FINISHED_PROGRESS) finishedAt = day;
  }

  return {
    progress: progressTimeline.at(-1)?.progress ?? 0,
    startedAt: progressTimeline[0]?.date ?? null,
    finishedAt,
    lastReadAt: progressTimeline.at(-1)?.date ?? null,
    lastActiveAt,
    totalSeconds,
    sessions,
    daily,
    progressTimeline,
  };
}

export type StatusInput = {
  progress: number; // 0-100
  lastActiveAt: string | null; // YYYY-MM-DD, BookStats.lastActiveAt
  today: string; // YYYY-MM-DD
  statusManual: ReadingStatus | null;
};

export function computeStatus(input: StatusInput): ReadingStatus {
  if (input.statusManual) return input.statusManual;
  if (input.progress >= FINISHED_PROGRESS) return 'lido';
  if (input.lastActiveAt != null && daysBetween(input.lastActiveAt, input.today) < READING_WINDOW_DAYS) return 'lendo';
  return 'pausado';
}

// The single status rule for every consumer (library, panel, focus, game).
// Archiving closes a book: it stops being 'lendo' until it is actively read again.
export function effectiveStatus(input: StatusInput & { arquivadoEm: string | null }): { status: ReadingStatus; arquivado: boolean } {
  const arquivado = input.arquivadoEm != null && (input.lastActiveAt == null || input.lastActiveAt <= input.arquivadoEm);
  const status = computeStatus(input);
  return { status: arquivado && status === 'lendo' ? 'pausado' : status, arquivado };
}
