# Mecânicas de jogo: design

Issue: #6. Bloco de gamificação que vem depois de "foco e conclusão" (#3) e "hábito" (#4). Referência visual e
de texto: protótipos `ideias-painel/B-progressao-rpg.html` e `ideias-painel/C-desafios-e-conquistas.html`.

## Objetivo

Dar à leitura objetivos curtos e recompensas visíveis, sem pedir trabalho extra: missões do dia, desafio da
semana e do mês, uma carta de desafio sorteada, um desafio relâmpago, chefes (livros grandes), a corrida contra
o próprio fantasma, a classe de leitor, a galeria de medalhas com a próxima conquista e os recordes pessoais.
Tudo fica numa página própria, "Conquistas" (`/conquistas`).

Tudo é **calculado** a partir do que já existe (`page_stat`, status dos livros, foco, metas do hábito). O único
dado guardado é o dia em que a carta foi trocada.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde fica | Página nova `/conquistas`, endpoint próprio `GET /api/jogo` | Não mexe no formato do `GET /api/dashboard` |
| Sorteios | Pseudoaleatório determinístico: FNV-1a da semente (ex. `carta:2026-10-03`) alimenta um mulberry32; `sortear` embaralha (Fisher-Yates) e pega o primeiro | Mesmo dia, mesmos dados ⇒ mesmo resultado, sem guardar nada |
| Estabilidade no dia | Missões que citam um livro escolhem o livro pelo estado **até ontem** (progresso e status do fim de ontem); os candidatos são ordenados por md5 antes do sorteio | Ler, arquivar ou mudar o status hoje não troca a missão no meio do dia |
| Status manual no estado de ontem | Ignorado: o status de ontem é sempre o calculado (`computeStatus` sem `statusManual`); o arquivamento só conta se `arquivado_em` for anterior a hoje | O status manual não tem data, então não dá para saber se valia ontem |
| Progresso | Sempre com os dados de hoje (ou da semana/mês corrente); `atual` não é cortado no alvo | O cliente limita a barra; o número real é mais honesto |
| Meta do dia e do mês | Lidas de `readHabitoSettings`; "meta batida" usa `meets` exportado de `habito.ts`; uma meta guardada com minutos e páginas em 0 vale como a meta padrão (`DEFAULT_METAS`) | Sem duplicar regra de meta; meta toda em 0 seria cumprida por qualquer dia |
| Reaproveitamento | Minutos e páginas por dia vêm de `dailyTotals` (`habito.ts`); progresso num dia vem de `progressAt` (`foco.ts`) | Mesmo arredondamento das outras páginas |
| Sequências | `computeStreaks` de `habito.ts` sobre dias com ≥ 5 min (nível bronze) | Mesma regra dos dois dias da página Hábito |
| Sessão | Leituras (todas os livros) separadas por mais de 30 min começam sessão nova (`SESSION_GAP_SECONDS` exportado de `stats.ts`); a sessão pertence ao dia em que começou | Mesma folga usada nas sessões por livro |
| Hora de uma leitura | Hora local de `start_time` (`hourOf` exportado de `habito.ts`) | Igual ao "melhor horário" |
| Trocar carta | Uma vez por dia; grava `jogo.carta_trocada_em = hoje`; segunda troca no mesmo dia → 409 | Único estado guardado; reinicia sozinho no dia seguinte |
| Chefe | Livro aberto (status `lendo`) com ≥ 400 páginas; vida = páginas restantes; derrotar = terminar (status `lido`) | Pedido da issue; 400 páginas já assusta |
| Corrida contra o fantasma | Duas corridas: mês atual contra o mês passado e contra o mesmo mês do ano passado, em páginas acumuladas por dia do mês | O cliente alterna entre as duas |
| Classes | Seis classes com pontuação 0–100 nos últimos 90 dias; a classe atual é a maior | Regras simples, ver "Classes de leitor" |
| Catálogo de medalhas | Constantes em `server/src/jogo-dados.ts`; regras em `server/src/jogo.ts` | Catálogo fixo, sem tabela |
| Livro marcado `lido` à mão | Conta como terminado; sem `finishedAt`, a data de desbloqueio fica desconhecida (`null`) | Não inventa data |
| Unidades e textos | O servidor devolve títulos prontos (citam livros e alvos) e `unidade`; o cliente formata minutos como horas | Títulos dependem de dados do servidor |
| Gráficos | `recharts` (já é dependência) | Sem dependência nova |

## Termos

