import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Chefe, ClasseLeitor, Desafio, Jogo, Medalha, ProgressoJogo, Recorde, UnidadeJogo } from '@leituras/shared';
import { ApiError, getJogo, trocarCarta } from '../api';
import { MONTHS, fmtHours } from '../format';
import { Card } from '../components/Card';
import Cover from '../components/Cover';
import ProgressBar from '../components/ProgressBar';

const muted = 'text-sm text-stone-500 dark:text-stone-400';
const chip = 'inline-block rounded-full border px-2 py-0.5 text-xs';

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const fmtDay = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const fmtMes = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const fmtData = (d: string) => (d.length === 7 ? fmtMes(d) : `${fmtDay(d)} ${d.slice(0, 4)}`);
const fmtValor = (n: number, unidade: UnidadeJogo | string) => {
  if (unidade === 'min') return n < 60 ? `${n} min` : fmtHours(n);
  if (unidade === '%') return `${n}%`;
  return `${n.toLocaleString('pt-BR')} ${unidade}`;
};
const pct = (p: ProgressoJogo) => (p.alvo === 0 ? 0 : (100 * p.atual) / p.alvo);
const prazo = (hoje: string, fim: string) => {
  const n = daysBetween(hoje, fim);
  return n <= 0 ? 'termina hoje' : n === 1 ? 'termina amanhã' : `termina em ${n} dias`;
};

function Feito({ feito }: { feito: boolean }) {
  return (
    <span role="img" aria-label={feito ? 'feito' : 'pendente'}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${feito ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 dark:border-stone-600'}`}>
      {feito ? '✓' : ''}
    </span>
  );
}

// One goal line: check mark, title, bar and "atual / alvo"
function Objetivo({ titulo, p, children }: { titulo: ReactNode; p: ProgressoJogo; children?: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <Feito feito={p.feito} />
        <span className={`min-w-0 flex-1 break-words ${p.feito ? 'text-stone-500 line-through dark:text-stone-400' : ''}`}>{titulo}</span>
      </div>
      <div className="flex items-center gap-2 pl-7">
        <div className="flex-1"><ProgressBar value={pct(p)} /></div>
        <span className="shrink-0 font-mono text-xs text-stone-500 dark:text-stone-400">{fmtValor(Math.min(p.atual, p.alvo), p.unidade)} / {fmtValor(p.alvo, p.unidade)}</span>
      </div>
      {children && <div className={`pl-7 ${muted}`}>{children}</div>}
    </div>
  );
}

function Missoes({ jogo }: { jogo: Jogo }) {
  const feitas = jogo.missoes.filter((m) => m.feito).length;
  return (
    <Card title="Missões do dia">
      <div className="space-y-3">
        {jogo.missoes.map((m) => (
          <Objetivo key={m.id} p={m} titulo={m.md5 ? <Link to={`/livros/${m.md5}`} className="hover:underline">{m.titulo}</Link> : m.titulo} />
        ))}
      </div>
      <p className={`mt-3 ${muted}`}>{feitas} de {jogo.missoes.length} feitas. Novas missões amanhã.</p>
    </Card>
  );
}

function Carta({ jogo }: { jogo: Jogo }) {
  const qc = useQueryClient();
  const trocar = useMutation({
    mutationFn: trocarCarta,
    onSuccess: (j) => qc.setQueryData(['jogo'], j),
    // the server state may differ from what is on screen (e.g. swapped in another tab): reload it
    onError: () => qc.invalidateQueries({ queryKey: ['jogo'] }),
  });
  const { carta } = jogo;
  const erro = trocar.error instanceof ApiError && trocar.error.status === 409 ? 'A carta de hoje já foi trocada.' : 'Não foi possível trocar a carta.';
  return (
    <Card title="Carta de desafio">
      <div className="mb-3 flex min-h-20 items-center rounded-md border border-dashed border-amber-400 bg-amber-50 p-3 font-semibold dark:border-amber-700 dark:bg-amber-950">
        {carta.titulo}
      </div>
      <Objetivo titulo={carta.feito ? 'Carta cumprida' : 'Progresso de hoje'} p={carta} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => trocar.mutate()} disabled={!carta.podeTrocar || trocar.isPending}
          className="rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800">
          Trocar carta
        </button>
        <span className={muted}>{carta.trocada ? 'Já trocada hoje.' : 'Uma troca por dia.'}</span>
        {trocar.isError && <span role="alert" className="text-sm text-red-600">{erro}</span>}
      </div>
    </Card>
  );
}

