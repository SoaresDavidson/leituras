import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHART, tooltipStyle } from '../styles/chart';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetaAno, RetroTipo, Retrospectiva } from '@leituras/shared';
import { getRetroPeriodo, getRetrospectiva, patchRetrospectiva } from '../api';
import { MONTHS, fmtDate, fmtHours } from '../format';
import { Card } from '../components/Card';
import Cover from '../components/Cover';
import ProgressBar from '../components/ProgressBar';

const num = (n: number) => n.toLocaleString('pt-BR');
const dayMonth = (d: string) => fmtDate(d).slice(0, 5);
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;
// Mirrors MAX_OFFSET in server/src/retrospectiva.ts
const RETRO_MAX_OFFSET = 520;
const META_MIN = 100;
const META_MAX = 100_000;

function rangeLabel(inicio: string, fim: string) {
  const ano = String(new Date().getFullYear());
  const fmt = inicio.startsWith(ano) && fim.startsWith(ano) ? dayMonth : fmtDate;
  return `${fmt(inicio)} a ${fmt(fim)}`;
}

function Delta({ atual, anterior }: { atual: number; anterior: number }) {
  if (anterior === 0) return <span className="muted">{atual > 0 ? 'nada no anterior' : 'igual ao anterior'}</span>;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  const color = pct > 0 ? 'text-ok' : pct < 0 ? 'text-warn' : 'text-muted';
  return <span className={`text-sm ${color}`}>{pct > 0 ? '+' : ''}{pct}% vs. anterior</span>;
}

function Metric({ label, value, atual, anterior }: { label: string; value: string; atual: number; anterior: number }) {
  return (
    <Card>
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
      <Delta atual={atual} anterior={anterior} />
    </Card>
  );
}

