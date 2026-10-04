import { clampPct, progressColor } from '../format';

export default function ProgressBar({
  value,
  className = 'bg-accent',
  scale = false,
}: {
  value: number;
  className?: string;
  /** Colore a barra de vermelho (0%) a verde (100%). */
  scale?: boolean;
}) {
  const pct = clampPct(value);
  return (
    <div
      className="track"
      title={`${Math.round(pct)}%`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <i
        className={`track-fill ${className}`}
        style={{ width: `${pct}%`, ...(scale ? { backgroundColor: progressColor(pct) } : {}) }}
      />
    </div>
  );
}
