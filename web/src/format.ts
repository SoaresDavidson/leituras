export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const fmtDate = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');
export const fmtHours = (min: number) => `${(min / 60).toFixed(1).replace('.', ',')} h`;
