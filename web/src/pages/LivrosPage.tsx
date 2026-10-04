import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LivroItem } from '@leituras/shared';
import { getLivros, restoreLivro } from '../api';
import { fmtDate } from '../format';
import { fuzzyFilter } from '../fuzzy';
import { Card } from '../components/Card';
import BookList from '../components/BookList';

type Filtro = 'todos' | 'lendo' | 'lido' | 'pausado' | 'arquivado';

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'lendo', label: 'Lendo' },
  { value: 'lido', label: 'Lido' },
  { value: 'pausado', label: 'Pausado' },
  { value: 'arquivado', label: 'Arquivado' },
];

// "arquivado" is its own bucket; the reading statuses only show books that are not archived
const matchesFiltro = (b: LivroItem, f: Filtro) => f === 'todos' || (f === 'arquivado' ? b.arquivado : !b.arquivado && b.status === f);

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${active
    ? 'border-emerald-600 bg-emerald-600 text-white'
    : 'border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'}`;

const maisTardeBadge = (b: LivroItem) =>
  b.maisTarde && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900 dark:text-violet-200">mais tarde</span>;

function Excluidos({ blacklist }: { blacklist: { md5: string; title: string; excluidoEm: string }[] }) {
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: restoreLivro,
    onSuccess: (livros) => {
      qc.setQueryData(['livros'], livros);
      qc.invalidateQueries({ queryKey: ['books'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  if (blacklist.length === 0) return null;
  return (
    <Card title="Excluídos">
      <p className="mb-2 text-sm text-stone-500 dark:text-stone-400">
        O plugin ignora estes livros. Ao desfazer, o livro e o histórico voltam na próxima sincronização do Kindle.
      </p>
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {blacklist.map((e) => (
          <li key={e.md5} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{e.title}</div>
              <div className="text-sm text-stone-500 dark:text-stone-400">excluído em {fmtDate(e.excluidoEm)}</div>
            </div>
            <button
              disabled={restore.isPending}
              onClick={() => restore.mutate(e.md5)}
              aria-label={`Desfazer exclusão de ${e.title}`}
              className="shrink-0 rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              Desfazer
            </button>
          </li>
        ))}
      </ul>
      {restore.isError && <p className="mt-2 text-sm text-red-600">Erro ao desfazer.</p>}
    </Card>
  );
}

export default function LivrosPage() {
  const q = useQuery({ queryKey: ['livros'], queryFn: getLivros });
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [soMaisTarde, setSoMaisTarde] = useState(false);

  const all = q.data?.books;
  const visible = useMemo(() => {
    const filtered = (all ?? []).filter((b) => matchesFiltro(b, filtro) && (!soMaisTarde || b.maisTarde));
    return fuzzyFilter(filtered, busca, (b) => [b.title, b.authors, b.series, b.categoria]);
  }, [all, busca, filtro, soMaisTarde]);

  return (
    <>
      <h1 className="text-2xl font-bold">Livros</h1>
      <Card>
        <div className="space-y-3">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, autor, série…"
            aria-label="Buscar livros"
            className="w-full rounded border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700 dark:bg-stone-900"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
            {FILTROS.map((f) => (
              <button key={f.value} aria-pressed={filtro === f.value} onClick={() => setFiltro(f.value)} className={chip(filtro === f.value)}>
                {f.label}
              </button>
            ))}
            <button aria-pressed={soMaisTarde} onClick={() => setSoMaisTarde((v) => !v)} className={chip(soMaisTarde)}>
              Ler mais tarde
            </button>
          </div>
          {all && <p className="text-sm text-stone-500 dark:text-stone-400">{visible.length} de {all.length} livros</p>}
        </div>
      </Card>
      <Card>
        {q.isLoading ? <p>Carregando…</p>
          : q.isError ? <p className="text-red-600">Erro ao carregar os livros.</p>
          : <BookList books={visible} badge={maisTardeBadge} />}
      </Card>
      {q.data && <Excluidos blacklist={q.data.blacklist} />}
    </>
  );
}
