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

// null = unclassified, treated as estudo
export type TipoLivro = 'estudo' | 'ficcao';

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
  tipo: TipoLivro | null; // fiction vs. study
  startedAt: string | null; // YYYY-MM-DD
  finishedAt: string | null; // YYYY-MM-DD
  lastReadAt: string | null; // YYYY-MM-DD, any recorded page
  lastActiveAt: string | null; // YYYY-MM-DD, last session of real reading (see server stats.ts)
  totalMinutes: number;
  hasCover: boolean;
  arquivado: boolean; // archived and not actively read since (see server stats.ts effectiveStatus)
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
  tipo: TipoLivro | null;
}>;

// ---- livros ----

export type LivroItem = BookSummary & { maisTarde: boolean };

export type BlacklistEntry = { md5: string; title: string; authors: string; excluidoEm: string }; // excluidoEm YYYY-MM-DD

export type Livros = {
  books: LivroItem[]; // same order as GET /api/books
  blacklist: BlacklistEntry[]; // most recently deleted first
};

export type LivroExtras = { maisTarde: boolean; anoPublicacao: number | null };

// One search hit from a metadata source; autores is newline-separated like book.authors
export type Metadados = { titulo: string; autores: string; paginas: number | null; anoPublicacao: number | null; assuntos: string[] };

export type FonteMetadados = 'google' | 'hardcover' | 'openlibrary';

// A candidate value and every source that returned it
export type OpcaoMetadados<T> = { valor: T; fontes: FonteMetadados[] };

// Up to MAX_OPCOES candidates per field, best first
export type OpcoesMetadados = {
  autores: OpcaoMetadados<string>[];
  paginas: OpcaoMetadados<number>[];
  anoPublicacao: OpcaoMetadados<number>[];
  assuntos: OpcaoMetadados<string[]>[];
};

// opcoes is null when no source found the book; falhas lists sources that errored
export type BuscaMetadados = { opcoes: OpcoesMetadados | null; falhas: FonteMetadados[] };

export type MetadadosPatch = Partial<{ authors: string; pages: number; anoPublicacao: number; assuntos: string[] }>;

// ---- habito ----

export type HabitoMeta = { minutos: number; paginas: number }; // 0 = part turned off

export type HabitoDia = DailyMinutes & { pages: number; metaBatida: boolean };

export type NivelSequencia = 'bronze' | 'prata' | 'ouro';

export type Sequencia = { inicio: string; fim: string; dias: number }; // dias = days that met the level

export type HabitoNivel = {
  nivel: NivelSequencia;
  atual: Sequencia | null; // alive while its last day is today, yesterday or the day before
  recorde: Sequencia | null;
  historico: Sequencia[]; // closed streaks, most recent first, at most 10
};

export type HabitoJanela = {
  inicio: string;
  fim: string;
  minutos: number;
  paginas: number;
  diasComLeitura: number;
  diasComMeta: number;
};

export type Habito = {
  hoje: string; // YYYY-MM-DD
  metas: { dia: HabitoMeta; mes: HabitoMeta };
  gatilho: string;
  progresso: { dia: HabitoMeta; mes: HabitoMeta };
  niveis: HabitoNivel[]; // bronze, prata, ouro
  daily: HabitoDia[]; // last 365 days, oldest first
  porHora: number[]; // 24 values: minutes per hour of day, last 90 days
  porDiaSemana: number[]; // 7 values Mon..Sun: average minutes per day, last 90 days
  semana: { atual: number[]; anterior: number[]; variacao: number | null }; // minutes Mon..Sun; variacao in %
  vsPassado: { atual: HabitoJanela; antes: HabitoJanela }; // last 30 days vs the 30 days ending 90 days ago
  consistencia: { pontuacao: number; diasComMeta: number; diasComLeitura: number; inicio: string; fim: string }; // 0-100
};

export type HabitoPatch = Partial<{
  metaDiaMinutos: number;
  metaDiaPaginas: number;
  metaMesMinutos: number;
  metaMesPaginas: number;
  gatilho: string;
}>;

// ---- retrospectiva ----

export type RetroTipo = 'semana' | 'mes';

export type RetroTotais = { minutos: number; paginas: number; diasLidos: number; livrosTocados: number; livrosTerminados: number };

export type RetroPeriodo = {
  tipo: RetroTipo;
  offset: number; // 0 = current period, 1 = previous, ...
  inicio: string; // YYYY-MM-DD, inclusive
  fim: string; // YYYY-MM-DD, inclusive
  totais: RetroTotais;
  anterior: RetroTotais & { inicio: string; fim: string };
  melhorDia: { date: string; minutos: number } | null;
  maiorSessao: { date: string; minutos: number; book: BookSummary } | null;
  livros: { book: BookSummary; minutos: number; paginas: number; terminou: boolean }[]; // most minutes first
};

