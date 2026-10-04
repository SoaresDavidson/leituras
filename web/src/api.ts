import type {
  BookDetail, BookPatch, BookSummary, Dashboard, Foco, Habito, HabitoPatch, LivroExtras, Livros, Metadados, MetadadosPatch,
  RetroPeriodo, RetroTipo, Retrospectiva,
} from '@leituras/shared';

export class ApiError extends Error {
  // `message` is the server's `{ error }` text when there is one
  constructor(public status: number, message = `HTTP ${status}`) {
    super(message);
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
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    throw new ApiError(res.status, typeof body?.error === 'string' ? body.error : undefined);
  }
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
export const getLivros = () => req<Livros>('/livros');
export const getLivroExtras = (md5: string) => req<LivroExtras>(`/livros/${md5}`);
export const putMaisTarde = (md5: string, maisTarde: boolean) =>
  req<LivroExtras>(`/livros/${md5}/mais-tarde`, { method: 'PUT', body: JSON.stringify({ maisTarde }) });
export const deleteLivro = (md5: string) => req<Livros>(`/livros/${md5}`, { method: 'DELETE' });
export const restoreLivro = (md5: string) => req<Livros>(`/livros/blacklist/${md5}`, { method: 'DELETE' });
export const buscarMetadados = (md5: string) => req<{ resultado: Metadados | null }>(`/livros/${md5}/metadados`);
export const aplicarMetadados = (md5: string, patch: MetadadosPatch) =>
  req<LivroExtras>(`/livros/${md5}/metadados`, { method: 'POST', body: JSON.stringify(patch) });
export const getRetrospectiva = () => req<Retrospectiva>('/retrospectiva');
export const getRetroPeriodo = (tipo: RetroTipo, offset: number) =>
  req<RetroPeriodo>(`/retrospectiva/periodo?tipo=${tipo}&offset=${offset}`);
export const patchRetrospectiva = (patch: { metaAnoPaginas: number }) =>
  req<Retrospectiva>('/retrospectiva', { method: 'PATCH', body: JSON.stringify(patch) });