- **Dia** (`YYYY-MM-DD`): dia no fuso `config.timeZone` (`dayKey`).
- **Minutos de um dia**: soma de `duration` ÷ 60. **Páginas de um dia**: pares (livro, página) distintos no dia.
  Iguais aos da página Hábito.
- **Estado de ontem** de um livro: progresso e último dia de leitura considerando só dias antes de hoje; status
  calculado com `computeStatus` para ontem (arquivado e `lendo` vira `pausado`, como no foco).
- **Aberto ontem**: status de ontem `lendo`. **Reta final ontem**: aberto ontem com progresso ≥ 75.
  **Parado ontem**: status de ontem `pausado`, não arquivado, com ao menos uma leitura.
- **Sessão longa**: sessão com ≥ 45 min.

## Dados

Sem migração. Uma chave na tabela `setting`:

| Chave | Padrão | Uso |
|---|---|---|
| `jogo.carta_trocada_em` | ausente | Dia (`YYYY-MM-DD`) da última troca de carta; a carta de hoje está trocada se for igual a hoje |

A importação do plugin não toca nessa chave.

### Missões do dia (3)

1. **Meta do dia** (`meta`), sempre: "Bater a meta do dia (20 min)". Alvo em minutos se a parte de minutos
   estiver ligada, senão em páginas; feita quando `meets(hoje, meta do dia)`.
2. **Missão de livro**, sorteada (semente `missao-livro:<hoje>`) entre as disponíveis; o livro de cada uma é
   sorteado entre os candidatos (semente `missao-livro:<hoje>:<id>`):
   - `livro-paginas`: "Avançar 10 páginas em X", X aberto ontem; páginas distintas de X hoje.
   - `reta-final`: "Ler 10 min de X, na reta final", X na reta final ontem; minutos de X hoje.
   - `resgate`: "Resgatar X: ler 5 min", X parado ontem; minutos de X hoje.
   Sem nenhuma disponível, a vaga é ocupada por uma missão geral.
3. **Missão geral**, sorteada (semente `missao-geral:<hoje>`) entre as que sobraram:
   `paginas` "Ler 20 páginas hoje", `sessao` "Uma sessão de 30 min sem pausa" (maior sessão de hoje),
   `dois-momentos` "Ler em dois momentos do dia" (sessões de hoje ≥ 2).

### Desafio da semana (segunda a domingo)

Sorteado com a semente `semana:<segunda>`:

| id | Título | Progresso | Alvo |
|---|---|---|---|
| `dias-meta` | Bater a meta do dia em 5 dias | dias da semana com meta batida | 5 |
| `paginas` | Ler N páginas na semana | páginas da semana | N = máx(50, ⌈1,1 × média semanal das 4 semanas anteriores⌉ arredondado para cima a dezenas) |
| `sessoes-longas` | Fazer 3 sessões de 45+ min | sessões longas começadas na semana | 3 |
| `todo-dia` | Ler em 6 dos 7 dias | dias com leitura | 6 |

### Desafio do mês

Sorteado com a semente `mes:<YYYY-MM>`; período do dia 1 ao último dia do mês:

| id | Título | Progresso | Alvo |
|---|---|---|---|
| `fechamentos` | Mês de fechamentos: terminar 2 livros | livros `lido` com `finishedAt` no mês | 2 |
| `horas` | Ler N h no mês | minutos no mês | N h, N = máx(5, ⌈1,1 × média de horas dos 3 meses anteriores⌉) |
| `dias` | Ler em 20 dias do mês | dias com leitura | 20 |
| `meta-mes` | Bater a meta do mês | minutos (ou páginas, se os minutos estiverem desligados) do mês | meta do mês; feita com `meets` |

### Carta de desafio

Baralho fixo (`CARTAS`): `antes-9h` "Ler 15 min antes das 9h", `noite` "Ler 15 min depois das 21h",
`trinta-paginas` "Ler 30 páginas hoje", `sessao-25` "Uma sessão de 25 min sem pausa",
`dois-livros` "Ler 2 livros diferentes hoje", `resgate` "Ler 10 min de um livro parado" (parado ontem).
Cartas impossíveis com os livros que existem saem do baralho do dia: `resgate` sem livro parado ontem e
`dois-livros` com menos de dois livros. As cartas de horário (`antes-9h`, `noite`) ficam o dia todo, para a carta
não mudar com a hora. O baralho restante é embaralhado com a semente `carta:<hoje>`; a carta do dia é a primeira,
ou a segunda depois da troca.

### Desafio relâmpago

