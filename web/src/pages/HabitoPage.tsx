import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHART, tooltipStyle } from '../styles/chart';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Habito, HabitoDia, HabitoMeta, HabitoNivel, HabitoPatch, NivelSequencia } from '@leituras/shared';
import { ApiError, getHabito, patchHabito } from '../api';
import { MONTHS, fmtHours } from '../format';
import { Card } from '../components/Card';
import Heatmap from '../components/Heatmap';
import ProgressBar from '../components/ProgressBar';
import { SkeletonCards } from '../components/Skeleton';

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const NIVEL_LABEL: Record<NivelSequencia, { nome: string; criterio: string; cor: string }> = {
  bronze: { nome: 'Bronze', criterio: '≥ 5 min', cor: 'text-warn' },
  prata: { nome: 'Prata', criterio: 'meta do dia', cor: 'text-muted' },
  ouro: { nome: 'Ouro', criterio: '2× a meta', cor: 'text-accent' },
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const fmtDay = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const fmtMin = (m: number) => (m < 60 ? `${Math.round(m)} min` : fmtHours(m));
const fmtMeta = (m: HabitoMeta) => [m.minutos && `${m.minutos} min`, m.paginas && `${m.paginas} págs`].filter(Boolean).join(' e ');
const capitalize = (t: string) => {
  const [first = '', ...rest] = Array.from(t);
  return first.toUpperCase() + rest.join('');
};
const delta = (now: number, before: number) => (before === 0 ? '—' : `${now > before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%`);

// Calendar color relative to the daily goal: < half, < goal, goal met, twice the goal
function goalBucket(meta: HabitoMeta) {
  return (d: HabitoDia) => {
    if (d.minutes <= 0 && d.pages <= 0) return 0;
    const ratios: number[] = [];
    if (meta.minutos > 0) ratios.push(d.minutes / meta.minutos);
    if (meta.paginas > 0) ratios.push(d.pages / meta.paginas);
    const ratio = ratios.length ? Math.min(...ratios) : 0;
    if (ratio < 0.5) return 1;
    if (ratio < 1) return 2;
    return ratio < 2 ? 3 : 4;
  };
}

function ErroApi({ error }: { error: unknown }) {
  const msg = error instanceof ApiError && !error.message.startsWith('HTTP ') ? error.message : 'Não foi possível salvar.';
  return <span role="alert" className="error">{msg}</span>;
}

function useHabitoMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: HabitoPatch) => patchHabito(patch),
    onSuccess: (habito) => qc.setQueryData(['habito'], habito),
  });
}

function Gatilho({ gatilho }: { gatilho: string }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(gatilho);
  const save = useHabitoMutation();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ gatilho: texto }, { onSuccess: () => setEditando(false) });
  };
  return (
    <section className="callout">
      <div className="section-title">Gatilho do hábito</div>
      {editando ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={140} placeholder="depois do café"
            aria-label="Gatilho do hábito" className="input min-w-0 flex-1" />
          <button disabled={save.isPending} className="btn-primary">Salvar</button>
          <button type="button" onClick={() => setEditando(false)} className="link">cancelar</button>
          {save.isError && <ErroApi error={save.error} />}
        </form>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-semibold">
            {gatilho ? `${capitalize(gatilho)}, eu leio.` : 'Prenda a leitura a algo que já acontece: “depois do café”, “antes de dormir”.'}
          </p>
          <button onClick={() => { setTexto(gatilho); setEditando(true); }} className="link">
            {gatilho ? 'editar' : 'escrever gatilho'}
          </button>
        </div>
      )}
    </section>
  );
}

const METAS_FIELDS = [
  { key: 'metaDiaMinutos', label: 'Dia (min)', nome: 'Meta diária em minutos', max: 600 },
  { key: 'metaDiaPaginas', label: 'Dia (págs)', nome: 'Meta diária em páginas', max: 1000 },
  { key: 'metaMesMinutos', label: 'Mês (min)', nome: 'Meta mensal em minutos', max: 18000 },
  { key: 'metaMesPaginas', label: 'Mês (págs)', nome: 'Meta mensal em páginas', max: 30000 },
] as const;
type MetaKey = (typeof METAS_FIELDS)[number]['key'];

// Returns the patch, or an error message when a field is empty, out of range or a goal is all 0
function validarMetas(v: Record<MetaKey, string>): Required<Omit<HabitoPatch, 'gatilho'>> | string {
  const out = {} as Record<MetaKey, number>;
  for (const f of METAS_FIELDS) {
    const raw = v[f.key].trim();
    if (!/^\d+$/.test(raw) || Number(raw) > f.max) return `${f.nome} deve ser inteiro entre 0 e ${f.max}`;
    out[f.key] = Number(raw);
  }
  if (out.metaDiaMinutos === 0 && out.metaDiaPaginas === 0) return 'A meta diária precisa de minutos ou páginas';
  if (out.metaMesMinutos === 0 && out.metaMesPaginas === 0) return 'A meta mensal precisa de minutos ou páginas';
  return out;
}

