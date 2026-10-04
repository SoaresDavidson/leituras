# Foco e conclusão de livros: design

Issue: #3. Primeiro bloco da gamificação do painel; os demais blocos estão adiados (#4 a #8).

## Objetivo

Atacar o problema de começar livros demais e não terminar. O painel passa a mostrar quantos livros estão
abertos contra um limite, uma fila de próximos livros com cadeado, um cemitério que força a decisão sobre
livros parados, a previsão de término de cada livro aberto e a taxa de conclusão.

O app não controla o Kindle: limite e cadeado são compromisso visual, não bloqueio.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| O que é um livro aberto | `status === 'lendo'` (leitura nos últimos 30 dias, regra atual) | Zero manutenção; o que vem do Kindle manda |
| Origem dos livros da fila | Só livros já no banco (abertos ao menos uma vez no KOReader) | A chave é o md5 do arquivo; sem casamento por título |
| Ler de novo um livro arquivado | O arquivamento se desfaz sozinho | O app nunca contradiz o Kindle |
| Onde a regra é calculada | Servidor, como campo `foco` do `GET /api/dashboard` | Mesmo padrão do `readingNow`; testável em `server/test/` |

## Termos

- **Aberto**: livro com status calculado `lendo`.
- **Arquivado**: livro com `arquivado_em` preenchido e sem leitura depois dessa data.
- **Cemitério**: livro `pausado`, não arquivado, com mais de `prazoDias` dias sem leitura.
- **Fila**: lista ordenada de livros que você quer ler a seguir.
- **Liberado**: o primeiro livro da fila, quando abertos < limite. Os demais estão trancados.
- **Reta final**: livro aberto com progresso ≥ 75%.
- **Abandonado** (para a taxa): livro arquivado ou no cemitério.

## Dados

Migração 2, adicionada ao fim de `MIGRATIONS` em `server/src/db.ts` (só acrescenta, sem recriar tabela):

```sql
ALTER TABLE book ADD COLUMN arquivado_em TEXT; -- YYYY-MM-DD no fuso configurado, NULL = nunca arquivado
CREATE TABLE fila (
  md5 TEXT PRIMARY KEY REFERENCES book(md5) ON DELETE CASCADE,
  posicao INTEGER NOT NULL
);
```

Ajustes na tabela `setting` existente, com padrão aplicado quando a chave não existe:

| Chave | Padrão | Faixa válida |
|---|---|---|
| `foco.limite` | 2 | inteiro 1–10 |
| `foco.prazo_dias` | 45 | inteiro 7–365 |

A importação do plugin não toca em `arquivado_em` nem em `fila`.

### Valores calculados (nada disso é guardado)

- **Arquivado** = `arquivado_em != null && (lastReadAt == null || lastReadAt <= arquivado_em)`.
- **Cemitério** = `status === 'pausado' && !arquivado && daysBetween(lastReadAt, hoje) > prazoDias`.
  `diasParado` = dias desde `lastReadAt`; `vencidoHa` = `diasParado - prazoDias`.
  Livros sem nenhuma leitura (`lastReadAt == null`) não entram no cemitério.
- **Liberado** = item na posição 0 da fila, livro não `lido`, e `abertos.length < limite`.
  Livros `lido` continuam na fila (você tira manualmente), mas nunca aparecem como liberados.
- **Previsão** = páginas restantes ÷ páginas por dia do livro nos últimos 14 dias (dias corridos, contando
  os dias sem leitura). `null` quando não há leitura nesses 14 dias.
  `minutosRestantes` = páginas restantes × minutos por página do livro nos mesmos 14 dias.
  Páginas restantes = `pages × (100 − progress) / 100`.
- **Reta final** = abertos com `progress >= 75`.
- **Taxa de conclusão**, sobre livros com `startedAt` no ano escolhido no painel:
  `lidos` = status `lido`; `abandonados` = arquivados + cemitério;
  `percentual` = `lidos / (lidos + abandonados)`, ou `null` se o denominador for 0.
  Livros abertos ou pausados dentro do prazo não entram na conta.

## API

Todas as rotas abaixo ficam no router `api`, atrás de `requireSession`. Entradas validadas à mão, no
estilo de `parsePatch`. Erros: 400 `{ error }` em português para entrada inválida, 404 para livro inexistente.

### Leitura: `GET /api/dashboard` ganha `foco`

Tipos em `shared/src/index.ts`:

