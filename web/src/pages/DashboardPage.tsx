import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getBooks, getDashboard } from '../api';
import { MONTHS, fmtHours } from '../format';
import { Card, Stat } from '../components/Card';
import Heatmap from '../components/Heatmap';
import BookList from '../components/BookList';

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
        <h1 className="text-2xl font-bold">Painel</h1>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700 dark:bg-stone-900">
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      {dash.isError && <p className="text-red-600">Erro ao carregar o painel.</p>}
      {d && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Livros concluídos" value={d.totals.booksFinished} />
            <Stat label="Horas lidas" value={fmtHours(d.totals.minutes)} />
            <Stat label="Páginas" value={d.totals.pages} />
          </div>
          <Card title="Atividade (últimos 365 dias)"><Heatmap daily={d.daily} /></Card>
          <Card title="Livros concluídos por mês">
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={d.finishedPerMonth.map((m) => ({ ...m, label: MONTHS[Number(m.month.slice(5)) - 1] }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Livros" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Lendo agora"><BookList books={d.foco.abertos} /></Card>
        </>
      )}
      <Card title="Todos os livros">
        {books.isLoading ? <p>Carregando…</p> : <BookList books={books.data ?? []} />}
      </Card>
    </>
  );
}
