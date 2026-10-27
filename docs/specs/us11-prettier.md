---
id: us11
card: —
mapa: docs/HISTORIAS.md
depende_de: US3 (PR #4, mergeada)
titulo: Formatação automática com Prettier
status: em-andamento
modo: direto
criada_em: 2026-10-27
implementada_em:
verificada_em: 2026-10-27
branch: us11-prettier
merge_request:
---

# US11 — Formatação automática com Prettier

## História
Como **time de desenvolvimento**, quero que o código seja formatado por uma ferramenta, com um estilo único, para que revisão e diff mostrem só mudança de comportamento, e não idas e vindas de formatação (como o `refactor(us3): volta ao estilo de formatação do projeto`).

## Contexto
Hoje o estilo do código depende de quem escreve, ou do agente. Na US3, um commit inteiro (`1ccd5bc`) serviu só para desfazer uma formatação diferente da do projeto. Esta US técnica, pedida explicitamente, adiciona o Prettier com as convenções que o código já segue (aspas simples, ponto e vírgula, vírgula final), reformata o código existente num commit isolado e faz o `git blame` ignorar esse commit.

No mapa (`docs/HISTORIAS.md`), ela roda logo depois da US3 e antes da US4. O número 11 é só de cadastro; a ordem é a da tabela.

## Critérios de aceite
- [x] Dado o projeto, então existe `.prettierrc.json` com `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `arrowParens: "always"`, `endOfLine: "lf"` e `printWidth: 100`.
- [x] Dado `npm run format`, então o Prettier formata o projeto inteiro (`prettier --write .`) menos o que está no `.prettierignore`. Dado `npm run format:check`, então ele sai com código ≠ 0 se algum arquivo estiver fora do padrão, e com 0 na branch final.
- [x] Dado o `.prettierignore`, então ficam de fora `data/`, `graphify-out/`, `src/generated/`, `prisma/migrations/`, `package-lock.json` e `*.md`. TS/JS, JSON e YAML (ex.: `docker-compose.yml`) são formatados.
- [x] Dado o ESLint, então `eslint-config-prettier` entra por último no `eslint.config.js` e desliga as regras de estilo que brigam com o Prettier, e `npm run lint` passa.
- [x] Dado o código existente, então a reformatação vai num commit só, só com a saída de `npm run format` e mais nenhuma mudança, e o hash dele entra em `.git-blame-ignore-revs`.
- [x] Dado a reformatação, então `npm test` e `npm run typecheck` passam sem nenhuma mudança manual em teste, porque não há mudança de comportamento.
- [x] Dado o README, então a seção "Testes" lista `npm run format:check`, e há uma linha explicando `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Escopo
**Dentro:**
- `prettier` e `eslint-config-prettier` como devDependencies.
- `.prettierrc.json`, `.prettierignore`, scripts `format` e `format:check`.
- `eslint-config-prettier/flat` no `eslint.config.js`.
- Reformatação do código atual num commit isolado e `.git-blame-ignore-revs`.
- README: comando de checagem e configuração do blame.

**Fora** (fica para outra US do mapa ou fora do card):
- Hook de pre-commit (husky/lint-staged) → outra US
- CI com `format:check` → outra US
- Formatar os `*.md` → fora do card
- Configuração de editor (`.vscode/`, format on save) → fora do card

## Decisões e respostas do usuário
- P: Qual a abrangência do `npm run format`? Não existe pasta `tests/`, e o Prettier dá erro com um caminho que não casa com nada. → R: `prettier .` com `.prettierignore`. Entram também JSON e YAML: `package.json` e `tsconfig.json` já estão no padrão, e o `docker-compose.yml` troca 3 linhas de aspas duplas por simples no commit de reformatação. A pasta `tests/` entra sozinha quando for criada.
- P: Como o PR vai ser mergeado, já que squash ou rebase trocam o hash do `.git-blame-ignore-revs`? → R: Merge commit, como nos PRs #1 a #4.
- P: Mantém o `eslint-config-prettier`, se hoje nenhuma regra do ESLint briga com o Prettier? → R: Mantém, como proteção para regras de estilo futuras.
- P: Em que branch fica a mudança da US11 que estava sem commit em `docs/HISTORIAS.md`? → R: Em `us11-prettier`, criada a partir da main atualizada (`2b32b08`, com a US3). Ela entra no primeiro commit, junto com esta spec.

## Premissas

## Design técnico
- **`.prettierrc.json`:**

  ```json
  {
    "singleQuote": true,
    "semi": true,
    "trailingComma": "all",
    "arrowParens": "always",
    "endOfLine": "lf",
    "printWidth": 100
  }
  ```

  O `printWidth: 100` equilibra leitura e tokens: a 80, 137 linhas quebrariam e cada chamada viraria 3–5 linhas; a 120, as linhas ficam longas demais para diff lado a lado.
- **`.prettierignore`:** `data/`, `graphify-out/`, `src/generated/`, `prisma/migrations/`, `package-lock.json`, `*.md`. O `node_modules/` o Prettier já ignora sozinho. Arquivos sem parser (Dockerfile, `.env*`, `schema.prisma`) não são tocados pelo `prettier .`.
- **Scripts:** `"format": "prettier --write ."` e `"format:check": "prettier --check ."`.
- **ESLint:** `import prettier from 'eslint-config-prettier/flat';` como último item de `tseslint.config(...)`.
- **Dependências:** `npm i -D prettier@^3 eslint-config-prettier@^10`. Confira se a versão do `eslint-config-prettier` aceita o ESLint 10 (peer dependency); se não aceitar, pare e avise.
- **Blame:** o `.git-blame-ignore-revs` traz um comentário e o hash completo do commit de reformatação. O GitHub o lê sozinho; localmente, `git config blame.ignoreRevsFile .git-blame-ignore-revs`. O PR **tem que ser mergeado com merge commit**: squash ou rebase trocam o hash.
- Sem mudança em contrato de API, modelo de dados ou comportamento.

## Arquivos que a mudança toca
- `package.json` / `package-lock.json` — alterar: devDependencies e scripts `format` e `format:check` — config, não conta
- `.prettierrc.json` — criar — config, não conta
- `.prettierignore` — criar — config, não conta
- `eslint.config.js` — alterar: `eslint-config-prettier/flat` — config, não conta
- `.git-blame-ignore-revs` — criar: hash do commit de reformatação — config, não conta
- `README.md` — alterar: seção "Testes" e configuração do blame — doc, não conta
- `docs/HISTORIAS.md` — alterar: entrada da US11 (já feita, sem commit) — doc, não conta
- Reformatação (saída do `npm run format`, medida em 2026-10-27 na main `2b32b08`):
  - `scripts/build-dataset/fixtures.ts` — ~5 linhas
  - `scripts/build-dataset/index.ts` — ~7 linhas
  - `scripts/build-dataset/read-cnefe.ts` — ~2 linhas
  - `scripts/seed/index.ts` — ~27 linhas
  - `src/application/find-nearby-ceps.ts` — ~3 linhas
  - `src/config/env.ts` — ~1 linha
  - `src/infrastructure/db/prisma-cep-repository.ts` — ~1 linha
  - `src/presentation/http/nearby-ceps-route.ts` — ~5 linhas
  - `docker-compose.yml` — 3 linhas (config, não conta)
  - testes (não contam): `scripts/build-dataset/index.test.ts`, `src/application/errors.test.ts`, `src/application/find-nearby-ceps.test.ts`, `src/config/env.test.ts`, `src/presentation/http/errors.test.ts` — ~105 linhas

A lista da reformatação é a medida de hoje. A fonte de verdade é a saída do `npm run format`: se aparecer arquivo fora dela, ele entra no mesmo commit, sem edição manual.

## Limite de tamanho
- **Estimativa:** ~51 linhas de lógica (`bc_giross`), todas de reformatação; não há lógica nova.
- **Não contam:** testes, docs, config (`.prettierrc.json`, `.prettierignore`, `.git-blame-ignore-revs`, `eslint.config.js`, `docker-compose.yml`) e lockfile; nenhum arquivo gerado.
- **Medição**, em `bc_giross`, sobre os commits da branch:

  ```bash
  git diff --numstat main...HEAD | awk -F'\t' '
    $1 == "-" { next }                                                             # binário
    $3 ~ /(^|\/)(tests?|__tests__|__snapshots__|e2e|docs|migrations)\// { next }  # pastas de teste, doc e gerados
    $3 ~ /\.(test|spec|e2e-spec)\.|_test\.|(^|\/)test_|-contract-test\./ { next } # arquivos de teste
    $3 ~ /\.(md|mdx|json|ya?ml|toml|lock|snap|prisma)$/ { next }                   # docs, config e dados
    $3 ~ /(^|\/)(Dockerfile|\.dockerignore|\.env\.example|prisma\.config\.ts|eslint\.config\.js|\.prettierignore|\.git-blame-ignore-revs)$/ { next } # config
    { s += $1 } END { print s + 0 }'
  ```

## Triagem de implementação

| Métrica | Valor |
| --- | --- |
| Tarefas | 3 |
| Arquivos que a mudança toca | 7 de config/doc + ~14 reformatados |
| Linhas de lógica estimadas | ~51 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Não |
| Dependência nova | Sim (`prettier`, `eslint-config-prettier`, dev) |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven — são 3 tarefas e há dependência nova. O trabalho, porém, é mecânico, e o modo direto é uma escolha razoável no `/pato/implement`.

## Tarefas
- [x] 1. `chore(us11)`: spec + `docs/HISTORIAS.md`, `prettier` e `eslint-config-prettier` em devDependencies, `.prettierrc.json`, `.prettierignore`, scripts `format`/`format:check` e `eslint.config.js`. Sem reformatar nada. `npm run lint` passa.
- [x] 2. `style(us11)`: `npm run format` e commit só da saída dele. Antes do commit: `npm test`, `npm run typecheck`, `npm run lint` e `npm run format:check` passam.
- [x] 3. `chore(us11)`: `.git-blame-ignore-revs` com o hash completo do commit da tarefa 2 e README (seção "Testes" com `npm run format:check`, e a linha do `blame.ignoreRevsFile`).

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- Automatizados: `npm test`, `npm run typecheck`, `npm run lint` e `npm run format:check` passam na branch final.
- O commit de reformatação não altera nenhum teste à mão: `git show --stat <hash>` mostra só a saída do Prettier, e rodar `npm run format` de novo sobre ele não muda nada.
- Manual: com `git config blame.ignoreRevsFile .git-blame-ignore-revs`, o `git blame scripts/seed/index.ts` não mostra o commit de reformatação.
- Negativo: tirar o `;` de uma linha em `src/` faz o `npm run format:check` sair com código ≠ 0 (depois, desfazer).

## Verificação independente

Data: 2026-10-27. Verificador: subagente em contexto limpo, só reportou. Base: `main`.

**Veredito:** aprovada, sem achados Alta/Média.

| Critério | Veredito |
| --- | --- |
| `.prettierrc.json` com as 6 opções | Atendido |
| `format` / `format:check` (0 na branch, ≠ 0 com desvio, testado numa cópia) | Atendido |
| `.prettierignore` e formatação de TS/JS, JSON e YAML | Atendido |
| `eslint-config-prettier/flat` por último; `npm run lint` passa | Atendido |
| Reformatação em commit único (`59f2d5c`), só saída do Prettier, hash em `.git-blame-ignore-revs` | Atendido |
| `npm test` e `npm run typecheck` sem mudança manual em teste | Atendido |
| README com `format:check` e `blame.ignoreRevsFile` | Atendido |

- **Entregável:** sim, funciona só com esta branch (4 commits, todos da US11).
- **Linhas medidas:** 51 / 500 (`bc_giross`).
- **Suítes:** `npm test` 15 arquivos, 133 testes, 0 falhas; `typecheck`, `lint` e `format:check` sem erros.
- **Blame:** com `blame.ignoreRevsFile`, 0 linhas do `59f2d5c` em `scripts/seed/index.ts` (27 sem a config).
- **Achados:** Baixa — `status`, `implementada_em` e `merge_request` vazios na spec; esperado antes do `/pato/close-spec`.
- **Não verificado:** `npm ci` limpo (warning ERESOLVE), leitura do `.git-blame-ignore-revs` pelo GitHub, merge commit (depende do PR).
- **Decisão do usuário:** corrigir achados; o único é Baixa e se resolve no close-spec, sem correção de código.

## Registro de testes

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |

## Riscos e pontos em aberto
- Squash ou rebase no merge invalidam o `.git-blame-ignore-revs`. O PR precisa ser mergeado com merge commit.
- Branches abertas a partir da main antiga (ex.: `fix/compose-env`) vão ter conflito de formatação. A saída é rodar `npm run format` nelas depois do rebase.
- `eslint-config-prettier` com ESLint 10: confirmar a peer dependency na instalação.
