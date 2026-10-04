# Livros: gestão e busca (design)

Issue: #8. Página própria `/livros` ("Livros" no menu) para achar, organizar e limpar a biblioteca.

## Objetivo

Hoje a lista de livros é um card no fim do painel, sem busca nem filtro, e um livro enviado pelo plugin
nunca sai do banco. Esta entrega traz:

1. Excluir um livro de vez, com uma lista de bloqueio (blacklist) para o plugin não trazê-lo de volta.
2. Buscar metadados (autores, páginas, ano, assuntos) no Open Library sob demanda.
3. Busca aproximada (fuzzy) e filtro por status na página `/livros`.
4. Lista "Ler mais tarde".

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde fica a blacklist | Tabela `blacklist` com md5, título, autores e data | Precisa sobreviver à exclusão do livro e mostrar algo legível para desfazer |
| Como o plugin é barrado | `POST /api/plugin/import` descarta em silêncio livros e estatísticas de md5 bloqueado, antes de importar | O plugin reenvia o histórico inteiro a cada sincronização; responder erro faria o plugin tentar de novo |
| Desfazer a exclusão | Remover o md5 da blacklist; o livro e o histórico voltam na próxima sincronização | O plugin é a fonte das leituras; o servidor não guarda cópia do que apagou |
| Capa ao excluir | O arquivo da capa é apagado (melhor esforço) | Não deixar lixo em `capas/`; se o livro voltar, a capa é buscada de novo |
| Confirmação | Confirmação em linha (botão vira "Excluir de vez?" + "Cancelar"), sem `window.confirm` | Funciona igual no celular e no teclado |
| Fonte dos metadados | Open Library `search.json`, a mesma de `covers.ts`, por título e primeiro autor | Sem chave de API, já usada no projeto |
| Busca de metadados | Só sob demanda (botão "Buscar metadados"), no servidor, timeout de 8 s; falha devolve 502 com mensagem | Nada de rede na importação; o navegador não fala com terceiros |
| Aplicar metadados | O usuário marca quais campos aplicar: autores, páginas, ano e assuntos (acrescentados aos tópicos, sem repetir linha) | O usuário decide; nada é sobrescrito sem escolha |
| Páginas já informadas pelo plugin | Podem ser substituídas pelo usuário (oferecidas quando diferem, mas só vêm marcadas quando o livro tem 0) | A contagem do KOReader varia com fonte e margem; o usuário pode preferir a da edição. A próxima sincronização com valor > 0 volta a mandar |
| Resposta do Open Library | Campos com formato inesperado são descartados (listas que não são arrays, números não inteiros ou ≤ 0); nunca viram 502 | Dado de terceiro não é confiável; resultado parcial ainda é útil |
| Autores e páginas x plugin | A importação deixa de apagar autores e páginas: valor vazio ou 0 vindo do plugin não sobrescreve o que já existe | Sem isso, o que foi aplicado sumiria na próxima sincronização. Valor não vazio do plugin continua mandando |
| Ano de publicação | Coluna nova `book.ano_publicacao`, do usuário, a importação não toca | Não existe no KOReader |
| "Ler mais tarde" x fila | Tabela própria `mais_tarde`, sem ordem e sem limite | A fila do foco é curta, ordenada e ligada ao limite de abertos; "ler mais tarde" é uma estante de desejos que não mexe no foco |
| Busca fuzzy | No cliente, sem dependência: acentos e caixa ignorados, cada palavra da busca precisa casar como subsequência em título, autores, série ou categoria; trecho contíguo e início de palavra pontuam mais; título vale mais que o resto | A lista inteira já vem do servidor; poucos livros |
| Filtro por status | Chips "Todos", "Lendo", "Lido", "Pausado", "Arquivado" + chip independente "Ler mais tarde" (E lógico) | "Arquivado" é visual (`book.arquivado`); os outros status mostram só livros não arquivados |

## Termos

- **Excluir**: apagar o livro, suas estatísticas de página, sua posição na fila e na lista "ler mais tarde",
  e guardar o md5 na blacklist.
