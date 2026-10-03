const formatters = new Map<string, Intl.DateTimeFormat>();

// Calendar day (YYYY-MM-DD) of an epoch-seconds instant in the given time zone.
export function dayKey(epochSeconds: number, timeZone: string): string {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(epochSeconds * 1000));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  const d = new Date(Date.parse(day) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}
