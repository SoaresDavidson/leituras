import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { logout } from '../api';

const LINKS: [string, string][] = [
  ['/', 'Painel'],
  ['/habito', 'Hábito'],
  ['/retrospectiva', 'Retrospectiva'],
  ['/aprendizado', 'Aprendizado'],
  ['/conquistas', 'Conquistas'],
  ['/livros', 'Livros'],
];

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
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3.5 gap-y-1.5 px-4 py-2.5 sm:px-5">
          <Link to="/" className="font-mono text-base font-bold tracking-tight">
            <span className="text-accent">▲</span> Leituras
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {LINKS.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className="nav-link">{label}</NavLink>
            ))}
          </nav>
          <button onClick={out} className="btn">Sair</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-16 sm:px-5">
        <Outlet />
      </main>
    </>
  );
}
