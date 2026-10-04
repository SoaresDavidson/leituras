// Recharts props take color strings; SVG presentation attributes resolve var(), so charts follow the theme.
export const CHART = {
  main: 'var(--color-accent)',
  strong: 'var(--color-accent-hi)',
  soft: 'color-mix(in oklch, var(--color-accent) 45%, transparent)',
  ghost: 'var(--color-muted)',
  alt: 'var(--color-info)',
  grid: 'var(--color-line)',
  axis: 'var(--color-muted)',
};

export const tooltipStyle = {
  contentStyle: { background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 8, color: 'var(--color-fg)' },
  labelStyle: { color: 'var(--color-muted)' },
  cursor: { fill: 'var(--color-surface-2)' },
};