```ts
export type FocoBook = BookSummary & {
  previsao: string | null; // YYYY-MM-DD
  minutosRestantes: number | null;
};

export type Foco = {
  limite: number;
  prazoDias: number;
  abertos: FocoBook[]; // reta final primeiro, depois por lastReadAt desc
  fila: { book: BookSummary; liberado: boolean }[]; // em ordem de posicao
  cemiterio: { book: BookSummary; diasParado: number; vencidoHa: number }[]; // mais vencido primeiro
  taxaConclusao: { lidos: number; abandonados: number; percentual: number | null };
};
```

`Dashboard` ganha `foco: Foco`. `readingNow` sai, substituído por `foco.abertos`.
`BookSummary` ganha `arquivado: boolean` (derivado, regra acima). A reta final não é uma lista separada:
o cliente identifica com `progress >= 75`.

### Escrita

1. **`PATCH /api/books/:md5`** (existente) aceita `arquivado: boolean`.
   `true` grava `arquivado_em` = hoje no fuso configurado (o cliente não manda data); `false` grava `NULL`.
   Resposta: o `BookDetail` atualizado, como hoje.
2. **`PUT /api/fila`** com `{ md5s: string[] }` substitui a fila inteira numa transação (posição = índice).
   400 se não for array de strings, se houver md5 repetido ou se algum md5 não existir.
   Resposta: `Foco` atualizado.
3. **`PATCH /api/foco`** com `{ limite?: number, prazoDias?: number }`. 400 fora da faixa ou se não for inteiro.
   Resposta: `Foco` atualizado.

Para devolver o `Foco` atualizado, `getDashboard` separa o cálculo do foco numa função `getFoco(db, year,
timeZone, now)`, usada pelas três rotas e pelo dashboard.

No cliente, toda mutação invalida as queries `['dashboard']` e `['books']`.

## Interface

Sem dependência nova; reaproveita `Card`, `Stat`, `Cover`, `ProgressBar`, `StatusBadge`, `BookList`.

### Painel (`web/src/pages/DashboardPage.tsx`)

Uma faixa "Foco" logo abaixo do título, no lugar do card "Lendo agora":

1. **Linha de `Stat`:** "Abertos N/limite" (âmbar e com o texto "Termine um antes de começar outro" quando
   N > limite), "Taxa de conclusão" (percentual ou "—") e "No cemitério" (quantidade).
2. **Card "Abertos":** capa, título, progresso, previsão ("termina ~12 nov" ou "sem ritmo recente") e tempo
   restante. Itens da reta final primeiro, com destaque "faltam ~3 h". Link "ajustar" abre, no próprio card,
   dois campos numéricos (limite e prazo do cemitério) e um botão "Salvar".
3. **Card "Próximo da fila":** itens em ordem; 🔒 nos trancados, "liberado" no primeiro quando houver vaga.
   Botões ↑, ↓ e ✕ por item (sem arrastar: funciona no celular e no teclado), cada um com `aria-label`.
   Fila vazia: dica para usar "Pôr na fila" na página do livro.
4. **Card "Cemitério":** livros com "parado há N dias", botão "Arquivar sem culpa" e a nota de que, para
   retomar, basta ler no Kindle.

### Página do livro (`web/src/pages/BookPage.tsx`)

- Botão "Pôr na fila" / "Tirar da fila": envia a fila atual com ou sem este livro para `PUT /api/fila`.
- Botão "Arquivar" / "Desarquivar", só quando o livro não é `lido`.

### Outros

- `StatusBadge` ganha a variante visual "arquivado" (cinza), usada quando `book.arquivado` é verdadeiro.
- Carregando e erro seguem o padrão atual. Botões ficam desabilitados durante a mutação.

## Testes

Em `server/test/`, no estilo de `api.test.ts`, com `now` fixo:

- Arquivar um livro pausado o tira do cemitério; nova leitura depois da data o faz voltar a `lendo` e
  `arquivado: false`.
- A fila libera só o primeiro item, e só quando abertos < limite; livro `lido` na posição 0 não é liberado.
- O cemitério respeita `prazoDias` (dia exato do prazo não entra; um dia depois entra).
- A previsão é `null` sem leitura nos últimos 14 dias e numérica com leitura.
- A taxa de conclusão ignora livros começados em outro ano e devolve `null` sem denominador.
- `PUT /api/fila` recusa md5 desconhecido, repetido e corpo inválido; `PATCH /api/foco` recusa valores
  fora da faixa.
- A importação do plugin não altera `arquivado_em` nem a fila.

## Fora de escopo

Tudo dos blocos adiados (#4 a #8), incluindo metas, sequências, desafios e medalhas. Também ficam fora:
livros planejados que ainda não existem no banco, bloqueio real no Kindle e notificações.
