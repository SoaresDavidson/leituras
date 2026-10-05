import type { Metadados } from '@leituras/shared';
import { FONTE_LIMITE, FONTE_TIMEOUT_MS, MAX_ASSUNTOS, isObject, objects, positiveInt, strings, type Consulta } from './normalizar';

const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';

// Text relevance ranks adaptations whose title repeats the author (e.g. comics)
// above the original work; popularity picks the canonical edition
const SEARCH = `query Search($q: String!) { search(query: $q, query_type: "Book", per_page: ${FONTE_LIMITE}, sort: "users_count:desc") { results } }`;

// Hardcover lookup by title and author; throws on network error, timeout, non-2xx or GraphQL errors
export async function fetchHardcover(query: Consulta, token: string, fetchFn: typeof fetch = fetch): Promise<Metadados[]> {
  const q = [query.title, query.author].filter(Boolean).join(' ');
  const res = await fetchFn(HARDCOVER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: /^Bearer /i.test(token) ? token : `Bearer ${token}` },
    body: JSON.stringify({ query: SEARCH, variables: { q } }),
    signal: AbortSignal.timeout(FONTE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Hardcover HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (isObject(body) && Array.isArray(body.errors) && body.errors.length > 0) throw new Error('Hardcover GraphQL error');
  const data = isObject(body) && isObject(body.data) ? body.data : undefined;
  const search = data && isObject(data.search) ? data.search : undefined;
  const results = search && isObject(search.results) ? search.results : undefined;
  return objects(objects(results?.hits).map((h) => h.document)).map((d) => ({
    titulo: typeof d.title === 'string' ? d.title : '',
    autores: strings(d.author_names).join('\n'),
    paginas: positiveInt(d.pages),
    anoPublicacao: positiveInt(d.release_year),
    assuntos: strings(d.genres).slice(0, MAX_ASSUNTOS),
  }));
}
