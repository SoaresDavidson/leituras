import type { Aprendizado, BookDetail, BookPatch, BookSummary, Dashboard, Foco, LivroAprendizado, Nota, TrilhaProgresso } from '@leituras/shared';

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

// ---- aprendizado ----
export const getAprendizado = () => req<Aprendizado>('/aprendizado');
export const getLivroAprendizado = (md5: string) => req<LivroAprendizado>(`/aprendizado/livros/${md5}`);
export const putArea = (md5: string, area: string | null) =>
  req<LivroAprendizado>(`/aprendizado/livros/${md5}/area`, { method: 'PUT', body: JSON.stringify({ area }) });
export const postNota = (md5: string, texto: string) =>
  req<Nota>('/aprendizado/notas', { method: 'POST', body: JSON.stringify({ md5, texto }) });
export const deleteNota = (id: number) => req<void>(`/aprendizado/notas/${id}`, { method: 'DELETE' });
export const revisarNota = (id: number, lembrei: boolean) =>
  req<Nota>(`/aprendizado/notas/${id}/revisao`, { method: 'POST', body: JSON.stringify({ lembrei }) });
export const putTrilhaItem = (trilha: string, item: string, md5s: string[]) =>
  req<TrilhaProgresso>(`/aprendizado/trilhas/${trilha}/itens/${item}`, { method: 'PUT', body: JSON.stringify({ md5s }) });
