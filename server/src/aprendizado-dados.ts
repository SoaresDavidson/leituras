// Seeded data for the "aprendizado" block. Edit freely: ids are stored in the database
// (book.area, trilha_livro.trilha/item), so renaming an id orphans what was saved under it.

// Days until the next review, indexed by the note's etapa
export const INTERVALOS = [1, 3, 7, 14, 30, 60, 120];

// Rust: 0% up to RUST_GRACE_DAYS without activity, 100% from RUST_FULL_DAYS on, linear in between
export const RUST_GRACE_DAYS = 7;
export const RUST_FULL_DAYS = 90;

// Skill level = how many of these thresholds the node's points reach (points = hours + 5 × finished books)
export const NIVEIS = [1, 5, 15, 30, 60];
export const PONTOS_POR_LIVRO = 5;

// Subset of the ACM/IEEE CS2013 knowledge areas
export const BASE_ACM: { id: string; nome: string }[] = [
  { id: 'AL', nome: 'Algoritmos e complexidade' },
  { id: 'AR', nome: 'Arquitetura e organização' },
  { id: 'CN', nome: 'Ciência computacional' },
  { id: 'DS', nome: 'Estruturas discretas' },
  { id: 'GV', nome: 'Computação gráfica e visual' },
  { id: 'HCI', nome: 'Interação humano-computador' },
  { id: 'IAS', nome: 'Garantia e segurança da informação' },
  { id: 'IM', nome: 'Gerência de informação' },
  { id: 'IS', nome: 'Sistemas inteligentes' },
  { id: 'NC', nome: 'Redes e comunicação' },
  { id: 'OS', nome: 'Sistemas operacionais' },
  { id: 'PD', nome: 'Computação paralela e distribuída' },
  { id: 'PL', nome: 'Linguagens de programação' },
  { id: 'SDF', nome: 'Fundamentos de desenvolvimento de software' },
  { id: 'SE', nome: 'Engenharia de software' },
  { id: 'SF', nome: 'Fundamentos de sistemas' },
  { id: 'SP', nome: 'Questões sociais e prática profissional' },
];

export type NoSemente = { id: string; nome: string; acm: string[]; filhos?: NoSemente[] };

// Two levels: areas (roots) and their sub-nodes. A book points to any node id.
export const ARVORE: NoSemente[] = [
  {
    id: 'fundamentos', nome: 'Fundamentos', acm: ['DS', 'SDF'], filhos: [
      { id: 'matematica-discreta', nome: 'Matemática discreta', acm: ['DS'] },
      { id: 'estruturas-de-dados', nome: 'Estruturas de dados', acm: ['SDF', 'AL'] },
      { id: 'programacao', nome: 'Programação', acm: ['SDF'] },
    ],
  },
  {
    id: 'algoritmos', nome: 'Algoritmos', acm: ['AL'], filhos: [
      { id: 'complexidade', nome: 'Complexidade', acm: ['AL'] },
      { id: 'grafos', nome: 'Grafos', acm: ['AL', 'DS'] },
      { id: 'programacao-dinamica', nome: 'Programação dinâmica', acm: ['AL'] },
    ],
  },
  {
    id: 'sistemas', nome: 'Sistemas', acm: ['SF', 'OS', 'AR'], filhos: [
      { id: 'arquitetura', nome: 'Arquitetura de computadores', acm: ['AR'] },
      { id: 'sistemas-operacionais', nome: 'Sistemas operacionais', acm: ['OS'] },
      { id: 'concorrencia', nome: 'Concorrência', acm: ['PD'] },
      { id: 'sistemas-distribuidos', nome: 'Sistemas distribuídos', acm: ['PD', 'SF'] },
    ],
  },
  {
    id: 'redes', nome: 'Redes', acm: ['NC'], filhos: [
      { id: 'protocolos', nome: 'Protocolos', acm: ['NC'] },
      { id: 'web', nome: 'Web', acm: ['NC'] },
    ],
  },
  {
    id: 'bancos', nome: 'Bancos de dados', acm: ['IM'], filhos: [
      { id: 'modelagem-dados', nome: 'Modelagem e SQL', acm: ['IM'] },
      { id: 'armazenamento', nome: 'Armazenamento e transações', acm: ['IM', 'PD'] },
    ],
  },
  {
    id: 'linguagens', nome: 'Linguagens e compiladores', acm: ['PL'], filhos: [
      { id: 'paradigmas', nome: 'Paradigmas', acm: ['PL'] },
      { id: 'compiladores', nome: 'Compiladores e interpretadores', acm: ['PL'] },
      { id: 'tipos', nome: 'Sistemas de tipos', acm: ['PL'] },
    ],
  },
  {
    id: 'engenharia', nome: 'Engenharia de software', acm: ['SE'], filhos: [
      { id: 'design-codigo', nome: 'Design de código', acm: ['SE'] },
      { id: 'testes', nome: 'Testes', acm: ['SE'] },
      { id: 'arquitetura-software', nome: 'Arquitetura de software', acm: ['SE'] },
    ],
  },
  {
    id: 'ia', nome: 'IA e aprendizado de máquina', acm: ['IS'], filhos: [
      { id: 'ia-classica', nome: 'IA clássica', acm: ['IS'] },
      { id: 'machine-learning', nome: 'Aprendizado de máquina', acm: ['IS', 'CN'] },
      { id: 'deep-learning', nome: 'Redes neurais', acm: ['IS'] },
    ],
  },
  {
    id: 'seguranca', nome: 'Segurança', acm: ['IAS'], filhos: [
      { id: 'criptografia', nome: 'Criptografia', acm: ['IAS', 'DS'] },
      { id: 'seguranca-sistemas', nome: 'Segurança de sistemas', acm: ['IAS'] },
    ],
  },
];

export type TrilhaSemente = { id: string; nome: string; itens: { id: string; nome: string }[] };

export const TRILHAS: TrilhaSemente[] = [
  {
    id: 'construir-linguagem', nome: 'Construir uma linguagem', itens: [
      { id: 'paradigmas', nome: 'Paradigmas e semântica' },
      { id: 'analise', nome: 'Análise léxica e sintática' },
      { id: 'interpretador', nome: 'Interpretador' },
      { id: 'tipos', nome: 'Sistema de tipos' },
      { id: 'geracao-codigo', nome: 'Geração de código' },
      { id: 'vm-gc', nome: 'Máquina virtual e coleta de lixo' },
    ],
  },
  {
    id: 'sistemas-distribuidos', nome: 'Sistemas distribuídos na prática', itens: [
      { id: 'so', nome: 'Sistemas operacionais e concorrência' },
      { id: 'redes', nome: 'Redes' },
      { id: 'dados', nome: 'Bancos de dados e armazenamento' },
      { id: 'consenso', nome: 'Replicação e consenso' },
      { id: 'projeto', nome: 'Projeto de sistemas' },
    ],
  },
  {
    id: 'ia-do-zero', nome: 'IA do zero', itens: [
      { id: 'matematica', nome: 'Álgebra linear e probabilidade' },
      { id: 'ml-classico', nome: 'Aprendizado de máquina clássico' },
      { id: 'redes-neurais', nome: 'Redes neurais' },
      { id: 'aplicacoes', nome: 'Aplicações (linguagem, visão)' },
    ],
  },
];
