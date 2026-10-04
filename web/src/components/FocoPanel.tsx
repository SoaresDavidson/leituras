import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Dashboard, Foco, FocoBook } from '@leituras/shared';
import { patchBook, patchFoco, putFila } from '../api';
import { fmtDate, fmtHours } from '../format';
import { Card, Stat } from './Card';
import Cover from './Cover';
import ProgressBar from './ProgressBar';
import { StatusQuickEdit } from './StatusSelect';

const RETA_FINAL = 75;

function useFocoMutation<T>(fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['books'] });
    },
  });
}

function Ajustes({ foco, onDone }: { foco: Foco; onDone: () => void }) {
  const [limite, setLimite] = useState(foco.limite);
  const [prazoDias, setPrazoDias] = useState(foco.prazoDias);
  const save = useFocoMutation(() => patchFoco({ limite, prazoDias }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-3 text-sm">
      <label className="block label">Limite de abertos
        <input type="number" min={1} max={10} value={limite} onChange={(e) => setLimite(Number(e.target.value))} className="input mt-1 block w-24" />
      </label>
      <label className="block label">Prazo do cemitério (dias)
        <input type="number" min={7} max={365} value={prazoDias} onChange={(e) => setPrazoDias(Number(e.target.value))} className="input mt-1 block w-24" />
      </label>
      <button disabled={save.isPending} className="btn-primary">Salvar</button>
      {save.isError && <span className="error">Valores inválidos.</span>}
    </form>
  );
}

function AbertoItem({ book }: { book: FocoBook }) {
  const retaFinal = book.progress >= RETA_FINAL;
  return (
    <li>
      <Link to={`/livros/${book.md5}`} className="flex items-center gap-3 py-3 hover:opacity-80">
        <Cover book={book} className="h-16 w-11" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate font-medium">{book.title}</div>
          <ProgressBar value={book.progress} />
          <div className="muted">
            {book.previsao ? `termina ~${fmtDate(book.previsao)}` : 'sem ritmo recente'}
            {book.minutosRestantes != null && (
              <span className={`ml-2 ${retaFinal ? 'font-medium text-ok' : ''}`}>
                {retaFinal ? 'reta final: ' : ''}faltam ~{fmtHours(book.minutosRestantes)}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="pb-3 pl-14"><StatusQuickEdit book={book} /></div>
    </li>
  );
}

export default function FocoPanel({ foco }: { foco: Foco }) {
  const [ajustando, setAjustando] = useState(false);
  const qc = useQueryClient();
  // Write the returned Foco into the cache right away, so the next ↑/↓/✕ builds on the new order
  const fila = useMutation({
    mutationFn: putFila,
    onSuccess: (novo) => {
      qc.setQueriesData<Dashboard>({ queryKey: ['dashboard'] }, (d) => d && { ...d, foco: { ...d.foco, fila: novo.fila } });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const arquivar = useFocoMutation((md5: string) => patchBook(md5, { arquivado: true }));
  const excedeu = foco.abertos.length > foco.limite;
  const md5s = foco.fila.map((f) => f.book.md5);

  const mover = (i: number, delta: number) => {
    const next = [...md5s];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    fila.mutate(next);
  };

  return (
    <>
      <div className="grid-3">
        <Card>
          <div className={`stat-value ${excedeu ? 'text-warn' : ''}`}>{foco.abertos.length}/{foco.limite}</div>
          <div className="stat-label">Abertos</div>
          {excedeu && <div className="text-sm text-warn">Termine um antes de começar outro</div>}
        </Card>
        <Stat label="Taxa de conclusão" value={foco.taxaConclusao.percentual == null ? '—' : `${foco.taxaConclusao.percentual}%`} />
        <Stat label="No cemitério" value={foco.cemiterio.length} />
      </div>

      <Card title="Abertos" actions={
        <button onClick={() => setAjustando(!ajustando)} aria-expanded={ajustando} className="btn">
          {ajustando ? 'fechar ajustes' : 'ajustar'}
        </button>
      }>
        {ajustando && <Ajustes foco={foco} onDone={() => setAjustando(false)} />}
        {foco.abertos.length === 0
          ? <p className="muted">Nenhum livro aberto.</p>
          : <ul className="list-divided">{foco.abertos.map((b) => <AbertoItem key={b.md5} book={b} />)}</ul>}
      </Card>

      <Card title="Próximo da fila">
        {foco.fila.length === 0 ? (
          <p className="muted">Fila vazia. Use “Pôr na fila” na página de um livro.</p>
        ) : (
          <ol className="list-divided">
            {foco.fila.map(({ book, liberado }, i) => (
              <li key={book.md5} className="flex items-center gap-2 py-2">
                <span aria-hidden className="w-5 text-center">{liberado ? '✓' : '🔒'}</span>
                <Link to={`/livros/${book.md5}`} className="min-w-0 flex-1 truncate hover:underline">{book.title}</Link>
                <span className={`hint ${liberado ? 'text-ok' : ''}`}>{liberado ? 'liberado' : 'trancado'}</span>
                <button aria-label="Subir" disabled={i === 0 || fila.isPending} onClick={() => mover(i, -1)} className="btn">↑</button>
                <button aria-label="Descer" disabled={i === md5s.length - 1 || fila.isPending} onClick={() => mover(i, 1)} className="btn">↓</button>
                <button aria-label="Tirar da fila" disabled={fila.isPending} onClick={() => fila.mutate(md5s.filter((m) => m !== book.md5))} className="btn">✕</button>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {foco.cemiterio.length > 0 && (
        <Card title="Cemitério">
          <p className="muted mb-2">Para retomar, basta ler no Kindle: o livro sai daqui sozinho.</p>
          <ul className="list-divided">
            {foco.cemiterio.map(({ book, diasParado }) => (
              <li key={book.md5} className="flex items-center gap-3 py-2">
                <Link to={`/livros/${book.md5}`} className="min-w-0 flex-1 truncate hover:underline">{book.title}</Link>
                <span className="muted">parado há {diasParado} dias</span>
                <button disabled={arquivar.isPending} onClick={() => arquivar.mutate(book.md5)} className="btn">Arquivar sem culpa</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
