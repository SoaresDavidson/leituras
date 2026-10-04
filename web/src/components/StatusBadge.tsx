import type { ReadingStatus } from '@leituras/shared';

const styles: Record<ReadingStatus | 'arquivado', string> = {
  lendo: 'border-info/50 text-info',
  lido: 'border-ok/50 text-ok',
  pausado: 'border-warn/50 text-warn',
  arquivado: 'border-line text-muted',
};

export default function StatusBadge({ status, arquivado = false }: { status: ReadingStatus; arquivado?: boolean }) {
  const label = arquivado ? 'arquivado' : status;
  return <span className={`tag ${styles[label]}`}>{label}</span>;
}
