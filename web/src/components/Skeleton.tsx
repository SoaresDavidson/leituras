// Placeholder shaped like the content that is about to load, instead of a "Carregando…" line.
const WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-3/4'];

export function SkeletonLines({ rows = 4, label = 'Carregando' }: { rows?: number; label?: string }) {
  // Fixed widths (not random) so the placeholder doesn't jump between renders; last row is short like a paragraph end
  const width = (i: number) => (rows > 1 && i === rows - 1 ? 'w-2/5' : WIDTHS[i % WIDTHS.length]);
  return (
    <div role="status" aria-label={label} className="space-y-2.5 py-1">
      {Array.from({ length: rows }, (_, i) => <div key={i} className={`skeleton h-3.5 ${width(i)}`} />)}
    </div>
  );
}

export function SkeletonCards({ count = 3, height = 'h-24' }: { count?: number; height?: string }) {
  return (
    <div role="status" aria-label="Carregando" className="space-y-3.5">
      {Array.from({ length: count }, (_, i) => <div key={i} className={`skeleton rounded-xl ${height}`} />)}
    </div>
  );
}
