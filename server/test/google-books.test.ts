import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleBooks } from '../src/google-books';

const fakeFetch = (body: unknown, init?: ResponseInit) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), init));
const asFetch = (f: ReturnType<typeof fakeFetch>) => f as unknown as typeof fetch;
const item = (volumeInfo: unknown) => ({ items: [{ volumeInfo }] });
const lookup = (body: unknown) => fetchGoogleBooks({ title: 'x' }, 'k', asFetch(fakeFetch(body)));
const first = async (body: unknown) => (await lookup(body))[0];

describe('fetchGoogleBooks', () => {
  it('builds the request from title and author and sends the key', async () => {
    const f = fakeFetch(item({ title: 'Duna' }));
    await fetchGoogleBooks({ title: 'Duna', author: 'Frank Herbert' }, 'k3y', asFetch(f));
    const [url, init] = f.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/books/v1/volumes');
    expect(u.searchParams.get('q')).toBe('Duna inauthor:Frank Herbert');
    expect(u.searchParams.get('maxResults')).toBe('5');
    expect(u.searchParams.get('key')).toBe('k3y');
    expect(u.searchParams.get('fields')).toContain('volumeInfo');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('omits inauthor when there is no author', async () => {
    const f = fakeFetch({});
    await fetchGoogleBooks({ title: 'Duna' }, 'k', asFetch(f));
    expect(new URL(f.mock.calls[0][0]).searchParams.get('q')).toBe('Duna');
  });

  it('normalizes each volume', async () => {
    expect(await first(item({
      title: 'Duna', authors: ['Frank Herbert', 'Outro'], pageCount: 412, publishedDate: '2008-05-01',
      categories: [' Ficção ', 'Desertos', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    }))).toEqual({
      titulo: 'Duna', autores: 'Frank Herbert\nOutro', paginas: 412, anoPublicacao: 2008,
      assuntos: ['Ficção', 'Desertos', 'c', 'd', 'e', 'f', 'g', 'h'],
    });
  });

  it('accepts a bare year', async () => {
    expect((await first(item({ publishedDate: '1899' }))).anoPublicacao).toBe(1899);
  });

  it('drops malformed fields', async () => {
    expect(await first(item({ title: 42, authors: 'Frank', pageCount: -3, publishedDate: 1965, categories: { a: 1 } })))
      .toEqual({ titulo: '', autores: '', paginas: null, anoPublicacao: null, assuntos: [] });
    expect(await first(item({ title: 'Duna', authors: ['F', 7, ''], pageCount: 1.5, publishedDate: '19x5', categories: ['P', null, ' '] })))
      .toEqual({ titulo: 'Duna', autores: 'F', paginas: null, anoPublicacao: null, assuntos: ['P'] });
  });

  it('keeps every volume in order and skips malformed ones', async () => {
    expect((await lookup({ items: [{ volumeInfo: { title: 'A' } }, 'x', { volumeInfo: 3 }, { volumeInfo: { title: 'B' } }] })).map((m) => m.titulo))
      .toEqual(['A', 'B']);
  });

  it('returns an empty list when there are no items', async () => {
    for (const body of [{}, { items: [] }, { items: 'nope' }, item('nope'), null]) expect(await lookup(body)).toEqual([]);
  });

  it('throws on non-2xx without leaking the key or URL', async () => {
    const err = await fetchGoogleBooks({ title: 'x' }, 'secret-key', asFetch(fakeFetch({}, { status: 429 }))).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Google Books HTTP 429');
    expect((err as Error).message).not.toMatch(/secret-key|googleapis/);
  });

  it('propagates network errors', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    await expect(fetchGoogleBooks({ title: 'x' }, 'k', f as unknown as typeof fetch)).rejects.toThrow('offline');
  });
});
