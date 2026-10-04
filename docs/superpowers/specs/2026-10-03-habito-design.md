# Hábito de leitura: design

Issue: #4. Segundo bloco da gamificação do painel, depois de "foco e conclusão" (#3). Referência visual e de
texto: protótipo `ideias-painel/A-habito-e-sequencia.html`.

## Objetivo

Transformar a leitura em hábito diário visível. Uma página própria, "Hábito" (`/habito`), mostra a meta do
dia e do mês, a sequência de dias em três níveis com a regra dos dois dias, o histórico de sequências, o
calendário de 365 dias, quando você costuma ler, como esta semana se compara à anterior e a você de 90 dias
atrás, o gatilho do hábito escrito por você e uma pontuação de consistência.

Tudo é calculado a partir de `page_stat`; só as metas e o gatilho são guardados.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde fica | Página nova `/habito`, endpoint próprio `GET /api/habito` | Não mexe no formato do `GET /api/dashboard` |
| Meta do dia e do mês | Minutos e/ou páginas; 0 desliga a parte; pelo menos uma das duas tem de ser > 0 | "minutos e/ou páginas" sem um terceiro campo de modo |
| Meta batida | Todas as partes ligadas atingidas (minutos ≥ meta **e** páginas ≥ meta) | Regra única e previsível |
| Páginas de um dia | Páginas distintas (livro + página) com `page_stat` naquele dia | Voltar a uma página no mesmo dia não conta duas vezes |
| Minutos de um dia | Soma de `duration` do dia ÷ 60, arredondado | Igual ao mapa de calor do painel |
| Três níveis | Bronze = ≥ 5 min; Prata = meta do dia; Ouro = o dobro da meta do dia (cada parte ligada ×2) | Igual ao protótipo: um dia fraco ainda alimenta o bronze |
| Regra dos dois dias | A sequência só quebra depois de **dois dias seguidos** sem cumprir o nível | Pedido da issue; um tropeço isolado é tolerado |
| Tamanho de uma sequência | Número de dias que cumpriram o nível (o dia tolerado não soma) | "N dias lidos" é honesto; início e fim mostram o intervalo |
| Função de sequência | `computeStreaks(dias, hoje)` exportada de `server/src/habito.ts`, pura, testada | O bloco "mecânicas de jogo" (#6) vai reutilizar |
| Melhor horário | Minutos por hora do dia (fuso configurado) nos últimos 90 dias; a hora é a de `start_time` | Páginas são curtas; não vale dividir uma página entre horas |
| Padrão por dia da semana | Média de minutos por dia da semana nos últimos 90 dias, contando dias sem leitura | Mostra o "elo fraco" sem favorecer dias raros |
| Semana | Segunda a domingo; compara dia a dia com a semana anterior; a variação usa só os dias até hoje nas duas | Comparação justa no meio da semana |
| Você vs. 90 dias atrás | Últimos 30 dias (até hoje) contra os 30 dias que terminam 90 dias antes de hoje | Janela de 30 dias suaviza semanas atípicas |
| Pontuação de consistência | Ver "Valores calculados" | Fórmula simples e documentada |
| Gatilho | Texto livre, até 140 caracteres, vazio permitido | O protótipo usa três selects; texto livre é mais simples e cobre tudo |
| Calendário | Reaproveita `Heatmap`, com um `bucket` opcional para colorir pela meta | Sem componente novo |
| Gráficos | `recharts` (já é dependência) | Sem dependência nova |

## Termos

- **Dia** (`YYYY-MM-DD`): dia no fuso `config.timeZone`, calculado com `dayKey` de `server/src/dates.ts`.
- **Meta do dia / do mês**: pares `{ minutos, páginas }`; uma parte 0 está desligada.
- **Nível**: bronze, prata ou ouro, cada um com seu critério de dia cumprido.
- **Sequência**: dias cumpridos de um nível, sem dois dias seguidos de falha no meio.
- **Sequência atual**: a sequência cujo último dia é hoje, ontem ou anteontem. Se o último foi anteontem,
  ontem falhou e hoje é obrigatório.
- **Recorde**: a maior sequência do nível (inclui a atual).
- **Histórico**: sequências já encerradas, mais recente primeiro (no máximo 10 por nível).
- **Gatilho**: frase livre do tipo "depois do café", mostrada no topo da página.

## Dados

Sem migração: só a tabela `setting` existente, com padrão quando a chave não existe.

| Chave | Padrão | Faixa válida |
|---|---|---|
| `habito.meta_dia_minutos` | 20 | inteiro 0–600 |
| `habito.meta_dia_paginas` | 0 | inteiro 0–1000 |
| `habito.meta_mes_minutos` | 600 | inteiro 0–18000 |
| `habito.meta_mes_paginas` | 0 | inteiro 0–30000 |
| `habito.gatilho` | `''` | texto até 140 caracteres (espaços nas pontas removidos) |

Valor guardado que não seja inteiro (vazio, texto, decimal) é ignorado e vale o padrão.
Depois de aplicar uma alteração, minutos e páginas de uma mesma meta não podem ficar os dois em 0.
A importação do plugin não toca nessas chaves.

### Valores calculados (nada disso é guardado)

- **Dia cumprido** por nível, para um dia com `m` minutos e `p` páginas e meta do dia `{M, P}`:
  bronze `m ≥ 5`; prata `(M = 0 ou m ≥ M) e (P = 0 ou p ≥ P)`; ouro igual à prata com `2M` e `2P`.
- **`computeStreaks(dias, hoje)`**: recebe os dias cumpridos (qualquer ordem, repetidos ignorados, dias
  depois de `hoje` ignorados). Percorre em ordem; um dia começa uma sequência nova quando está a mais de 2
  dias do anterior (`daysBetween > 2`, ou seja, dois dias de falha no meio). Devolve
  `{ atual, recorde, historico }`: `atual` é a última sequência se `daysBetween(fim, hoje) ≤ 2`, senão `null`;
  `historico` são as demais, mais recente primeiro; `recorde` é a maior (empate: a mais antiga).
- **Progresso**: minutos e páginas de hoje; minutos e páginas do mês corrente (do dia 1 até hoje).
- **Pontuação de consistência** (0–100), nos últimos 30 dias: cada dia vale 1 se bateu a meta, 0,5 se teve
  leitura (≥ 1 min ou ≥ 1 página) sem bater a meta e 0 sem leitura;
  `pontuação = round(100 × soma ÷ 30)`. Hoje só entra se já tiver leitura; senão a janela termina ontem
  (o dia ainda não acabou e não deve puxar a nota para baixo).
- **Semana**: `atual[i]` e `anterior[i]` são os minutos de segunda (`i = 0`) a domingo (`i = 6`); dias futuros
  valem 0. `variacao` = `(atual até hoje − anterior até o mesmo dia da semana) ÷ anterior até o mesmo dia`,
  em %, ou `null` se o denominador for 0.
- **Você vs. 90 dias atrás**: janelas `[hoje−29, hoje]` e `[hoje−119, hoje−90]`, cada uma com minutos,
  páginas, dias com leitura e dias com meta.

## API

Rotas no router `api`, atrás de `requireSession`. Entrada validada à mão, no estilo de `parseFocoPatch`.

Tipos em `shared/src/index.ts`, no fim, sob `// ---- habito ----`:

```ts
export type HabitoMeta = { minutos: number; paginas: number };
export type HabitoDia = DailyMinutes & { pages: number; metaBatida: boolean };
export type NivelSequencia = 'bronze' | 'prata' | 'ouro';
export type Sequencia = { inicio: string; fim: string; dias: number };
export type HabitoNivel = { nivel: NivelSequencia; atual: Sequencia | null; recorde: Sequencia | null; historico: Sequencia[] };
export type HabitoJanela = { inicio: string; fim: string; minutos: number; paginas: number; diasComLeitura: number; diasComMeta: number };
export type Habito = {
  hoje: string;
  metas: { dia: HabitoMeta; mes: HabitoMeta };
  gatilho: string;
  progresso: { dia: HabitoMeta; mes: HabitoMeta };
  niveis: HabitoNivel[]; // bronze, prata, ouro
  daily: HabitoDia[]; // últimos 365 dias, mais antigo primeiro
  porHora: number[]; // 24 valores, minutos nos últimos 90 dias
  porDiaSemana: number[]; // 7 valores seg..dom, média de minutos por dia nos últimos 90 dias, arredondada
  semana: { atual: number[]; anterior: number[]; variacao: number | null };
  vsPassado: { atual: HabitoJanela; antes: HabitoJanela };
  consistencia: { pontuacao: number; diasComMeta: number; diasComLeitura: number; inicio: string; fim: string };
};
export type HabitoPatch = Partial<{ metaDiaMinutos: number; metaDiaPaginas: number; metaMesMinutos: number; metaMesPaginas: number; gatilho: string }>;
```

1. **`GET /api/habito`** → `Habito`.
2. **`PATCH /api/habito`** com `HabitoPatch` → `Habito` atualizado. 400 `{ error }` se o corpo não for objeto,
   se um número não for inteiro na faixa, se o gatilho não for texto ou passar de 140 caracteres, ou se a
   meta resultante ficar com minutos e páginas em 0. A mensagem nomeia o campo e a faixa, por exemplo
   "Meta diária em minutos deve ser inteiro entre 0 e 600" ou "A meta mensal precisa de minutos ou páginas".
   O formulário valida as mesmas regras antes de enviar (campo vazio não vira 0) e mostra a mensagem do
   servidor quando ele recusa.

No cliente, a mutação grava a resposta na query `['habito']`.

## Interface

Página `web/src/pages/HabitoPage.tsx`, link "Hábito" no cabeçalho. Reaproveita `Card`, `Stat`, `ProgressBar`,
`Heatmap` e `format.ts`; gráficos de barra com `recharts`. Cabe em 375 px sem rolagem horizontal (o calendário
rola dentro do próprio card, como no painel).

1. **Gatilho**: faixa no topo com a frase ("Depois do café, eu leio.") e "editar"; vazio mostra um convite
   para escrever um.
2. **Hoje e mês**: cards "Meta do dia" e "Meta do mês" com barra de progresso por parte ligada
   ("12 de 20 min", "8 de 15 págs") e o card "Consistência" com a nota e "N de 30 dias com meta".
   Link "ajustar" abre o formulário das quatro metas.
3. **Sequência**: os três níveis com a sequência atual, o critério e o recorde; aviso da regra dos dois dias
   para a prata ("Hoje já conta", "Se hoje falhar, é só um tropeço: amanhã é obrigatório",
   "Ontem falhou. Hoje é obrigatório").
4. **Histórico de sequências**: botões Bronze/Prata/Ouro e a lista (início – fim, N dias, ★ no recorde).
5. **Calendário (365 dias)**: `Heatmap` colorido pela meta: menos da metade, até a meta, meta batida,
   o dobro.
6. **Melhor horário** (barras por hora, com o pico destacado) e **Por dia da semana** (barras seg..dom,
   com o mais forte e o elo fraco).
7. **Esta semana vs. semana passada**: barras agrupadas por dia e a variação em %.
   **Você vs. você de 90 dias atrás**: tabela com antes, agora e Δ%.

## Testes

`server/test/habito.test.ts`, com `now` fixo e fuso `America/Fortaleza`:

- `computeStreaks`: um dia de falha não quebra; dois quebram; atual viva com último dia anteontem e morta com
  três dias; histórico mais recente primeiro; recorde; dias repetidos, fora de ordem e futuros.
- Dias no fuso: leitura às 23h de Fortaleza conta no dia local, não no dia UTC.
- Níveis: dia com 10 min alimenta o bronze e não a prata (meta 20); ouro exige o dobro; meta de páginas.
- Progresso do dia e do mês; páginas distintas por dia.
- Melhor horário e média por dia da semana na janela de 90 dias.
- Semana e variação até o mesmo dia; janelas de 30 dias contra 90 dias atrás.
- Consistência: pesos 1 / 0,5 / 0 e hoje fora da janela quando ainda não há leitura.

Em `api.test.ts`: `GET /api/habito` exige sessão; `PATCH` grava metas e gatilho, recusa fora da faixa,
não-inteiro, gatilho longo e meta toda em 0; a importação do plugin não altera as metas.

## Fora de escopo

Escudos de corrente, missões, XP, desafio do mês com selo e qualquer outra mecânica de jogo (#6). Também ficam
fora: lembretes e notificações, plano semanal de blocos, histograma de duração das sessões e o card
"continue de onde parou".
