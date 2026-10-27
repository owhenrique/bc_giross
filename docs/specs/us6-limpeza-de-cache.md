---
id: us6
card: —
mapa: docs/HISTORIAS.md
depende_de: US4 (PR #6, mergeada)
titulo: Limpeza de cache protegida
status: pendente
modo: agent-driven
criada_em: 2026-10-27
implementada_em:
verificada_em:
branch: feat/us6-limpeza-de-cache
merge_request:
---

# US6 — Limpeza de cache protegida

## História
Como **operador da API**, quero limpar o cache manualmente, de forma protegida, para forçar dados atualizados sem reiniciar o serviço.

## Contexto
A US4 colocou no Redis o resultado (`result:<raio>:<cep>`, 7 d), o endereço da BrasilAPI (`address:<cep>`, 30 d / 1 h) e a US5 a coordenada do Nominatim (`geocode:<cep>`, 30 d / 1 h). Hoje o único jeito de invalidar é o seed, que apaga só `result:*`. Um endereço corrigido na BrasilAPI ou um CEP que passou a existir fica preso até o TTL vencer. Esta US dá ao operador dois endpoints protegidos por token (D21): um limpa todo o cache da API e o outro limpa só um CEP.

No mapa (`docs/HISTORIAS.md`), a US6 depende só da US4, que já está mergeada. A porta `Cache` já tem `deleteByPrefix`, que propaga erro e timeout, e o catálogo de erros da US8 já está pronto para receber os erros novos.

## Critérios de aceite
- [ ] Dado `CACHE_ADMIN_TOKEN` definido e o header `Authorization: Bearer <token>` correto, quando chamo `DELETE /cache`, então todas as chaves `result:*`, `address:*` e `geocode:*` são apagadas e a resposta é `204` sem corpo.
- [ ] Dado o mesmo cenário, então chaves fora desses prefixos (ex.: `outra:chave`) continuam no Redis.
- [ ] Dado token correto, quando chamo `DELETE /cache/04551000`, então `address:04551000`, `geocode:04551000` e `result:<SEARCH_RADIUS_KM>:04551000` são apagadas, as chaves de outros CEPs continuam lá e a resposta é `204` sem corpo.
- [ ] Dado `DELETE /cache/04551-000`, então o efeito é igual ao de `DELETE /cache/04551000`.
- [ ] Dado um CEP sem nada em cache, quando chamo `DELETE /cache/:cep` ou `DELETE /cache` com token correto, então `204` (idempotente).
- [ ] Dado token correto e `DELETE /cache/123`, então `400 CEP_INVALIDO`.
- [ ] Dado `CACHE_ADMIN_TOKEN` definido, quando chamo qualquer um dos dois endpoints sem `Authorization`, com header sem o esquema `Bearer ` ou com token errado, então `401` com `{ erro: { codigo: "NAO_AUTORIZADO", mensagem: "Token de acesso inválido ou ausente" } }`, header `WWW-Authenticate: Bearer` e nada é apagado.
- [ ] Dado token errado e `DELETE /cache/123`, então `401` (a autenticação vem antes da validação do CEP).
- [ ] Dado `CACHE_ADMIN_TOKEN` ausente ou vazio, quando chamo `DELETE /cache` ou `DELETE /cache/:cep`, com ou sem header, então `404 NAO_ENCONTRADO` genérico, igual ao de qualquer rota inexistente.
- [ ] Dado `CACHE_ADMIN_TOKEN` definido com menos de 12 caracteres, quando a API sobe, então o `loadEnv` falha e o processo sai com código ≠ 0.
- [ ] Dado o Redis fora do ar ou estourando o timeout durante a limpeza, quando chamo um dos endpoints com token correto, então `503` com `{ erro: { codigo: "CACHE_INDISPONIVEL", mensagem: "Não foi possível limpar o cache" } }`.
- [ ] Dado a comparação do token, então ela é feita em tempo constante (`crypto.timingSafeEqual` sobre digests de mesmo tamanho), e um token de tamanho diferente não lança exceção.
- [ ] Dado o catálogo de erros, então `cache_unavailable` tem entrada nele, e o teste existente do catálogo continua passando.
- [ ] O README documenta os dois endpoints, o token e os códigos de resposta, e o `docker-compose.yml` e o `.env.example` trazem `CACHE_ADMIN_TOKEN`.

## Escopo
**Dentro:**
- `DELETE /cache` e `DELETE /cache/:cep`, com autenticação Bearer e desligamento por env.
- `delete(keys)` na porta `Cache` (Redis e memória) e constantes de prefixo para `address:` e `geocode:`.
- Caso de uso `clearCache` em `application`, erro `CacheUnavailableError` e entrada no catálogo.
- `CACHE_ADMIN_TOKEN` no `loadEnv`, no compose e no `.env.example`. README e DECISOES.

**Fora** (fica para outra US do mapa ou fora do card):
- Invalidar o CEP limpo dentro das listas de vizinhos de outros CEPs. Essas listas continuam em cache até o TTL ou até um `DELETE /cache` → fora do card (documentado no README).
- Apagar `result:*:<cep>` de raios antigos. Com o raio atual na chave, essas entradas já são inalcançáveis e saem por TTL/LRU → fora do card.
- Rate limit dos endpoints de limpeza → US7.
- Documentação OpenAPI dos endpoints → US10.
- Contagem de chaves apagadas na resposta → fora do card.

## Decisões e respostas do usuário
- P: O que o `DELETE /cache` apaga? → R: só os prefixos da app (`result:`, `address:`, `geocode:`) via `deleteByPrefix`. `FLUSHDB` foi descartado porque zeraria chaves de outras features, como o contador do rate limit da US7, que vai usar o mesmo Redis.
- P: O que o `DELETE /cache/:cep` apaga? → R: as chaves do próprio CEP: `address:<cep>`, `geocode:<cep>` e `result:<raio atual>:<cep>`. As listas de outros CEPs que o contêm como vizinho ficam até o TTL.
- P: Qual a resposta de sucesso? → R: `204` sem corpo, idempotente.
- P: Redis fora do ar durante o DELETE? → R: `503 CACHE_INDISPONIVEL`, com um `AppError` novo (`cache_unavailable`) e uma linha no catálogo.
- P: Header ausente, malformado ou com token errado? → R: todos `401 NAO_AUTORIZADO`, com o mesmo corpo e `WWW-Authenticate: Bearer`.
- P: Sem `CACHE_ADMIN_TOKEN`, como fica o 404? → R: as rotas não são registradas e caem no `404 NAO_ENCONTRADO` genérico, sem revelar que existem.
- P: Ordem entre a autenticação e a validação do CEP? → R: autenticação primeiro. Sem token válido é sempre `401`.
- P: Tamanho mínimo do token? → R: 12 caracteres. Menos que isso faz o `loadEnv` falhar. Vazio ou ausente desliga os endpoints.

## Premissas
Nenhuma.

## Design técnico
- **Modelos de dados / migrações:** nenhum.
- **Porta `Cache`** (`src/application/cache.ts`):
  - novo `delete(keys: string[]): Promise<void>`, que lança erro como o `deleteByPrefix`, para o chamador saber que a limpeza falhou;
  - novas constantes `ADDRESS_KEY_PREFIX = 'address:'` e `GEOCODE_KEY_PREFIX = 'geocode:'`, usadas por `addressKey`/`geocodeKey`;
  - `CACHE_KEY_PREFIXES = [RESULT_KEY_PREFIX, ADDRESS_KEY_PREFIX, GEOCODE_KEY_PREFIX]`.
  - `RedisCache.delete` faz `UNLINK` com `withTimeout`, e lista vazia não chama o Redis. `InMemoryCache.delete` remove do `Map`.
- **Caso de uso** `clearCache(cache, { radiusKm })` (`src/application/clear-cache.ts`), que devolve `{ all(): Promise<void>, cep(input: string): Promise<void> }`:
  - `all` roda `deleteByPrefix` para cada prefixo de `CACHE_KEY_PREFIXES`, em sequência;
  - `cep` normaliza com `normalizeCep` (inválido → `InvalidCepError`) e chama `cache.delete([addressKey, geocodeKey, resultKey(radiusKm, cep)])`;
  - qualquer erro do cache vira `CacheUnavailableError` (`kind: 'cache_unavailable'`), com o erro original em `cause`. Falha no meio do `all` deixa parte apagada, e repetir a chamada é seguro.
- **Erros:** `cache_unavailable` em `APP_ERROR_KINDS` e `CacheUnavailableError` em `src/application/errors.ts`. No catálogo: `{ status: 503, codigo: 'CACHE_INDISPONIVEL', mensagem: 'Não foi possível limpar o cache' }`. Em `ErrorCode`: `CacheUnavailable: 'CACHE_INDISPONIVEL'` e `Unauthorized: 'NAO_AUTORIZADO'`.
- **Autenticação** (`src/presentation/http/bearer-auth.ts`), com `requireBearerToken(token): RequestHandler`:
  - lê `req.headers.authorization` e exige o prefixo `Bearer ` (o esquema é case-insensitive, como manda o RFC 6750);
  - compara `sha256(recebido)` com `sha256(esperado)` via `crypto.timingSafeEqual`. Os digests têm o mesmo tamanho, então o tamanho do token não vaza nem lança exceção;
  - quando falha, define `WWW-Authenticate: Bearer` e chama `sendError(res, 401, ErrorCode.Unauthorized, 'Token de acesso inválido ou ausente')`.
  - O 401 não vira `AppError`: é preocupação de HTTP e não há caso de uso por trás.
- **Rotas** (`src/presentation/http/cache-route.ts`), com `cacheRouter(clear, token)`:
  - `router.delete('/cache', requireBearerToken(token), ...)` → `await clear.all(); res.status(204).end()`;
  - `router.delete('/cache/:cep', requireBearerToken(token), ...)` → `await clear.cep(req.params.cep)` → 204.
  - A rota só mapeia HTTP; a lógica fica no caso de uso.
- **Composição** (`src/presentation/http/app.ts`): `AppDeps` ganha `cacheAdmin?: { clearCache: ReturnType<typeof clearCache>; token: string }`. O router só é registrado quando `cacheAdmin` existe. Sem ele, as rotas caem no `notFoundHandler`. `src/index.ts` monta o `cacheAdmin` quando `env.cacheAdminToken` está definido.
- **Configuração** (`src/config/env.ts`): `CACHE_ADMIN_TOKEN` opcional. String vazia vira `undefined` (o compose passa `${CACHE_ADMIN_TOKEN:-}`), e definido com menos de 12 caracteres falha. Exposto como `Env.cacheAdminToken?: string`. No `docker-compose.yml`, `CACHE_ADMIN_TOKEN: ${CACHE_ADMIN_TOKEN:-}`. No `.env.example`, a linha comentada com um exemplo.
- **Casos de borda:** um `:cep` com caracteres URL-encoded segue a validação normal do `normalizeCep`. `DELETE /cache/` com barra final cai na rota `/cache`, pelo comportamento padrão do Express. Logs: o `pino-http` já registra a requisição, mas o header `Authorization` não pode aparecer no log. Confira o `redact` do logger e, se faltar, acrescente `req.headers.authorization`.

## Arquivos que a mudança toca
- `src/application/cache.ts` — `delete` na interface, `ADDRESS_KEY_PREFIX`, `GEOCODE_KEY_PREFIX`, `CACHE_KEY_PREFIXES` — ~8 linhas
- `src/infrastructure/cache/redis-cache.ts` — `delete` em `RedisCache` (`unlink` já está em `RedisClientLike`) — ~5 linhas
- `src/infrastructure/cache/in-memory-cache.ts` — `delete` — ~4 linhas
- `src/application/clear-cache.ts` — criar: `clearCache` (`all`, `cep`) — ~30 linhas
- `src/application/errors.ts` — `cache_unavailable`, `CacheUnavailableError` — ~6 linhas
- `src/presentation/http/error-catalog.ts` — entrada `cache_unavailable` — ~5 linhas
- `src/presentation/http/errors.ts` — `ErrorCode.Unauthorized`, `ErrorCode.CacheUnavailable` — ~2 linhas
- `src/presentation/http/bearer-auth.ts` — criar: `requireBearerToken` — ~25 linhas
- `src/presentation/http/cache-route.ts` — criar: `cacheRouter` — ~20 linhas
- `src/presentation/http/app.ts` — `AppDeps.cacheAdmin`, registro condicional — ~5 linhas
- `src/config/env.ts` — `CACHE_ADMIN_TOKEN`, `Env.cacheAdminToken` — ~5 linhas
- `src/index.ts` — monta `clearCache` e `cacheAdmin` — ~6 linhas
- `src/infrastructure/logger.ts` — `redact` do header `authorization`, se ainda não houver — ~2 linhas
- Testes (não contam): `src/application/clear-cache.test.ts` (criar), `src/presentation/http/cache-route.test.ts` (criar, Supertest com `InMemoryCache`), `src/infrastructure/cache/in-memory-cache.test.ts`, `src/infrastructure/cache/redis-cache.test.ts`, `src/config/env.test.ts`
- Config/docs (não contam): `docker-compose.yml`, `.env.example`, `README.md`, `docs/DECISOES.md` (D21 cont.), `docs/HISTORIAS.md` (spec e decisões da US6)

## Limite de tamanho
A US inteira sai num PR, mergeável sozinho, com **até 500 linhas de lógica** adicionadas ou modificadas. Remoção não conta.

- **Estimativa:** ~123 linhas (bc_giross: ~123), soma da lista acima.
- **Não contam:** testes, documentação, configuração e dados, lockfiles, migrations e código gerado. Nenhum arquivo gerado nesta US (`src/generated/prisma` não muda).
- **Medição**, sobre os commits da branch:

  ```bash
  git diff --numstat main...HEAD | awk -F'\t' '
    $1 == "-" { next }                                                             # binário
    $3 ~ /(^|\/)(tests?|__tests__|__snapshots__|e2e|docs|migrations|generated)\// { next }
    $3 ~ /\.(test|spec|e2e-spec)\.|_test\.|(^|\/)test_|-contract-test\./ { next }
    $3 ~ /\.(md|mdx|json|ya?ml|toml|lock|snap)$/ { next }
    { s += $1 } END { print s + 0 }'
  ```

Passou de 500? Não divida em partes nem abra mais de um PR: reduza o escopo (os critérios cortados viram outra US no mapa) ou simplifique, decidindo com o usuário.

## Triagem de implementação
Preenchido no `/pato/spec`; o `/pato/implement` confirma o modo com o usuário antes de começar.

| Métrica | Valor |
| --- | --- |
| Tarefas | 4 |
| Arquivos que a mudança toca | 13 de código (+5 de teste, +5 de config/docs) |
| Linhas de lógica estimadas | ~123 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Sim (dois endpoints novos, aditivo) |
| Dependência nova | Não |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são 4 tarefas, 13 arquivos e contrato de API novo.

## Tarefas
Passos (commits) desta US. Todos entram no mesmo PR, e tarefa não é entregável.
- [x] 1. Porta `Cache`: `delete(keys)` em Redis e memória, constantes de prefixo, testes dos adapters.
- [x] 2. Caso de uso `clearCache` + `CacheUnavailableError` + entrada no catálogo + `ErrorCode`s, com `clear-cache.test.ts`.
- [x] 3. HTTP: `requireBearerToken`, `cacheRouter`, registro condicional no `createApp`, `CACHE_ADMIN_TOKEN` no `loadEnv` e no `index.ts`, redact do header no logger; `cache-route.test.ts` e `env.test.ts`.
- [x] 4. Config e docs: `docker-compose.yml`, `.env.example`, README (endpoints, token, códigos), DECISOES (D21 cont.) e HISTORIAS (US6).

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- **Unitários:**
  - `clearCache` com `InMemoryCache`: `all` apaga os 3 prefixos e mantém `outra:chave`; `cep` apaga as 3 chaves do CEP e mantém as dos outros; o CEP com hífen é normalizado; `123` lança `InvalidCepError`; um cache que lança erro vira `CacheUnavailableError`.
  - `RedisCache.delete` com o fake existente: chama `unlink`, lista vazia não chama, e erro ou timeout propagam.
  - `InMemoryCache.delete`.
  - `loadEnv`: token ausente ou vazio → `undefined`; 11 caracteres → falha; 12 → ok.
- **HTTP (Supertest, `cache-route.test.ts`):**
  - `204` nos dois endpoints, com os efeitos no cache;
  - `401` sem header, com `Basic xyz`, com token errado e com tamanho diferente, todos com `WWW-Authenticate` e sem apagar nada;
  - `401` em `/cache/123` com token errado;
  - `400` em `/cache/123` com token certo;
  - `404 NAO_ENCONTRADO` sem `cacheAdmin`;
  - `503 CACHE_INDISPONIVEL` com um cache que lança erro.
- **Suítes:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.
- **Manual:** com `docker compose up` e `CACHE_ADMIN_TOKEN` definido:
  1. chamar `GET /ceps-proximos/04551000/detalhes` e conferir as chaves com `redis-cli KEYS '*'`;
  2. rodar `curl -X DELETE -H "Authorization: Bearer $TOKEN" localhost:3000/cache/04551000` → `204` e as chaves somem;
  3. repetir sem o token → `401`;
  4. `docker compose stop redis` e repetir com o token → `503`.

## Verificação independente
Preenchido no `/pato/verify`; o `/pato/close-spec` não começa sem esta seção.

- **Data:**
- **Verificador:**
- **Suítes rodadas:**
- **Critérios de aceite:**
- **Entregável:**
- **Linhas de lógica:**
- **Achados:**
- **Decisão do usuário:**

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |

## Riscos e pontos em aberto
- **Listas de vizinhos desatualizadas:** depois de um `DELETE /cache/:cep`, os resultados em cache de outros CEPs ainda podem listar o CEP limpo. Para invalidar tudo de uma vez existe o `DELETE /cache`. Fica documentado no README.
- **`DELETE /cache` sobre a base inteira:** SCAN + UNLINK sobre muitas chaves pode levar mais que o timeout do cliente HTTP. O timeout de 500 ms vale por passo (por página do SCAN), não pela varredura toda, então ele não estoura no meio. Uma falha no meio deixa a limpeza parcial (`503`), e repetir a chamada é seguro.
- **Token em log:** confira se o `pino-http` não registra o header `Authorization` (tarefa 3).
