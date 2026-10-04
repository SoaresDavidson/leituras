import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Aprendizado, BookSummary, NoArvore, Nota, TrilhaProgresso } from '@leituras/shared';
import { deleteNota, getAprendizado, getBooks, putTrilhaItem, revisarNota } from '../api';
import { fmtDate, fmtHours } from '../format';
import { Card, Stat } from '../components/Card';
import ProgressBar from '../components/ProgressBar';
import { ErroInline, NovaNota, useAprendizadoMutation } from '../components/AprendizadoLivro';

const MAX_NIVEL = 5;

function RevisarHoje({ notas }: { notas: Nota[] }) {
  const revisar = useAprendizadoMutation(({ id, lembrei }: { id: number; lembrei: boolean }) => revisarNota(id, lembrei));
  if (notas.length === 0) return <p className="muted">Nada para revisar hoje.</p>;
  return (
    <>
    <ErroInline show={revisar.isError}>Não foi possível registrar a revisão.</ErroInline>
    <ul className="space-y-3">
      {notas.map((n) => (
        <li key={n.id} className="panel">
          <p className="whitespace-pre-wrap break-words">{n.texto}</p>
          <p className="muted mt-1">
            <Link to={`/livros/${n.md5}`} className="underline-offset-2 hover:underline">{n.bookTitle}</Link> · anotado em {fmtDate(n.criadoEm)}
          </p>
          <div className="mt-2 flex gap-2">
            <button disabled={revisar.isPending} onClick={() => revisar.mutate({ id: n.id, lembrei: true })}
              className="btn-primary">Lembrei</button>
            <button disabled={revisar.isPending} onClick={() => revisar.mutate({ id: n.id, lembrei: false })} className="btn">Esqueci</button>
          </div>
        </li>
      ))}
    </ul>
    </>
  );
}

function NovoAprendizado({ books }: { books: BookSummary[] }) {
  const ordered = [...books].sort((a, b) => Number(b.status === 'lido') - Number(a.status === 'lido') || a.title.localeCompare(b.title, 'pt-BR'));
  const [md5, setMd5] = useState('');
  return (
    <div className="space-y-3">
      <label className="block text-sm">Livro
        <select value={md5} onChange={(e) => setMd5(e.target.value)} className="input">
          <option value="">Escolha um livro</option>
          {ordered.map((b) => <option key={b.md5} value={b.md5}>{b.title}{b.status === 'lido' ? ' (lido)' : ''}</option>)}
        </select>
      </label>
      <NovaNota md5={md5} placeholder="Uma frase: o que ficou?" />
    </div>
  );
}

