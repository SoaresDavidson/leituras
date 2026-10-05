import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { RetroPeriodo, Retrospectiva } from '@leituras/shared';
import { getRetroPeriodo, getRetrospectiva } from '../api';
import { fmtDate, fmtHours } from '../format';
import Cover from './Cover';
import ProgressBar from './ProgressBar';

// Day of the month the recap opens by itself, like a monthly Wrapped
export const RETRO_DIA = 25;
const SLIDE_MS = 6500;
const VISTO_KEY = 'retro-visto';

const num = (n: number) => n.toLocaleString('pt-BR');
const mesNome = (isoDay: string) => new Date(`${isoDay}T12:00`).toLocaleDateString('pt-BR', { month: 'long' });
const mesKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** From the 25th on, the recap is about the month that is ending; before that, about the previous one. */
export const retroOffset = (d = new Date()) => (d.getDate() >= RETRO_DIA ? 0 : 1);

/** Opens once per month, on the first visit from the 25th until the month ends. */
export function useRetroAuto(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => {
    if (new Date().getDate() < RETRO_DIA) return false;
    try { return localStorage.getItem(VISTO_KEY) !== mesKey(); } catch { return false; }
  });
  const set = (v: boolean) => {
    if (!v && new Date().getDate() >= RETRO_DIA) {
      try { localStorage.setItem(VISTO_KEY, mesKey()); } catch { /* private mode: it may show again */ }
    }
    setOpen(v);
  };
  return [open, set];
}

function Delta({ atual, anterior, mes }: { atual: number; anterior: number; mes: string }) {
  if (anterior === 0) return <p className="muted">{atual > 0 ? `Em ${mes} não houve leitura.` : ''}</p>;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return <p className="muted">O mesmo que em {mes}.</p>;
  return <p className={pct > 0 ? 'text-ok' : 'text-warn'}>{pct > 0 ? '+' : ''}{pct}% em relação a {mes}.</p>;
}

// Each child fades up a beat after the previous one (see .story-in in components.css)
const In = ({ i, className = '', children }: { i: number; className?: string; children: ReactNode }) => (
  <div className={`story-in ${className}`} style={{ '--i': i } as React.CSSProperties}>{children}</div>
);

type Slide = { id: string; body: ReactNode };

