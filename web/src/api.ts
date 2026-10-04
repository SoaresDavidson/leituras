import type { BookDetail, BookPatch, BookSummary, Dashboard, Foco, Habito, HabitoPatch } from '@leituras/shared';

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
export const getHabito = () => req<Habito>('/habito');
export const patchHabito = (patch: HabitoPatch) => req<Habito>('/habito', { method: 'PATCH', body: JSON.stringify(patch) });
