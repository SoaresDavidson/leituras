import type { BookDetail, BookPatch, BookSummary, Dashboard, Foco, LivroExtras, Livros, Metadados, MetadadosPatch } from '@leituras/shared';

export class ApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 401 && path !== '/login' && path !== '/me') {
    window.location.assign('/login');
  }
  if (!res.ok) throw new ApiError(res.status);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const login = (password: string) =>
  req<void>('/login', { method: 'POST', body: JSON.stringify({ password }) });
export const logout = () => req<void>('/logout', { method: 'POST' });
export const me = () => req<void>('/me');
export const getDashboard = (year: number) => req<Dashboard>(`/dashboard?year=${year}`);
export const getBooks = () => req<BookSummary[]>('/books');
export const getBook = (md5: string) => req<BookDetail>(`/books/${md5}`);
export const patchBook = (md5: string, patch: BookPatch) =>
  req<BookDetail>(`/books/${md5}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const putFila = (md5s: string[]) => req<Foco>('/fila', { method: 'PUT', body: JSON.stringify({ md5s }) });
export const patchFoco = (patch: { limite?: number; prazoDias?: number }) =>
  req<Foco>('/foco', { method: 'PATCH', body: JSON.stringify(patch) });
export const coverUrl = (md5: string) => `/api/books/${md5}/cover`;
export const getLivros = () => req<Livros>('/livros');
export const getLivroExtras = (md5: string) => req<LivroExtras>(`/livros/${md5}`);
export const putMaisTarde = (md5: string, maisTarde: boolean) =>
  req<LivroExtras>(`/livros/${md5}/mais-tarde`, { method: 'PUT', body: JSON.stringify({ maisTarde }) });
export const deleteLivro = (md5: string) => req<Livros>(`/livros/${md5}`, { method: 'DELETE' });
export const restoreLivro = (md5: string) => req<Livros>(`/livros/blacklist/${md5}`, { method: 'DELETE' });
export const buscarMetadados = (md5: string) => req<{ resultado: Metadados | null }>(`/livros/${md5}/metadados`);
export const aplicarMetadados = (md5: string, patch: MetadadosPatch) =>
  req<LivroExtras>(`/livros/${md5}/metadados`, { method: 'POST', body: JSON.stringify(patch) });