function buildSlides(p: RetroPeriodo, r: Retrospectiva | undefined, onClose: () => void): Slide[] {
  const mes = mesNome(p.inicio);
  const mesAnterior = mesNome(p.anterior.inicio);
  const ano = p.inicio.slice(0, 4);
  const t = p.totais;
  const slides: Slide[] = [{
    id: 'abertura',
    body: <>
      <In i={0}><p className="muted">Sua retrospectiva de</p></In>
      <In i={1}><h2 className="font-mono text-6xl/[1.05] font-bold tracking-tighter text-accent capitalize">{mes}</h2></In>
      <In i={2}><p className="mt-6 max-w-[28ch] text-base">{t.minutos > 0 ? 'O que você leu, quanto e qual livro dominou o mês.' : `Nenhuma leitura registrada em ${mes} até agora.`}</p></In>
    </>,
  }];
  if (t.minutos === 0) return slides;

  slides.push({
    id: 'tempo',
    body: <>
      <In i={0}><p className="text-base">Você passou</p></In>
      <In i={1}><p className="num text-7xl/none font-bold tracking-tighter text-accent">{fmtHours(t.minutos)}</p></In>
      <In i={2}><p className="mt-2 text-base">lendo em {mes}.</p></In>
      <In i={3} className="mt-6"><Delta atual={t.minutos} anterior={p.anterior.minutos} mes={mesAnterior} /></In>
    </>,
  });

  slides.push({
    id: 'paginas',
    body: <div className="grid gap-8">
      <In i={0}>
        <p className="num text-6xl/none font-bold tracking-tighter">{num(t.paginas)}</p>
        <p className="mt-1 text-base">páginas viradas</p>
      </In>
      <In i={1} className="justify-self-end text-right">
        <p className="num text-6xl/none font-bold tracking-tighter text-accent">{t.diasLidos}</p>
        <p className="mt-1 text-base">{t.diasLidos === 1 ? 'dia' : 'dias'} com leitura</p>
      </In>
      <In i={2}><Delta atual={t.paginas} anterior={p.anterior.paginas} mes={mesAnterior} /></In>
    </div>,
  });

  const top = p.livros[0];
  if (top) slides.push({
    id: 'livro',
    body: <>
      <In i={0}><p className="muted">O livro do mês</p></In>
      <In i={1} className="my-6"><Cover book={top.book} className="h-56 w-38 -rotate-3 shadow-2xl shadow-black/40" /></In>
      <In i={2}><h2 className="font-mono text-2xl/tight font-bold text-balance">{top.book.title}</h2></In>
      <In i={3}><p className="muted mt-1">{top.book.authors}</p></In>
      <In i={4}><p className="mt-4 text-base"><span className="num font-bold text-accent">{fmtHours(top.minutos)}</span> e {num(top.paginas)} páginas{top.terminou ? ', do começo ao fim' : ''}.</p></In>
    </>,
  });

  if (p.maiorSessao || p.melhorDia) slides.push({
    id: 'sessao',
    body: <div className="grid gap-10">
      {p.maiorSessao && <In i={0}>
        <p className="muted">Maior sessão</p>
        <p className="num text-6xl/none font-bold tracking-tighter text-accent">{p.maiorSessao.minutos} min</p>
        <p className="mt-2 text-base">seguidos em {p.maiorSessao.book.title}, no dia {fmtDate(p.maiorSessao.date).slice(0, 5)}.</p>
      </In>}
      {p.melhorDia && <In i={1}>
        <p className="muted">Melhor dia</p>
        <p className="num text-4xl/none font-bold tracking-tighter">{fmtDate(p.melhorDia.date).slice(0, 5)}</p>
        <p className="mt-2 text-base">{fmtHours(p.melhorDia.minutos)} de leitura.</p>
      </In>}
    </div>,
  });

  const terminados = p.livros.filter((l) => l.terminou);
  if (terminados.length > 0) slides.push({
    id: 'terminados',
    body: <>
      <In i={0}><p className="num text-7xl/none font-bold tracking-tighter text-accent">{terminados.length}</p></In>
      <In i={1}><p className="mt-1 text-base">{terminados.length === 1 ? 'livro terminado' : 'livros terminados'}</p></In>
      <In i={2} className="mt-8 flex -space-x-6">
        {terminados.slice(0, 5).map(({ book }, i) => (
          <Cover key={book.md5} book={book} className={`h-36 w-24 shadow-xl shadow-black/40 ${i % 2 ? 'rotate-3' : '-rotate-2'}`} />
        ))}
      </In>
    </>,
  });

  if (r && String(r.meta.ano) === ano) {
    const pct = Math.round((r.meta.lidas / r.meta.metaPaginas) * 100);
    slides.push({
      id: 'meta',
      body: <>
        <In i={0}><p className="muted">Meta de {r.meta.ano}</p></In>
        <In i={1}><p className="num text-7xl/none font-bold tracking-tighter">{Math.min(100, pct)}%</p></In>
        <In i={2} className="mt-4 w-full"><ProgressBar value={pct} /></In>
        <In i={3}><p className="mt-4 text-base">
          {r.meta.restantes === 0
            ? 'Meta batida. O resto do ano é bônus.'
            : <>{num(r.meta.lidas)} de {num(r.meta.metaPaginas)} páginas. Faltam <span className="num font-bold text-accent">{num(r.meta.paginasPorDia)} por dia</span> até 31/12.</>}
        </p></In>
      </>,
    });
  }

  slides.push({
    id: 'fim',
    body: <>
      <In i={0}><h2 className="font-mono text-4xl/tight font-bold tracking-tighter text-balance">Até {RETRO_DIA} de {mesNome(nextMonth(p.inicio))}.</h2></In>
      {r && <In i={1}><p className="mt-4 text-base">Desde que começou a contar: <span className="num font-bold text-accent">{fmtHours(r.investimento.total.minutos)}</span> e {num(r.investimento.total.paginas)} páginas.</p></In>}
      <In i={2} className="mt-8 flex flex-wrap gap-2">
        <button onClick={onClose} className="btn-primary">Fechar</button>
        <Link to="/livros" onClick={onClose} className="btn">Ver livros</Link>
      </In>
    </>,
  });
  return slides;
}

