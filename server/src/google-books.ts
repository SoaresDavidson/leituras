import type { Metadados } from '@leituras/shared';
import { FONTE_LIMITE, FONTE_TIMEOUT_MS, MAX_ASSUNTOS, objects, positiveInt, strings, type Consulta } from './normalizar';

const year = (v: unknown) => (typeof v === 'string' && /^\d{4}(?!\d)/.test(v) ? positiveInt(Number(v.slice(0, 4))) : null);

// Google Books lookup by title and author; throws on network error, timeout or non-2xx
export async function fetchGoogleBooks(query: Consulta, apiKey: string, fetchFn: typeof fetch = fetch): Promise<Metadados[]> {
  const params = new URLSearchParams({
    // A leading intitle: returns nothing; free-text title plus inauthor: matches well
    q: query.author ? `${query.title} inauthor:${query.author}` : query.title,
    maxResults: String(FONTE_LIMITE),
    key: apiKey,
    fields: 'items(volumeInfo(title,authors,pageCount,publishedDate,categories))',
  });
  const res = await fetchFn(`https://www.googleapis.com/books/v1/volumes?${params}`, { signal: AbortSignal.timeout(FONTE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google Books HTTP ${res.status}`);
  const items = ((await res.json()) as { items?: unknown } | null)?.items;
  return objects(objects(items).map((i) => i.volumeInfo)).map((v) => ({
    titulo: typeof v.title === 'string' ? v.title : '',
    autores: strings(v.authors).join('\n'),
    paginas: positiveInt(v.pageCount),
    anoPublicacao: year(v.publishedDate),
    assuntos: strings(v.categories).slice(0, MAX_ASSUNTOS),
  }));
}
