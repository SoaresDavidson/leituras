import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { logout } from '../api';

const LINKS: [string, string][] = [
  ['/', 'Painel'],
  ['/habito', 'Hábito'],
  ['/retrospectiva', 'Retrospectiva'],
  ['/conquistas', 'Conquistas'],
  ['/livros', 'Livros'],
  ['/configuracoes', 'Configurações'],
];

export default function Layout() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  // On narrow screens the nav is a scrolling strip: keep the current page visible in it
  useEffect(() => {
    navRef.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  const out = async () => {
    await logout();
    qc.clear();
    nav('/login');
  };
  return (
    <>
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3.5 gap-y-1 px-4 pt-2 sm:px-5 sm:py-2.5">
          <Link to="/" className="font-mono text-base font-bold tracking-tight">
            <span className="text-accent">▲</span> Leituras
          </Link>
          <nav ref={navRef}
            className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto overscroll-x-contain px-4 pb-2 [scrollbar-width:none]
              sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {LINKS.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className="nav-link shrink-0 whitespace-nowrap">{label}</NavLink>
            ))}
          </nav>
          <button onClick={out} className="btn ml-auto">Sair</button>
        </div>
      </header>
      <main id="conteudo" tabIndex={-1} className="outline-none mx-auto max-w-6xl px-4 py-6 pb-16 sm:px-5">
        <div key={pathname} className="animate-enter space-y-6">
          <Outlet />
        </div>
      </main>
    </>
  );
}
