import type { Metadados } from '@leituras/shared';
import { FONTE_LIMITE, FONTE_TIMEOUT_MS, MAX_ASSUNTOS, objects, positiveInt, strings, type Consulta } from './normalizar';

// Open Library lookup by title and author; throws on network error, timeout or non-2xx
export async function fetchOpenLibrary(query: Consulta, fetchFn: typeof fetch = fetch): Promise<Metadados[]> {
  const params = new URLSearchParams({
    title: query.title,
    limit: String(FONTE_LIMITE),
    fields: 'title,author_name,number_of_pages_median,first_publish_year,subject',
  });
  if (query.author) params.set('author', query.author);
  const res = await fetchFn(`https://openlibrary.org/search.json?${params}`, { signal: AbortSignal.timeout(FONTE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open Library HTTP ${res.status}`);
  const docs = ((await res.json()) as { docs?: unknown } | null)?.docs;
  return objects(docs).map((d) => ({
    titulo: typeof d.title === 'string' ? d.title : '',
    autores: strings(d.author_name).join('\n'),
    paginas: positiveInt(d.number_of_pages_median),
    anoPublicacao: positiveInt(d.first_publish_year),
    assuntos: strings(d.subject).slice(0, MAX_ASSUNTOS),
  }));
}
