import type { Medalha, UnidadeJogo } from '@leituras/shared';

// Fixed catalogs for the game block. Rules that evaluate them live in jogo.ts.

export const CHEFE_PAGINAS = 400;
export const SESSAO_LONGA_MINUTOS = 45;
export const CLASSES_JANELA_DIAS = 90;
export const RELAMPAGO_PRAZOS = [12, 18, 22];
export const RELAMPAGO_ALVOS = [15, 20, 30];

export const CARTAS = [
  { id: 'antes-9h', titulo: 'Ler 15 min antes das 9h', alvo: 15, unidade: 'min', prazoHora: 9 },
  { id: 'noite', titulo: 'Ler 15 min depois das 21h', alvo: 15, unidade: 'min' },
  { id: 'trinta-paginas', titulo: 'Ler 30 páginas hoje', alvo: 30, unidade: 'págs' },
  { id: 'sessao-25', titulo: 'Uma sessão de 25 min sem pausa', alvo: 25, unidade: 'min' },
  { id: 'dois-livros', titulo: 'Ler 2 livros diferentes hoje', alvo: 2, unidade: 'livros' },
  { id: 'resgate', titulo: 'Ler 10 min de um livro parado', alvo: 10, unidade: 'min' },
] as const satisfies readonly { id: string; titulo: string; alvo: number; unidade: UnidadeJogo; prazoHora?: number }[];

export type CartaId = (typeof CARTAS)[number]['id'];

export const CLASSES = [
  { id: 'maratonista', nome: 'Maratonista', criterio: 'Média de minutos por sessão', referencia: 60, unidade: 'min' },
  { id: 'constante', nome: 'Constante', criterio: 'Dias com leitura', referencia: 80, unidade: '%' },
  { id: 'noturno', nome: 'Noturno', criterio: 'Minutos lidos entre 21h e 5h', referencia: 50, unidade: '%' },
  { id: 'madrugador', nome: 'Madrugador', criterio: 'Minutos lidos entre 5h e 9h', referencia: 40, unidade: '%' },
  { id: 'explorador', nome: 'Explorador', criterio: 'Categorias diferentes nos livros lidos', referencia: 4, unidade: 'categorias' },
  { id: 'finalizador', nome: 'Finalizador', criterio: 'Livros terminados', referencia: 3, unidade: 'livros' },
] as const;

export type ClasseId = (typeof CLASSES)[number]['id'];

type MedalhaDef = Pick<Medalha, 'id' | 'nome' | 'descricao' | 'sigla' | 'raridade' | 'alvo' | 'unidade'>;

export const MEDALHAS = [
  { id: 'primeiro-livro', nome: 'Primeiro livro', descricao: 'Terminar um livro.', sigla: '1º', raridade: 'comum', alvo: 1, unidade: 'livros' },
  { id: 'estante', nome: 'Estante cheia', descricao: 'Terminar 10 livros.', sigla: '10', raridade: 'rara', alvo: 10, unidade: 'livros' },
  { id: 'primeiro-chefe', nome: 'Primeiro chefe', descricao: 'Terminar um livro de 400+ páginas.', sigla: '400', raridade: 'comum', alvo: 100, unidade: '%' },
  { id: 'chefao-mil', nome: 'Chefão de mil', descricao: 'Terminar um livro de 1000+ páginas.', sigla: '1K', raridade: 'épica', alvo: 100, unidade: '%' },
  { id: 'sequencia-7', nome: 'Sequência de 7', descricao: '7 dias de sequência (5+ min por dia).', sigla: '7d', raridade: 'comum', alvo: 7, unidade: 'dias' },
  { id: 'sequencia-30', nome: 'Sequência de 30', descricao: '30 dias de sequência (5+ min por dia).', sigla: '30d', raridade: 'rara', alvo: 30, unidade: 'dias' },
  { id: 'cem-horas', nome: 'Cem horas', descricao: '100 horas de leitura acumuladas.', sigla: '100h', raridade: 'rara', alvo: 100, unidade: 'h' },
  { id: 'maratona', nome: 'Maratona de 3h', descricao: 'Uma sessão de 3 horas ou mais.', sigla: '3h', raridade: 'rara', alvo: 180, unidade: 'min' },
  { id: 'coruja', nome: 'Coruja', descricao: 'Ler entre 23h e 4h em 20 dias.', sigla: '23h', raridade: 'comum', alvo: 20, unidade: 'dias' },
  { id: 'madrugador', nome: 'Madrugador', descricao: 'Ler entre 4h e 7h em 10 dias.', sigla: '5h', raridade: 'rara', alvo: 10, unidade: 'dias' },
  { id: 'polimata', nome: 'Polímata', descricao: 'Terminar livros de 5 categorias.', sigla: '5C', raridade: 'rara', alvo: 5, unidade: 'categorias' },
  { id: 'ressurreicao', nome: 'Ressurreição', descricao: 'Terminar um livro que ficou 30+ dias parado.', sigla: 'REV', raridade: 'épica', alvo: 1, unidade: 'livros' },
  { id: 'velocista', nome: 'Velocista', descricao: 'Terminar um livro de 100+ páginas em até 7 dias.', sigla: '7×', raridade: 'rara', alvo: 1, unidade: 'livros' },
  { id: 'mil-paginas-mes', nome: 'Mil páginas no mês', descricao: 'Ler 1000 páginas num mês do calendário.', sigla: '1KP', raridade: 'épica', alvo: 1000, unidade: 'págs' },
] as const satisfies readonly MedalhaDef[];

export type MedalhaId = (typeof MEDALHAS)[number]['id'];
