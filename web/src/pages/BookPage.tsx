import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BookDetail, Metadados, MetadadosPatch, ReadingStatus, TipoLivro } from '@leituras/shared';
import { ApiError, aplicarMetadados, buscarMetadados, deleteLivro, getBook, getDashboard, getLivroExtras, patchBook, putFila, putMaisTarde } from '../api';
import { CHART, tooltipStyle } from '../styles/chart';
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

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block label">Categoria
        <input value={categoria} onChange={(e) => setCategoria(e.target.value)} className="input mt-1" />
      </label>
      <label className="block label">Status manual
        <select value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus | '')} className="input mt-1">
          <option value="">Automático</option>
          <option value="lendo">Lendo</option>
          <option value="lido">Lido</option>
          <option value="pausado">Pausado</option>
        </select>
      </label>
      {book.tipo !== 'ficcao' && (
        <label className="block label">Tópicos aprendidos
          <textarea rows={6} value={topicos} onChange={(e) => setTopicos(e.target.value)} className="input mt-1" />
        </label>
      )}
      <div className="flex items-center gap-3">
        <button disabled={save.isPending} className="btn-primary">Salvar</button>
        {save.isSuccess && <span className="success">Salvo.</span>}
        {save.isError && <span className="error">Erro ao salvar.</span>}
      </div>
    </form>
  );
}

// Unclassified (null) behaves as estudo, so it is shown as such
function TipoSelector({ book }: { book: BookDetail }) {
  const qc = useQueryClient();
  const atual: TipoLivro = book.tipo ?? 'estudo';
  const salvar = useMutation({
    mutationFn: (tipo: TipoLivro) => patchBook(book.md5, { tipo }),
    onSuccess: (updated) => {
      qc.setQueryData(['book', book.md5], updated);
      qc.invalidateQueries({ queryKey: ['books'] });
      qc.invalidateQueries({ queryKey: ['aprendizado'] });
    },
  });
  const opcoes: [TipoLivro, string][] = [['estudo', 'Estudo'], ['ficcao', 'Ficção']];
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tipo do livro">
      {opcoes.map(([tipo, label]) => (
        <button key={tipo} aria-pressed={atual === tipo} disabled={salvar.isPending} onClick={() => tipo !== atual && salvar.mutate(tipo)} className="btn">
          {label}
        </button>
      ))}
      {salvar.isError && <span className="error">Erro ao salvar o tipo.</span>}
    </div>
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

  return (
    <div className="flex flex-wrap gap-2">
      <button disabled={!fila || toggleFila.isPending} onClick={() => toggleFila.mutate()} className="btn">
        {naFila ? 'Tirar da fila' : 'Pôr na fila'}
      </button>
      {book.status !== 'lido' && (
        <button disabled={toggleArquivo.isPending} onClick={() => toggleArquivo.mutate()} className="btn">
          {book.arquivado ? 'Desarquivar' : 'Arquivar'}
        </button>
      )}
    </div>
  );
}

