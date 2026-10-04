import type { Metadados } from '@leituras/shared';

const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';
const TIMEOUT_MS = 8000;
const MAX_ASSUNTOS = 8;

// Text relevance ranks adaptations whose title repeats the author (e.g. comics)
// above the original work; popularity picks the canonical edition
const SEARCH = 'query Search($q: String!) { search(query: $q, query_type: "Book", per_page: 1, sort: "users_count:desc") { results } }';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : []);
const positiveInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

// Hardcover lookup by title and author; throws on network error, timeout, non-2xx or GraphQL errors
export async function fetchHardcover(
  query: { title: string; author?: string },
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<Metadados | null> {
  const q = [query.title, query.author].filter(Boolean).join(' ');
  const res = await fetchFn(HARDCOVER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: /^Bearer /i.test(token) ? token : `Bearer ${token}` },
    body: JSON.stringify({ query: SEARCH, variables: { q } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Hardcover HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (isObject(body) && Array.isArray(body.errors) && body.errors.length > 0) throw new Error('Hardcover GraphQL error');
  // Malformed fields are dropped, never trusted
  const data = isObject(body) && isObject(body.data) ? body.data : undefined;
  const search = data && isObject(data.search) ? data.search : undefined;
  const results = search?.results;
  const hits = isObject(results) ? results.hits : undefined;
  const hit = Array.isArray(hits) ? hits[0] : undefined;
  const d = isObject(hit) ? hit.document : undefined;
  if (!isObject(d)) return null;
  return {
    titulo: typeof d.title === 'string' ? d.title : '',
    autores: strings(d.author_names).join('\n'),
    paginas: positiveInt(d.pages),
    anoPublicacao: positiveInt(d.release_year),
    assuntos: strings(d.genres).slice(0, MAX_ASSUNTOS),
  };
}
