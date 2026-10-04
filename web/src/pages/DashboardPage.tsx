import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PAINEL_ITENS } from '@leituras/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getBooks, getDashboard, getPainelConfig } from '../api';
import { CHART, tooltipStyle } from '../styles/chart';
import { MONTHS, fmtHours } from '../format';
import { Card, Stat } from '../components/Card';
import Heatmap from '../components/Heatmap';
import BookList from '../components/BookList';
import FocoPanel from '../components/FocoPanel';

export default function DashboardPage() {
  const now = new Date().getFullYear();
  const [year, setYear] = useState(now);
  const dash = useQuery({ queryKey: ['dashboard', year], queryFn: () => getDashboard(year) });
  const books = useQuery({ queryKey: ['books'], queryFn: getBooks });
  const cfg = useQuery({ queryKey: ['painel-config'], queryFn: getPainelConfig });
  // Until the preference loads (or if it fails) everything stays visible
  const show = (item: (typeof PAINEL_ITENS)[number]) => cfg.data?.[item] ?? true;
  const allHidden = cfg.data !== undefined && PAINEL_ITENS.every((i) => !cfg.data[i]);
  const years = Array.from({ length: 6 }, (_, i) => now - i);
  const d = dash.data;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="page-title">Painel</h1>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="input w-auto">
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      {dash.isError && <p className="error">Erro ao carregar o painel.</p>}
      {d && (
        <>
          {show('foco') && <FocoPanel foco={d.foco} />}
          {(show('livrosConcluidos') || show('horas') || show('paginas')) && (
            <div className="grid-stats">
              {show('livrosConcluidos') && <Stat label="Livros concluídos" value={d.totals.booksFinished} />}
              {show('horas') && <Stat label="Horas lidas" value={fmtHours(d.totals.minutes)} />}
              {show('paginas') && <Stat label="Páginas" value={d.totals.pages} />}
            </div>
          )}
          {show('atividade') && <Card title="Atividade (últimos 365 dias)"><Heatmap daily={d.daily} /></Card>}
          {show('concluidosPorMes') && <Card title="Livros concluídos por mês">
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={d.finishedPerMonth.map((m) => ({ ...m, label: MONTHS[Number(m.month.slice(5)) - 1] }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
                  <YAxis allowDecimals={false} tick={{ fill: CHART.axis, fontSize: 11 }} stroke={CHART.grid} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" name="Livros" fill={CHART.main} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>}
        </>
      )}
      {show('todosLivros') && (
        <Card title="Todos os livros">
          {books.isLoading ? <p>Carregando…</p> : <BookList books={books.data ?? []} />}
        </Card>
      )}
      {allHidden && (
        <div className="callout">
          <p className="font-bold">Todos os itens do painel estão ocultos.</p>
          <p className="muted">Seus dados continuam salvos. <Link to="/configuracoes" className="underline">Abra as Configurações</Link> para mostrar os itens de novo.</p>
        </div>
      )}
    </>
  );
}
