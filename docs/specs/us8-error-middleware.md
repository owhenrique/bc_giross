---
id: us8
card: —
mapa: docs/HISTORIAS.md
depende_de: US2 (PR #2, mergeada)
titulo: Error middleware com catálogo de erros
status: implementado
modo: agent-driven
criada_em: 2026-10-27
implementada_em: 2026-10-27
verificada_em: 2026-10-27
branch: feat/us8-error-middleware
merge_request: https://github.com/owhenrique/bc_giross/pull/3
---

# US8 — Error middleware com catálogo de erros

## História
Como **time de desenvolvimento**, quero que os erros de negócio sejam traduzidos para HTTP num único middleware, a partir de um catálogo, para que um erro novo custe uma classe e uma linha no catálogo, e não um `case` em cada rota.

## Contexto
Esta US define como os erros de negócio chegam ao HTTP: o caso de uso lança um `AppError` tipado, e um único error middleware o traduz pelo catálogo. Assim, um erro novo custa uma classe e uma linha no catálogo, sem tocar nas rotas.

US técnica, pedida explicitamente. Não muda o contrato. Ela cobre os erros que existem depois da US2; os erros de negócio das US3 a US7 já nascem como `AppError` mais uma linha no catálogo.

Decisões que valem aqui: D26, D27, D28.

## Critérios de aceite
- [x] 1. Dado um CEP inválido, paginação inválida ou CEP inexistente, quando o caso de uso roda, então ele lança `InvalidCepError` (`invalid_cep`), `InvalidPageError` (`invalid_page`), `InvalidLimitError` (`invalid_limit`) ou `CepNotFoundError` (`cep_not_found`), todas subclasses de `AppError` com `kind` estável em inglês.
- [x] 2. Dado um `AppError`, quando chega ao error middleware, então a resposta sai do catálogo em `presentation` (`kind → { status, codigo, mensagem }`) no formato `{ erro: { codigo, mensagem } }`.
- [x] 3. Dado um erro que não é `AppError`, ou um `kind` fora do catálogo, então `500 ERRO_INTERNO`, com log do erro e sem stack na resposta.
- [x] 4. Dado um erro da pilha com `status` 4xx que não é `AppError` (ex.: JSON malformado), então continua `400 PARAMETRO_INVALIDO` / `Requisição inválida`.
- [x] 5. Dado as rotas, então nenhuma tem `switch`/`if` de status de erro: a rota chama o caso de uso e devolve `toResponse(resultado)`; a rejeição vai ao middleware pelo Express 5.
- [x] 6. Dado o catálogo, então um teste garante que todo `kind` de `AppError` tem entrada nele (erro novo sem entrada quebra o teste e o typecheck, não a produção).
- [x] 7. Dado os testes HTTP existentes de `app.test.ts`, então passam sem alterar nenhuma asserção de corpo ou de status.

## Escopo
**Dentro:**
- `AppError` e as quatro subclasses em `application`.
- Catálogo e error middleware em `presentation`.
- `findNearbyCeps` retorna só o sucesso e lança os erros; a rota devolve o resultado traduzido.

**Fora** (fica para outra US do mapa ou fora do card):
- Erros de endereço/cobertura da US3 e de cache da US6 → cada uma usa `AppError` + catálogo. O `401` do token da US6 e o `429` do rate limit da US7 são da borda HTTP e não viram `AppError`.
- Mudar qualquer resposta de erro ou o formato `{ erro: { codigo, mensagem } }` → fora do card.

## Decisões e respostas do usuário
- P: Quais erros a US8 cobre? → R: Os da US2; os erros de negócio das US3–US7 nascem usando `AppError` + catálogo. No mapa, a US8 depende só da US2 (~100 linhas).
- P: Paginação tem duas mensagens com o mesmo código → R: dois kinds, `invalid_page` e `invalid_limit`, cada um com entrada no catálogo.
- P: 4xx da pilha (`err.status` 4xx, não `AppError`) → R: manter o ramo atual no middleware, comportamento idêntico (`app.test.ts`, "maps any 4xx error raised by the stack").
- P: Onde ficam `AppError` e as subclasses? → R: `src/application/errors.ts`; o domínio fica sem erros por ora.
- Pedido do usuário (mapa): erros esperados como exceção tipada.

## Premissas
Nenhuma.

## Design técnico
- **`src/application/errors.ts`:** `APP_ERROR_KINDS` (tupla `as const`), `type AppErrorKind`, `abstract class AppError extends Error` com `abstract readonly kind: AppErrorKind`, e uma subclasse por `kind`. Não conhece HTTP.
- **`src/presentation/http/error-catalog.ts`:** `ERROR_CATALOG: Record<AppErrorKind, { status; codigo; mensagem }>`. É o único lugar com status HTTP de erro de negócio:

  | kind | status | codigo | mensagem |
  | --- | --- | --- | --- |
  | `invalid_cep` | 400 | `CEP_INVALIDO` | `CEP inválido` |
  | `invalid_page` | 400 | `PARAMETRO_INVALIDO` | `pagina deve ser um inteiro maior ou igual a 1` |
  | `invalid_limit` | 400 | `PARAMETRO_INVALIDO` | `limite deve ser um inteiro entre 1 e 200` |
  | `cep_not_found` | 404 | `CEP_NAO_ENCONTRADO` | `CEP não encontrado` |

- **`errorHandler`:** (1) `err instanceof AppError` com entrada no catálogo → `sendError` com os dados dela; (2) `err.status` 4xx → `400 PARAMETRO_INVALIDO`; (3) senão `req.log.error({ err })` e `500 ERRO_INTERNO`. `AppError` sem entrada no catálogo cai no 3 (com log).
- **`findNearbyCeps`:** retorna o resultado de sucesso, que o `toResponse` recebe direto; os outros desfechos são `AppError`.
- **Rota:** `res.json(toResponse(await find(...)))`. As mensagens de paginação ficam no catálogo.
- Sem migração, sem dependência nova, sem mudança de contrato.

## Arquivos que a mudança toca
- `src/application/errors.ts` — criar: `APP_ERROR_KINDS`, `AppErrorKind`, `AppError`, `InvalidCepError`, `InvalidPageError`, `InvalidLimitError`, `CepNotFoundError` — ~25 linhas
- `src/application/find-nearby-ceps.ts` — alterar: lança os erros e retorna só o sucesso — ~15 linhas
- `src/presentation/http/error-catalog.ts` — criar: `ERROR_CATALOG` — ~25 linhas
- `src/presentation/http/errors.ts` — alterar: `errorHandler` consulta o catálogo — ~25 linhas
- `src/presentation/http/nearby-ceps-route.ts` — alterar: sem tratamento de erro, com `toResponse` sobre o resultado de sucesso — ~10 linhas
- `src/application/find-nearby-ceps.test.ts` — alterar: `rejects.toThrow`/`toBeInstanceOf` (teste, não conta)
- `src/application/errors.test.ts` — criar: `kind` de cada subclasse (teste, não conta)
- `src/presentation/http/error-catalog.test.ts` — criar: todo `APP_ERROR_KINDS` tem entrada (teste, não conta)
- `src/presentation/http/app.test.ts` — sem mudar asserts de corpo/status (teste, não conta)

## Limite de tamanho
- **Estimativa:** ~100 linhas de lógica (`bc_giross`), soma da lista acima.
- **Não contam:** testes, docs, config, lockfile; nenhum arquivo gerado.
- **Medição**, em `bc_giross`, sobre os commits da branch:

  ```bash
  git diff --numstat main...HEAD | awk -F'\t' '
    $1 == "-" { next }                                                             # binário
    $3 ~ /(^|\/)(tests?|__tests__|__snapshots__|e2e|docs|migrations)\// { next }  # pastas de teste, doc e gerados
    $3 ~ /\.(test|spec|e2e-spec)\.|_test\.|(^|\/)test_|-contract-test\./ { next } # arquivos de teste
    $3 ~ /\.(md|mdx|json|ya?ml|toml|lock|snap|prisma)$/ { next }                   # docs, config e dados
    $3 ~ /(^|\/)(Dockerfile|\.dockerignore|\.env\.example|prisma\.config\.ts|eslint\.config\.js)$/ { next } # config
    { s += $1 } END { print s + 0 }'
  ```

  Enquanto a US2 não for mergeada, a base da medição é a branch da US2 (`feat/us2-ceps-proximos`), não `main`.

## Triagem de implementação

| Métrica | Valor |
| --- | --- |
| Tarefas | 4 |
| Arquivos que a mudança toca | 5 de lógica + 4 de teste |
| Linhas de lógica estimadas | ~100 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Não |
| Dependência nova | Não |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven — 4 tarefas e 5 arquivos de lógica, acima do limite do modo direto (1 tarefa, ≤ 3 arquivos, ≤ 50 linhas).

## Tarefas
- [x] 1. `application/errors.ts`: `AppError`, `APP_ERROR_KINDS` e as quatro subclasses, com teste de `kind`.
- [x] 2. `error-catalog.ts` e `errorHandler` consultando o catálogo (AppError, 4xx da pilha, 500), com testes do catálogo e do middleware.
- [x] 3. `findNearbyCeps` lança os erros e retorna só o sucesso; a rota fica sem tratamento de erro; testes do caso de uso ajustados.
- [x] 4. Conferir `npm test`, `npm run lint`, `npm run typecheck`, `app.test.ts` sem alterar asserts de corpo/status, e a medição de linhas.

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- `npm test`, `npm run lint` e `npm run typecheck`.
- Casos novos: `errorHandler` com `AppError` de cada `kind`, `AppError` fora do catálogo → 500 com log, erro comum → 500 sem stack; catálogo cobre `APP_ERROR_KINDS`.
- Regressão: `app.test.ts` inalterado nas asserções.
- Manual: `curl` em `/ceps-proximos/123`, `/ceps-proximos/04551000?pagina=0`, `?limite=999` e um CEP inexistente; respostas idênticas às da US2.

## Verificação independente
Em 2026-10-27, subagente em contexto limpo, base `e4fc4e9` (merge do PR #2; `main` local estava desatualizada).

- **Suítes:** `npm test` 13 arquivos, 89 testes, 0 falhas; `npm run lint` e `npm run typecheck` sem erros. Sem curl real (sem Postgres); respostas cobertas por supertest em `app.test.ts`.
- **Critérios 1 a 7:** todos atendidos (evidência em `errors.ts`, `error-catalog.ts`, `nearby-ceps-route.ts` e testes; `app.test.ts` não foi tocado).
- **Entregável:** sim, funciona só com esta branch; 6 commits, todos da US8.
- **Linhas medidas:** 72 / 500 (`bc_giross`).
- **Achados:** nenhum Alta ou Média. Baixa: `find-nearby-ceps.test.ts` foi reformatado por inteiro (aspas e quebras), ruído no diff; `docs/HISTORIAS.md` alterado fora da lista, mas registrado em "Decisões".
- **Decisão do usuário:** aceitar como está.
- **Não verificado:** curl contra servidor real com Postgres.

## Registro de testes

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-27 | Automatizado | local | local | `npm test` (13 arquivos, 89 testes), `npm run lint`, `npm run typecheck` | Aprovado | — |
| 2026-10-27 | Verificação independente | subagente (contexto limpo) | local | diff contra a spec + suítes rodadas | Aprovado | seção "Verificação independente" |
| 2026-10-27 | Manual | Henrique | local | `curl` em `/ceps-proximos/123`, `?pagina=0`, `?limite=999` e CEP inexistente; respostas idênticas às da US2 | Aprovado | — |

## Riscos e pontos em aberto
- A US2 (PR #2) ainda não foi mergeada; a branch da US8 parte dela ou de `main` depois do merge. O `/pato/implement` só começa quando a base tiver a US2.
- A rota e o `toResponse` mudam: se a US3 já estiver em andamento em paralelo, haverá conflito nesses dois arquivos.