function AjustesMetas({ habito, onDone }: { habito: Habito; onDone: () => void }) {
  const [v, setV] = useState<Record<MetaKey, string>>({
    metaDiaMinutos: String(habito.metas.dia.minutos),
    metaDiaPaginas: String(habito.metas.dia.paginas),
    metaMesMinutos: String(habito.metas.mes.minutos),
    metaMesPaginas: String(habito.metas.mes.paginas),
  });
  const [erro, setErro] = useState<string | null>(null);
  const save = useHabitoMutation();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch = validarMetas(v);
    if (typeof patch === 'string') { setErro(patch); return; }
    setErro(null);
    save.mutate(patch, { onSuccess: onDone });
  };
  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3 text-sm">
        {METAS_FIELDS.map((f) => (
          <label key={f.key} className="block">{f.label}
            <input type="number" inputMode="numeric" min={0} max={f.max} step={1} value={v[f.key]}
              onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className="input mt-1 block w-24" />
          </label>
        ))}
        <button disabled={save.isPending} className="btn-primary">Salvar</button>
        {erro ? <span role="alert" className="error">{erro}</span> : save.isError && <ErroApi error={save.error} />}
      </form>
      <p className="muted mt-2">0 desliga a parte, mas minutos e páginas de uma mesma meta não podem ficar os dois em 0. A meta é batida quando todas as partes ligadas são atingidas.</p>
    </Card>
  );
}

function MetaCard({ title, meta, feito, rodape }: { title: string; meta: HabitoMeta; feito: HabitoMeta; rodape?: string }) {
  const partes = [
    meta.minutos > 0 && { label: `${feito.minutos} de ${meta.minutos} min`, value: (feito.minutos / meta.minutos) * 100 },
    meta.paginas > 0 && { label: `${feito.paginas} de ${meta.paginas} págs`, value: (feito.paginas / meta.paginas) * 100 },
  ].filter((p): p is { label: string; value: number } => !!p);
  const batida = partes.every((p) => p.value >= 100);
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <div className="muted">{title}</div>
        {batida && <span className="success">batida ✓</span>}
      </div>
      <div className="mt-2 space-y-2">
        {partes.map((p) => (
          <div key={p.label}>
            <div className="num text-lg font-bold">{p.label}</div>
            <ProgressBar value={p.value} />
          </div>
        ))}
      </div>
      {rodape && <div className="muted mt-2">{rodape}</div>}
    </Card>
  );
}

function RegraDoisDias({ nivel, hoje }: { nivel: HabitoNivel; hoje: string }) {
  if (!nivel.atual) return <div className="panel text-sm">Sem sequência ativa. Bata a meta hoje para começar uma.</div>;
  const dias = daysBetween(nivel.atual.fim, hoje);
  const [cls, msg] = dias === 0
    ? ['panel border-ok/50 text-ok', 'Hoje já conta. A margem de uma falha está preservada.']
    : dias === 1
      ? ['panel border-warn/50 text-warn', 'Ontem foi ok. Se hoje falhar, é só um tropeço: amanhã é obrigatório.']
      : ['panel border-danger/50 text-danger', 'Ontem falhou. Hoje é obrigatório: uma segunda falha seguida quebra a sequência.'];
  return <div className={`text-sm ${cls}`}>{msg}</div>;
}

function Sequencias({ habito }: { habito: Habito }) {
  const max = Math.max(1, ...habito.niveis.map((n) => n.recorde?.dias ?? 0));
  const prata = habito.niveis.find((n) => n.nivel === 'prata')!;
  return (
    <Card title="Sequência">
      <div className="space-y-3">
        {habito.niveis.map((n) => {
          const l = NIVEL_LABEL[n.nivel];
          return (
            <div key={n.nivel}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="whitespace-nowrap"><b className={l.cor}>{l.nome}</b> <span className="muted">{l.criterio}</span></span>
                <span className="num whitespace-nowrap">{n.atual?.dias ?? 0} d <span className="muted">· recorde {n.recorde?.dias ?? 0}</span></span>
              </div>
              <ProgressBar value={((n.atual?.dias ?? 0) / max) * 100} />
            </div>
          );
        })}
        <RegraDoisDias nivel={prata} hoje={habito.hoje} />
        <p className="muted">Regra dos dois dias: um dia sem meta é tolerado; dois seguidos quebram a sequência. Nos dias ruins, mire no bronze.</p>
      </div>
    </Card>
  );
}

