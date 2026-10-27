---
id: us7
card: —
mapa: docs/HISTORIAS.md
depende_de: US2 (mergeada). Parte da `main` com a US6 (PR #8, mergeada)
titulo: Rate limit da API
status: em-andamento
modo: agent-driven
criada_em: 2026-10-27
implementada_em:
verificada_em:
branch: feat/us7-rate-limit
merge_request:
---

# US7 — Rate limit da API

## História
Como **operador da API**, quero limitar as requisições por cliente e as chamadas às APIs externas, com os contadores no Redis, para proteger o serviço e a BrasilAPI e o Nominatim de abuso, mesmo com mais de uma réplica da API.

## Contexto
Hoje nada limita quem chama a nossa API. Um cliente pode disparar milhares de consultas de CEPs fora da base, e cada uma gasta o limite da BrasilAPI (5 req/s) e do Nominatim (1 req/s, com risco de bloqueio do IP). Esses dois limites de saída já existem, mas em memória (`WindowRateLimiter`), por processo: com duas réplicas, o Nominatim recebe 2 req/s. A D11 (cont.) já registrava que, nesse caso, o limiter teria de ir para o Redis.

A US7 resolve as duas coisas:
- **entrada:** 60 req/min por IP, com `express-rate-limit` e `rate-limit-redis`, e `429` pelo catálogo de erros da US8;
- **saída:** os limiters da BrasilAPI e do Nominatim passam a contar no Redis (janela deslizante), com o limiter em memória como fallback quando o Redis cai.

No mapa (`docs/HISTORIAS.md`), a US7 depende só da US2. A branch parte da `main`, que já tem a US6 (o `DELETE /cache` também fica sob o rate limit). A isenção do `/saude` é da US9.

## Critérios de aceite
**Entrada (nossa API)**
- [ ] Dado 60 requisições do mesmo IP dentro da janela de 60 s, quando chega a 61ª, em qualquer rota (incluindo `DELETE /cache` e rotas inexistentes), então `429` com `{ erro: { codigo: "LIMITE_EXCEDIDO", mensagem: "Limite de requisições excedido" } }` e o header `Retry-After` com os segundos que faltam para a janela virar.
- [ ] Dado um IP que estourou o limite, quando outro IP chama, então o outro é atendido normalmente: os contadores são por IP. IPv6 conta por sub-rede /56 (padrão do `express-rate-limit`).
- [ ] Dado uma resposta dentro ou fora do limite, então ela traz os headers `RateLimit` e `RateLimit-Policy` (IETF draft-8). Os headers legados `X-RateLimit-*` não são enviados.
- [ ] Dado `RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW_SECONDS` (padrão 60 e 60), então o limite e a janela seguem a env. Valor não inteiro ou < 1 faz o `loadEnv` falhar.
- [ ] Dado o Redis fora do ar ou estourando o timeout (500 ms) ao contar a requisição, então ela passa sem limite (fail-open) e o erro é logado como `warn`. A API não cai, nem na subida com o Redis fora.
- [ ] Dado o contador no Redis, então a chave é `ratelimit:api:<ip>`, e um `DELETE /cache` não a apaga (fica fora dos `CACHE_KEY_PREFIXES`).
- [ ] Dado `TRUST_PROXY` definido (ex.: `1`, `loopback`), então o IP do cliente sai do `X-Forwarded-For` conforme o `trust proxy` do Express. Sem a env (ou vazia), vale o IP do socket, e o `X-Forwarded-For` é ignorado.
- [ ] Dado o catálogo de erros, então `rate_limit_exceeded` tem entrada nele, e o teste existente do catálogo continua passando.

**Requisição que gera outra internamente**
- [ ] Dado uma requisição que passa pelo middleware de rate limit mais de uma vez (o mesmo `req` atravessa um router ou sub-app que monta o middleware de novo, ou é repassado internamente), então ela conta **uma vez só** e não recebe `429` por causa da própria passagem extra: o middleware pula quando `req.rateLimit` já está definido.
- [ ] Dado a regra de arquitetura D30, então a composição interna (um caso de uso que precisa do resultado de outro) chama o caso de uso direto, em processo, e nunca faz HTTP para a própria API. Assim, a chamada interna não gasta o limite do cliente, não divide contador com `127.0.0.1` e não consome duas vezes a vaga da BrasilAPI ou do Nominatim. A regra fica registrada em `docs/DECISOES.md` (D30) e num comentário no `rateLimitMiddleware`.
- [ ] Dado um teste com o middleware montado duas vezes no mesmo caminho (app e router) e limite 2, quando o mesmo IP faz 2 requisições, então as duas são `200` e o `RateLimit` mostra 0 restante. Um middleware que contasse em dobro bloquearia a 2ª, e o teste quebra.

**Saída (BrasilAPI e Nominatim)**
- [ ] Dado duas instâncias da API apontando para o mesmo Redis, então as duas juntas fazem no máximo 5 chamadas por segundo à BrasilAPI e 1 ao Nominatim: as chaves `ratelimit:brasilapi` e `ratelimit:nominatim` são compartilhadas.
- [ ] Dado a janela de 1 s, então ela é deslizante: o Nominatim nunca recebe 2 chamadas a menos de 1 s uma da outra, nem na virada do segundo.
- [ ] Dado o limite de saída atingido, então o comportamento é o de hoje: BrasilAPI → `unavailable` (`503 PROVEDOR_INDISPONIVEL` para CEP fora da base, `origem.endereco: null` em `/detalhes` para CEP na base); Nominatim → `503 PROVEDOR_INDISPONIVEL`.
- [ ] Dado o Redis fora do ar ou estourando o timeout ao pedir vaga, então a vaga é pedida ao `WindowRateLimiter` em memória do processo (mesmo limite), com log `warn`. Quando o Redis volta, a contagem volta para ele sem reiniciar o serviço.

**Docs**
- [ ] O README documenta o limite de entrada, as envs `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY`, o `429 LIMITE_EXCEDIDO` na tabela de erros e os limites de saída compartilhados no Redis. O `docker-compose.yml` e o `.env.example` trazem as três envs.

## Escopo
**Dentro:**
- Middleware global de rate limit no `createApp`, com `express-rate-limit` e `rate-limit-redis` (dependências novas).
- `RateLimitExceededError` (`rate_limit_exceeded`) e a entrada `429` no catálogo.
- Porta `RateLimiter` dos limiters de saída, adapter Redis de janela deslizante com fallback em memória, e BrasilAPI e Nominatim passando a usá-lo.
- Envs `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY`. README, DECISOES e HISTORIAS.

**Fora** (fica para outra US do mapa ou fora do card):
- Isenção do `/saude` do rate limit → US9.
- Documentação OpenAPI do `429` → US10.
- Limites diferentes por rota, allowlist de IPs, limite por token/cliente autenticado → fora do card.
- Janela deslizante no limite de entrada (o `rate-limit-redis` usa janela fixa) → fora do card.
- Configurar por env os limites de saída (5/s e 1/s continuam fixos no código) → fora do card.

## Decisões e respostas do usuário
- P: De onde parte a branch, com a US6 em PR aberto? → R: o usuário já deu o pull. A US6 está na `main` (PR #8), e a US7 parte dela.
- P: Redis fora ao contar uma requisição de entrada? → R: fail-open: passa sem limite e loga.
- P: Como implementar o limite de entrada? → R: `express-rate-limit` + `rate-limit-redis`, em vez de código próprio.
- P: Como identificar o cliente atrás de proxy? → R: env `TRUST_PROXY`, repassada ao `trust proxy` do Express. Desligada por padrão.
- P: Quais headers? → R: `RateLimit` e `RateLimit-Policy` (draft-8) e `Retry-After` no `429`.
- P: Escopo do Redis? → R: "Quero garantir que todo limiter será persistido no redis". Os três limiters (entrada 60/min por IP, BrasilAPI 5/s e Nominatim 1/s) contam no Redis.
- P: Redis fora ao pedir vaga para a BrasilAPI ou o Nominatim? → R: cai no `WindowRateLimiter` em memória do processo e loga `warn`.
- P: E a entrada com o Redis fora? → R: continua fail-open, como decidido (sem fallback em memória).
- P: Como garantir que, se a API evoluir e uma requisição fizer outra internamente, isso não quebre o limite? → R: contagem única por requisição (pula se `req.rateLimit` já existe) + regra de arquitetura D30 (composição interna chama o caso de uso em processo, nunca HTTP para a própria API) + teste que trava a contagem única. Foram descartados: o token interno com header que pula o limite (cria segredo e superfície de ataque) e o repasse assinado do IP original (complexo demais para um caso que a regra D30 evita).

## Premissas
Nenhuma.

## Design técnico
- **Modelos de dados / migrações:** nenhum. O Redis do compose já existe (US4).
- **Dependências:** `express-rate-limit@^8.7.1` e `rate-limit-redis@^6.0.2` (peer `express-rate-limit >= 8.6.0`). Lido no código dos pacotes:
  - `passOnStoreError: true` deixa passar e loga quando a store lança;
  - o `init` da store só loga o erro (o processo não cai com o Redis fora na subida), e o `RedisStore` recarrega o script Lua sozinho (`NOSCRIPT`) na próxima requisição;
  - o `Retry-After` só sai com `standardHeaders` ou `legacyHeaders` ligados;
  - o `handler` recebe `next`.
- **Entrada: store Redis** (`src/infrastructure/rate-limit/redis-rate-limit-store.ts`). `createRedisRateLimitStore(client: RedisCommandSender)` devolve `new RedisStore({ prefix: 'ratelimit:api:', sendCommand: (...args) => withTimeout(client.sendCommand(args)) })`.
  - `RedisCommandSender` é a fatia `{ sendCommand(args: string[]): Promise<unknown> }` do node-redis, que facilita o fake nos testes.
  - O `withTimeout` (500 ms) existe porque o `RedisStore` não tem timeout próprio: com o Redis travado, a requisição ficaria pendurada. Com o Redis desconectado, o `disableOfflineQueue` já falha na hora.
  - `withTimeout` passa a ser exportado de `redis-cache.ts`.
- **Entrada: middleware** (`src/presentation/http/rate-limit.ts`), com `rateLimitMiddleware({ limit, windowMs, store?, logger })`:
  - `rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, passOnStoreError: true, store, logger: <adapter>, handler: (_req, _res, next) => next(new RateLimitExceededError()) })`;
  - `skip: (req) => req.rateLimit !== undefined`: a lib só define `req.rateLimit` depois de contar, então uma segunda passagem do mesmo `req` é pulada antes do `increment`. Isso evita contar em dobro e o aviso `ERR_ERL_DOUBLE_COUNT` da validação `singleCount`. O comentário no código aponta para a D30;
  - `store` ausente cai no `MemoryStore` da lib (testes);
  - `logger` adapta o pino: `error(err, msg)` → `logger.warn({ err }, msg)` (fail-open é degradação, não erro) e `warn` → `logger.warn`;
  - a lib define o `Retry-After` antes de chamar o `handler`, e o error middleware da US8 monta o corpo pelo catálogo.
- **Erros:** `rate_limit_exceeded` em `APP_ERROR_KINDS` e `RateLimitExceededError` em `src/application/errors.ts`. No catálogo: `{ status: 429, codigo: 'LIMITE_EXCEDIDO', mensagem: 'Limite de requisições excedido' }`. Em `ErrorCode`: `RateLimitExceeded: 'LIMITE_EXCEDIDO'`.
- **Composição** (`src/presentation/http/app.ts`):
  - `AppDeps` ganha `rateLimit: { limit: number; windowMs: number; store?: Store }` (obrigatório, para a produção não esquecer) e `trustProxy?: boolean | number | string`;
  - ordem: `app.set('trust proxy', trustProxy ?? false)`, `pinoHttp`, `rateLimitMiddleware`, routers, `notFoundHandler`, `errorHandler`. O 429 passa pelo `pinoHttp` e cobre as rotas inexistentes.
  - Uma store por instância de middleware: a lib reclama de store compartilhada (`unsharedStore`).
- **Saída: porta** (`src/infrastructure/http/rate-limiter.ts`). `interface RateLimiter { tryAcquire(): boolean | Promise<boolean> }`, que o `WindowRateLimiter` atual implementa sem mudar a lógica. `BrasilApiCepProviderOptions.limiter` e `NominatimGeocoderOptions.limiter` passam a ser `RateLimiter`, e as chamadas viram `await this.limiter.tryAcquire()`. O padrão sem `limiter` continua `new WindowRateLimiter(5, 1000)` / `(1, 1000)`.
- **Saída: adapter Redis** (`src/infrastructure/rate-limit/redis-window-rate-limiter.ts`), com `RedisWindowRateLimiter implements RateLimiter`, `constructor(client: RedisCommandSender, { key, max, windowMs, fallback: RateLimiter, logger })`.
  - `tryAcquire` roda `EVAL` (com `withTimeout`) de um Lua de janela deslizante sobre sorted set:
    ```lua
    local t = redis.call('TIME')
    local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
    if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
    redis.call('ZADD', KEYS[1], now, ARGV[3])
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    return 1
    ```
    Os argumentos são `ARGV = [windowMs, max, member]`, com `member = <Date.now()>-<randomUUID()>` para ser único.
  - O relógio é o do Redis (`TIME`), igual para todas as réplicas. O script é atômico. O `ZREMRANGEBYSCORE` até `now - windowMs` (inclusive) replica a regra `current - ts >= windowMs` do `WindowRateLimiter`.
  - Resposta `1` → `true` e `0` → `false`. Erro ou timeout → `logger.warn({ err, key }, 'redis rate limiter failed, using in-memory fallback')` e `return this.fallback.tryAcquire()`.
  - O fallback só conta enquanto o Redis está fora. Quando o Redis volta, as vagas voltam para ele (sem estado de "circuito").
- **Configuração** (`src/config/env.ts`):
  - `RATE_LIMIT_MAX` (int ≥ 1, padrão 60) e `RATE_LIMIT_WINDOW_SECONDS` (int ≥ 1, padrão 60), expostos como `Env.rateLimit: { max, windowSeconds }`;
  - `TRUST_PROXY` opcional: vazio ou ausente → `false`, `true`/`false` → boolean, só dígitos → número de saltos, outro texto → string (ex.: `loopback, 10.0.0.0/8`). Exposto como `Env.trustProxy`;
  - no compose, `${RATE_LIMIT_MAX:-60}`, `${RATE_LIMIT_WINDOW_SECONDS:-60}` e `${TRUST_PROXY:-}`.
- **`src/index.ts`:**
  - `createApp({ ..., trustProxy: env.trustProxy, rateLimit: { limit: env.rateLimit.max, windowMs: env.rateLimit.windowSeconds * 1000, store: createRedisRateLimitStore(redis) } })`;
  - BrasilAPI com `limiter: new RedisWindowRateLimiter(redis, { key: 'ratelimit:brasilapi', max: 5, windowMs: 1000, fallback: new WindowRateLimiter(5, 1000), logger })`;
  - Nominatim igual, com `ratelimit:nominatim` e 1/1000.
- **Requisição interna (D30):** em `docs/DECISOES.md`, nova D30 ("Composição interna em processo"). Um fluxo que precise do resultado de outro chama o caso de uso (`findNearbyCeps`, `clearCache`...) direto, pela composição em `src/index.ts`, e nunca faz `fetch` para a própria API. Motivos:
  - a requisição interna sairia de `127.0.0.1` (ou do IP do pod), dividindo um contador só entre todos os clientes;
  - gastaria o limite do cliente duas vezes;
  - repetiria a vaga dos limiters de saída.

  Somada ao `skip`, a regra garante uma contagem por requisição do cliente. Os limiters de saída não mudam: em processo, cada chamada externa real pede uma vaga só.
- **Casos de borda:**
  - `TRUST_PROXY=true` confia em qualquer `X-Forwarded-For` e a lib loga `ERR_ERL_PERMISSIVE_TRUST_PROXY`. O README recomenda o número de saltos;
  - com o `allkeys-lru` do Redis, uma chave `ratelimit:*` pode ser despejada sob pressão de memória, o que só zera um contador (falha a favor do cliente);
  - as requisições que recebem `429` também contam na janela (comportamento da lib). Em janela fixa, isso não estende o bloqueio.

## Arquivos que a mudança toca
- `src/presentation/http/rate-limit.ts` — criar: `rateLimitMiddleware` (com `skip` de contagem única), adapter de logger — ~28 linhas
- `src/infrastructure/rate-limit/redis-rate-limit-store.ts` — criar: `RedisCommandSender`, `createRedisRateLimitStore` — ~15 linhas
- `src/infrastructure/rate-limit/redis-window-rate-limiter.ts` — criar: `RedisWindowRateLimiter`, script Lua — ~35 linhas
- `src/infrastructure/http/rate-limiter.ts` — criar: interface `RateLimiter` — ~4 linhas
- `src/infrastructure/http/window-rate-limiter.ts` — `implements RateLimiter` — ~2 linhas
- `src/infrastructure/http/brasil-api-cep-provider.ts` — `limiter: RateLimiter`, `await tryAcquire()` — ~3 linhas
- `src/infrastructure/http/nominatim-geocoder.ts` — idem — ~3 linhas
- `src/infrastructure/cache/redis-cache.ts` — exportar `withTimeout` — ~1 linha
- `src/application/errors.ts` — `rate_limit_exceeded`, `RateLimitExceededError` — ~6 linhas
- `src/presentation/http/error-catalog.ts` — entrada `rate_limit_exceeded` — ~5 linhas
- `src/presentation/http/errors.ts` — `ErrorCode.RateLimitExceeded` — ~1 linha
- `src/presentation/http/app.ts` — `AppDeps.rateLimit`, `AppDeps.trustProxy`, `trust proxy`, `app.use` — ~10 linhas
- `src/config/env.ts` — `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `TRUST_PROXY`, `Env.rateLimit`, `Env.trustProxy` — ~20 linhas
- `src/index.ts` — store de entrada, limiters de saída, `trustProxy` — ~20 linhas
- Testes (não contam): `src/presentation/http/rate-limit.test.ts` (criar, Supertest), `src/infrastructure/rate-limit/redis-rate-limit-store.test.ts` (criar), `src/infrastructure/rate-limit/redis-window-rate-limiter.test.ts` (criar), `src/infrastructure/http/brasil-api-cep-provider.test.ts`, `src/infrastructure/http/nominatim-geocoder.test.ts`, `src/config/env.test.ts`, `src/presentation/http/app.test.ts` e `cache-route.test.ts` (helpers passam `rateLimit`)
- Config/docs (não contam): `package.json`, `package-lock.json`, `docker-compose.yml`, `.env.example`, `README.md`, `docs/DECISOES.md` (D22 cont.), `docs/HISTORIAS.md` (US7)

## Limite de tamanho
A US inteira sai num PR, mergeável sozinho, com **até 500 linhas de lógica** adicionadas ou modificadas. Remoção não conta.

- **Estimativa:** ~153 linhas (bc_giross: ~153), soma da lista acima.
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
| Tarefas | 3 |
| Arquivos que a mudança toca | 14 de código (+8 de teste, +7 de config/docs) |
| Linhas de lógica estimadas | ~153 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Sim (novo `429 LIMITE_EXCEDIDO` e headers `RateLimit*`, aditivo) |
| Dependência nova | Sim (`express-rate-limit`, `rate-limit-redis`) |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são 3 tarefas, 14 arquivos, dependências novas e mudança de contrato.

## Tarefas
Passos (commits) desta US. Todos entram no mesmo PR, e tarefa não é entregável.
- [x] 1. Limiters de saída no Redis: interface `RateLimiter`, `WindowRateLimiter implements`, `RedisWindowRateLimiter` com fallback (+ `RedisCommandSender`, `withTimeout` exportado), providers com `await tryAcquire()` e montagem no `index.ts`. Testes: `redis-window-rate-limiter.test.ts`, mais os testes dos providers ajustados.
- [x] 2. Limite de entrada: instalar `express-rate-limit` e `rate-limit-redis`; `RateLimitExceededError` + catálogo + `ErrorCode`; `createRedisRateLimitStore`; `rateLimitMiddleware` com `skip` de contagem única; `AppDeps.rateLimit`/`trustProxy` no `createApp`; `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY` no `loadEnv` e no `index.ts`. Testes: `rate-limit.test.ts`, `redis-rate-limit-store.test.ts`, `env.test.ts` e os helpers de `app.test.ts`/`cache-route.test.ts`.
- [ ] 3. Config e docs: `docker-compose.yml`, `.env.example`, README (limites, envs, `429`, `TRUST_PROXY`), DECISOES (D22 cont., D30 composição interna em processo, e a nota da D11 cont. sobre o limiter por processo) e HISTORIAS (US7).

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- **Unitários:**
  - `RedisWindowRateLimiter` com `sendCommand` fake:
    - manda `EVAL` com a chave, `windowMs`, `max` e um member único;
    - `1` → `true` e `0` → `false`;
    - erro ou timeout (fake que nunca resolve, com fake timers) → usa o `fallback` e loga `warn`;
    - depois de um erro, a chamada seguinte volta a ir ao Redis.
  - `createRedisRateLimitStore` com `sendCommand` fake: o prefixo `ratelimit:api:` chega na chave do `EVALSHA`, e o timeout rejeita.
  - BrasilAPI e Nominatim: um `limiter` assíncrono que devolve `false` → `unavailable` sem chamar o `fetch`.
  - `loadEnv`:
    - padrões 60/60;
    - `RATE_LIMIT_MAX=0` ou `abc` falham;
    - `TRUST_PROXY` vazio → `false`, `1` → `1`, `true` → `true`, `loopback` → `'loopback'`.
- **HTTP (Supertest, `rate-limit.test.ts`, `MemoryStore` com limite baixo, ex.: 2):**
  - 3ª requisição → `429 LIMITE_EXCEDIDO` com `Retry-After` numérico, `RateLimit` e `RateLimit-Policy`, e sem `X-RateLimit-*`;
  - rota inexistente também conta e bloqueia;
  - com `trustProxy: 1`, `X-Forwarded-For` diferente → contadores separados;
  - sem `trustProxy`, `X-Forwarded-For` diferente → mesmo contador;
  - store que lança erro → `200` (fail-open) e log `warn`;
  - contagem única: o middleware montado no app e de novo num router do mesmo caminho, com limite 2, faz 2 requisições → as duas `200`, e a 3ª `429`.
- **Suítes:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.
- **Manual** (o script Lua e o `RedisStore` só rodam de verdade com Redis real), com `docker compose up`:
  1. `for i in $(seq 61); do curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/ceps-proximos/04551000; done | sort | uniq -c` → 60 × `200` e 1 × `429`. Depois, `curl -i` mostra `Retry-After` e `redis-cli TTL ratelimit:api:<ip>` mostra o TTL;
  2. `CACHE_ADMIN_TOKEN` definido, `DELETE /cache` → a chave `ratelimit:api:*` continua no Redis;
  3. duas consultas seguidas de CEPs fora da base que vão ao Nominatim → a segunda dá `503`, e `redis-cli ZRANGE ratelimit:nominatim 0 -1 WITHSCORES` mostra a entrada;
  4. `docker compose stop redis` → as requisições passam (fail-open) e os logs mostram os `warn` do fallback dos limiters de saída.

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
- **Script Lua sem teste automatizado contra Redis real:** a suíte usa fakes. A janela deslizante e o `RedisStore` são conferidos no teste manual (itens 1 e 3).
- **Fail-open de entrada:** com o Redis fora, não há limite de entrada. Os limites de saída continuam por processo (fallback), então a BrasilAPI e o Nominatim seguem protegidos por réplica.
- **Log ruidoso com o Redis fora:** cada requisição loga um `warn` do fail-open. Isso é aceito, porque deixa a degradação visível. Um throttle de log fica fora do card.
- **Regra D30 só por convenção:** nada impede, no código, que alguém faça `fetch` para a própria API. A defesa é a D30 e o comentário no middleware. Se a regra for quebrada, a chamada interna conta como um cliente `127.0.0.1`. Se um dia houver outro serviço chamando a API, o token interno descartado nesta US volta a ser opção (fora do card).
- **IP errado atrás de proxy:** sem `TRUST_PROXY`, todos os clientes atrás do mesmo proxy dividem o contador. Fica documentado no README.