function Diario({ notas }: { notas: Nota[] }) {
  const apagar = useAprendizadoMutation(deleteNota);
  if (notas.length === 0) return <p className="muted">Nenhum aprendizado ainda. Comece pela página de um livro que você terminou.</p>;
  const porDia = new Map<string, Nota[]>();
  for (const n of notas) porDia.set(n.criadoEm, [...(porDia.get(n.criadoEm) ?? []), n]);
  return (
    <div className="space-y-4">
      <ErroInline show={apagar.isError}>Não foi possível apagar.</ErroInline>
      {[...porDia].map(([dia, doDia]) => (
        <section key={dia}>
          <h3 className="mb-1 text-sm font-semibold">{fmtDate(dia)}</h3>
          <ul className="list-divided">
            {doDia.map((n) => (
              <li key={n.id} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words">{n.texto}</p>
                  <p className="muted">
                    <Link to={`/livros/${n.md5}`} className="underline-offset-2 hover:underline">{n.bookTitle}</Link> · revisar em {fmtDate(n.proximaRevisao)}
                  </p>
                </div>
                <button aria-label="Apagar aprendizado" disabled={apagar.isPending} onClick={() => apagar.mutate(n.id)} className="btn">✕</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Ferrugem({ areas }: { areas: Aprendizado['ferrugem'] }) {
  if (areas.length === 0) return <p className="muted">Preencha a categoria dos livros para ver a ferrugem por área.</p>;
  const cor = (f: number) => (f >= 75 ? 'bg-danger' : f >= 40 ? 'bg-warn' : 'bg-ok');
  return (
    <>
      <p className="muted mb-2">Sem leitura nem revisão na área: 0% até 7 dias, 100% a partir de 90.</p>
      <ul className="space-y-2">
        {areas.map((a) => (
          <li key={a.area}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="truncate font-medium">{a.area}</span>
              <span className="num shrink-0 text-xs text-muted">{a.dias === 0 ? 'hoje' : `${a.dias} dias sem tocar`} · {a.ferrugem}%</span>
            </div>
            <ProgressBar value={a.ferrugem} className={cor(a.ferrugem)} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Nivel({ nivel }: { nivel: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`Nível ${nivel} de ${MAX_NIVEL}`}>
      {Array.from({ length: MAX_NIVEL }, (_, i) => (
        <span key={i} className={`h-2 w-3 rounded-sm ${i < nivel ? 'bg-accent' : 'bg-surface-2'}`} />
      ))}
    </span>
  );
}

function Arvore({ arvore }: { arvore: NoArvore[] }) {
  const resumo = (n: NoArvore) => `${fmtHours(n.minutos)} · ${n.livrosLidos} ${n.livrosLidos === 1 ? 'livro lido' : 'livros lidos'}`;
  return (
    <>
      <p className="muted mb-3">Escolha a área de cada livro na página dele. Pontos = horas + 5 por livro lido; níveis em 1, 5, 15, 30 e 60 pontos.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {arvore.map((raiz) => (
          <section key={raiz.id} className={`panel ${raiz.nivel > 0 ? 'border-accent/50' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{raiz.nome}</h3>
              <Nivel nivel={raiz.nivel} />
            </div>
            <p className="muted">{resumo(raiz)}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {raiz.filhos.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2" title={resumo(f)}>
                  <span className={`truncate ${f.nivel === 0 ? 'text-muted' : ''}`}>{f.nome}</span>
                  <Nivel nivel={f.nivel} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

const ESTADO = { feito: { icon: '✓', cls: 'text-ok' }, andamento: { icon: '◐', cls: 'text-warn' }, vazio: { icon: '○', cls: 'text-muted' } };

function TrilhaItem({ trilha, item, books }: { trilha: string; item: TrilhaProgresso['itens'][number]; books: BookSummary[] }) {
  const [editando, setEditando] = useState(false);
  const salvar = useAprendizadoMutation((md5s: string[]) => putTrilhaItem(trilha, item.id, md5s));
  const marcados = item.livros.map((l) => l.md5);
  const disponiveis = books.filter((b) => !marcados.includes(b.md5));
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className={`w-4 text-center ${ESTADO[item.estado].cls}`}>{ESTADO[item.estado].icon}</span>
        <span className="min-w-0 flex-1">{item.nome}</span>
        <button onClick={() => setEditando(!editando)} className="link shrink-0">{editando ? 'fechar' : 'editar'}</button>
      </div>
      {item.livros.length > 0 && (
        <ul className="ml-6 mt-1 space-y-1 text-sm">
          {item.livros.map((l) => (
            <li key={l.md5} className="flex items-center gap-2">
              <Link to={`/livros/${l.md5}`} className="min-w-0 flex-1 truncate text-muted hover:text-fg hover:underline">
                {l.title}{l.status === 'lido' ? ' (lido)' : ''}
              </Link>
              {editando && (
                <button aria-label={`Tirar ${l.title} do item`} disabled={salvar.isPending}
                  onClick={() => salvar.mutate(marcados.filter((m) => m !== l.md5))} className="btn">✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <label className="ml-6 mt-2 block text-sm">Adicionar livro
          <select value="" disabled={salvar.isPending} onChange={(e) => e.target.value && salvar.mutate([...marcados, e.target.value])} className="input">
            <option value="">Escolha um livro</option>
            {disponiveis.map((b) => <option key={b.md5} value={b.md5}>{b.title}</option>)}
          </select>
        </label>
      )}
      <div className="ml-6"><ErroInline show={salvar.isError} /></div>
    </li>
  );
}

function Trilhas({ trilhas, books }: { trilhas: TrilhaProgresso[]; books: BookSummary[] }) {
  return (
    <div className="space-y-5">
      <p className="muted">Marque os livros que cobrem cada item; o item conta como feito quando um deles está lido.</p>
      {trilhas.map((t) => (
        <section key={t.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">{t.nome}</h3>
            <span className="num text-sm text-muted">{t.progresso}%</span>
          </div>
          <ProgressBar value={t.progresso} />
          <ol className="list-divided">
            {t.itens.map((i) => <TrilhaItem key={i.id} trilha={t.id} item={i} books={books} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Lacunas({ lacunas }: { lacunas: Aprendizado['lacunas'] }) {
  const faltam = lacunas.filter((l) => !l.coberta);
  const cobertas = lacunas.filter((l) => l.coberta).sort((a, b) => b.minutos - a.minutos);
  return (
    <>
      <p className="muted mb-2">Áreas do currículo ACM CS2013 sem nenhum minuto em livros da árvore.</p>
      {faltam.length === 0
        ? <p className="success">Nenhuma lacuna: todas as áreas têm leitura.</p>
        : (
          <ul className="flex flex-wrap gap-2">
            {faltam.map((l) => (
              <li key={l.id} className="tag border-warn text-warn">
                <abbr title={l.id} className="no-underline">{l.nome}</abbr>
              </li>
            ))}
          </ul>
        )}
      {cobertas.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-sm font-semibold">Cobertas</h3>
          <ul className="list-divided text-sm">
            {cobertas.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 py-1">
                <span className="truncate">{l.nome}</span>
                <span className="num shrink-0 text-muted">{fmtHours(l.minutos)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function MapaTopicos({ topicos }: { topicos: Aprendizado['topicos'] }) {
  if (topicos.length === 0) return <p className="muted">Preencha os tópicos dos livros (separados por vírgula ou linha) para ver o mapa.</p>;
  const max = Math.max(1, ...topicos.map((t) => t.minutos));
  // sqrt keeps small topics readable next to a dominant one
  const size = (min: number) => 0.8 + 1.4 * Math.sqrt(min / max);
  return (
    <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-2" aria-label="Tópicos por minutos lidos">
      {topicos.map((t) => (
        <li key={t.topico} title={`${fmtHours(t.minutos)} em ${t.livros} ${t.livros === 1 ? 'livro' : 'livros'}`}
          className={`break-words leading-tight ${t.minutos === 0 ? 'text-muted' : 'text-accent'}`}
          style={{ fontSize: `${size(t.minutos)}rem` }}>
          {t.topico}
        </li>
      ))}
    </ul>
  );
}

export default function AprendizadoPage() {
  const q = useQuery({ queryKey: ['aprendizado'], queryFn: getAprendizado });
  const books = useQuery({ queryKey: ['books'], queryFn: getBooks });
  const a = q.data;
  const allBooks = books.data ?? [];

  return (
    <>
      <h1 className="page-title">Aprendizado</h1>
      {q.isLoading && <p>Carregando…</p>}
      {q.isError && <p className="error">Erro ao carregar o aprendizado.</p>}
      {a && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Para revisar hoje" value={a.revisarHoje.length} />
            <Stat label="Aprendizados" value={a.notas.length} />
            <Stat label="Nós com nível" value={a.arvore.flatMap((r) => [r, ...r.filhos]).filter((f) => f.nivel > 0).length} />
          </div>
          <Card title="Revisar hoje"><RevisarHoje notas={a.revisarHoje} /></Card>
          <Card title="Novo aprendizado"><NovoAprendizado books={allBooks} /></Card>
          <Card title="Diário de aprendizado"><Diario notas={a.notas} /></Card>
          <Card title="Enferrujamento por área"><Ferrugem areas={a.ferrugem} /></Card>
          <Card title="Árvore de habilidades"><Arvore arvore={a.arvore} /></Card>
          <Card title="Trilhas"><Trilhas trilhas={a.trilhas} books={allBooks} /></Card>
          <Card title="Lacunas"><Lacunas lacunas={a.lacunas} /></Card>
          <Card title="Mapa de tópicos"><MapaTopicos topicos={a.topicos} /></Card>
        </>
      )}
    </>
  );
}