function Periodo() {
  const [tipo, setTipo] = useState<RetroTipo>('semana');
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ['retrospectiva', 'periodo', tipo, offset],
    queryFn: () => getRetroPeriodo(tipo, offset),
    // Keep the old period on screen only while navigating within the same tipo
    placeholderData: (prev) => (prev?.tipo === tipo ? prev : undefined),
  });
  const p = q.data;
  const nome = tipo === 'semana' ? 'semana' : 'mês';
  const anteriorLabel = tipo === 'semana' ? 'Semana anterior' : 'Mês anterior';
  const proximoLabel = tipo === 'semana' ? 'Próxima semana' : 'Próximo mês';
  const escolher = (t: RetroTipo) => { setTipo(t); setOffset(0); };
  const tab = 'btn';

  return (
    <Card title="Retrospectiva">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Tipo de período">
          <button className={tab} aria-pressed={tipo === 'semana'} onClick={() => escolher('semana')}>Semana</button>
          <button className={tab} aria-pressed={tipo === 'mes'} onClick={() => escolher('mes')}>Mês</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button aria-label={anteriorLabel} className="btn" disabled={offset >= RETRO_MAX_OFFSET} onClick={() => setOffset(offset + 1)}>←</button>
          <span className="min-w-28 text-center text-sm">{p ? rangeLabel(p.inicio, p.fim) : '…'}</span>
          <button aria-label={proximoLabel} className="btn" disabled={offset === 0} onClick={() => setOffset(offset - 1)}>→</button>
        </div>
      </div>
      {q.isError && <p className="error">Erro ao carregar a retrospectiva.</p>}
      {q.isPending && <p>Carregando…</p>}
      {p && (
        <div className={`space-y-4 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          {offset === 0 && <p className="muted">{tipo === 'semana' ? 'Semana' : 'Mês'} em andamento; a comparação é com o {nome} anterior inteiro.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric label="Tempo lido" value={fmtHours(p.totais.minutos)} atual={p.totais.minutos} anterior={p.anterior.minutos} />
            <Metric label="Páginas" value={num(p.totais.paginas)} atual={p.totais.paginas} anterior={p.anterior.paginas} />
            <Metric label="Dias com leitura" value={String(p.totais.diasLidos)} atual={p.totais.diasLidos} anterior={p.anterior.diasLidos} />
            <Metric label="Livros tocados" value={String(p.totais.livrosTocados)} atual={p.totais.livrosTocados} anterior={p.anterior.livrosTocados} />
            <Metric label="Livros terminados" value={String(p.totais.livrosTerminados)} atual={p.totais.livrosTerminados} anterior={p.anterior.livrosTerminados} />
          </div>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <div className="muted">Melhor dia</div>
              <div className="num font-medium">{p.melhorDia ? `${fmtDate(p.melhorDia.date)} · ${p.melhorDia.minutos} min` : '—'}</div>
            </div>
            <div className="min-w-0">
              <div className="muted">Maior sessão</div>
              <div className="truncate font-medium">
                {p.maiorSessao ? `${p.maiorSessao.minutos} min em ${fmtDate(p.maiorSessao.date)} · ${p.maiorSessao.book.title}` : '—'}
              </div>
            </div>
          </div>
          {p.livros.length === 0 ? (
            <p className="muted">Nenhuma leitura neste período.</p>
          ) : (
            <ul className="list-divided">
              {p.livros.map(({ book, minutos, paginas, terminou }) => (
                <li key={book.md5}>
                  <Link to={`/livros/${book.md5}`} className="flex items-center gap-3 py-2 hover:opacity-80">
                    <Cover book={book} className="h-12 w-8" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{book.title}</div>
                      <div className="muted">{fmtHours(minutos)} · {num(paginas)} págs</div>
                    </div>
                    {terminou && <span className="success">terminou</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Investimento({ investimento }: { investimento: Retrospectiva['investimento'] }) {
  const [ano, setAno] = useState<number | null>(null);
  const atual = (ano != null && investimento.anos.find((a) => a.ano === ano)) || investimento.total;
  return (
    <Card title="Quanto já investi">
      <select aria-label="Recorte" value={ano ?? ''} onChange={(e) => setAno(e.target.value ? Number(e.target.value) : null)}
        className="input mb-4 w-auto">
        <option value="">Desde sempre</option>
        {investimento.anos.map((a) => <option key={a.ano} value={a.ano}>{a.ano}</option>)}
      </select>
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
        <div><div className="num text-3xl font-bold">{fmtHours(atual.minutos)}</div><div className="muted">lidas</div></div>
        <div><div className="num text-3xl font-bold">{num(atual.paginas)}</div><div className="muted">páginas</div></div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {atual.equivalencias.map((e) => (
          <div key={e.id} className="panel">
            <div className="stat-value">{e.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div>
            <div className="muted">{e.rotulo}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AjustarMeta({ meta, onDone }: { meta: MetaAno; onDone: () => void }) {
  const [valor, setValor] = useState(String(meta.metaPaginas));
  const [invalido, setInvalido] = useState(false);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: patchRetrospectiva,
    onSuccess: (novo) => { qc.setQueryData(['retrospectiva'], novo); onDone(); },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(valor.trim());
    if (!/^\d+$/.test(valor.trim()) || n < META_MIN || n > META_MAX) { setInvalido(true); return; }
    save.mutate({ metaAnoPaginas: n });
  };
  const change = (v: string) => { setValor(v); setInvalido(false); save.reset(); };
  const erro = invalido ? 'Use um número inteiro entre 100 e 100.000.' : save.isError ? (save.error as Error).message : null;
  return (
    <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-3 text-sm">
      <label className="block">Meta de páginas em {meta.ano}
        <input type="number" inputMode="numeric" min={META_MIN} max={META_MAX} step={100} value={valor} onChange={(e) => change(e.target.value)}
          className="input mt-1 block w-28" />
      </label>
      <button disabled={save.isPending} className="btn-primary">Salvar</button>
      {erro && <span role="alert" className="error">{erro}</span>}
    </form>
  );
}

function Meta({ meta }: { meta: MetaAno }) {
  const [ajustando, setAjustando] = useState(false);
  const adiantado = meta.diferenca >= 0;
  return (
    <Card title={`Meta de ${meta.ano}`}>
      <button onClick={() => setAjustando(!ajustando)} aria-expanded={ajustando} className="link mb-2">
        {ajustando ? 'fechar ajustes' : 'ajustar'}
      </button>
      {ajustando && <AjustarMeta meta={meta} onDone={() => setAjustando(false)} />}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="stat-value">{num(meta.lidas)} <span className="text-base font-normal text-muted">/ {num(meta.metaPaginas)} págs</span></span>
        <span className="muted">{Math.min(100, Math.round((meta.lidas / meta.metaPaginas) * 100))}%</span>
      </div>
      <ProgressBar value={(meta.lidas / meta.metaPaginas) * 100} />
      <div className="mt-3 space-y-1">
        {meta.restantes === 0 ? (
          <p className="success">Meta batida! Tudo o que vier agora é bônus.</p>
        ) : (
          <p><span className="num text-xl font-bold">{num(meta.paginasPorDia)} págs/dia</span> até 31/12 para fechar o ano ({meta.diasRestantes} {meta.diasRestantes === 1 ? 'dia' : 'dias'}, contando hoje).</p>
        )}
        <p className={`text-sm ${adiantado ? 'text-ok' : 'text-warn'}`}>
          {adiantado ? 'Adiantado' : 'Atrasado'} {num(Math.abs(meta.diferenca))} págs em relação ao ritmo linear (esperado hoje: {num(meta.esperadoHoje)}).
        </p>
      </div>
    </Card>
  );
}

function Ritmo({ r }: { r: Retrospectiva }) {
  const data = r.velocidadeMensal.map((m) => ({ label: monthLabel(m.month), paginasPorHora: m.paginasPorHora }));
  const valores = data.flatMap((d) => (d.paginasPorHora == null ? [] : [d.paginasPorHora]));
  const temDados = valores.length > 0;
  const resumo = temDados
    ? `Páginas por hora por mês, de ${data[0].label} a ${data.at(-1)!.label}: média ${Math.round(valores.reduce((a, b) => a + b, 0) / valores.length)}, mínimo ${Math.min(...valores)}, máximo ${Math.max(...valores)}; último mês com dados: ${valores.at(-1)} págs/h.`
    : '';
  return (
    <Card title="Ritmo pessoal">
      <h3 className="section-title mb-2">Velocidade de leitura (páginas por hora, por mês)</h3>
      {temDados ? (
        <div className="h-56" role="img" aria-label={resumo}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ left: -20, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={16} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <YAxis allowDecimals={false} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v} págs/h`, 'Velocidade']} />
              <Line type="monotone" dataKey="paginasPorHora" name="Velocidade" stroke={CHART.main} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="muted">Ainda não há meses com leitura suficiente (10 min ou mais).</p>
      )}
      <h3 className="section-title mb-1 mt-4">Por livro</h3>
      <p className="muted mb-2">Livros técnicos costumam ser mais lentos: compare cada um consigo mesmo.</p>
      {r.ritmoLivros.length === 0 ? (
        <p className="muted">Nenhum livro com 10 min ou mais de leitura.</p>
      ) : (
        <ul className="list-divided">
          {r.ritmoLivros.map(({ book, minutos, paginasPorHora }) => (
            <li key={book.md5}>
              <Link to={`/livros/${book.md5}`} className="flex items-center gap-3 py-2 hover:opacity-80">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{book.title}</div>
                  <div className="muted">{fmtHours(minutos)} lidas</div>
                </div>
                <span className="num shrink-0 font-medium">{paginasPorHora} págs/h</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function RetrospectivaPage() {
  const q = useQuery({ queryKey: ['retrospectiva'], queryFn: getRetrospectiva });
  return (
    <>
      <h1 className="page-title">Retrospectiva</h1>
      <Periodo />
      {q.isError && <p className="error">Erro ao carregar os dados.</p>}
      {q.isLoading && <p>Carregando…</p>}
      {q.data && (
        <>
          <Meta meta={q.data.meta} />
          <Investimento investimento={q.data.investimento} />
          <Ritmo r={q.data} />
        </>
      )}
    </>
  );
}
