# Retrospectiva: design

Issue: #7. Bloco da gamificação que olha para trás: o que você leu na semana e no mês, quanto já investiu,
quanto falta para a meta do ano e como o seu ritmo muda com o tempo.

## Objetivo

Tornar visível o esforço acumulado e dar um número para decidir hoje. Uma página própria, `/retrospectiva`
("Retrospectiva" no menu), com quatro partes:

1. **Retrospectiva da semana e do mês**, com período navegável para trás e comparação com o período anterior.
2. **Quanto já investi**: horas e páginas (desde sempre e por ano) traduzidas em equivalências divertidas.
3. **Páginas por dia para fechar o ano**, contra uma meta anual de páginas editável na própria página.
4. **Ritmo pessoal**: páginas por hora por livro e a velocidade de leitura mês a mês (gráfico de linha).

Sequências (streaks) ficam com o bloco de hábito (#4) e não são calculadas aqui.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| O que é "página lida" | Cada registro de `page_stat` (virada de página), como `totals.pages` do painel | Mesmo número do painel; releitura também é esforço |
| Semana | Segunda a domingo, no fuso configurado | Pedido da issue |
| Navegação | `offset` inteiro ≥ 0 (0 = atual, 1 = anterior…), até 520 | Simples de paginar e de testar |
| Período atual | Vai até o fim da semana/mês, mesmo com dias no futuro | O intervalo mostrado é sempre o período inteiro |
| Comparação | Mesmo tipo de período, imediatamente anterior, inteiro | Previsível; o atual ainda em andamento aparece como parcial na interface |
| Sessão | Viradas de página do mesmo livro com menos de 30 min de intervalo (regra de `stats.ts`); conta no dia em que começa | Reaproveita a regra de sessões existente |
| Livro terminado no período | `status === 'lido'` e `finishedAt` dentro do período | Mesma regra de `finishedPerMonth` do painel |
| Meta anual | Só em páginas (`retrospectiva.meta_ano_paginas`), padrão 6000 (20 livros de 300 págs) | Páginas medem esforço contínuo; livros têm tamanhos muito diferentes |
| Ritmo linear | Esperado hoje = meta × dias decorridos (contando hoje) ÷ dias do ano | Linha reta de 1/jan a 31/dez |
| Páginas por dia | `ceil(restantes ÷ dias até 31/12, contando hoje)` | Hoje ainda dá para ler |
| Ruído no ritmo | Livro ou mês com menos de 10 min de leitura fica de fora (mês aparece com `null`) | Poucos minutos geram velocidades absurdas |
| Velocidade mensal | Últimos 24 meses, incluindo o atual | Gráfico legível no celular |
| Equivalências | Calculadas no servidor; constantes em `EQUIVALENCIAS` de `server/src/retrospectiva.ts` | Um só lugar, documentado, testável |
| Endpoints | `GET /api/retrospectiva/periodo` separado de `GET /api/retrospectiva` | Navegar entre períodos não recalcula o resto |

## Termos

- **Período**: semana (seg–dom) ou mês civil, no fuso configurado, identificado por `tipo` e `offset`.
- **Livro tocado**: livro com ao menos um registro de `page_stat` no período.
- **Melhor dia**: dia do período com mais minutos lidos (empate: o mais antigo).
- **Maior sessão**: sessão com mais minutos lidos que começou no período.
- **Investido**: minutos e páginas somados num recorte (desde sempre ou um ano).
- **Páginas por hora**: páginas ÷ (segundos lidos ÷ 3600), arredondado para inteiro.

## Dados

Nenhuma tabela nova. Novo ajuste na tabela `setting`, com padrão quando a chave não existe:

| Chave | Padrão | Faixa válida |
|---|---|---|
| `retrospectiva.meta_ano_paginas` | 6000 | inteiro 100–100000 |

A importação do plugin não toca nesse ajuste. Tudo o mais é calculado de `page_stat` a cada pedido.

### Equivalências (constantes em `EQUIVALENCIAS`)

| id | Base | Valor |
|---|---|---|
| `filmes` | minutos | 120 min (filme médio de 2 h) |
| `voos` | minutos | 600 min (voo São Paulo–Lisboa, ~10 h) |
| `dias` | minutos | 1440 min (um dia inteiro) |
| `livros` | páginas | 300 págs (livro de tamanho médio) |

Quantidade = total ÷ valor, com uma casa decimal.

## API

Todas atrás de `requireSession`. Erros: 400 `{ error }` em português.

### `GET /api/retrospectiva/periodo?tipo=semana|mes&offset=N`

`tipo` padrão `semana`, `offset` padrão 0. 400 para `tipo` desconhecido ou `offset` fora de 0–520/não inteiro.

```ts
export type RetroTotais = { minutos: number; paginas: number; diasLidos: number; livrosTocados: number; livrosTerminados: number };
export type RetroPeriodo = {
  tipo: 'semana' | 'mes';
  offset: number;
  inicio: string; fim: string; // YYYY-MM-DD, inclusivos
  totais: RetroTotais;
  anterior: RetroTotais & { inicio: string; fim: string };
  melhorDia: { date: string; minutos: number } | null;
  maiorSessao: { date: string; minutos: number; book: BookSummary } | null;
  livros: { book: BookSummary; minutos: number; paginas: number; terminou: boolean }[]; // mais minutos primeiro
};
```

### `GET /api/retrospectiva`

```ts
export type Investido = { minutos: number; paginas: number; equivalencias: { id: string; rotulo: string; quantidade: number }[] };
export type Retrospectiva = {
  investimento: { total: Investido; anos: (Investido & { ano: number })[] }; // anos com leitura, mais recente primeiro
  meta: {
    ano: number; metaPaginas: number; lidas: number; restantes: number;
    diasRestantes: number; paginasPorDia: number;
    esperadoHoje: number; diferenca: number; // diferenca = lidas − esperadoHoje (positivo = adiantado)
  };
  ritmoLivros: { book: BookSummary; minutos: number; paginas: number; paginasPorHora: number }[]; // mais recente primeiro
  velocidadeMensal: { month: string; paginasPorHora: number | null }[]; // YYYY-MM, 24 meses, mais antigo primeiro
};
```

### `PATCH /api/retrospectiva` com `{ metaAnoPaginas: number }`

400 se não for inteiro em 100–100000 (string ou fracionário também). Resposta: `Retrospectiva` atualizada.

## Interface

Página `web/src/pages/RetrospectivaPage.tsx`, rota `/retrospectiva`, link "Retrospectiva" no menu.
Sem dependência nova; reaproveita `Card`, `Stat`, `Cover`, `fmtHours`, `fmtDate` e recharts.

1. **Retrospectiva**: botões "Semana"/"Mês", setas ← → (com `aria-label`) e o intervalo ("29/09 a 05/10").
   `Stat`s: tempo lido, páginas, dias com leitura, livros tocados e terminados, cada um com a variação
   contra o período anterior ("+12% vs. anterior"). Linha de destaques: melhor dia e maior sessão
   (com o livro). Lista dos livros do período com capa, tempo e "terminou" quando for o caso.
2. **Quanto já investi**: seletor "Desde sempre" / anos; horas e páginas grandes e as equivalências
   em cartões ("12,5 filmes", "2,5 voos São Paulo–Lisboa"…).
3. **Meta do ano**: páginas lidas / meta com barra, "N págs/dia até 31/12", e "adiantado/atrasado
   N págs em relação ao ritmo linear". Link "ajustar" abre campo numérico e "Salvar".
4. **Ritmo pessoal**: gráfico de linha (recharts) de páginas/hora por mês, com falhas nos meses sem
   dados; lista de livros com páginas/hora.

Mobile: grades de 2 colunas no celular, nada com largura fixa maior que a tela.

## Testes

`server/test/retrospectiva.test.ts`, com `now` fixo (2026-10-03, sábado) e fuso `America/Fortaleza`:

- Semana atual vai de segunda 2026-09-28 a domingo 2026-10-04; offset 1 é a anterior; mês atual e
  mês anterior; leitura às 23h30 locais conta no dia local, não no UTC.
- Totais do período: minutos, páginas, dias lidos, livros tocados e terminados; comparação com o anterior.
- Melhor dia e maior sessão (sessão quebra com intervalo > 30 min).
- Investimento: total e por ano, equivalências pelas constantes.
- Meta: padrão 6000, páginas por dia até 31/12, adiantado/atrasado pelo ritmo linear.
- Ritmo por livro ignora livros com menos de 10 min; velocidade mensal tem 24 meses e `null` sem dados.

Em `server/test/api.test.ts`: as rotas exigem sessão; `periodo` recusa `tipo`/`offset` inválidos;
`PATCH` recusa meta fora da faixa, string e fracionário, e grava a meta; a importação do plugin não altera
a meta.

## Fora de escopo

Sequências e hábito (#4), meta em livros, metas mensais/semanais, texto automático de "ajuste sugerido",
compartilhar/exportar a retrospectiva.
