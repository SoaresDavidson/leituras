import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BookDetail, ReadingStatus } from '@leituras/shared';
import { getBook, getDashboard, patchBook, putFila } from '../api';
import { fmtDate, fmtHours } from '../format';
import { Card } from '../components/Card';
import Cover from '../components/Cover';
import ProgressBar from '../components/ProgressBar';
import StatusBadge from '../components/StatusBadge';
import AprendizadoLivro from '../components/AprendizadoLivro';

function EditForm({ book }: { book: BookDetail }) {
  const qc = useQueryClient();
  const [categoria, setCategoria] = useState(book.categoria);
  const [status, setStatus] = useState<ReadingStatus | ''>(book.statusManual ?? '');
  const [topicos, setTopicos] = useState(book.topicos);
  useEffect(() => {
    setCategoria(book.categoria);
    setStatus(book.statusManual ?? '');
    setTopicos(book.topicos);
  }, [book]);

  const save = useMutation({
    mutationFn: () => patchBook(book.md5, { categoria, statusManual: status || null, topicos }),
    onSuccess: (updated) => {
      qc.setQueryData(['book', book.md5], updated);
      qc.invalidateQueries({ queryKey: ['books'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const input = 'w-full rounded border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700 dark:bg-stone-900';

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">Categoria
        <input value={categoria} onChange={(e) => setCategoria(e.target.value)} className={input} />
      </label>
      <label className="block text-sm">Status manual
        <select value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus | '')} className={input}>
          <option value="">Automático</option>
          <option value="lendo">Lendo</option>
          <option value="lido">Lido</option>
          <option value="pausado">Pausado</option>
        </select>
      </label>
      <label className="block text-sm">Tópicos aprendidos
        <textarea rows={6} value={topicos} onChange={(e) => setTopicos(e.target.value)} className={input} />
      </label>
      <div className="flex items-center gap-3">
        <button disabled={save.isPending} className="rounded bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-50">Salvar</button>
        {save.isSuccess && <span className="text-sm text-emerald-600">Salvo.</span>}
        {save.isError && <span className="text-sm text-red-600">Erro ao salvar.</span>}
      </div>
    </form>
  );
}

function FocoActions({ book }: { book: BookDetail }) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const dash = useQuery({ queryKey: ['dashboard', year], queryFn: () => getDashboard(year) });
  const fila = dash.data?.foco.fila.map((f) => f.book.md5);
  const naFila = fila?.includes(book.md5) ?? false;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['books'] });
  };
  const toggleFila = useMutation({
    mutationFn: () => putFila(naFila ? fila!.filter((m) => m !== book.md5) : [...fila!, book.md5]),
    onSuccess: refresh,
  });
  const toggleArquivo = useMutation({
    mutationFn: () => patchBook(book.md5, { arquivado: !book.arquivado }),
    onSuccess: (updated) => {
      qc.setQueryData(['book', book.md5], updated);
      refresh();
    },
  });
  const btn = 'rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800';

  return (
    <div className="flex flex-wrap gap-2">
      <button disabled={!fila || toggleFila.isPending} onClick={() => toggleFila.mutate()} className={btn}>
        {naFila ? 'Tirar da fila' : 'Pôr na fila'}
      </button>
      {book.status !== 'lido' && (
        <button disabled={toggleArquivo.isPending} onClick={() => toggleArquivo.mutate()} className={btn}>
          {book.arquivado ? 'Desarquivar' : 'Arquivar'}
        </button>
      )}
    </div>
  );
}

export default function BookPage() {
  const { md5 = '' } = useParams();
  const q = useQuery({ queryKey: ['book', md5], queryFn: () => getBook(md5) });
  if (q.isLoading) return <p>Carregando…</p>;
  if (!q.data) return <p className="text-red-600">Livro não encontrado.</p>;
  const b = q.data;

  return (
    <>
      <Link to="/" className="text-sm hover:underline">← Voltar</Link>
      <Card>
        <div className="flex gap-4">
          <Cover book={b} className="h-40 w-28" />
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="text-xl font-bold">{b.title}</h1>
            <div className="text-stone-500 dark:text-stone-400">{b.authors}</div>
            {b.series && <div className="text-sm">Série: {b.series}</div>}
            <StatusBadge status={b.status} arquivado={b.arquivado} />
            <ProgressBar value={b.progress} />
            <div className="text-sm">{Math.round(b.progress)}% de {b.pages} páginas</div>
            <FocoActions book={b} />
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[['Início', fmtDate(b.startedAt)], ['Conclusão', fmtDate(b.finishedAt)], ['Última leitura', fmtDate(b.lastReadAt)],
            ['Tempo total', fmtHours(b.totalMinutes)], ['Sessões', b.sessions]].map(([k, v]) => (
            <div key={k}><dt className="text-stone-500 dark:text-stone-400">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
      </Card>
      <Card title="Minutos por dia">
        <div className="h-52">
          <ResponsiveContainer>
            <BarChart data={b.daily}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={30} />
              <YAxis />
              <Tooltip labelFormatter={fmtDate} />
              <Bar dataKey="minutes" name="Minutos" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Progresso">
        <div className="h-52">
          <ResponsiveContainer>
            <LineChart data={b.progressTimeline}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={30} />
              <YAxis domain={[0, 100]} unit="%" />
              <Tooltip labelFormatter={fmtDate} />
              <Line dataKey="progress" name="Progresso" stroke="#3b82f6" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <AprendizadoLivro book={b} />
      <Card title="Anotações"><EditForm book={b} /></Card>
    </>
  );
}
