# Foco e conclusão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao painel o bloco "Foco": livros abertos contra um limite, fila com cadeado, cemitério, previsão de término, reta final e taxa de conclusão (issue #3).

**Architecture:** O servidor guarda só três coisas novas (`book.arquivado_em`, tabela `fila`, dois ajustes em `setting`) e calcula todo o resto numa função `getFoco` em `server/src/foco.ts`, devolvida dentro do `GET /api/dashboard` e pelas rotas de escrita. O React só exibe e chama três operações de escrita.

**Tech Stack:** Node + Express 5, better-sqlite3, Vitest + supertest; React 19, TanStack Query 5, Tailwind 4. Tipos compartilhados em `shared/src/index.ts`.

**Spec:** `docs/superpowers/specs/2026-10-03-foco-e-conclusao-design.md`

## Global Constraints

- Branch: `feat/foco-e-conclusao`. Toda mensagem de commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e cita `Refs #3`.
- Comandos com prefixo `rtk` (ex.: `rtk npm test`), conforme `CLAUDE.md` do usuário.
- Nenhuma dependência nova em `server`, `web` ou `shared`.
- Textos de interface e mensagens de erro da API em português; identificadores de código seguem o estilo atual (inglês, exceto termos de domínio já em português: `categoria`, `topicos`, `foco`, `fila`, `arquivado`).
- Datas são `YYYY-MM-DD` no fuso `config.timeZone`, sempre via `dayKey`/`addDays`/`daysBetween` de `server/src/dates.ts`.
- Padrões: `foco.limite` = 2 (inteiro 1–10), `foco.prazo_dias` = 45 (inteiro 7–365). Reta final: `progress >= 75`. Janela da previsão: 14 dias.
- Migrações só acrescentam (nova entrada no fim de `MIGRATIONS`); nunca editar a migração 1.

## Review Focus

1. Livro com `pages = 0` (KOReader não informou): previsão e minutos restantes devem ser `null`, nunca `Infinity`/`NaN`. → teste na Task 2.
2. `PUT /api/fila` com `md5s: []` deve esvaziar a fila (200), não ser recusado. → teste na Task 3.
3. Releitura no mesmo dia do arquivamento: `lastReadAt === arquivado_em` mantém o livro arquivado (regra `<=`); só leitura em dia posterior desarquiva. → teste na Task 1.
4. Números enviados como string (`{ limite: "3" }`) ou fracionários (`2.5`) devem dar 400, não ser convertidos. → teste na Task 3.
5. Livro da fila que já é `lendo` na posição 0: segue a regra da spec (liberado só se abertos < limite); o teste fixa esse comportamento para não mudar sem querer. → teste na Task 2.

---

### Task 1: Arquivar livros

**Files:**
- Modify: `server/src/db.ts` (nova entrada em `MIGRATIONS`)
- Modify: `server/src/books.ts` (`BookRow`, `loadBooks`, `buildDetail`, `updateBook`)
- Modify: `server/src/app.ts` (`parsePatch`)
- Modify: `shared/src/index.ts` (`BookSummary`, `BookPatch`)
- Test: `server/test/api.test.ts`

**Interfaces:**
- Produces: migração 2 completa (inclui a tabela `fila`, usada na Task 2):
  ```sql
  ALTER TABLE book ADD COLUMN arquivado_em TEXT;
  CREATE TABLE fila (md5 TEXT PRIMARY KEY REFERENCES book(md5) ON DELETE CASCADE, posicao INTEGER NOT NULL);
  ```
- Produces: `BookSummary.arquivado: boolean`; `BookPatch` aceita `arquivado?: boolean`.
- Produces: `updateBook(db, md5, patch, today: string)` — novo parâmetro `today` (YYYY-MM-DD), usado como `arquivado_em` quando `patch.arquivado === true`; `false` grava `NULL`.

- [ ] **Step 1: Escrever os testes que falham** em `describe('web api')` de `server/test/api.test.ts`. Use um livro de 10 páginas com `pageStats(3, start)` para ficar não lido.