function Relampago({ jogo }: { jogo: Jogo }) {
  const r = jogo.relampago;
  const estado = {
    ativo: { texto: `até as ${r.prazoHora}h`, cor: 'border-amber-500 text-amber-700 dark:text-amber-400' },
    feito: { texto: 'cumprido', cor: 'border-emerald-600 text-emerald-700 dark:text-emerald-400' },
    perdido: { texto: 'acabou o prazo', cor: 'border-stone-400 text-stone-500' },
  }[r.estado];
  return (
    <Card title="Desafio relâmpago">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-lg font-semibold">⚡ {r.titulo}</span>
      </div>
      <Objetivo titulo="Minutos antes do prazo" p={r} />
      <div className="mt-3"><span className={`${chip} ${estado.cor}`}>{estado.texto}</span></div>
      <p className={`mt-2 ${muted}`}>Vale só hoje. Amanhã sai outro.</p>
    </Card>
  );
}

function DesafioCard({ title, d, hoje }: { title: string; d: Desafio; hoje: string }) {
  return (
    <Card title={title}>
      <Objetivo titulo={d.titulo} p={d} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className={muted}>{fmtDay(d.inicio)} – {fmtDay(d.fim)}</span>
        <span className={`${chip} ${d.feito ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400' : 'border-amber-500 text-amber-700 dark:text-amber-400'}`}>
          {d.feito ? 'cumprido' : prazo(hoje, d.fim)}
        </span>
      </div>
    </Card>
  );
}

function ChefeItem({ c }: { c: Chefe }) {
  const maxDano = Math.max(1, ...c.danoPorDia.map((d) => d.dano));
  return (
    <li className="flex gap-3">
      <Cover book={c.book} className="h-16 w-11" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <Link to={`/livros/${c.book.md5}`} className="break-words font-medium hover:underline">{c.book.title}</Link>
          <span className="font-mono text-sm">{c.vida.toLocaleString('pt-BR')} / {c.vidaMax.toLocaleString('pt-BR')} págs de vida</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-stone-200 dark:bg-stone-700" role="img" aria-label={`Vida: ${c.vida} de ${c.vidaMax} páginas`}>
          <div className="h-full bg-red-500" style={{ width: `${(100 * c.vida) / Math.max(1, c.vidaMax)}%` }} />
        </div>
        <div className="flex items-end gap-1" role="img"
          aria-label={`Dano nos últimos 7 dias: ${c.danoPorDia.map((d) => `${fmtDay(d.date)} ${d.dano} págs`).join(', ')}`}>
          {c.danoPorDia.map((d) => (
            <div key={d.date} title={`${fmtDay(d.date)}: ${d.dano} págs`} className="flex w-6 flex-col items-center">
              <div className="w-full rounded-sm bg-red-300 dark:bg-red-800" style={{ height: `${d.dano > 0 ? 4 + (20 * d.dano) / maxDano : 2}px` }} />
            </div>
          ))}
          <span className={`ml-2 ${muted}`}>dano por dia (7 d)</span>
        </div>
        <div className={muted}>
          {c.danoMedio != null ? `~${String(c.danoMedio).replace('.', ',')} págs/dia` : 'sem dano recente'}
          {c.previsao ? ` · derrota prevista ~${fmtDay(c.previsao)}` : ''}
        </div>
      </div>
    </li>
  );
}