Prazo sorteado em {12h, 18h, 22h} (semente `relampago-prazo:<hoje>`) e alvo em {15, 20, 30} min (semente
`relampago-alvo:<hoje>`): "Ler 30 min antes das 22h". Progresso = minutos de hoje com hora < prazo.
Estado: `feito` se atingiu, `perdido` se a hora atual ≥ prazo, senão `ativo`.

### Chefes

- **Chefe**: livro `lendo` com `pages ≥ 400`. `vidaMax = pages`; `vida = round(pages × (100 − progress) / 100)`.
- **Dano por dia** (últimos 7 dias, hoje incluído): `round(pages × (progresso no fim do dia − no fim do dia
  anterior) / 100)`. `danoMedio` = páginas por dia nos últimos 14 dias (mesmo ritmo da previsão do foco), ou
  `null`; `previsao` = previsão do foco (`forecast`).
- Ordem: menos vida primeiro. **Derrotados**: livros `lido` com ≥ 400 páginas, `derrotadoEm = finishedAt`,
  mais recentes primeiro.

### Corrida contra o fantasma

Duas corridas, `mes-passado` e `ano-passado`. Para cada dia `d` do mês atual (1 até o número de dias do mês):
`voce` = páginas acumuladas do dia 1 até `d` (null depois de hoje); `fantasma` = o mesmo no mês de comparação
(dias que ele não tem repetem o último valor). Totais `voce` e `fantasma` comparados no dia de hoje.

### Classes de leitor

Janela: últimos 90 dias até hoje. Pontuação = `min(100, round(100 × valor ÷ referência))`.

| id | Classe | Valor | Referência (100) |
|---|---|---|---|
| `maratonista` | Maratonista | média de minutos por sessão | 60 min |
| `constante` | Constante | % de dias com leitura | 80% |
| `noturno` | Noturno | % dos minutos lidos entre 21h e 4h59 | 50% |
| `madrugador` | Madrugador | % dos minutos lidos entre 5h e 8h59 | 40% |
| `explorador` | Explorador | categorias distintas (não vazias) dos livros lidos | 4 |
| `finalizador` | Finalizador | livros terminados (`finishedAt` na janela) | 3 |

Classe atual = maior pontuação (empate: ordem da tabela); `null` sem leitura na janela.

### Medalhas

Catálogo em `jogo-dados.ts` (id, nome, descrição, sigla, raridade, alvo, unidade). `atual` é o progresso;
`desbloqueadaEm` é o dia em que o alvo foi atingido, quando dá para saber.

| id | Nome | Regra | Alvo | Data |
|---|---|---|---|---|
| `primeiro-livro` | Primeiro livro | livros terminados | 1 | 1º `finishedAt` |
| `estante` | Estante cheia | livros terminados | 10 | 10º `finishedAt` |
| `primeiro-chefe` | Primeiro chefe | maior progresso (%) entre livros ≥ 400 págs | 100% | 1º `finishedAt` de livro ≥ 400 |
| `chefao-mil` | Chefão de mil | idem, ≥ 1000 págs | 100% | idem |
| `sequencia-7` | Sequência de 7 | maior sequência (bronze) | 7 dias | 7º dia da 1ª sequência com 7 |
| `sequencia-30` | Sequência de 30 | idem | 30 dias | idem |
| `cem-horas` | Cem horas | horas acumuladas | 100 h | dia em que a soma passou de 100 h |
| `maratona` | Maratona de 3h | maior sessão | 180 min | dia da 1ª sessão ≥ 180 min |
| `coruja` | Coruja | dias com leitura das 23h às 3h59 | 20 dias | 20º desses dias |
| `madrugador` | Madrugador | dias com leitura das 4h às 6h59 | 10 dias | 10º desses dias |
| `polimata` | Polímata | categorias distintas de livros terminados | 5 | dia em que a 5ª entrou |
| `ressurreicao` | Ressurreição | livro terminado depois de 30+ dias parado (intervalo ≥ 30 dias entre dois dias de leitura) | 1 | `finishedAt` |
| `velocista` | Velocista | livro de 100+ págs terminado em até 7 dias (`finishedAt − startedAt + 1 ≤ 7`) | 1 | `finishedAt` |
| `mil-paginas-mes` | Mil páginas no mês | mais páginas num mês do calendário | 1000 | dia em que o mês passou de 1000 |

**Próxima conquista**: medalha bloqueada com maior `atual ÷ alvo` (empate: ordem do catálogo).

### Recordes pessoais

Empates ficam com o mais antigo. `valor` é `null` sem dados.

