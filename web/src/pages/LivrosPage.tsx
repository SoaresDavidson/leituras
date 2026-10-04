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

const maisTardeBadge = (b: LivroItem) =>
  b.maisTarde && <span className="tag border-info text-info">mais tarde</span>;

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
      <p className="muted mb-2">
        O plugin ignora estes livros. Ao desfazer, o livro e o histórico voltam na próxima sincronização do Kindle.
      </p>
      <ul className="list-divided">
        {blacklist.map((e) => (
          <li key={e.md5} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{e.title}</div>
              <div className="muted">excluído em {fmtDate(e.excluidoEm)}</div>
            </div>
            <button
              disabled={restore.isPending}
              onClick={() => restore.mutate(e.md5)}
              aria-label={`Desfazer exclusão de ${e.title}`}
              className="btn shrink-0"
            >
              Desfazer
            </button>
          </li>
        ))}
      </ul>
      {restore.isError && <p className="error mt-2">Erro ao desfazer.</p>}
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
      <h1 className="page-title">Livros</h1>
      <Card>
        <div className="space-y-3">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, autor, série…"
            aria-label="Buscar livros"
            className="input"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
            {FILTROS.map((f) => (
              <button key={f.value} aria-pressed={filtro === f.value} onClick={() => setFiltro(f.value)} className="btn">
                {f.label}
              </button>
            ))}
            <button aria-pressed={soMaisTarde} onClick={() => setSoMaisTarde((v) => !v)} className="btn">
              Ler mais tarde
            </button>
          </div>
          {all && <p className="muted">{visible.length} de {all.length} livros</p>}
        </div>
      </Card>
      <Card>
        {q.isLoading ? <p>Carregando…</p>
          : q.isError ? <p className="error">Erro ao carregar os livros.</p>
          : <BookList books={visible} badge={maisTardeBadge} />}
      </Card>
      {q.data && <Excluidos blacklist={q.data.blacklist} />}
    </>
  );
}