function Chefes({ jogo }: { jogo: Jogo }) {
  return (
    <Card title="Chefes">
      <p className={`mb-3 ${muted}`}>Livros abertos com 400+ páginas. A vida é o que falta ler; terminar o livro derrota o chefe.</p>
      {jogo.chefes.length === 0 ? (
        <p className={muted}>Nenhum chefe aberto agora.</p>
      ) : (
        <ul className="space-y-4">{jogo.chefes.map((c) => <ChefeItem key={c.book.md5} c={c} />)}</ul>
      )}
      {jogo.chefesDerrotados.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-sm font-medium">Derrotados</div>
          <ul className="space-y-1 text-sm">
            {jogo.chefesDerrotados.slice(0, 5).map((c) => (
              <li key={c.book.md5} className="flex justify-between gap-2">
                <Link to={`/livros/${c.book.md5}`} className="min-w-0 truncate hover:underline">{c.book.title}</Link>
                <span className="shrink-0 text-stone-500">{c.derrotadoEm ? fmtData(c.derrotadoEm) : '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Fantasma({ jogo }: { jogo: Jogo }) {
  const [idx, setIdx] = useState(0);
  const c = jogo.fantasma[idx];
  const diff = c.voce - c.fantasma;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Corrida contra o fantasma</h2>
        <div className="flex gap-1" role="group" aria-label="Comparar com">
          {jogo.fantasma.map((f, i) => (
            <button key={f.id} onClick={() => setIdx(i)} aria-pressed={i === idx}
              className={`rounded border px-2 py-0.5 text-sm ${i === idx ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 dark:border-stone-700'}`}>
              {f.id === 'mes-passado' ? 'Mês passado' : 'Ano passado'}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-2 text-sm">
        Você em {fmtMes(c.mes)} contra você em {fmtMes(c.mesFantasma)}, em páginas acumuladas.{' '}
        {diff === 0 ? <b>Empate com o fantasma.</b> : <b className={diff > 0 ? 'text-emerald-600' : 'text-red-600'}>{Math.abs(diff).toLocaleString('pt-BR')} págs {diff > 0 ? 'à frente' : 'atrás'}.</b>}
      </p>
      <div className="h-56" role="img"
        aria-label={`Páginas acumuladas: você ${c.voce} em ${fmtMes(c.mes)} contra ${c.fantasma} do fantasma em ${fmtMes(c.mesFantasma)}, até o dia ${c.dias.filter((d) => d.voce != null).length}`}>
        <ResponsiveContainer>
          <LineChart data={c.dias}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="dia" minTickGap={20} />
            <YAxis width={40} />
            <Tooltip labelFormatter={(d) => `Dia ${d}`} formatter={(v: number) => `${v} págs`} />
            <Legend />
            <Line dataKey="fantasma" name="Fantasma" stroke="#a8a29e" strokeDasharray="5 4" dot={false} />
            <Line dataKey="voce" name="Você" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Classes({ jogo }: { jogo: Jogo }) {
  const valor = (c: ClasseLeitor) => fmtValor(c.valor, c.unidade);
  return (
    <Card title="Classe de leitor">
      <p className={`mb-3 ${muted}`}>Calculada nos últimos 90 dias. A classe atual é a de maior pontuação.</p>
      <ul className="space-y-3">
        {jogo.classes.map((c) => (
          <li key={c.id} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-medium">
                {c.nome}
                {jogo.classe?.id === c.id && <span className={`${chip} ml-2 border-emerald-600 text-emerald-700 dark:text-emerald-400`}>classe atual</span>}
              </span>
              <span className="font-mono text-xs text-stone-500">{c.pontuacao}/100</span>
            </div>
            <ProgressBar value={c.pontuacao} />
            <div className={muted}>{c.criterio}: {valor(c)} (100 em {fmtValor(c.referencia, c.unidade)})</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Selo({ m }: { m: Medalha }) {
  return (
    <span aria-hidden
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 font-mono text-xs font-bold ${m.feito
        ? 'border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'border-stone-300 bg-stone-100 text-stone-400 dark:border-stone-700 dark:bg-stone-800'}`}>
      {m.sigla}
    </span>
  );
}

function ProximaConquista({ m }: { m: Medalha | null }) {
  return (
    <Card title="Próxima conquista">
      {m ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Selo m={m} />
            <div className="min-w-0">
              <div className="font-medium">{m.nome}</div>
              <div className={muted}>{m.descricao}</div>
            </div>
          </div>
          <ProgressBar value={pct(m)} />
          <div className="font-mono text-xs text-stone-500">{fmtValor(m.atual, m.unidade)} / {fmtValor(m.alvo, m.unidade)} · {Math.floor(pct(m))}%</div>
        </div>
      ) : (
        <p className={muted}>Todas as medalhas conquistadas.</p>
      )}
    </Card>
  );
}

function Recordes({ recordes }: { recordes: Recorde[] }) {
  return (
    <Card title="Recordes pessoais">
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {recordes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div>{r.rotulo}</div>
              <div className={`${muted} break-words`}>
                {[r.detalhe, r.data && (r.id === 'semana' ? `semana de ${fmtData(r.data)}` : fmtData(r.data))].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <b className="shrink-0 font-mono">{r.valor == null ? '—' : fmtValor(r.valor, r.unidade)}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Galeria({ medalhas }: { medalhas: Medalha[] }) {
  const ganhas = medalhas.filter((m) => m.feito).length;
  return (
    <Card title={`Galeria de medalhas (${ganhas}/${medalhas.length})`}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {medalhas.map((m) => (
          <li key={m.id} className={`flex gap-3 rounded-md border p-3 ${m.feito ? 'border-amber-300 dark:border-amber-800' : 'border-stone-200 dark:border-stone-800'}`}>
            <Selo m={m} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className={`font-medium ${m.feito ? '' : 'text-stone-500 dark:text-stone-400'}`}>{m.nome}</span>
                <span className="text-xs text-stone-500">{m.raridade}</span>
              </div>
              <div className={muted}>{m.descricao}</div>
              {m.feito ? (
                <div className="text-xs text-emerald-700 dark:text-emerald-400">conquistada{m.desbloqueadaEm ? ` em ${fmtData(m.desbloqueadaEm)}` : ''}</div>
              ) : (
                <>
                  <ProgressBar value={pct(m)} />
                  <div className="font-mono text-xs text-stone-500">{fmtValor(m.atual, m.unidade)} / {fmtValor(m.alvo, m.unidade)}</div>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ConquistasPage() {
  const q = useQuery({ queryKey: ['jogo'], queryFn: getJogo });
  const j = q.data;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Conquistas</h1>
        {j?.classe && (
          <span className="text-sm">
            Classe: <b className="text-emerald-700 dark:text-emerald-400">{j.classe.nome}</b>
          </span>
        )}
      </div>
      {q.isLoading && <p role="status">Carregando…</p>}
      {q.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-red-600">
          Erro ao carregar as conquistas.
          <button onClick={() => q.refetch()} className="rounded border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
            Tentar de novo
          </button>
        </div>
      )}
      {j && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Missoes jogo={j} />
            <Carta jogo={j} />
            <Relampago jogo={j} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DesafioCard title="Desafio da semana" d={j.semana} hoje={j.hoje} />
            <DesafioCard title={`Desafio de ${fmtMes(j.mes.inicio.slice(0, 7))}`} d={j.mes} hoje={j.hoje} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Chefes jogo={j} />
            <Fantasma jogo={j} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Classes jogo={j} />
            <div className="space-y-3">
              <ProximaConquista m={j.proximaConquista} />
              <Recordes recordes={j.recordes} />
            </div>
          </div>
          <Galeria medalhas={j.medalhas} />
        </>
      )}
    </>
  );
}