| id | Rótulo | Valor | Data / detalhe |
|---|---|---|---|
| `maior-sessao` | Maior sessão | minutos | dia da sessão |
| `dia-paginas` | Mais páginas num dia | páginas | dia |
| `dia-minutos` | Mais tempo num dia | minutos | dia |
| `semana` | Melhor semana | minutos (segunda a domingo) | segunda-feira |
| `mes-paginas` | Mais páginas num mês | páginas | `YYYY-MM` |
| `sequencia` | Maior sequência | dias (bronze) | último dia |
| `livro-rapido` | Livro mais rápido | dias (`finishedAt − startedAt + 1`) | `finishedAt`, título |
| `maior-livro` | Maior livro terminado | páginas | `finishedAt`, título |

## API

Rotas no router `api`, atrás de `requireSession`. Tipos no fim de `shared/src/index.ts`, sob `// ---- jogo ----`
(`Jogo`, `Missao`, `Desafio`, `CartaDesafio`, `DesafioRelampago`, `Chefe`, `ChefeDerrotado`, `CorridaFantasma`,
`ClasseLeitor`, `Medalha`, `Recorde`, `UnidadeJogo`).

1. **`GET /api/jogo`** → `Jogo`.
2. **`POST /api/jogo/carta/trocar`** (sem corpo) → `Jogo` com a carta trocada. 409
   `{ error: 'A carta de hoje já foi trocada' }` na segunda troca do dia.

No cliente, a troca grava a resposta na query `['jogo']`.

## Interface

Página `web/src/pages/ConquistasPage.tsx`, link "Conquistas" no cabeçalho. Reaproveita `Card`, `Cover`,
`ProgressBar` e `format.ts`; corrida com `recharts`. Cabe em 375 px sem rolagem horizontal.

1. **Cabeçalho**: título e a classe atual em destaque.
2. **Hoje**: "Missões do dia" (✓ nas feitas, barra e "12/20 min", "N de 3 feitas"), "Carta de desafio"
   (botão "Trocar carta", desabilitado depois da troca) e "Desafio relâmpago" (prazo e estado).
3. **Desafios**: "Desafio da semana" e "Desafio do mês" com barra e "termina em N dias".
4. **Chefes**: capa, "N págs de vida", barra vermelha, dano dos últimos 7 dias em barrinhas, ritmo e previsão;
   lista curta de chefes derrotados.
5. **Corrida contra o fantasma**: linhas de páginas acumuladas (você contínua, fantasma tracejada), botões
   "Mês passado" / "Ano passado" e "N págs à frente/atrás".
6. **Classe de leitor**: as seis classes com barra de pontuação e o critério.
7. **Próxima conquista** e **Galeria de medalhas** (bloqueadas em cinza com progresso; desbloqueadas com data).
8. **Recordes pessoais**.

## Testes

`server/test/jogo.test.ts`, com `now` fixo e fuso `America/Fortaleza`:

- Sorteio: mesma semente, mesmo resultado; sementes diferentes variam.
- Missões: três, a primeira é a meta (usa a meta do hábito); a missão de livro usa o livro aberto ontem;
  missões gerais quando não há livros.
- Desafios da semana e do mês: cada regra e o período; alvo de páginas a partir das semanas anteriores.
- Carta: troca uma vez por dia e reinicia no dia seguinte; progresso de cada carta; cartas impossíveis não saem.
- Estabilidade: ler qualquer candidato hoje, mudar o status manual ou arquivar hoje não troca a missão de livro.
- Meta guardada toda em 0 cai na meta padrão.
- Relâmpago: `ativo`, `feito` e `perdido`, inclusive exatamente na hora do prazo.
- Chefes: vida, dano por dia, livro de 399 págs fora, derrotados.
- Fantasma: páginas acumuladas, dias depois de hoje nulos, mês de 31 dias contra fevereiro e 2028-02 contra 2027-02.
- Classes: maratonista, noturno e `null` sem leitura.
- Medalhas: desbloqueio com data (inclusive sequência com um dia de folga), progresso e próxima conquista; recordes.

Em `api.test.ts`: as rotas exigem sessão; `GET` devolve o bloco; a segunda troca de carta no dia dá 409;
a importação do plugin não altera a troca.

## Fora de escopo

XP, níveis, árvore de habilidades, escudos de sequência, quiz, contrato, missões aceitas à mão e notificações.
Nada de histórico guardado: medalhas e recordes são recalculados a cada leitura e podem mudar se os dados
mudarem (por exemplo, livro excluído ou metas alteradas).