export type Equivalencia = { id: string; rotulo: string; quantidade: number };

export type Investido = { minutos: number; paginas: number; equivalencias: Equivalencia[] };

export type MetaAno = {
  ano: number;
  metaPaginas: number;
  lidas: number;
  restantes: number;
  diasRestantes: number; // until Dec 31, today included
  paginasPorDia: number;
  esperadoHoje: number; // linear pace
  diferenca: number; // lidas - esperadoHoje, positive = ahead
};

export type Retrospectiva = {
  investimento: { total: Investido; anos: (Investido & { ano: number })[] }; // newest year first
  meta: MetaAno;
  ritmoLivros: { book: BookSummary; minutos: number; paginas: number; paginasPorHora: number }[]; // most recently read first
  velocidadeMensal: { month: string; paginasPorHora: number | null }[]; // YYYY-MM, oldest first
};

// ---- jogo ----

export type UnidadeJogo = 'min' | 'págs' | 'dias' | 'sessões' | 'livros' | 'categorias' | 'h' | '%';

// `atual` is not capped at `alvo`
export type ProgressoJogo = { atual: number; alvo: number; unidade: UnidadeJogo; feito: boolean };

export type Missao = ProgressoJogo & { id: string; titulo: string; md5: string | null };

export type Desafio = ProgressoJogo & { id: string; titulo: string; inicio: string; fim: string }; // YYYY-MM-DD

// 'perdido': a deadline hour passed before the goal was reached
export type EstadoDesafio = 'ativo' | 'feito' | 'perdido';

export type CartaDesafio = ProgressoJogo & { id: string; titulo: string; estado: EstadoDesafio; trocada: boolean; podeTrocar: boolean };

export type DesafioRelampago = ProgressoJogo & {
  titulo: string;
  prazoHora: number; // local hour; counts reading that started before it
  estado: EstadoDesafio;
};

export type Chefe = {
  book: BookSummary;
  vida: number; // pages left
  vidaMax: number; // book pages
  danoPorDia: { date: string; dano: number }[]; // last 7 days, oldest first
  danoMedio: number | null; // pages/day over the last 14 days
  previsao: string | null; // YYYY-MM-DD
};

export type ChefeDerrotado = { book: BookSummary; derrotadoEm: string | null };

export type CorridaFantasma = {
  id: 'mes-passado' | 'ano-passado';
  mes: string; // YYYY-MM
  mesFantasma: string; // YYYY-MM
  dias: { dia: number; voce: number | null; fantasma: number }[]; // cumulative pages; voce null after today
  voce: number;
  fantasma: number; // both at today's day of month
};

export type ClasseLeitor = {
  id: string;
  nome: string;
  criterio: string;
  valor: number;
  referencia: number; // valor that scores 100
  unidade: string;
  pontuacao: number; // 0-100
};

export type Medalha = ProgressoJogo & {
  id: string;
  nome: string;
  descricao: string;
  sigla: string;
  raridade: 'comum' | 'rara' | 'épica';
  desbloqueadaEm: string | null; // YYYY-MM-DD, null when locked or the date is unknown
};

export type Recorde = {
  id: string;
  rotulo: string;
  valor: number | null;
  unidade: UnidadeJogo;
  data: string | null; // YYYY-MM-DD, or YYYY-MM for a month
  detalhe: string | null; // book title when the record is about a book
};

export type Jogo = {
  hoje: string;
  missoes: Missao[];
  semana: Desafio;
  mes: Desafio;
  carta: CartaDesafio;
  relampago: DesafioRelampago;
  chefes: Chefe[]; // least life first
  chefesDerrotados: ChefeDerrotado[]; // most recent first
  fantasma: CorridaFantasma[]; // mes-passado, ano-passado
  classe: ClasseLeitor | null;
  classes: ClasseLeitor[]; // catalog order
  medalhas: Medalha[]; // catalog order
  proximaConquista: Medalha | null;
  recordes: Recorde[];
};

// ---- painel (dashboard visibility, per instance) ----

export const PAINEL_ITENS = ['foco', 'livrosConcluidos', 'horas', 'paginas', 'atividade', 'concluidosPorMes', 'todosLivros'] as const;
export type PainelItem = (typeof PAINEL_ITENS)[number];
export type PainelConfig = Record<PainelItem, boolean>;
export type PainelConfigPatch = Partial<PainelConfig>;
