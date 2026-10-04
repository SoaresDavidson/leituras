import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookDetail, NoArvore } from '@leituras/shared';
import { deleteNota, getAprendizado, getLivroAprendizado, postNota, putArea } from '../api';
import { fmtDate } from '../format';
import { Card } from './Card';

export const btn = 'rounded border border-stone-300 px-2 py-1 text-sm hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800';
export const input = 'w-full rounded border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700 dark:bg-stone-900';
export const primary = 'rounded bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-50';

export function useAprendizadoMutation<T, R = unknown>(fn: (arg: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aprendizado'] });
      qc.invalidateQueries({ queryKey: ['aprendizado-livro'] });
    },
  });
}

// Writes a new note for `md5`; used on the book page and on /aprendizado
export function NovaNota({ md5, placeholder }: { md5: string; placeholder?: string }) {
  const [texto, setTexto] = useState('');
  const salvar = useAprendizadoMutation(() => postNota(md5, texto));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate(undefined, { onSuccess: () => setTexto('') });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm">Novo aprendizado
        <textarea rows={3} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} className={input} />
      </label>
      <div className="flex items-center gap-3">
        <button disabled={!md5 || !texto.trim() || salvar.isPending} className={primary}>Salvar</button>
        {salvar.isError && <span className="text-sm text-red-600">Erro ao salvar.</span>}
      </div>
    </form>
  );
}

export function AreaSelect({ arvore, value, onChange, disabled }: {
  arvore: NoArvore[]; value: string | null; onChange: (area: string | null) => void; disabled?: boolean;
}) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={input}>
      <option value="">Sem área</option>
      {arvore.map((raiz) => (
        <optgroup key={raiz.id} label={raiz.nome}>
          <option value={raiz.id}>{raiz.nome} (geral)</option>
          {raiz.filhos.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export default function AprendizadoLivro({ book }: { book: BookDetail }) {
  const livro = useQuery({ queryKey: ['aprendizado-livro', book.md5], queryFn: () => getLivroAprendizado(book.md5) });
  const geral = useQuery({ queryKey: ['aprendizado'], queryFn: getAprendizado });
  const area = useAprendizadoMutation((a: string | null) => putArea(book.md5, a));
  const apagar = useAprendizadoMutation(deleteNota);
  const lido = book.status === 'lido';

  return (
    <Card title="O que aprendi">
      {lido && <p className="mb-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">Terminou! O que ficou deste livro?</p>}
      <div className="space-y-4">
        <label className="block text-sm">Área da árvore de habilidades
          {geral.data && livro.data
            ? <AreaSelect arvore={geral.data.arvore} value={livro.data.area} disabled={area.isPending} onChange={(a) => area.mutate(a)} />
            : <div className="text-stone-500">Carregando…</div>}
        </label>
        {livro.data && livro.data.notas.length > 0 && (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {livro.data.notas.map((n) => (
              <li key={n.id} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words">{n.texto}</p>
                  <p className="text-xs text-stone-500">{fmtDate(n.criadoEm)} · revisar em {fmtDate(n.proximaRevisao)}</p>
                </div>
                <button aria-label="Apagar aprendizado" disabled={apagar.isPending} onClick={() => apagar.mutate(n.id)} className={btn}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <NovaNota md5={book.md5} placeholder={lido ? 'Uma ideia que você quer lembrar daqui a um ano' : 'Algo que você aprendeu até aqui'} />
      </div>
    </Card>
  );
}