- **Blacklist**: md5s que o servidor ignora na importação do plugin.
- **Ler mais tarde**: marcação de livros já no banco que você quer ler algum dia. Sem ordem.
- **Fila** (do foco, #3): os próximos livros, em ordem, liberados um a um conforme o limite de abertos.
  Um livro pode estar nas duas listas; elas não se influenciam.

## Dados

Migração 3, no fim de `MIGRATIONS` em `server/src/db.ts`:

```sql
CREATE TABLE blacklist (
  md5 TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  excluido_em TEXT NOT NULL -- YYYY-MM-DD no fuso configurado
);
CREATE TABLE mais_tarde (
  md5 TEXT PRIMARY KEY REFERENCES book(md5) ON DELETE CASCADE,
  adicionado_em TEXT NOT NULL
);
ALTER TABLE book ADD COLUMN ano_publicacao INTEGER; -- do usuário, NULL = desconhecido
```

A importação do plugin não toca em `blacklist`, `mais_tarde` nem `ano_publicacao`. `page_stat` e `fila` já
têm `ON DELETE CASCADE`, então excluir o livro leva junto as estatísticas, a fila e "ler mais tarde".

Mudança na importação (`importPluginData`): `authors` e `pages` só são sobrescritos quando o plugin manda
valor não vazio / maior que 0.

## API

Tudo em `server/src/livros.ts`, rotas no router `api` atrás de `requireSession`. Erros: 400 `{ error }`
em português, 404 para livro inexistente.

Tipos em `shared/src/index.ts`:

```ts
export type LivroItem = BookSummary & { maisTarde: boolean };
export type BlacklistEntry = { md5: string; title: string; authors: string; excluidoEm: string };
export type Livros = { books: LivroItem[]; blacklist: BlacklistEntry[] };
export type LivroExtras = { maisTarde: boolean; anoPublicacao: number | null };
export type Metadados = { titulo: string; autores: string; paginas: number | null; anoPublicacao: number | null; assuntos: string[] };
export type MetadadosPatch = Partial<{ authors: string; pages: number; anoPublicacao: number; assuntos: string[] }>;
```

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/livros` | | `Livros` (livros na ordem de `listBooks`, blacklist mais recente primeiro) |
| `GET /api/livros/:md5` | | `LivroExtras` |
| `PUT /api/livros/:md5/mais-tarde` | `{ maisTarde: boolean }` | `LivroExtras`; 400 se não for booleano |
| `DELETE /api/livros/:md5` | | `Livros`; livro some, md5 entra na blacklist |
| `DELETE /api/livros/blacklist/:md5` | | `Livros`; 404 se o md5 não está na blacklist |
| `GET /api/livros/:md5/metadados` | | `{ resultado: Metadados \| null }`; 502 `{ error }` se o Open Library falhar ou demorar |
| `POST /api/livros/:md5/metadados` | `MetadadosPatch` | `LivroExtras`; 400 para campo inválido |

Validação de `MetadadosPatch`: `authors` string não vazia; `pages` inteiro 1–100000; `anoPublicacao`
inteiro 1–9999; `assuntos` array de no máximo 50 strings de até 200 caracteres (vazias ignoradas; acima do limite é 400,
sem truncar). Corpo sem nenhum campo é 400.

`POST /api/plugin/import` responde 400 quando algum item de `books` ou `stats` não é objeto.

`createApp` ganha a opção `fetchFn` (padrão `fetch`) para os testes injetarem a resposta do Open Library.

No cliente, toda mutação invalida `['livros']`, `['books']`, `['dashboard']` e o livro afetado.

## Interface

### Página `/livros` (`web/src/pages/LivrosPage.tsx`)

- Campo de busca ("Buscar por título, autor, série…"), chips de status e o chip "Ler mais tarde", com a
  contagem "N de M livros".
- Lista no estilo de `BookList` (capa, título, autores, progresso, status), com selo "mais tarde".
- Card "Excluídos" (só quando há blacklist): título, data e botão "Desfazer", com a nota de que o livro
  volta na próxima sincronização do Kindle.

### Página do livro

- Botão "Ler mais tarde" / "Tirar de ler mais tarde".
- Ano de publicação, quando houver, junto da série.
- Card "Metadados": botão "Buscar metadados"; mostra o resultado com caixas de seleção por campo e
  "Aplicar selecionados". Sem resultado: "Nada encontrado no Open Library". Falha: mensagem de erro.
- Botão "Excluir livro" no fim; ao clicar vira "Excluir de vez?" + "Cancelar", com a explicação de que
  o plugin não vai reenviar o livro. Depois de excluir, volta para `/livros`.

### Outros

- Link "Livros" no menu. O link "← Voltar" da página do livro passa a ir para `/livros`.

## Testes

`server/test/livros.test.ts`, no estilo de `api.test.ts`:

- Excluir apaga livro, `page_stat`, fila e "ler mais tarde", e grava a blacklist; 404 para livro inexistente.
- Importar de novo um md5 bloqueado não traz livro nem estatísticas, inclusive num envio só de estatísticas;
  outros livros do mesmo envio entram. Itens que não são objetos dão 400.
- Remover da blacklist faz o livro voltar na importação seguinte; 404 para md5 fora da blacklist.
- "Ler mais tarde" liga e desliga, aparece em `GET /api/livros`, recusa corpo inválido e sobrevive à importação.
- Metadados: com `fetch` simulado, devolve autores, páginas, ano e assuntos; resposta com formato estranho
  devolve só os campos válidos; sem resultado devolve `null`; erro de rede devolve 502.
- Aplicar metadados grava autores, páginas, ano e acrescenta assuntos aos tópicos sem repetir; recusa
  corpo inválido (incluindo mais de 50 assuntos ou assunto com mais de 200 caracteres); páginas substituem
  um valor já informado pelo plugin; a importação seguinte com autores vazios e 0 páginas não apaga o que foi aplicado.
- Busca fuzzy (`web/src/fuzzy.ts`, função pura testada pelo vitest do servidor): ignora acento e caixa,
  aceita subsequência, prefere trecho contíguo e título.

## Fora de escopo

- **Resumo por LLM** do que aprender com as páginas já lidas (último item da issue #8): decidido não fazer.
- Livros que ainda não existem no banco (planejados), busca no servidor, ordenação manual de "ler mais
  tarde", troca de capa a partir dos metadados e busca automática de metadados na importação.
