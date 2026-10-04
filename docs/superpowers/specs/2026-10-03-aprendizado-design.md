# Aprendizado visível: design

Issue: #5. Bloco da gamificação que ataca a dor de "não sinto que estou aprendendo nada": transforma leitura em
notas, revisões, áreas e trilhas visíveis numa página própria, `/aprendizado`.

## Objetivo

Mostrar o que você aprendeu, não só quantas páginas passaram: um diário de aprendizados por livro com revisão
espaçada, a ferrugem de cada área, uma árvore de habilidades da computação, trilhas com objetivo, as lacunas em
relação a uma lista base (ACM CS2013) e um mapa de tópicos pesado pelos minutos lidos.

Tudo é calculado no servidor a partir dos livros, das leituras e de poucas tabelas novas. Árvore, trilhas e lista
base são constantes de código num único arquivo, `server/src/aprendizado-dados.ts`, fácil de editar depois.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde mora o bloco | Página nova `/aprendizado` + card "O que aprendi" na página do livro | O painel já está cheio; o livro é onde a nota nasce |
| Formato do aprendizado | Texto livre, várias notas por livro, sem título | Uma frase basta; menos atrito |
| Intervalos da revisão | 1, 3, 7, 14, 30, 60, 120 dias | Sequência clássica, crescente, sem configuração |
| "Lembrei" / "Esqueci" | Lembrei avança uma etapa (para na última); esqueci volta à etapa 0 | Leitner simplificado, fácil de explicar |
| Área da ferrugem | `book.categoria` (texto livre, já do usuário) | Pedido da issue; não exige mapeamento novo |
| Fórmula da ferrugem | 0% até 7 dias sem atividade, 100% a partir de 90, linear no meio | Simples, documentada, testável |
| Nó da árvore do livro | Coluna nova `book.area` (id de um nó), separada de `categoria` | `categoria` é texto livre; a árvore precisa de ids fixos |
| Árvore, trilhas e base | Constantes em `aprendizado-dados.ts`, não editáveis pela interface na v1 | Pedido da issue; sem tela de administração |
| Nível do nó | Pontos = horas lidas + 5 × livros lidos; níveis em 1, 5, 15, 30, 60 pontos (0 a 5) | Mistura tempo e conclusão, como pede a issue |
| Item de trilha feito | Algum livro marcado nele está `lido` | O que vem do Kindle manda; marcar não basta |
| Lacuna | Área base sem minutos em livros cujo nó da árvore a cobre | A ponte árvore → ACM fica nas constantes |
| Tópicos | `book.topicos` separado por vírgula ou quebra de linha, agrupado sem diferenciar maiúsculas | Campo que já existe |
| Visual do mapa de tópicos | Nuvem de tags com tamanho proporcional aos minutos | Sem dependência nova; cabe no celular |
| Rotas | Todas sob `/api/aprendizado`; `GET /api/dashboard` e `PATCH /api/books` intactos | Isolamento dos outros blocos |

## Termos

- **Aprendizado** (nota): frase livre sobre um livro, com data de criação e agenda de revisão.
- **Etapa**: índice da nota na lista de intervalos; define a próxima revisão.
- **Revisar hoje**: notas com `proximaRevisao <= hoje`.
- **Ferrugem**: quanto uma categoria está esquecida, de 0 a 100%.
- **Árvore**: áreas da computação (raízes) com subnós (filhos); um livro aponta para um nó.
- **Trilha**: objetivo com itens ordenados; cada item recebe livros marcados por você.
- **Lista base**: subconjunto das áreas de conhecimento do ACM CS2013.

## Dados

Migração 3, adicionada ao fim de `MIGRATIONS` em `server/src/db.ts`:

```sql
ALTER TABLE book ADD COLUMN area TEXT; -- id de nó da árvore, NULL = sem nó
CREATE TABLE aprendizado (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  md5 TEXT NOT NULL REFERENCES book(md5) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL,        -- YYYY-MM-DD
  etapa INTEGER NOT NULL DEFAULT 0,
  proxima_revisao TEXT NOT NULL,  -- YYYY-MM-DD
  revisado_em TEXT                -- YYYY-MM-DD da última revisão
);
CREATE TABLE trilha_livro (
  trilha TEXT NOT NULL,
  item TEXT NOT NULL,
  md5 TEXT NOT NULL REFERENCES book(md5) ON DELETE CASCADE,
  PRIMARY KEY (trilha, item, md5)
);
```

A importação do plugin não toca em `area`, `aprendizado` nem `trilha_livro`. Nenhuma configuração nova.

### Valores calculados (nada disso é guardado)

- **Revisão**: ao criar, etapa 0 e `proximaRevisao = hoje + 1`. Lembrei: `etapa = min(etapa + 1, 6)`;
  esqueci: `etapa = 0`. Em ambos `proximaRevisao = hoje + INTERVALOS[etapa]` e `revisadoEm = hoje`.
- **Ferrugem** por categoria não vazia: `ultimaAtividade` = maior data entre `lastReadAt` dos livros da categoria
  e `revisadoEm` das notas desses livros. `dias = hoje − ultimaAtividade`.
  `ferrugem = 0` se `dias <= 7`; `100` se `dias >= 90`; senão `round((dias − 7) / 83 × 100)`.
  Categorias sem nenhuma atividade ficam de fora. Ordem: mais enferrujada primeiro.
