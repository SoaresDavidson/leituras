export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const fmtDate = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
export const clampPct = (v: number) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);

/** Cor de progresso: vermelho (0%) -> verde (100%), interpolando o matiz em oklch. */
export const progressColor = (v: number) => {
  const t = clampPct(v) / 100;
  return `oklch(0.68 0.16 ${(25 + 120 * t).toFixed(1)})`;
};

export const fmtHours =(min: number) => `${(min / 60).toFixed(1).replace('.', ',')} h`;
