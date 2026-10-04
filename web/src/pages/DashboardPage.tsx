import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getBooks, getDashboard } from '../api';
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
          <FocoPanel foco={d.foco} />
          <div className="grid-3">
            <Stat label="Livros concluídos" value={d.totals.booksFinished} />
            <Stat label="Horas lidas" value={fmtHours(d.totals.minutes)} />
            <Stat label="Páginas" value={d.totals.pages} />
          </div>
          <Card title="Atividade (últimos 365 dias)"><Heatmap daily={d.daily} /></Card>
          <Card title="Livros concluídos por mês">
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
          </Card>
        </>
      )}
      <Card title="Todos os livros">
        {books.isLoading ? <p>Carregando…</p> : <BookList books={books.data ?? []} />}
      </Card>
    </>
  );
}