function Historico({ habito }: { habito: Habito }) {
  const [nivel, setNivel] = useState<NivelSequencia>('prata');
  const n = habito.niveis.find((x) => x.nivel === nivel)!;
  const lista = [...(n.atual ? [n.atual] : []), ...n.historico];
  const max = Math.max(1, ...lista.map((s) => s.dias));
  return (
    <Card title="Histórico de sequências">
      <div className="mb-3 flex gap-2" role="group" aria-label="Nível">
        {habito.niveis.map((x) => (
          <button key={x.nivel} onClick={() => setNivel(x.nivel)} aria-pressed={x.nivel === nivel}
            className="btn">
            {NIVEL_LABEL[x.nivel].nome}
          </button>
        ))}
      </div>
      {lista.length === 0 ? <p className="muted">Nenhuma sequência ainda.</p> : (
        <ul className="space-y-2">
          {lista.map((s) => (
            <li key={s.inicio} className="flex items-center gap-2 text-sm">
              <span className="num shrink-0 whitespace-nowrap text-muted">{fmtDay(s.inicio)} – {fmtDay(s.fim)}</span>
              <div className="track min-w-0 flex-1">
                <div className={`track-fill ${s === n.atual ? 'bg-accent' : 'bg-accent/40'}`} style={{ width: `${(s.dias / max) * 100}%` }} />
              </div>
              <span className="num shrink-0 whitespace-nowrap text-right">{s.dias} d{s.inicio === n.recorde?.inicio ? ' ★' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted mt-2">Barra escura = sequência em andamento. ★ = recorde.</p>
    </Card>
  );
}

function Padroes({ habito }: { habito: Habito }) {
  const horas = habito.porHora.map((min, h) => ({ label: `${h}h`, min }));
  const total = habito.porHora.reduce((a, b) => a + b, 0);
  const pico = habito.porHora.indexOf(Math.max(...habito.porHora));
  const semana = habito.porDiaSemana.map((min, i) => ({ label: WEEKDAYS[i], min: Math.round(min) }));
  const forte = habito.porDiaSemana.indexOf(Math.max(...habito.porDiaSemana));
  const fraco = habito.porDiaSemana.indexOf(Math.min(...habito.porDiaSemana));
  return (
    <div className="grid-2">
      <Card title="Melhor horário">
        <div className="h-44" role="img" aria-label={total === 0 ? 'Minutos por hora do dia: sem leitura' : `Minutos por hora do dia nos últimos 90 dias; pico às ${pico}h`}>
          <ResponsiveContainer>
            <BarChart data={horas}>
              <XAxis dataKey="label" interval={5} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <YAxis hide />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} min`, 'Leitura']} />
              <Bar dataKey="min" radius={[2, 2, 0, 0]}>
                {horas.map((h, i) => <Cell key={h.label} fill={i === pico && total > 0 ? CHART.main : CHART.soft} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted">
          {total === 0 ? 'Sem leitura nos últimos 90 dias.'
            : <>Pico às <b>{pico}h</b> ({Math.round((habito.porHora[pico] / total) * 100)}% do tempo nos últimos 90 dias). Proteja esse horário.</>}
        </p>
      </Card>
      <Card title="Por dia da semana">
        <div className="h-44" role="img" aria-label={`Média de minutos por dia da semana: ${semana.map((d) => `${d.label} ${d.min}`).join(', ')}`}>
          <ResponsiveContainer>
            <BarChart data={semana}>
              <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <YAxis hide />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} min/dia`, 'Média']} />
              <Bar dataKey="min" radius={[2, 2, 0, 0]}>
                {semana.map((d, i) => <Cell key={d.label} fill={i === forte && total > 0 ? CHART.main : CHART.soft} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted">
          {total === 0 ? 'Média de minutos por dia nos últimos 90 dias.'
            : <>Mais forte: <b>{WEEKDAYS[forte]}</b> ({semana[forte].min} min). Elo fraco: <b>{WEEKDAYS[fraco]}</b> ({semana[fraco].min} min).</>}
        </p>
      </Card>
    </div>
  );
}

function Comparacoes({ habito }: { habito: Habito }) {
  const { semana, vsPassado } = habito;
  const dados = WEEKDAYS.map((label, i) => ({ label, passada: semana.anterior[i], esta: semana.atual[i] }));
  const totalAtual = semana.atual.reduce((a, b) => a + b, 0);
  const linhas: [string, keyof typeof vsPassado.atual][] = [['Minutos', 'minutos'], ['Páginas', 'paginas'], ['Dias com leitura', 'diasComLeitura'], ['Dias com meta', 'diasComMeta']];
  return (
    <div className="grid-2">
      <Card title="Esta semana vs. semana passada">
        <div className="stat-value">
          {fmtMin(totalAtual)}{' '}
          {semana.variacao != null && (
            <span className={`text-base ${semana.variacao > 0 ? 'text-ok' : semana.variacao < 0 ? 'text-danger' : 'text-muted'}`}>
              {semana.variacao > 0 ? '+' : ''}{semana.variacao}%
            </span>
          )}
        </div>
        <div className="muted">Variação contando só os dias até hoje nas duas semanas.</div>
        <div className="mt-2 h-44" role="img" aria-label={`Minutos por dia: esta semana ${semana.atual.join(', ')}; semana passada ${semana.anterior.join(', ')}`}>
          <ResponsiveContainer>
            <BarChart data={dados}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <YAxis allowDecimals={false} width={32} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => `${v} min`} />
              <Legend />
              <Bar dataKey="passada" name="Passada" fill={CHART.ghost} radius={[2, 2, 0, 0]} />
              <Bar dataKey="esta" name="Esta" fill={CHART.main} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Você vs. você de 90 dias atrás">
        <p className="muted mb-2">
          Últimos 30 dias contra {fmtDay(vsPassado.antes.inicio)} – {fmtDay(vsPassado.antes.fim)}.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted"><th className="text-left font-normal" /><th className="text-right font-normal">Antes</th><th className="text-right font-normal">Agora</th><th className="text-right font-normal">Δ</th></tr>
          </thead>
          <tbody>
            {linhas.map(([nome, k]) => {
              const antes = vsPassado.antes[k] as number;
              const agora = vsPassado.atual[k] as number;
              return (
                <tr key={k} className="border-t border-line">
                  <td className="py-1">{nome}</td>
                  <td className="num text-right">{antes.toLocaleString('pt-BR')}</td>
                  <td className="num text-right">{agora.toLocaleString('pt-BR')}</td>
                  <td className={`num text-right ${agora > antes ? 'text-ok' : agora < antes ? 'text-danger' : 'text-muted'}`}>{delta(agora, antes)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function HabitoPage() {
  const q = useQuery({ queryKey: ['habito'], queryFn: getHabito });
  const [ajustando, setAjustando] = useState(false);
  const h = q.data;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="page-title">Hábito</h1>
        {h && (
          <button onClick={() => setAjustando(!ajustando)} className="link">
            {ajustando ? 'fechar ajustes' : 'ajustar metas'}
          </button>
        )}
      </div>
      {q.isLoading && <SkeletonCards />}
      {q.isError && <p className="error">Erro ao carregar o hábito.</p>}
      {h && (
        <>
          <Gatilho key={h.gatilho} gatilho={h.gatilho} />
          {ajustando && <AjustesMetas habito={h} onDone={() => setAjustando(false)} />}
          <div className="grid-3">
            <MetaCard title="Meta do dia" meta={h.metas.dia} feito={h.progresso.dia} />
            <MetaCard title={`Meta de ${MONTHS[Number(h.hoje.slice(5, 7)) - 1]}`} meta={h.metas.mes} feito={h.progresso.mes} />
            <Card>
              <div className="muted">Consistência</div>
              <div className="stat-value">{h.consistencia.pontuacao}<span className="text-base font-normal text-muted">/100</span></div>
              <ProgressBar value={h.consistencia.pontuacao} />
              <div className="muted mt-2">
                {h.consistencia.diasComMeta} de 30 dias com meta, {h.consistencia.diasComLeitura} com leitura.
                Meta vale 1, só leitura vale ½.
              </div>
            </Card>
          </div>
          <div className="grid-2">
            <Sequencias habito={h} />
            <Historico habito={h} />
          </div>
          <Card title="Calendário (últimos 365 dias)">
            <Heatmap daily={h.daily} bucketOf={goalBucket(h.metas.dia)} ariaLabel="Calendário de leitura dos últimos 365 dias, colorido pela meta do dia"
              label={(d) => `${fmtDay(d.date)}: ${d.minutes} min, ${d.pages} págs${d.metaBatida ? ' · meta batida' : ''}`} />
            <p className="muted mt-2">
              <b>{h.daily.filter((d) => d.metaBatida).length}</b> dias com meta ({fmtMeta(h.metas.dia)}) em 365.
              Cores: menos da metade, quase, meta batida, o dobro.
            </p>
          </Card>
          <Padroes habito={h} />
          <Comparacoes habito={h} />
        </>
      )}
    </>
  );
}
