import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookDetail, LivroAprendizado } from '@leituras/shared';
import { deleteNota, getLivroAprendizado, postNota, putArea } from '../api';
import { fmtDate } from '../format';
import { Card } from './Card';
import { SkeletonLines } from './Skeleton';

export const ErroInline = ({ show, children = 'Não foi possível salvar. Tente de novo.' }: { show: boolean; children?: string }) =>
  show ? <p role="alert" className="error">{children}</p> : null;

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
        <textarea rows={3} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} className="input" />
      </label>
      <div className="flex items-center gap-3">
        <button disabled={!md5 || !texto.trim() || salvar.isPending} className="btn-primary">Salvar</button>
        {salvar.isError && <span className="error">Erro ao salvar.</span>}
      </div>
    </form>
  );
}

export function AreaSelect({ arvore, value, onChange, disabled }: {
  arvore: LivroAprendizado['arvore']; value: string | null; onChange: (area: string | null) => void; disabled?: boolean;
}) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className="input">
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
  const area = useAprendizadoMutation((a: string | null) => putArea(book.md5, a));
  const apagar = useAprendizadoMutation(deleteNota);
  const lido = book.status === 'lido';

  return (
    <Card title="O que aprendi">
      {lido && <p className="success mb-3">Terminou! O que ficou deste livro?</p>}
      {livro.isError && (
        <div className="flex items-center gap-3">
          <span className="error">Erro ao carregar os aprendizados.</span>
          <button onClick={() => livro.refetch()} className="btn">Tentar de novo</button>
        </div>
      )}
      {livro.isLoading && <SkeletonLines rows={3} />}
      {livro.data && (
      <div className="space-y-4">
        <label className="block text-sm">Área da árvore de habilidades
          <AreaSelect arvore={livro.data.arvore} value={livro.data.area} disabled={area.isPending} onChange={(a) => area.mutate(a)} />
        </label>
        <ErroInline show={area.isError}>Não foi possível mudar a área.</ErroInline>
        {livro.data && livro.data.notas.length > 0 && (
          <ul className="list-divided">
            {livro.data.notas.map((n) => (
              <li key={n.id} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words">{n.texto}</p>
                  <p className="hint">{fmtDate(n.criadoEm)} · revisar em {fmtDate(n.proximaRevisao)}</p>
                </div>
                <button aria-label="Apagar aprendizado" disabled={apagar.isPending} onClick={() => apagar.mutate(n.id)} className="btn">✕</button>
              </li>
            ))}
          </ul>
        )}
        <ErroInline show={apagar.isError}>Não foi possível apagar.</ErroInline>
        <NovaNota md5={book.md5} placeholder={lido ? 'Uma ideia que você quer lembrar daqui a um ano' : 'Algo que você aprendeu até aqui'} />
      </div>
      )}
    </Card>
  );
}