```ts
it('archives a book and unarchives it when read on a later day', async () => {
  const old = Math.floor(Date.now() / 1000) - 60 * 86_400;
  await sendImport({ books: [book], stats: pageStats(3, old) }).expect(200);
  const agent = await login();
  const archived = await agent.patch('/api/books/abc123').send({ arquivado: true }).expect(200);
  expect(archived.body.arquivado).toBe(true);

  const tomorrowish = Math.floor(Date.now() / 1000) + 86_400; // leitura depois da data de arquivamento
  await sendImport({ books: [book], stats: pageStats(4, tomorrowish).slice(3) }).expect(200);
  const after = await agent.get('/api/books/abc123').expect(200);
  expect(after.body.arquivado).toBe(false);
});

it('keeps a book archived when re-read on the same day it was archived', async () => {
  const now = Math.floor(Date.now() / 1000);
  // stats a poucos segundos de agora, para não cruzar a meia-noite durante o teste
  await sendImport({ books: [book], stats: pageStats(3, now - 200) }).expect(200);
  const agent = await login();
  await agent.patch('/api/books/abc123').send({ arquivado: true }).expect(200);
  await sendImport({ books: [book], stats: pageStats(4, now - 190).slice(3) }).expect(200);
  expect((await agent.get('/api/books/abc123')).body.arquivado).toBe(true);
});

it('unarchives explicitly and rejects a non-boolean arquivado', async () => {
  await sendImport({ books: [book], stats: [] }).expect(200);
  const agent = await login();
  await agent.patch('/api/books/abc123').send({ arquivado: true }).expect(200);
  expect((await agent.patch('/api/books/abc123').send({ arquivado: false })).body.arquivado).toBe(false);
  await agent.patch('/api/books/abc123').send({ arquivado: 'sim' }).expect(400);
});
```

E em `describe('plugin import')`, estender `keeps user-owned fields…` (ou novo teste) para afirmar que reimportar não altera `arquivado_em`:
```ts
expect(db.prepare('SELECT arquivado_em FROM book').get()).toEqual({ arquivado_em: expect.any(String) });
```

- [ ] **Step 2: Rodar e ver falhar** — `rtk npm test -w server` → FAIL (`arquivado` undefined / 400 esperado recebe 200).

- [ ] **Step 3: Implementar.** Migração 2 acima no fim de `MIGRATIONS`. `arquivado_em` entra em `BookRow` e no `SELECT` de `loadBooks`. Em `buildDetail`: `arquivado = row.arquivado_em != null && (stats.lastReadAt == null || stats.lastReadAt <= row.arquivado_em)`. `parsePatch` valida `arquivado` como boolean (senão `null` → 400). A rota `PATCH /books/:md5` passa `dayKey(Date.now() / 1000, config.timeZone)` como `today`. `toSummary` mantém `arquivado` no resumo.

- [ ] **Step 4: Rodar e ver passar** — `rtk npm test -w server` → PASS; `rtk npm run typecheck` → sem erros.

