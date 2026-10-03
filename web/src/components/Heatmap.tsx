import type { DailyMinutes } from '@leituras/shared';
import { MONTHS } from '../format';

const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 28;
const TOP = 16;
const FILLS = [
  'fill-stone-200 dark:fill-stone-800',
  'fill-emerald-200 dark:fill-emerald-900',
  'fill-emerald-400 dark:fill-emerald-700',
  'fill-emerald-500 dark:fill-emerald-500',
  'fill-emerald-700 dark:fill-emerald-300',
];

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

export default function Heatmap({ daily }: { daily: DailyMinutes[] }) {
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
        className={FILLS[bucket(d.minutes)]}>
        <title>{`${date.toLocaleDateString('pt-BR')}: ${d.minutes} min`}</title>
      </rect>
    );
  });

  return (
    <div className="overflow-x-auto">
      <svg width={LEFT + weeks * STEP} height={TOP + 7 * STEP} role="img" aria-label="Mapa de calor de leitura">
        {labels.map((l) => (
          <text key={l.x} x={l.x} y={10} className="fill-stone-500 text-[10px] dark:fill-stone-400">{l.text}</text>
        ))}
        {[['seg', 1], ['qua', 3], ['sex', 5]].map(([t, r]) => (
          <text key={t} x={0} y={TOP + (r as number) * STEP + 10} className="fill-stone-500 text-[10px] dark:fill-stone-400">{t}</text>
        ))}
        {cells}
      </svg>
    </div>
  );
}
