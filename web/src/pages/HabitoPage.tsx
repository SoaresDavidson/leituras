import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Habito, HabitoDia, HabitoMeta, HabitoNivel, HabitoPatch, NivelSequencia } from '@leituras/shared';
import { ApiError, getHabito, patchHabito } from '../api';
import { MONTHS, fmtHours } from '../format';
import { Card } from '../components/Card';
import Heatmap from '../components/Heatmap';
import ProgressBar from '../components/ProgressBar';

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const NIVEL_LABEL: Record<NivelSequencia, { nome: string; criterio: string; cor: string }> = {
  bronze: { nome: 'Bronze', criterio: '≥ 5 min', cor: 'text-amber-700 dark:text-amber-500' },
  prata: { nome: 'Prata', criterio: 'meta do dia', cor: 'text-stone-500 dark:text-stone-300' },
  ouro: { nome: 'Ouro', criterio: '2× a meta', cor: 'text-yellow-500' },
};
const input = 'w-24 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-900';
const muted = 'text-sm text-stone-500 dark:text-stone-400';

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
  return <span role="alert" className="text-sm text-red-600">{msg}</span>;
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
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
      <div className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Gatilho do hábito</div>
      {editando ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={140} placeholder="depois do café"
            aria-label="Gatilho do hábito" className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-900" />
          <button disabled={save.isPending} className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">Salvar</button>
          <button type="button" onClick={() => setEditando(false)} className="text-sm text-stone-500 hover:underline">cancelar</button>
          {save.isError && <ErroApi error={save.error} />}
        </form>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-semibold">
            {gatilho ? `${capitalize(gatilho)}, eu leio.` : 'Prenda a leitura a algo que já acontece: “depois do café”, “antes de dormir”.'}
          </p>
          <button onClick={() => { setTexto(gatilho); setEditando(true); }} className="text-sm text-stone-500 hover:underline">
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
              onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className={`${input} block`} />
          </label>
        ))}
        <button disabled={save.isPending} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white disabled:opacity-50">Salvar</button>
        {erro ? <span role="alert" className="text-sm text-red-600">{erro}</span> : save.isError && <ErroApi error={save.error} />}
      </form>
      <p className={`mt-2 ${muted}`}>0 desliga a parte, mas minutos e páginas de uma mesma meta não podem ficar os dois em 0. A meta é batida quando todas as partes ligadas são atingidas.</p>
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
        <div className={muted}>{title}</div>
        {batida && <span className="text-sm font-medium text-emerald-600">batida ✓</span>}
      </div>
      <div className="mt-2 space-y-2">
        {partes.map((p) => (
          <div key={p.label}>
            <div className="text-lg font-bold">{p.label}</div>
            <ProgressBar value={p.value} />
          </div>
        ))}
      </div>
      {rodape && <div className={`mt-2 ${muted}`}>{rodape}</div>}
    </Card>
  );
}