- [ ] **Step 5: Commit**
```bash
rtk git add server shared && rtk git commit -m "feat(server): archive books, auto-unarchive on later reading

Refs #3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Calcular o foco

**Files:**
- Create: `server/src/foco.ts`
- Modify: `server/src/books.ts` (exportar `listBookDetails`; `getDashboard` troca `readingNow` por `foco`)
- Modify: `shared/src/index.ts` (`FocoBook`, `Foco`; `Dashboard.foco`, remover `readingNow`)
- Modify: `web/src/pages/DashboardPage.tsx` (trocar `d.readingNow` por `d.foco.abertos` para continuar compilando; a UI real vem na Task 4)
- Test: `server/test/foco.test.ts`

**Interfaces:**
- Consumes: `BookSummary.arquivado`, tabela `fila` (Task 1).
- Produces (em `books.ts`): `listBookDetails(db: Db, timeZone: string, now?: number): BookDetail[]`; `listBooks` passa a ser `listBookDetails(...).map(toSummary)`.
- Produces (em `foco.ts`):
  - `getFoco(db: Db, year: number, timeZone: string, now = Date.now()): Foco`
  - `readFocoSettings(db: Db): { limite: number; prazoDias: number }` (padrões 2 e 45 quando a chave falta)
  - `forecast(book: BookDetail, today: string): { previsao: string | null; minutosRestantes: number | null }`
- Produces (em `shared`): `FocoBook`, `Foco` exatamente como na seção "API" da spec; `Dashboard.foco: Foco`. `taxaConclusao.percentual` é inteiro 0–100 (`Math.round`), mesma escala de `progress`.

- [ ] **Step 1: Escrever os testes que falham** em `server/test/foco.test.ts`. Montar dados com `openDb(':memory:')` + `importPluginData` e chamar `getFoco` com `now` fixo. Helper sugerido: `read(md5, pages, day: 'YYYY-MM-DD', fromPage, toPage)` que gera `PluginPageStat` de 60 s às 12:00 de `America/Fortaleza`. `NOW = Date.parse('2026-10-03T15:00:00Z')`, `TZ = 'America/Fortaleza'`.

Casos e asserções:
- `it('releases only the first queue item and only when there is room')`: 2 livros lendo, limite 2, fila [A, B] → `fila.map(f => f.liberado)` = `[false, false]`; com 1 livro lendo → `[true, false]`.
- `it('never releases a finished book at the head of the queue')`: fila [lido, X], vaga livre → `[false, false]`.
- `it('applies the queue rule to a head that is already lendo')` (Review Focus 5): fila [L] com L lendo e abertos = limite → `liberado: false`; com abertos < limite → `true`.
- `it('puts a pausado book in the cemetery only after the deadline')`: última leitura há 45 dias → fora; há 46 dias → `cemiterio[0]` com `diasParado: 46, vencidoHa: 1`. Livro arquivado com 100 dias parado → fora. Livro sem nenhuma leitura → fora.
- `it('forecasts from the last 14 days and returns null without recent reading')`: livro de 100 páginas, leu 14 páginas (14%) distribuídas nos últimos 14 dias, progresso total 30% → `previsao` = `addDays(hoje, 70)`; outro livro sem leitura nos 14 dias → `{ previsao: null, minutosRestantes: null }`.
- `it('returns null forecast for a book without page count')` (Review Focus 1): `pages: 0` com leitura recente → ambos `null`.
- `it('orders reta final first among abertos')`: livros lendo com 80% e 20% → `abertos[0].progress === 80`.
- `it('computes completion rate for books started in the chosen year')`: 1 lido + 1 arquivado começados em 2026 e 1 lido começado em 2025 → `{ lidos: 1, abandonados: 1, percentual: 50 }` para `year = 2026`; ano sem livros → `percentual: null`.
- `it('reads default settings')`: banco novo → `limite: 2, prazoDias: 45`.

- [ ] **Step 2: Rodar e ver falhar** — `rtk npm test -w server` → FAIL (`foco.ts` não existe).

- [ ] **Step 3: Implementar `forecast`.** Algoritmo (a spec diz "páginas por dia nos últimos 14 dias"; este é o modo sem consultar `page_stat` de novo):
```ts
const since = addDays(today, -14);
const progressAt = (day: string) => [...book.progressTimeline].reverse().find((p) => p.date <= day)?.progress ?? 0;
const pagesRecent = (book.pages * (book.progress - progressAt(since))) / 100;
if (book.pages <= 0 || pagesRecent <= 0) return { previsao: null, minutosRestantes: null };
const minutesRecent = book.daily.filter((d) => d.date > since).reduce((s, d) => s + d.minutes, 0);
const remaining = (book.pages * (100 - book.progress)) / 100;
return {
  previsao: addDays(today, Math.ceil(remaining / (pagesRecent / 14))),
  minutosRestantes: Math.round((remaining * minutesRecent) / pagesRecent),
};
```

- [ ] **Step 4: Implementar `readFocoSettings` e `getFoco`** com as regras da seção "Valores calculados" da spec. Ordem: `abertos` = reta final primeiro, depois `lastReadAt` desc; `fila` por `posicao`; `cemiterio` por `vencidoHa` desc. `getDashboard` passa a incluir `foco: getFoco(db, year, timeZone, now)` e perde `readingNow`.

- [ ] **Step 5: Rodar e ver passar** — `rtk npm test -w server` → PASS; `rtk npm run typecheck` → sem erros (inclui `web`).

- [ ] **Step 6: Commit** — `feat(server): compute focus block for the dashboard` com `Refs #3` e o `Co-Authored-By`.

---

### Task 3: Escrever fila e ajustes

**Files:**
- Modify: `server/src/foco.ts` (`setFila`, `updateFocoSettings`)
- Modify: `server/src/app.ts` (rotas `PUT /fila`, `PATCH /foco`)
- Test: `server/test/api.test.ts` (novo `describe('foco api')`)

**Interfaces:**
- Consumes: `getFoco`, `readFocoSettings` (Task 2).
- Produces: `setFila(db: Db, md5s: string[]): 'ok' | 'unknown' | 'duplicate'` (transação: `DELETE FROM fila` + inserts com `posicao` = índice); `updateFocoSettings(db: Db, patch: { limite?: number; prazoDias?: number }): void` (grava `foco.limite`/`foco.prazo_dias` com `INSERT … ON CONFLICT(key) DO UPDATE`).
- Produces (HTTP): `PUT /api/fila` e `PATCH /api/foco`, ambos respondem 200 com `Foco` (ano corrente).

