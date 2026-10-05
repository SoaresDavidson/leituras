import { describe, expect, it, vi } from 'vitest';
import { fetchHardcover } from '../src/hardcover';

const TOKEN = 'secret-token-xyz';
const reply = (body: unknown, init?: ResponseInit) => vi.fn(async () => new Response(JSON.stringify(body), init));
const hit = (document: unknown) => ({ data: { search: { results: { hits: [{ document }] } } } });
const initOf = (fetchFn: ReturnType<typeof reply>) => (fetchFn.mock.calls[0] as unknown as [string, RequestInit]);

describe('fetchHardcover', () => {
  it('posts the query with variables and auth header', async () => {
    const fetchFn = reply(hit({ title: 'Dom Casmurro' }));
    await fetchHardcover({ title: 'Dom "Casmurro"', author: 'Machado' }, TOKEN, fetchFn);
    const [url, init] = initOf(fetchFn);
    expect(url).toBe('https://api.hardcover.app/v1/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ q: 'Dom "Casmurro" Machado' });
    expect(body.query).not.toContain('Casmurro');
  });

  it('does not double the Bearer prefix', async () => {
    const fetchFn = reply(hit({}));
    await fetchHardcover({ title: 'x' }, `Bearer ${TOKEN}`, fetchFn);
    expect(initOf(fetchFn)[1].headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  });

  it('asks for the most read books first', async () => {
    const fetchFn = reply(hit({}));
    await fetchHardcover({ title: 'x' }, TOKEN, fetchFn);
    expect(JSON.parse(initOf(fetchFn)[1].body as string).query).toContain('sort: "users_count:desc"');
  });

  it('normalizes each hit', async () => {
    const fetchFn = reply(hit({
      title: 'Dom Casmurro', author_names: ['Machado', ' de Assis '], pages: 256, release_year: 1899,
      genres: ['Fiction', ' ', 'Classic', ...Array.from({ length: 10 }, (_, i) => `g${i}`)],
    }));
    expect((await fetchHardcover({ title: 'Dom Casmurro' }, TOKEN, fetchFn))[0]).toEqual({
      titulo: 'Dom Casmurro', autores: 'Machado\nde Assis', paginas: 256, anoPublicacao: 1899,
      assuntos: ['Fiction', 'Classic', 'g0', 'g1', 'g2', 'g3', 'g4', 'g5'],
    });
  });

  it('drops malformed fields', async () => {
    const fetchFn = reply(hit({ title: 42, author_names: ['A', 7, null], pages: -3, release_year: '1999', genres: 'Fiction' }));
    expect((await fetchHardcover({ title: 'x' }, TOKEN, fetchFn))[0]).toEqual({
      titulo: '', autores: 'A', paginas: null, anoPublicacao: null, assuntos: [],
    });
  });

  it('returns an empty list when there is no hit or the shape is off', async () => {
    expect(await fetchHardcover({ title: 'x' }, TOKEN, reply({ data: { search: { results: { hits: [] } } } }))).toEqual([]);
    expect(await fetchHardcover({ title: 'x' }, TOKEN, reply({ data: { search: { results: 'nope' } } }))).toEqual([]);
    expect(await fetchHardcover({ title: 'x' }, TOKEN, reply({ data: { search: { results: { hits: ['x', { document: 1 }] } } } }))).toEqual([]);
    expect(await fetchHardcover({ title: 'x' }, TOKEN, reply(null))).toEqual([]);
  });

  it('throws on non-2xx without leaking the token', async () => {
    const err = await fetchHardcover({ title: 'x' }, TOKEN, reply({}, { status: 401 })).catch((e: Error) => e);
    expect((err as Error).message).toBe('Hardcover HTTP 401');
  });

  it('throws on GraphQL errors without leaking the token', async () => {
    const err = await fetchHardcover({ title: 'x' }, TOKEN, reply({ errors: [{ message: `bad ${TOKEN}` }] })).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it('propagates network errors', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline'); });
    await expect(fetchHardcover({ title: 'x' }, TOKEN, fetchFn)).rejects.toThrow('offline');
  });
});