function useRefreshLivro(md5: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['book', md5] });
    qc.invalidateQueries({ queryKey: ['livro-extras', md5] });
    qc.invalidateQueries({ queryKey: ['livros'] });
    qc.invalidateQueries({ queryKey: ['books'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

function MaisTardeButton({ md5 }: { md5: string }) {
  const extras = useQuery({ queryKey: ['livro-extras', md5], queryFn: () => getLivroExtras(md5) });
  const refresh = useRefreshLivro(md5);
  const toggle = useMutation({ mutationFn: () => putMaisTarde(md5, !extras.data!.maisTarde), onSuccess: refresh });
  return (
    <>
      <button disabled={!extras.data || toggle.isPending} onClick={() => toggle.mutate()} className="btn">
        {extras.data?.maisTarde ? 'Tirar de ler mais tarde' : 'Ler mais tarde'}
      </button>
      {extras.isError && <span className="error self-center">Erro ao carregar “ler mais tarde”.</span>}
      {toggle.isError && <span className="error self-center">Erro ao atualizar “ler mais tarde”.</span>}
    </>
  );
}

type Campo = 'authors' | 'pages' | 'anoPublicacao' | 'assuntos';

function MetadadosCard({ book }: { book: BookDetail }) {
  const refresh = useRefreshLivro(book.md5);
  const [marcados, setMarcados] = useState<Set<Campo>>(new Set());
  const busca = useMutation({
    mutationFn: () => buscarMetadados(book.md5),
    onMutate: () => aplicar.reset(),
    onSuccess: ({ resultado }) => setMarcados(new Set(resultado
      ? campos(resultado).map((c) => c.key).filter((k) => k !== 'pages' || book.pages === 0)
      : [])),
  });
  const aplicar = useMutation({
    mutationFn: (patch: MetadadosPatch) => aplicarMetadados(book.md5, patch),
    onSuccess: () => { refresh(); busca.reset(); },
  });

  // Pages can override what KOReader reported; preselected only when it reported none
  const campos = (m: Metadados) => [
    m.autores && m.autores !== book.authors && { key: 'authors' as const, label: 'Autores', value: m.autores.replace(/\n/g, ', ') },
    m.paginas && m.paginas !== book.pages && { key: 'pages' as const, label: book.pages > 0 ? `Páginas (hoje ${book.pages})` : 'Páginas', value: String(m.paginas) },
    m.anoPublicacao && { key: 'anoPublicacao' as const, label: 'Ano de publicação', value: String(m.anoPublicacao) },
    m.assuntos.length > 0 && { key: 'assuntos' as const, label: 'Assuntos (vão para os tópicos)', value: m.assuntos.join(', ') },
  ].filter((c) => !!c);

  const submit = (m: Metadados) => {
    const patch: MetadadosPatch = {};
    if (marcados.has('authors')) patch.authors = m.autores;
    if (marcados.has('pages')) patch.pages = m.paginas!;
    if (marcados.has('anoPublicacao')) patch.anoPublicacao = m.anoPublicacao!;
    if (marcados.has('assuntos')) patch.assuntos = m.assuntos;
    aplicar.mutate(patch);
  };
  const toggle = (key: Campo) => setMarcados((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const resultado = busca.data?.resultado;
  const lista = resultado ? campos(resultado) : [];
  return (
    <Card title="Metadados">
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busca.isPending} onClick={() => busca.mutate()} className="btn">
            {busca.isPending ? 'Buscando…' : 'Buscar metadados'}
          </button>
          <span className="muted">no Open Library, por título e autor</span>
        </div>
        {busca.isError && (
          <p className="error">{busca.error instanceof ApiError && busca.error.status === 502 ? 'O Open Library não respondeu. Tente de novo mais tarde.' : 'Erro ao buscar metadados.'}</p>
        )}
        {busca.isSuccess && !resultado && <p>Nada encontrado no Open Library.</p>}
        {resultado && lista.length === 0 && <p>Encontrado “{resultado.titulo}”, mas não há nada novo para aplicar.</p>}
        {resultado && lista.length > 0 && (
          <div className="space-y-2">
            <p>Encontrado: <span className="font-medium">{resultado.titulo}</span></p>
            {lista.map((c) => (
              <label key={c.key} className="flex items-start gap-2">
                <input type="checkbox" checked={marcados.has(c.key)} onChange={() => toggle(c.key)} className="mt-1" />
                <span className="min-w-0 break-words"><span className="muted">{c.label}:</span> {c.value}</span>
              </label>
            ))}
            <button
              disabled={marcados.size === 0 || aplicar.isPending}
              onClick={() => submit(resultado)}
              className="btn-primary"
            >
              Aplicar selecionados
            </button>
            {aplicar.isError && <p className="error">Erro ao aplicar.</p>}
          </div>
        )}
        {aplicar.isSuccess && !resultado && <p className="success">Metadados aplicados.</p>}
      </div>
    </Card>
  );
}

function ExcluirLivro({ book }: { book: BookDetail }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [confirmando, setConfirmando] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmando) confirmRef.current?.focus(); }, [confirmando]);
  const excluir = useMutation({
    mutationFn: () => deleteLivro(book.md5),
    onSuccess: (livros) => {
      // leave the page before dropping its queries so "Livro não encontrado" never flashes
      nav('/livros');
      qc.setQueryData(['livros'], livros);
      qc.removeQueries({ queryKey: ['book', book.md5] });
      qc.removeQueries({ queryKey: ['livro-extras', book.md5] });
      qc.invalidateQueries({ queryKey: ['books'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <Card title="Excluir livro">
      <p className="muted mb-3">
        Apaga o livro, o histórico de leitura e as anotações daqui. O plugin não vai reenviá-lo; dá para desfazer na
        lista de excluídos em Livros.
      </p>
      {confirmando ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            ref={confirmRef}
            disabled={excluir.isPending}
            onClick={() => excluir.mutate()}
            className="btn btn-danger"
          >
            Excluir de vez?
          </button>
          <button disabled={excluir.isPending} onClick={() => setConfirmando(false)} className="btn">Cancelar</button>
        </div>
      ) : (
        <button onClick={() => setConfirmando(true)} className="btn btn-danger">
          Excluir livro
        </button>
      )}
      {excluir.isError && <p className="error mt-2">Erro ao excluir.</p>}
    </Card>
  );
}

export default function BookPage() {
  const { md5 = '' } = useParams();
  const q = useQuery({ queryKey: ['book', md5], queryFn: () => getBook(md5) });
  const extras = useQuery({ queryKey: ['livro-extras', md5], queryFn: () => getLivroExtras(md5) });
  if (q.isLoading) return <p>Carregando…</p>;
  if (!q.data) return <p className="error">Livro não encontrado.</p>;
  const b = q.data;

  return (
    <>
      <Link to="/livros" className="link">← Livros</Link>
      <Card>
        <div className="flex gap-4">
          <Cover book={b} className="h-40 w-28" />
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="page-title">{b.title}</h1>
            <div className="muted">{b.authors}</div>
            {b.series && <div className="text-sm">Série: {b.series}</div>}
            {extras.data?.anoPublicacao != null && <div className="text-sm">Publicado em {extras.data.anoPublicacao}</div>}
            {extras.isError && <div className="error">Erro ao carregar os dados extras do livro.</div>}
            <StatusBadge status={b.status} arquivado={b.arquivado} />
            <TipoSelector book={b} />
            <ProgressBar value={b.progress} />
            <div className="text-sm">{Math.round(b.progress)}% de {b.pages} páginas</div>
            <div className="flex flex-wrap gap-2">
              <FocoActions book={b} />
              <MaisTardeButton md5={b.md5} />
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[['Início', fmtDate(b.startedAt)], ['Conclusão', fmtDate(b.finishedAt)], ['Última leitura', fmtDate(b.lastReadAt)],
            ['Tempo total', fmtHours(b.totalMinutes)], ['Sessões', b.sessions]].map(([k, v]) => (
            <div key={k}><dt className="stat-label">{k}</dt><dd className="num font-medium">{v}</dd></div>
          ))}
        </dl>
      </Card>
      <Card title="Minutos por dia">
        <div className="h-52">
          <ResponsiveContainer>
            <BarChart data={b.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={30} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <YAxis tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <Tooltip labelFormatter={fmtDate} {...tooltipStyle} />
              <Bar dataKey="minutes" name="Minutos" fill={CHART.main} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Progresso">
        <div className="h-52">
          <ResponsiveContainer>
            <LineChart data={b.progressTimeline}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={30} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <Tooltip labelFormatter={fmtDate} {...tooltipStyle} />
              <Line dataKey="progress" name="Progresso" stroke={CHART.alt} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      {/* fiction has no aprendizado; its notes stay stored and return if the book goes back to estudo */}
      {b.tipo !== 'ficcao' && <AprendizadoLivro book={b} />}
      <Card title="Anotações"><EditForm book={b} /></Card>
      <MetadadosCard book={b} />
      <ExcluirLivro book={b} />
    </>
  );
}
