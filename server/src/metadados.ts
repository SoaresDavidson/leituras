import type { BuscaMetadados, FonteMetadados, Metadados, OpcaoMetadados, OpcoesMetadados } from '@leituras/shared';
import type { Db } from './db';
import { fetchGoogleBooks } from './google-books';
import { fetchHardcover } from './hardcover';
import { fetchOpenLibrary } from './openlibrary';

export const MAX_OPCOES = 5;

export type ChavesFontes = { googleBooksApiKey?: string; hardcoverToken?: string };

type Resultado = { fonte: FonteMetadados; hits: Metadados[] };

// rank is the best position the value reached in any source's hit list (0 = top hit)
export type Candidata<T> = OpcaoMetadados<T> & { rank: number };

// Accents, case, spaces and punctuation don't make a value different ("J. R. R." = "J.R.R.")
const semRuido = (s: string) => s.normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

// Same value from several hits or sources becomes one candidate listing every source
function candidatas<T>(resultados: Resultado[], valor: (m: Metadados) => T | null, chave: (v: T) => string): Candidata<T>[] {
  const porChave = new Map<string, Candidata<T>>();
  for (const { fonte, hits } of resultados) {
    hits.forEach((m, rank) => {
      const v = valor(m);
      if (v === null) return;
      const c = porChave.get(chave(v));
      if (!c) { porChave.set(chave(v), { valor: v, fontes: [fonte], rank }); return; }
      if (!c.fontes.includes(fonte)) c.fontes.push(fonte);
      c.rank = Math.min(c.rank, rank);
    });
  }
  return [...porChave.values()];
}

// Best candidates first. Candidates arrive in source order (google, hardcover,
// openlibrary), each source's hits from best to worst.
export function ordenar<T>(c: Candidata<T>[]): Candidata<T>[] {
  // TODO(human)
  return c;
}

const opcoes = <T>(resultados: Resultado[], valor: (m: Metadados) => T | null, chave: (v: T) => string): OpcaoMetadados<T>[] =>
  ordenar(candidatas(resultados, valor, chave)).slice(0, MAX_OPCOES).map(({ valor: v, fontes }) => ({ valor: v, fontes }));

export function mesclar(resultados: Resultado[]): OpcoesMetadados {
  return {
    autores: opcoes(resultados, (m) => m.autores || null, semRuido),
    paginas: opcoes(resultados, (m) => m.paginas, String),
    anoPublicacao: opcoes(resultados, (m) => m.anoPublicacao, String),
    assuntos: opcoes(resultados, (m) => (m.assuntos.length > 0 ? m.assuntos : null), (a) => a.map(semRuido).sort().join('|')),
  };
}

// Asks every configured source at once; throws only when none of them answered
export async function buscarMetadados(db: Db, md5: string, chaves: ChavesFontes, fetchFn: typeof fetch = fetch): Promise<BuscaMetadados | undefined> {
  const book = db.prepare('SELECT title, authors FROM book WHERE md5 = ?').get(md5) as { title: string; authors: string } | undefined;
  if (!book) return undefined;
  const query = { title: book.title, author: book.authors.split('\n')[0] || undefined };
  const fontes: [FonteMetadados, () => Promise<Metadados[]>][] = [];
  if (chaves.googleBooksApiKey) fontes.push(['google', () => fetchGoogleBooks(query, chaves.googleBooksApiKey!, fetchFn)]);
  if (chaves.hardcoverToken) fontes.push(['hardcover', () => fetchHardcover(query, chaves.hardcoverToken!, fetchFn)]);
  fontes.push(['openlibrary', () => fetchOpenLibrary(query, fetchFn)]);

  const resultados: Resultado[] = [];
  const falhas: FonteMetadados[] = [];
  const settled = await Promise.allSettled(fontes.map(([, buscar]) => buscar()));
  settled.forEach((s, i) => {
    const fonte = fontes[i][0];
    if (s.status === 'fulfilled') resultados.push({ fonte, hits: s.value });
    else { console.warn(`Metadata lookup on ${fonte} failed for ${md5}:`, s.reason); falhas.push(fonte); }
  });
  if (resultados.length === 0) throw new Error('No metadata source answered');
  return { opcoes: resultados.some((r) => r.hits.length > 0) ? mesclar(resultados) : null, falhas };
}