- **Árvore**: para cada nó, `minutos` = soma de `totalMinutes` e `livrosLidos` = livros `lido` com `area` no nó.
  A raiz soma os próprios livros e os dos filhos. `pontos = minutos / 60 + 5 × livrosLidos`;
  `nivel` = quantos limites de `[1, 5, 15, 30, 60]` os pontos alcançam.
- **Trilha**: item `feito` se algum livro marcado está `lido`, `andamento` se tem livro marcado mas nenhum lido,
  `vazio` sem livros. `progresso = round(feitos / itens × 100)`.
- **Lacunas**: para cada área base, `minutos` = soma de `totalMinutes` dos livros cujo nó (ou a raiz do nó)
  lista a área em `acm`. `coberta = minutos > 0`.
- **Tópicos**: por livro, tópicos sem repetição; peso = soma de `totalMinutes` dos livros com o tópico.
  Ordem: mais minutos primeiro, depois alfabética.

## API

Rotas no router `api`, atrás de `requireSession`. Entrada validada à mão; 400 `{ error }` em português,
404 para livro, nota, trilha ou item inexistente.

Tipos em `shared/src/index.ts` (seção `// ---- aprendizado ----`): `Nota`, `NoArvore`, `TrilhaProgresso`,
`Aprendizado`, `LivroAprendizado`.

1. **`GET /api/aprendizado`** → `Aprendizado`: `hoje`, `notas` (diário, mais recentes primeiro), `revisarHoje`
   (mais atrasada primeiro), `ferrugem`, `arvore`, `trilhas`, `lacunas`, `topicos`.
2. **`GET /api/aprendizado/livros/:md5`** → `LivroAprendizado` `{ area, notas }`. 404 se o livro não existe.
3. **`PUT /api/aprendizado/livros/:md5/area`** com `{ area: string | null }`. 400 se não for id de nó conhecido.
   Resposta: `LivroAprendizado`.
4. **`POST /api/aprendizado/notas`** com `{ md5, texto }`. Texto aparado, 1 a 2000 caracteres. 201 com a `Nota`.
5. **`DELETE /api/aprendizado/notas/:id`** → 204.
6. **`POST /api/aprendizado/notas/:id/revisao`** com `{ lembrei: boolean }` → `Nota` atualizada.
7. **`PUT /api/aprendizado/trilhas/:trilha/itens/:item`** com `{ md5s: string[] }`: substitui os livros do item.
   400 para corpo inválido, md5 repetido ou desconhecido. Resposta: `TrilhaProgresso`.

No cliente, toda mutação invalida `['aprendizado']` e `['aprendizado-livro']`.

## Interface

Sem dependência nova. Reaproveita `Card`, `Stat`, `ProgressBar`, `fmtDate`, `fmtHours`.

### Página `/aprendizado` (link "Aprendizado" no menu)

1. **Linha de `Stat`**: "Para revisar hoje", "Aprendizados" (total), "Nós com nível" (nós com nível ≥ 1).
2. **Revisar hoje**: cartões com o texto, o livro e os botões "Lembrei" e "Esqueci". Vazio: "Nada para revisar hoje."
3. **Novo aprendizado**: seletor de livro (lidos primeiro) + campo de texto + "Salvar".
4. **Diário**: notas agrupadas por data, com livro, próxima revisão e botão ✕ (`aria-label`).
5. **Enferrujamento**: barra por categoria com "N dias sem tocar".
6. **Árvore de habilidades**: grade de áreas com nível (0–5), horas e livros; filhos listados abaixo.
7. **Trilhas**: barra de progresso por trilha; itens com estado e livros marcados; "editar" abre, no item,
   a lista de livros com ✕ e um seletor "adicionar livro".
8. **Lacunas (ACM CS2013)**: áreas sem leitura em destaque; as cobertas em lista menor, com horas.
9. **Mapa de tópicos**: nuvem com tamanho proporcional aos minutos; título com horas no `title`.

### Página do livro

Card "O que aprendi": seletor do nó da árvore, notas do livro com ✕ e campo para nova nota. Quando o livro está
`lido`, o card abre com o convite "Terminou! O que ficou deste livro?".

## Testes

Em `server/test/aprendizado.test.ts`, com `now` fixo e TZ `America/Fortaleza`, e casos de rota em `api.test.ts`:

- Nota nova entra no diário e vence amanhã; "lembrei" avança 1 → 3 → … → 120 e para; "esqueci" volta a 1 dia.
- Revisar hoje inclui só notas vencidas, mais atrasada primeiro.
- Ferrugem: 7 dias = 0%, 90 dias = 100%, meio linear; revisão de nota renova a área; categoria vazia fica de fora.
- Árvore: minutos e livros lidos somam no nó e na raiz; nível segue os limites.
- Trilha: estados vazio/andamento/feito e progresso.
- Lacunas: área base coberta só com minutos em livro de nó que a cobre.
- Tópicos: separa por vírgula e linha, agrupa sem caixa, soma minutos.
- Rotas: validação de nota, área, revisão e trilha; 404 para livro/nota/trilha inexistentes; sessão obrigatória;
  a importação do plugin não altera `area`, notas nem trilhas.

## Fora de escopo

Editar o texto de uma nota (apaga e cria de novo), editar árvore/trilhas/base pela interface, XP e medalhas
(blocos #4 a #8), notificações de revisão, importar destaques do KOReader como notas.
