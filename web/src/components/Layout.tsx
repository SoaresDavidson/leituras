import { Link, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { logout } from '../api';

export default function Layout() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const out = async () => {
    await logout();
    qc.clear();
    nav('/login');
  };
  return (
    <>
      <header className="border-b border-stone-200 dark:border-stone-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-semibold">Leituras</Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className="hover:underline">Painel</Link>
            <Link to="/habito" className="hover:underline">Hábito</Link>
            <Link to="/retrospectiva" className="hover:underline">Retrospectiva</Link>
            <Link to="/aprendizado" className="hover:underline">Aprendizado</Link>
            <Link to="/livros" className="hover:underline">Livros</Link>
            <button onClick={out} className="rounded border border-stone-300 px-3 py-1 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">Sair</button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Outlet />
      </main>
    </>
  );
}
