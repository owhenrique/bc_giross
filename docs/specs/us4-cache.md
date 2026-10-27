---
id: us4
card: —
mapa: docs/HISTORIAS.md
depende_de: US3 (PR #4, mergeada) e US11 (PR #5, mergeada)
titulo: Cache
status: em-andamento
modo: agent-driven
criada_em: 2026-10-27
implementada_em:
verificada_em:
branch: feat/us4-cache
merge_request:
---

# US4 — Cache

## História
Como **Giross**, quero respostas rápidas para CEPs já consultados, para não esperar nem depender do banco e das APIs externas a cada chamada.

## Contexto
Hoje cada chamada a `GET /ceps-proximos/:cep` e a `/detalhes` faz o mesmo trabalho do zero. O `findNearbyCeps` (`src/application/find-nearby-ceps.ts`) consulta o Postgres (`findByCep` + `findInBox`), calcula o Haversine de cada candidato e ordena a lista. No `/detalhes`, ou com o CEP fora da base, também chama a BrasilAPI, limitada a 5 req/s (D22). Esta US põe um cache Redis na frente das duas coisas, como definem a D17, a D19 e a D20. No mapa (`docs/HISTORIAS.md`), ela vem depois da US3 e da US11. A US5 (Nominatim) e a US6 (limpeza manual) dependem dela.

## Critérios de aceite
- [x] 1. Dado um CEP na base já consultado (em `/ceps-proximos/:cep` ou em `/detalhes`), quando consulto de novo dentro do TTL de resultado, então a resposta é idêntica à primeira e nem o banco nem a BrasilAPI são chamados. No `/detalhes`, o endereço vem do cache de endereço.
- [x] 2. Dado o resultado de um CEP em cache, quando peço outra `pagina` ou outro `limite`, então a página sai da lista em cache, com `total` e `total_paginas` corretos, sem ir ao banco.
- [x] 3. Dado um lookup da BrasilAPI com `found`, então ele fica em cache por `CACHE_TTL_ADDRESS_SECONDS` (padrão 30 d). Com `not_found`, fica por `CACHE_TTL_NOT_FOUND_SECONDS` (padrão 1 h). Com `unavailable`, não entra no cache, e a chamada seguinte tenta a BrasilAPI de novo.
- [x] 4. Dado um CEP fora da base consultado de novo dentro do TTL do lookup, então a BrasilAPI não é chamada e a resposta (`404 CEP_NAO_ENCONTRADO`, `422 CEP_FORA_DA_COBERTURA` ou `422 CEP_SEM_GEOLOCALIZACAO`) sai igual. O banco continua sendo consultado.
- [x] 5. Dado `CACHE_TTL_RESULT_SECONDS` (padrão 7 d) e os outros dois TTLs, então os valores vêm do ambiente (inteiros positivos em segundos), com os padrões da D20. Dado `REDIS_URL` ausente, então nem a API nem o seed sobem (erro de ambiente, código ≠ 0).
- [x] 6. Dado o Redis fora do ar (na subida ou durante a execução), então as consultas respondem normalmente, só sem cache, e cada falha vira log `warn`. Uma operação de cache que trava não segura a requisição por mais de 500 ms. Quando o Redis volta, o cache volta a funcionar sem reiniciar a API.
- [x] 7. Dado o seed, quando a carga termina, então todas as chaves de resultado são apagadas e as de endereço ficam. Dado o Redis inacessível, então o seed sai com código ≠ 0 antes de mexer no banco. Se a limpeza falhar depois do `COMMIT`, ele também sai com código ≠ 0 e avisa que a base foi carregada mas o cache não foi limpo.
- [x] 8. Dado o `docker compose up`, então sobe um serviço `redis` com `maxmemory` e `maxmemory-policy allkeys-lru`, com healthcheck. A `api` e o `seed` recebem `REDIS_URL` e só sobem com o Redis saudável.
- [x] 9. Dado um CEP fora da base com UF existente (caminho `422`), quando a API decide entre `CEP_FORA_DA_COBERTURA` e `CEP_SEM_GEOLOCALIZACAO`, então as UFs carregadas vêm da tabela `loaded_uf` (no máximo 27 linhas), sem ler a tabela `cep`. Dado o seed, então ele grava em `loaded_uf` as UFs que carregou, na mesma transação da carga dos CEPs.

## Escopo
**Dentro:**
- Porta `Cache` em `application`, com duas implementações: `RedisCache` (produção) e `InMemoryCache` (testes).
- Cache do resultado (origem + lista inteira de vizinhos ordenada) dentro do `findNearbyCeps`.
- Cache do lookup de endereço como decorator do `CepAddressProvider`.
- Variáveis `REDIS_URL` e as três de TTL, mais o serviço `redis` no compose.
- Limpeza dos resultados no seed.
- Tabela `loaded_uf`, preenchida pelo seed e lida pelo `findLoadedUfs`, no lugar do `distinct` sobre `cep`.
- README e `DECISOES.md` atualizados.

**Fora** (fica para outra US do mapa ou fora do card):
- `DELETE /cache` e `DELETE /cache/:cep` → US6
- Cache do Nominatim (30 d) → US5
- Componente `cache` no `/saude` → US9
- Header `X-Cache` ou qualquer outra mudança de contrato → fora do card

## Decisões e respostas do usuário
- P: Redis fora do ar → R: a API **degrada**: erro de cache vira log e miss, e a consulta segue no banco e na BrasilAPI. Isso bate com o `/saude` da US9, que mostra o Redis fora como "degradado".
- P: Sem `REDIS_URL` → R: a variável é **obrigatória**. O `loadEnv` falha sem ela. O `InMemoryCache` só é usado nos testes.
- P: CEP fora da base (404/422): o que entra no cache? → R: **só o lookup da BrasilAPI** (`found` 30 d, `not_found` 1 h). O desfecho (o erro) não entra, e a repetição ainda consulta o banco.
- P: O seed não consegue falar com o Redis → R: **o seed falha** (código ≠ 0).
- P: Qual cliente Redis? → R: **`redis` (node-redis v5)**.
- P: Formato dos TTLs → R: **segundos**: `CACHE_TTL_ADDRESS_SECONDS`, `CACHE_TTL_RESULT_SECONDS`, `CACHE_TTL_NOT_FOUND_SECONDS`.
- P: A resposta indica se veio do cache? → R: **não**. O contrato fica igual, e os testes provam o critério 1 com fakes que contam as chamadas.
- P: Aprova a US4 com os 8 critérios? → R: aprovada.
- P: (levantado pelo usuário depois da primeira versão) O caminho de erro faz `findMany({ distinct: ['uf'] })` sobre ~898 mil linhas sem índice em `uf`, e o Prisma pode até deduplicar em memória. A US trata disso? → R: não tratava. O usuário escolheu a **opção 1**: uma tabela `loaded_uf` preenchida pelo seed, **dentro da US4**. Ficaram de fora a opção 2 (só pôr as UFs no cache, o que ainda lê a tabela inteira no miss e em todo erro com o Redis fora) e a opção 3 (índice + CTE recursiva em SQL à mão).

## Premissas
—

## Design técnico
- **Porta** (`src/application/cache.ts`):
  - `interface Cache { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown, ttlSeconds: number): Promise<void>; deleteByPrefix(prefix: string): Promise<void> }`.
  - O JSDoc documenta o contrato: `get` e `set` nunca lançam (falha = miss / no-op), e `deleteByPrefix` lança, porque o seed precisa saber da falha.
  - O arquivo também tem os prefixos e os geradores de chave: `RESULT_KEY_PREFIX = 'result:'` e `resultKey(radiusKm, cep)` → `result:<radiusKm>:<cep>` (o raio entra na chave porque pode mudar por env), além de `addressKey(cep)` → `address:<cep>`.
- **Cache do resultado** (`findNearbyCeps`):
  - A assinatura passa a ser `findNearbyCeps(repository, addressProvider, cache, { radiusKm, resultTtlSeconds })`.
  - O fluxo fica assim:
    1. Valida a entrada.
    2. Dispara o lookup, se `withAddress`.
    3. Faz `cache.get<CachedResult>(resultKey)`.
    4. No hit, pula o banco. No miss, segue o caminho atual e grava `{ origin: { cep, lat, lon }, neighbors }` (a lista inteira, já filtrada e ordenada).
    5. Pagina sobre essa lista nos dois casos.
  - Os caminhos de erro (CEP fora da base) não gravam nada.
  - O endereço não entra no valor do resultado: o resumo e o `/detalhes` usam a mesma chave, e o endereço vem do decorator.
- **Cache do endereço** (`src/application/caching-cep-address-provider.ts`):
  - `CachingCepAddressProvider implements CepAddressProvider`, com `(inner, cache, { foundTtlSeconds, notFoundTtlSeconds })`.
  - Lê `addressKey(cep)`. No miss, chama o `inner` e grava `found`/`not_found` com o TTL de cada um. `unavailable` não é gravado.
- **`InMemoryCache`** (`src/infrastructure/cache/in-memory-cache.ts`): um `Map` com `expiresAt` e relógio injetável (`now = Date.now`). `deleteByPrefix` percorre as chaves.
- **`RedisCache`** (`src/infrastructure/cache/redis-cache.ts`):
  - Recebe um cliente do `redis` v5, criado com `disableOfflineQueue: true` (sem conexão, o comando falha na hora em vez de enfileirar) e reconexão automática, mais o `logger`.
  - Registra o listener de `error`, que loga `warn` e não derruba o processo.
  - `get` faz `GET` + `JSON.parse`, e `set` faz `SET key value EX ttl`.
  - `get` e `set` correm contra um timeout de 500 ms (`CACHE_OPERATION_TIMEOUT_MS`). Erro ou timeout → `warn` + miss/no-op.
  - `deleteByPrefix` usa `scanIterator({ MATCH: prefix + '*', COUNT: 500 })` + `UNLINK` em lotes e propaga o erro.
  - Para testar sem Redis, a classe depende só de uma interface mínima do cliente (`get`, `set`, `scanIterator`, `unlink`), e os testes usam um fake.
- **Composição** (`src/index.ts`):
  - Cria o cliente com `REDIS_URL` e chama `connect()` sem bloquear a subida: falha de conexão vira `warn`, e o cliente reconecta sozinho.
  - Monta `CachingCepAddressProvider(BrasilApiCepProvider, redisCache, ttls)` e o `findNearbyCeps` com o cache.
  - No shutdown, fecha o cliente Redis (`close`/`quit`, com falha ignorada) além do Prisma.
- **Seed** (`scripts/seed/index.ts`):
  - Conecta no Redis **antes** do `BEGIN`, com cliente sem reconexão e `PING`. Falha → `Seed abortado: ...` e código 1.
  - Depois do `COMMIT`, faz `deleteByPrefix(RESULT_KEY_PREFIX)`. Falha → mensagem `Seed carregou a base, mas não limpou o cache de resultados: ...` e código 1.
  - Fecha o cliente no `finally`.
- **UFs carregadas** (critério 9):
  - Model novo `LoadedUf { uf String @id @db.Char(2) }`, com `@@map("loaded_uf")` (tabela no singular, nome interno em inglês), e migration `prisma migrate dev --name loaded_uf`.
  - `PrismaCepRepository.findLoadedUfs` passa a ser `prisma.loadedUf.findMany({ select: { uf: true } })`. A porta `CepRepository` não muda.
  - No seed, na mesma transação: `TRUNCATE cep, loaded_uf`, o `COPY` e depois um `INSERT INTO loaded_uf (uf) SELECT unnest($1::text[])` com as UFs de `totals` que tiveram ao menos um CEP. Se o `COPY` falhar, o `ROLLBACK` desfaz as duas tabelas.
  - Numa base existente, a migration cria a tabela vazia. Até o seed rodar, todo CEP fora da base com UF existente cai em `CEP_FORA_DA_COBERTURA`. O compose sempre roda o seed antes da API, então isso só afeta quem migrar à mão sem rodar o seed (o README avisa).
- **Ambiente** (`src/config/env.ts`):
  - `REDIS_URL: z.string().min(1)`.
  - `CACHE_TTL_ADDRESS_SECONDS` (padrão 2592000), `CACHE_TTL_RESULT_SECONDS` (padrão 604800) e `CACHE_TTL_NOT_FOUND_SECONDS` (padrão 3600), todos com `z.coerce.number().int().positive()`.
  - O `Env` ganha `redisUrl` e `cacheTtl: { addressSeconds, resultSeconds, notFoundSeconds }`.
- **Compose:**
  - Serviço `redis` (`redis:8-alpine`, `redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru`, sem persistência, `redis-cli ping` como healthcheck). Não expõe porta por padrão: rodar local fica com `docker compose up redis` e `ports` comentado. Revisar no implement.
  - `seed` e `api` ganham `REDIS_URL: redis://redis:6379` e `depends_on: redis: condition: service_healthy`.
  - A `api` também recebe as três variáveis de TTL, com `${...:-padrão}`.
- **`.env.example`:** `REDIS_URL=redis://localhost:6379` e as três variáveis de TTL.
- **Contrato HTTP:** sem mudança. Os testes de `app.test.ts` só ajustam a montagem (`InMemoryCache`).
- **Casos de borda:**
  - Valor corrompido no Redis (JSON inválido) → `warn` + miss.
  - Página além do total, com o resultado em cache → `ceps: []`, como hoje.
  - `limite` diferente → mesma chave, porque a lista é inteira.

## Arquivos que a mudança toca
- `src/application/cache.ts` — criar: `Cache`, `RESULT_KEY_PREFIX`, `resultKey`, `addressKey` — ~15 linhas
- `src/application/caching-cep-address-provider.ts` — criar: `CachingCepAddressProvider` — ~25 linhas
- `src/application/find-nearby-ceps.ts` — alterar: assinatura (`cache`, opções), leitura e escrita do resultado, `CachedResult` — ~35 linhas
- `src/infrastructure/cache/in-memory-cache.ts` — criar: `InMemoryCache` — ~30 linhas
- `src/infrastructure/cache/redis-cache.ts` — criar: `RedisCache`, `CACHE_OPERATION_TIMEOUT_MS`, interface mínima do cliente — ~65 linhas
- `src/config/env.ts` — alterar: `REDIS_URL` e os TTLs no schema e no `Env` — ~15 linhas
- `src/index.ts` — alterar: cliente Redis, decorator, nova montagem do caso de uso, shutdown — ~20 linhas
- `scripts/seed/index.ts` — alterar: conexão prévia ao Redis, `TRUNCATE`/`INSERT` em `loaded_uf`, limpeza pós-`COMMIT`, fechamento — ~38 linhas
- `src/infrastructure/db/prisma-cep-repository.ts` — alterar: `findLoadedUfs` lê `loadedUf` — ~3 linhas
- `prisma/schema.prisma` + `prisma/migrations/<timestamp>_loaded_uf/migration.sql` — model `LoadedUf` e migration (schema e migration, não contam). O client em `src/generated/` é gerado por `npx prisma generate` (não conta).
- `package.json` / `package-lock.json` — dependência `redis` (config, não conta)
- `docker-compose.yml`, `.env.example` — serviço `redis` e variáveis (config, não conta)
- Testes (não contam):
  - `src/application/find-nearby-ceps.test.ts` — hit/miss, paginação sobre o cache, erros sem gravação, contagem de chamadas ao repositório e ao provider;
  - `src/application/caching-cep-address-provider.test.ts` — criar: TTL de `found`/`not_found`, `unavailable` fora do cache;
  - `src/infrastructure/cache/in-memory-cache.test.ts` — criar: expiração com relógio injetado, `deleteByPrefix`;
  - `src/infrastructure/cache/redis-cache.test.ts` — criar: com cliente fake, erro e timeout viram miss, JSON inválido vira miss, `deleteByPrefix` em lotes e propagando o erro;
  - `src/config/env.test.ts` — `REDIS_URL` obrigatória, padrões dos TTLs;
  - `src/presentation/http/app.test.ts` — montagem com `InMemoryCache`, segunda chamada HTTP sem tocar o repositório;
  - `scripts/seed/index.test.ts` — se a limpeza ou a lista de UFs a gravar forem extraídas numa função testável.
- Docs (não contam): `README.md` (Redis, variáveis, comportamento degradado) e `docs/DECISOES.md` (decisões desta US: degradação, `REDIS_URL` obrigatória, seed falha sem Redis, só o lookup em cache para CEP fora da base, tabela `loaded_uf`).

## Limite de tamanho
- **Estimativa:** ~246 linhas de lógica (`bc_giross`), soma da lista acima.
- **Não contam:** testes, docs, config (`docker-compose.yml`, `.env.example`, `package.json`), lockfile, `prisma/schema.prisma`, a migration e o client gerado em `src/generated/` (`npx prisma generate`, já fora do git).
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

## Triagem de implementação

| Métrica | Valor |
| --- | --- |
| Tarefas | 7 |
| Arquivos que a mudança toca | 9 de lógica + 7 de teste + 4 de config + schema/migration + 2 de doc |
| Linhas de lógica estimadas | ~246 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Sim (tabela `loaded_uf`, preenchida pelo seed) |
| Muda contrato de API | Não |
| Dependência nova | Sim (`redis`) |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são 7 tarefas, 9 arquivos de lógica, uma migration e uma dependência nova.

## Tarefas
- [x] 1. Porta `Cache` (chaves e prefixos), `InMemoryCache` e o ambiente (`REDIS_URL` + TTLs), com testes.
- [x] 2. `CachingCepAddressProvider` (found 30 d, not_found 1 h, unavailable fora), com testes.
- [x] 3. Cache do resultado no `findNearbyCeps` (nova assinatura, paginação sobre a lista em cache), com testes do caso de uso e do `app.test.ts`.
- [x] 4. `RedisCache` (degradação, timeout de 500 ms, `deleteByPrefix`), dependência `redis`, composição em `src/index.ts`, serviço `redis` no compose e `.env.example`, com testes do `RedisCache`.
- [x] 5. Tabela `loaded_uf`: model, migration, `findLoadedUfs` lendo dela e o seed gravando as UFs na mesma transação, com teste.
- [x] 6. Seed: conecta no Redis antes da carga e limpa os resultados depois do `COMMIT`, falhando nos dois casos, com teste.
- [x] 7. README e `DECISOES.md`.

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- `npm test`, `npm run typecheck`, `npm run lint` e `npm run format:check` passam.
- **Automatizados:** os listados em "Arquivos que a mudança toca". O critério 1 é provado com repositório e provider fakes que contam as chamadas: a segunda chamada tem zero chamadas.
- **Manual:**
  1. `docker compose up` com `SEED_UFS=SP`.
  2. Chamar `GET /ceps-proximos/04551000` duas vezes e ver a segunda mais rápida. Em `docker compose exec redis redis-cli keys '*'`, aparecem `result:1:04551000` e, depois do `/detalhes`, `address:04551000`.
  3. Rodar `docker compose stop redis` e conferir que a API ainda responde, com `warn` no log.
  4. Rodar `docker compose start redis` e conferir que o cache volta.
  5. Rodar `docker compose run --rm seed` e conferir que as chaves `result:*` somem e as `address:*` ficam.
  6. Conferir `SELECT * FROM loaded_uf` (só `SP`) e, com o log de queries do Postgres ligado, que um `422` não toca a tabela `cep` além do `findByCep`.

## Verificação independente
Preenchido no `/pato/verify`.

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |

## Riscos e pontos em aberto
- **Reconexão do node-redis v5:** o comportamento do `connect()` com o Redis fora na subida (rejeita ou fica tentando) precisa ser confirmado no implement. O critério 6 exige que a API suba mesmo assim.
- **Tamanho dos valores:** em áreas densas, a lista de vizinhos num raio de 1 km pode ter milhares de CEPs, o que dá dezenas de KB de JSON por chave. Com `maxmemory 256mb` + LRU, isso cabe com folga para o uso esperado.
- **Ordem do seed:** se a limpeza falhar depois do `COMMIT`, a base já mudou e o cache antigo pode servir resultado velho até o TTL. O seed sai com erro e mensagem clara, e a US6 vai dar a limpeza manual.
- **Base migrada sem seed:** com `loaded_uf` vazia, todo CEP fora da base cai em `CEP_FORA_DA_COBERTURA`. O compose evita isso rodando o seed sempre, e o README avisa para rodar o seed depois do `migrate deploy`.
- **`app.test.ts` e `find-nearby-ceps.test.ts`:** mudam pela nova assinatura do caso de uso, mas só na montagem: as asserções de contrato continuam iguais.