function nextMonth(isoDay: string) {
  const [y, m] = isoDay.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export default function RetroStory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const offset = retroOffset();
  const periodo = useQuery({ queryKey: ['retrospectiva', 'periodo', 'mes', offset], queryFn: () => getRetroPeriodo('mes', offset), enabled: open });
  const retro = useQuery({ queryKey: ['retrospectiva'], queryFn: getRetrospectiva, enabled: open });
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  // Under reduced motion nothing advances by itself: the bars would otherwise finish instantly
  const [auto] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);

  // <dialog> gives Esc, focus containment and an inert page for free
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setI(0); setPaused(false); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  const slides = periodo.data ? buildSlides(periodo.data, retro.data, onClose) : [];
  const n = slides.length;
  const go = (step: number) => setI((v) => Math.min(n - 1, Math.max(0, v + step)));

  return (
    <dialog ref={ref} onClose={onClose} aria-label="Retrospectiva do mês"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === ' ') { e.preventDefault(); setPaused((v) => !v); }
      }}
      className="story m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-fg backdrop:bg-bg/85 backdrop:backdrop-blur-sm sm:m-auto sm:h-[min(820px,92dvh)] sm:max-w-[440px]">
      <div className="story-surface relative flex h-full flex-col overflow-hidden px-6 pt-4 pb-8 sm:rounded-2xl sm:border sm:border-line">
        <div className="flex gap-1" aria-hidden="true">
          {(n ? slides : [{ id: 'x' }]).map((s, k) => (
            <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-fg/15">
              <span
                key={k === i ? `${s.id}-on` : s.id}
                className={`block h-full bg-fg ${k < i || (k === i && !auto) ? 'w-full' : k === i ? 'story-bar' : 'w-0'}`}
                style={k === i && auto ? { animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' } : undefined}
                onAnimationEnd={() => (i < n - 1 ? setI(i + 1) : setPaused(true))}
              />
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-sm font-bold tracking-tight"><span className="text-accent">▲</span> Leituras</span>
          <div className="flex gap-1">
            {auto && n > 1 && <button onClick={() => setPaused((v) => !v)} className="btn-icon" aria-label={paused ? 'Continuar' : 'Pausar'}>{paused ? '▶' : '❚❚'}</button>}
            <button onClick={onClose} className="btn-icon" aria-label="Fechar retrospectiva">✕</button>
          </div>
        </div>

        <div className="relative flex-1">
          {periodo.isPending && <div role="status" aria-label="Carregando" className="flex h-full flex-col justify-center gap-4">
            <div className="skeleton h-4 w-32" /><div className="skeleton h-16 w-3/4" /><div className="skeleton h-4 w-2/3" />
          </div>}
          {periodo.isError && <div className="flex h-full flex-col justify-center gap-3">
            <p className="error">Não foi possível carregar a retrospectiva.</p>
            <button onClick={() => periodo.refetch()} className="btn self-start">Tentar de novo</button>
          </div>}
          {n > 0 && <>
            {/* tap zones: left third goes back, the rest goes forward; holding pauses */}
            <button aria-label="Anterior" tabIndex={-1} onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-0 w-1/3 cursor-w-resize"
              onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
            <button aria-label="Próximo" tabIndex={-1} onClick={() => go(1)} className="absolute inset-y-0 right-0 z-0 w-2/3 cursor-e-resize"
              onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
            <section key={slides[i].id} aria-live="polite" aria-roledescription="slide" aria-label={`${i + 1} de ${n}`}
              className="pointer-events-none relative flex h-full flex-col justify-center [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
              {slides[i].body}
            </section>
          </>}
        </div>

        {n > 1 && <div className="flex justify-between">
          <button onClick={() => go(-1)} disabled={i === 0} className="btn" aria-label="Slide anterior">←</button>
          <span className="num self-center text-xs text-muted">{i + 1}/{n}</span>
          <button onClick={() => go(1)} disabled={i === n - 1} className="btn" aria-label="Próximo slide">→</button>
        </div>}
      </div>
    </dialog>
  );
}