- [ ] **Step 1: Escrever os testes que falham:**
  - `it('replaces the queue in order')`: dois livros importados; `PUT /api/fila { md5s: [b, a] }` → 200 e `body.fila.map(f => f.book.md5)` = `[b, a]`.
  - `it('clears the queue with an empty list')` (Review Focus 2): `{ md5s: [] }` → 200, `body.fila` = `[]`.
  - `it('rejects unknown, duplicated or malformed queues')`: `['nao-existe']`, `[a, a]`, `{ md5s: 'a' }`, `{ md5s: [1] }` → todos 400 com `body.error` string; a fila anterior continua intacta.
  - `it('updates focus settings within range')`: `PATCH /api/foco { limite: 3, prazoDias: 30 }` → 200, `body.limite === 3`, `body.prazoDias === 30`.
  - `it('rejects out-of-range or non-integer settings')` (Review Focus 4): `{ limite: 0 }`, `{ limite: 11 }`, `{ limite: 2.5 }`, `{ limite: '3' }`, `{ prazoDias: 6 }`, `{ prazoDias: 366 }` → 400.
  - `it('requires a session for foco routes')`: sem login → 401 nas duas rotas.

- [ ] **Step 2: Rodar e ver falhar** — `rtk npm test -w server` → FAIL (404 nas rotas).

- [ ] **Step 3: Implementar** `setFila`, `updateFocoSettings` e as rotas, validando à mão como `parsePatch` (`Number.isInteger` e faixas da seção Global Constraints). Mensagens: `'Fila inválida'`, `'Livro não encontrado na fila'`, `'Livro repetido na fila'`, `'Ajustes inválidos'`.

- [ ] **Step 4: Rodar e ver passar** — `rtk npm test -w server` → PASS.

- [ ] **Step 5: Commit** — `feat(server): add queue and focus settings endpoints` com `Refs #3` e o `Co-Authored-By`.

---

### Task 4: Interface do foco

**Files:**
- Modify: `web/src/api.ts` (`putFila`, `patchFoco`)
- Create: `web/src/components/FocoPanel.tsx`
- Modify: `web/src/pages/DashboardPage.tsx` (render `<FocoPanel foco={d.foco} />` no lugar do card "Lendo agora")
- Modify: `web/src/pages/BookPage.tsx` (botões fila e arquivar)
- Modify: `web/src/components/StatusBadge.tsx` (prop `arquivado?: boolean`)
- Modify: `web/src/components/BookList.tsx` (passar `arquivado` ao badge)

**Interfaces:**
- Consumes: `Foco`, `FocoBook`, `BookSummary.arquivado` (shared); rotas da Task 3; `patchBook(md5, { arquivado })`.
- Produces: `putFila(md5s: string[]): Promise<Foco>`, `patchFoco(p: { limite?: number; prazoDias?: number }): Promise<Foco>`; `FocoPanel({ foco }: { foco: Foco })`.

- [ ] **Step 1: Implementar `api.ts` e `StatusBadge`.** Com `arquivado`, o badge mostra "arquivado" com `bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300`.

- [ ] **Step 2: Implementar `FocoPanel`** seguindo a seção "Interface › Painel" da spec, com os textos dela: "Abertos N/limite" (âmbar `text-amber-600` e "Termine um antes de começar outro" quando N > limite), "Taxa de conclusão" (`—` se `null`), "No cemitério"; cards "Abertos" (com "ajustar"), "Próximo da fila" (↑ ↓ ✕ com `aria-label` "Subir", "Descer", "Tirar da fila"; 🔒 / "liberado"), "Cemitério" ("parado há N dias", "Arquivar sem culpa", nota sobre retomar no Kindle). Datas com `fmtDate` de `web/src/format.ts`; horas com `fmtHours`. Toda mutação: `disabled` enquanto `isPending`, e `onSuccess` invalida `['dashboard']` e `['books']`.

- [ ] **Step 3: Implementar os botões no `BookPage`.** "Pôr na fila"/"Tirar da fila" lê a fila do cache de `['dashboard', anoAtual]` (ou busca `getDashboard(ano)` se ausente) e chama `putFila`. "Arquivar"/"Desarquivar" só quando `book.status !== 'lido'`; chama `patchBook(md5, { arquivado: !book.arquivado })` e aplica o mesmo `onSuccess` do `EditForm`.

- [ ] **Step 4: Verificar** — `rtk npm run typecheck` → sem erros; `rtk npm run build -w web` → build ok; `rtk npm test` → tudo PASS.

- [ ] **Step 5: Verificar no navegador** — `rtk npm run dev`, abrir `http://localhost:5173`, conferir: os três cards aparecem; ↑/↓/✕ reordenam e a ordem persiste após recarregar; "ajustar" muda o limite e o "Abertos N/limite"; arquivar na página do livro mostra o selo "arquivado" na lista; layout sem rolagem horizontal em 375 px.

- [ ] **Step 6: Commit** — `feat(web): focus panel, queue controls and archive button` com `Refs #3` e o `Co-Authored-By`.
