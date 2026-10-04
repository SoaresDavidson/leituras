import type { ReadingStatus } from '@leituras/shared';

const styles: Record<ReadingStatus | 'arquivado', string> = {
  lendo: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  lido: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  pausado: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  arquivado: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
};

export default function StatusBadge({ status, arquivado = false }: { status: ReadingStatus; arquivado?: boolean }) {
  const label = arquivado ? 'arquivado' : status;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[label]}`}>{label}</span>;
}