function RegraDoisDias({ nivel, hoje }: { nivel: HabitoNivel; hoje: string }) {
  if (!nivel.atual) return <div className="rounded bg-stone-100 p-3 text-sm dark:bg-stone-800">Sem sequência ativa. Bata a meta hoje para começar uma.</div>;
  const dias = daysBetween(nivel.atual.fim, hoje);
  const [cls, msg] = dias === 0
    ? ['bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', 'Hoje já conta. A margem de uma falha está preservada.']
    : dias === 1
      ? ['bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300', 'Ontem foi ok. Se hoje falhar, é só um tropeço: amanhã é obrigatório.']
      : ['bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300', 'Ontem falhou. Hoje é obrigatório: uma segunda falha seguida quebra a sequência.'];
  return <div className={`rounded p-3 text-sm ${cls}`}>{msg}</div>;
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
                <span className="whitespace-nowrap"><b className={l.cor}>{l.nome}</b> <span className={muted}>{l.criterio}</span></span>
                <span className="whitespace-nowrap font-mono">{n.atual?.dias ?? 0} d <span className={muted}>· recorde {n.recorde?.dias ?? 0}</span></span>
              </div>
              <ProgressBar value={((n.atual?.dias ?? 0) / max) * 100} />
            </div>
          );
        })}
        <RegraDoisDias nivel={prata} hoje={habito.hoje} />
        <p className={muted}>Regra dos dois dias: um dia sem meta é tolerado; dois seguidos quebram a sequência. Nos dias ruins, mire no bronze.</p>
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
            className={`rounded-full border px-3 py-1 text-sm ${x.nivel === nivel ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 dark:border-stone-700'}`}>
            {NIVEL_LABEL[x.nivel].nome}
          </button>
        ))}
      </div>
      {lista.length === 0 ? <p className={muted}>Nenhuma sequência ainda.</p> : (
        <ul className="space-y-2">
          {lista.map((s) => (
            <li key={s.inicio} className="flex items-center gap-2 text-sm">
              <span className="shrink-0 whitespace-nowrap font-mono text-stone-500">{fmtDay(s.inicio)} – {fmtDay(s.fim)}</span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-stone-200 dark:bg-stone-700">
                <div className={`h-full ${s === n.atual ? 'bg-emerald-600' : 'bg-emerald-300 dark:bg-emerald-800'}`} style={{ width: `${(s.dias / max) * 100}%` }} />
              </div>
              <span className="shrink-0 whitespace-nowrap text-right font-mono">{s.dias} d{s.inicio === n.recorde?.inicio ? ' ★' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={`mt-2 ${muted}`}>Barra escura = sequência em andamento. ★ = recorde.</p>
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Card title="Melhor horário">
        <div className="h-44" role="img" aria-label={total === 0 ? 'Minutos por hora do dia: sem leitura' : `Minutos por hora do dia nos últimos 90 dias; pico às ${pico}h`}>
          <ResponsiveContainer>
            <BarChart data={horas}>
              <XAxis dataKey="label" interval={5} fontSize={11} />
              <YAxis hide />
              <Tooltip formatter={(v: number) => [`${v} min`, 'Leitura']} />
              <Bar dataKey="min" radius={[2, 2, 0, 0]}>
                {horas.map((h, i) => <Cell key={h.label} fill={i === pico && total > 0 ? '#047857' : '#6ee7b7'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className={muted}>
          {total === 0 ? 'Sem leitura nos últimos 90 dias.'
            : <>Pico às <b>{pico}h</b> ({Math.round((habito.porHora[pico] / total) * 100)}% do tempo nos últimos 90 dias). Proteja esse horário.</>}
        </p>
      </Card>
      <Card title="Por dia da semana">
        <div className="h-44" role="img" aria-label={`Média de minutos por dia da semana: ${semana.map((d) => `${d.label} ${d.min}`).join(', ')}`}>
          <ResponsiveContainer>
            <BarChart data={semana}>
              <XAxis dataKey="label" fontSize={11} />
              <YAxis hide />
              <Tooltip formatter={(v: number) => [`${v} min/dia`, 'Média']} />
              <Bar dataKey="min" radius={[2, 2, 0, 0]}>
                {semana.map((d, i) => <Cell key={d.label} fill={i === forte && total > 0 ? '#047857' : '#6ee7b7'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className={muted}>
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Card title="Esta semana vs. semana passada">
        <div className="text-2xl font-bold">
          {fmtMin(totalAtual)}{' '}
          {semana.variacao != null && (
            <span className={`text-base ${semana.variacao > 0 ? 'text-emerald-600' : semana.variacao < 0 ? 'text-red-600' : 'text-stone-500'}`}>
              {semana.variacao > 0 ? '+' : ''}{semana.variacao}%
            </span>
          )}
        </div>
        <div className={muted}>Variação contando só os dias até hoje nas duas semanas.</div>
        <div className="mt-2 h-44" role="img" aria-label={`Minutos por dia: esta semana ${semana.atual.join(', ')}; semana passada ${semana.anterior.join(', ')}`}>
          <ResponsiveContainer>
            <BarChart data={dados}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} width={32} fontSize={11} />
              <Tooltip formatter={(v: number) => `${v} min`} />
              <Legend />
              <Bar dataKey="passada" name="Passada" fill="#a8a29e" radius={[2, 2, 0, 0]} />
              <Bar dataKey="esta" name="Esta" fill="#10b981" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Você vs. você de 90 dias atrás">
        <p className={`mb-2 ${muted}`}>
          Últimos 30 dias contra {fmtDay(vsPassado.antes.inicio)} – {fmtDay(vsPassado.antes.fim)}.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-stone-500"><th className="text-left font-normal" /><th className="text-right font-normal">Antes</th><th className="text-right font-normal">Agora</th><th className="text-right font-normal">Δ</th></tr>
          </thead>
          <tbody>
            {linhas.map(([nome, k]) => {
              const antes = vsPassado.antes[k] as number;
              const agora = vsPassado.atual[k] as number;
              return (
                <tr key={k} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="py-1">{nome}</td>
                  <td className="text-right font-mono">{antes.toLocaleString('pt-BR')}</td>
                  <td className="text-right font-mono">{agora.toLocaleString('pt-BR')}</td>
                  <td className={`text-right font-mono ${agora > antes ? 'text-emerald-600' : agora < antes ? 'text-red-600' : 'text-stone-500'}`}>{delta(agora, antes)}</td>
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
        <h1 className="text-2xl font-bold">Hábito</h1>
        {h && (
          <button onClick={() => setAjustando(!ajustando)} className="text-sm text-stone-500 hover:underline">
            {ajustando ? 'fechar ajustes' : 'ajustar metas'}
          </button>
        )}
      </div>
      {q.isLoading && <p>Carregando…</p>}
      {q.isError && <p className="text-red-600">Erro ao carregar o hábito.</p>}
      {h && (
        <>
          <Gatilho key={h.gatilho} gatilho={h.gatilho} />
          {ajustando && <AjustesMetas habito={h} onDone={() => setAjustando(false)} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetaCard title="Meta do dia" meta={h.metas.dia} feito={h.progresso.dia} />
            <MetaCard title={`Meta de ${MONTHS[Number(h.hoje.slice(5, 7)) - 1]}`} meta={h.metas.mes} feito={h.progresso.mes} />
            <Card>
              <div className={muted}>Consistência</div>
              <div className="text-2xl font-bold">{h.consistencia.pontuacao}<span className="text-base font-normal text-stone-500">/100</span></div>
              <ProgressBar value={h.consistencia.pontuacao} />
              <div className={`mt-2 ${muted}`}>
                {h.consistencia.diasComMeta} de 30 dias com meta, {h.consistencia.diasComLeitura} com leitura.
                Meta vale 1, só leitura vale ½.
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Sequencias habito={h} />
            <Historico habito={h} />
          </div>
          <Card title="Calendário (últimos 365 dias)">
            <Heatmap daily={h.daily} bucketOf={goalBucket(h.metas.dia)} ariaLabel="Calendário de leitura dos últimos 365 dias, colorido pela meta do dia"
              label={(d) => `${fmtDay(d.date)}: ${d.minutes} min, ${d.pages} págs${d.metaBatida ? ' · meta batida' : ''}`} />
            <p className={`mt-2 ${muted}`}>
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
