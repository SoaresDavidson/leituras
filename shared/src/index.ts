// Type-only contract shared by server and web. Never import runtime values from here.

// ---- KOReader plugin payloads (same shape as KoInsight plugin 0.3.0) ----

export type PluginBook = {
  id: number;
  md5: string;
  title: string;
  authors: string;
  series: string;
  language: string;
  pages: number;
  last_open: number;
  notes?: number;
  highlights?: number;
  total_read_time?: number;
  total_read_pages?: number;
};

export type PluginPageStat = {
  book_md5: string;
  device_id: string;
  page: number;
  start_time: number; // epoch seconds
  duration: number; // seconds
  total_pages: number;
};

export type PluginDevicePayload = { id: string; model: string; version?: string };

export type PluginImportPayload = {
  books?: PluginBook[];
  stats?: PluginPageStat[];
  annotations?: unknown; // accepted and ignored
  device_id?: string;
  version?: string;
};

// ---- Web API ----

export type ReadingStatus = 'lendo' | 'lido' | 'pausado';

export type BookSummary = {
  md5: string;
  title: string;
  authors: string;
  series: string;
  pages: number;
  progress: number; // 0-100
  status: ReadingStatus; // effective status (status_manual wins)
  statusManual: ReadingStatus | null;
  categoria: string;
  startedAt: string | null; // YYYY-MM-DD
  finishedAt: string | null; // YYYY-MM-DD
  lastReadAt: string | null; // YYYY-MM-DD
  totalMinutes: number;
  hasCover: boolean;
  arquivado: boolean; // archived and not read since
};

export type DailyMinutes = { date: string; minutes: number };

export type Dashboard = {
  year: number;
  totals: { booksFinished: number; minutes: number; pages: number };
  daily: DailyMinutes[]; // last 365 days, oldest first, zero days included
  finishedPerMonth: { month: string; count: number }[]; // YYYY-MM for the 12 months of `year`
  foco: Foco;
};

export type FocoBook = BookSummary & {
  previsao: string | null; // YYYY-MM-DD, null = no reading in the last 14 days
  minutosRestantes: number | null;
};

export type Foco = {
  limite: number;
  prazoDias: number;
  abertos: FocoBook[]; // reta final (progress >= 75) first, then most recently read
  fila: { book: BookSummary; liberado: boolean }[];
  cemiterio: { book: BookSummary; diasParado: number; vencidoHa: number }[];
  taxaConclusao: { lidos: number; abandonados: number; percentual: number | null }; // percentual 0-100
};

export type BookDetail = BookSummary & {
  topicos: string;
  sessions: number;
  daily: DailyMinutes[]; // only days with reading
  progressTimeline: { date: string; progress: number }[];
};

export type BookPatch = Partial<{
  categoria: string;
  statusManual: ReadingStatus | null;
  topicos: string;
  arquivado: boolean;
}>;

// ---- aprendizado ----

export type Nota = {
  id: number;
  md5: string;
  bookTitle: string;
  texto: string;
  criadoEm: string; // YYYY-MM-DD
  etapa: number; // index into the review intervals
  proximaRevisao: string; // YYYY-MM-DD
  revisadoEm: string | null; // YYYY-MM-DD
};

export type NoArvore = {
  id: string;
  nome: string;
  nivel: number; // 0-5
  minutos: number;
  livrosLidos: number;
  filhos: NoArvore[]; // empty for leaves; roots include their children's totals
};

export type TrilhaProgresso = {
  id: string;
  nome: string;
  progresso: number; // 0-100, share of items with a finished book
  itens: { id: string; nome: string; estado: 'vazio' | 'andamento' | 'feito'; livros: { md5: string; title: string; status: ReadingStatus }[] }[];
};

export type Aprendizado = {
  hoje: string; // YYYY-MM-DD
  notas: Nota[]; // journal, newest first
  revisarHoje: Nota[]; // due notes, most overdue first
  ferrugem: { area: string; dias: number; ferrugem: number; ultimaAtividade: string }[]; // area = categoria; ferrugem 0-100, rustiest first
  arvore: NoArvore[];
  trilhas: TrilhaProgresso[];
  lacunas: { id: string; nome: string; minutos: number; coberta: boolean }[]; // ACM CS2013 subset, in base order
  topicos: { topico: string; minutos: number; livros: number }[]; // heaviest first
};

export type LivroAprendizado = {
  area: string | null; // skill tree node id
  notas: Nota[]; // newest first
};
