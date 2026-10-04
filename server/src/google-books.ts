import type { Metadados } from '@leituras/shared';

const TIMEOUT_MS = 8000;
const MAX_ASSUNTOS = 8;

const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
const positiveInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
const year = (v: unknown) => (typeof v === 'string' && /^\d{4}(?!\d)/.test(v) ? positiveInt(Number(v.slice(0, 4))) : null);

// Google Books lookup by title and author; throws on network error, timeout or non-2xx
export async function fetchGoogleBooks(
  query: { title: string; author?: string },
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Metadados | null> {
  const params = new URLSearchParams({
    q: `intitle:${query.title}${query.author ? `+inauthor:${query.author}` : ''}`,
    maxResults: '1',
    key: apiKey,
    fields: 'items(volumeInfo(title,authors,pageCount,publishedDate,categories))',
  });
  const res = await fetchFn(`https://www.googleapis.com/books/v1/volumes?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google Books HTTP ${res.status}`);
  // Malformed fields are dropped, never trusted
  const items = ((await res.json()) as { items?: unknown } | null)?.items;
  const info = Array.isArray(items) && isObject(items[0]) ? (items[0] as { volumeInfo?: unknown }).volumeInfo : undefined;
  if (!isObject(info)) return null;
  const v = info as Record<string, unknown>;
  return {
    titulo: typeof v.title === 'string' ? v.title : '',
    autores: strings(v.authors).join('\n'),
    paginas: positiveInt(v.pageCount),
    anoPublicacao: year(v.publishedDate),
    assuntos: strings(v.categories).map((s) => s.trim()).slice(0, MAX_ASSUNTOS),
  };
}
