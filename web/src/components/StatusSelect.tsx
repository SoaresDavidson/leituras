import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BookSummary, ReadingStatus } from '@leituras/shared';
import { patchBook } from '../api';

export type StatusValue = ReadingStatus | '';

const OPTIONS: { value: StatusValue; label: string }[] = [
  { value: '', label: 'Automático' },
  { value: 'lendo', label: 'Lendo' },
  { value: 'lido', label: 'Lido' },
  { value: 'pausado', label: 'Pausado' },
];

export const ARQUIVADO_HINT = 'Livro arquivado: “Lendo” aparece como Pausado até você ler de novo.';

/** Controlled select shared by the book page form and the quick editor. */
export function StatusSelect({ value, onChange, disabled, arquivado, label = 'Status manual', className = 'input mt-1' }: {
  value: StatusValue;
  onChange: (v: StatusValue) => void;
  disabled?: boolean;
  arquivado?: boolean;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const showHint = arquivado && value === 'lendo';
  return (
    <>
      <label htmlFor={id} className="block label">{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={showHint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value as StatusValue)}
        className={className}
      >
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {showHint && <p id={hintId} className="hint">{ARQUIVADO_HINT}</p>}
    </>
  );
}

/** Saves the manual status immediately; one in-flight request per book. */
export function StatusQuickEdit({ book }: { book: Pick<BookSummary, 'md5' | 'statusManual' | 'arquivado' | 'title'> }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (v: StatusValue) => patchBook(book.md5, { statusManual: v || null }),
    onSuccess: (updated) => {
      qc.setQueryData(['book', book.md5], updated);
      for (const key of ['books', 'dashboard', 'livros']) qc.invalidateQueries({ queryKey: [key] });
    },
  });
  // show the chosen value while saving; falls back to the server value on error
  const value: StatusValue = save.isPending ? (save.variables ?? '') : (book.statusManual ?? '');
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <StatusSelect
        value={value}
        arquivado={book.arquivado}
        disabled={save.isPending}
        onChange={(v) => save.mutate(v)}
        label={`Status de ${book.title}`}
        className="input"
      />
      {save.isPending && <span role="status" className="muted">Salvando…</span>}
      {save.isError && <span role="alert" className="error">Erro ao salvar o status.</span>}
    </div>
  );
}
