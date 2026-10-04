import type { DailyMinutes } from '@leituras/shared';
import { MONTHS } from '../format';

const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 28;
const TOP = 16;
const FILLS = ['fill-surface-2', 'fill-accent/25', 'fill-accent/50', 'fill-accent/75', 'fill-accent'];

function bucket(min: number) {
  if (min <= 0) return 0;
  if (min < 15) return 1;
  if (min < 30) return 2;
  if (min < 60) return 3;
  return 4;
}

// Parse YYYY-MM-DD as a local date (avoids UTC shifts).
const parse = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
};

type Props<T> = {
  daily: T[];
  bucketOf?: (d: T) => number; // 0-4, overrides the default minutes scale (e.g. to color by goal)
  label?: (d: T) => string; // cell tooltip
  ariaLabel?: string;
};

export default function Heatmap<T extends DailyMinutes>({ daily, bucketOf = (d) => bucket(d.minutes), label, ariaLabel = 'Mapa de calor de leitura' }: Props<T>) {
  if (daily.length === 0) return null;
  const offset = parse(daily[0].date).getDay(); // Sunday-first rows
  const weeks = Math.ceil((daily.length + offset) / 7);
  const labels: { x: number; text: string }[] = [];
  let lastMonth = -1;

  const cells = daily.map((d, i) => {
    const col = Math.floor((i + offset) / 7);
    const row = (i + offset) % 7;
    const date = parse(d.date);
    if (row === 0 || i === 0) {
      const m = date.getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        labels.push({ x: LEFT + col * STEP, text: MONTHS[m] });
      }
    }
    return (
      <rect key={d.date} x={LEFT + col * STEP} y={TOP + row * STEP} width={CELL} height={CELL} rx={2}
        className={FILLS[bucketOf(d)]}>
        <title>{label ? label(d) : `${date.toLocaleDateString('pt-BR')}: ${d.minutes} min`}</title>
      </rect>
    );
  });

  return (
    <div className="overflow-x-auto">
      <svg width={LEFT + weeks * STEP} height={TOP + 7 * STEP} role="img" aria-label={ariaLabel}>
        {labels.map((l) => (
          <text key={l.x} x={l.x} y={10} className="fill-muted text-[10px]">{l.text}</text>
        ))}
        {[['seg', 1], ['qua', 3], ['sex', 5]].map(([t, r]) => (
          <text key={t} x={0} y={TOP + (r as number) * STEP + 10} className="fill-muted text-[10px]">{t}</text>
        ))}
        {cells}
      </svg>
    </div>
  );
}
