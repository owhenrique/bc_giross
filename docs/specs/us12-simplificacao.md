---
id: us12
card: —
mapa: docs/HISTORIAS.md
depende_de: US7 (PR #9) e US8 (PR #3), mergeadas. Parte da `main` com a US7
titulo: Simplificação do projeto
status: implementado
modo: agent-driven
criada_em: 2026-10-28
implementada_em: 2026-10-28
verificada_em: 2026-10-28
branch: feat/us12-simplificacao
merge_request: https://github.com/owhenrique/bc_giross/pull/10
---

# US12 — Simplificação do projeto

## História
Como **time de desenvolvimento**, quero os rate limits em memória, sem Redis, e o código sem arquivos de poucas linhas nem trechos repetidos, para entender a solução de relance e evoluí-la com menos peças.

## Contexto
O projeto cresceu além do enunciado, que é para uma vaga Jr com prazo de 2 dias. Hoje o `src/` tem 33 arquivos de produção. Os rate limits contam no Redis, com um store próprio para a entrada e um limiter distribuído em Lua para a saída. Contratos e catálogos estão espalhados em arquivos de poucas linhas, os providers e o seed repetem trechos, e a raiz tem arquivos dispensáveis. Quem lê o código, inclusive quem avalia o teste, paga por essa complexidade.

Esta US mantém os dois limites, agora em memória e por processo. A entrada (60 req/min por IP, com `429 LIMITE_EXCEDIDO`) usa o store padrão do `express-rate-limit`, e a saída (BrasilAPI 5 req/s, Nominatim 1 req/s) usa o `WindowRateLimiter`. O contrato da API não muda.

No mapa (`docs/HISTORIAS.md`), a US12 roda depois da US8 e antes da US9; o número é só de cadastro. A US9 e a US10 continuam depois desta.

## Critérios de aceite
- [x] 1. Dado mais de `RATE_LIMIT_MAX` requisições (padrão 60) do mesmo IP dentro da janela, quando ele chama a API, então recebe `429 LIMITE_EXCEDIDO` com `Retry-After` e os headers `RateLimit`/`RateLimit-Policy`, como hoje. O contador fica em memória, por processo, no store padrão do `express-rate-limit`: um contador por IP, que sai da memória depois de uma janela sem requisições. O `rate-limit-redis` saiu das dependências.
- [x] 2. Dado a BrasilAPI já chamada 5 vezes no último segundo, quando uma consulta precisa dela, então o provider devolve indisponível sem chamá-la, com a mesma resposta de hoje: `503 PROVEDOR_INDISPONIVEL` para CEP fora da base, `origem.endereco: null` no `/detalhes` para CEP na base. O mesmo vale para o Nominatim com 1 req/s. A contagem fica em memória, por processo, e nenhum dos dois limites grava chave `ratelimit:*` no Redis.
- [x] 3. Dado o Redis fora do ar, quando a API sobe, então ela sobe sem esperar por ele e responde sem cache, como já faz quando ele cai com a API rodando, e os dois rate limits continuam valendo.
- [x] 4. Dado as rotas e os erros de hoje (`GET /ceps-proximos/:cep`, `GET /ceps-proximos/:cep/detalhes`, `DELETE /cache`, `DELETE /cache/:cep`, rota inexistente, token errado, requisição malformada, limite excedido e erro interno), quando chamados, então status, corpo e headers são os mesmos de antes: os testes HTTP passam sem mudar o status, o corpo nem os headers esperados. Só saem os testes do store do Redis.
- [x] 5. Dado o `src/` (fora `src/generated`), então ele tem 29 arquivos de produção e nenhuma pasta foi achatada: `domain/cep/cep.ts` (`cep-code` + `cep-centroid`) e `domain/geo/geo.ts` (`haversine` + `bounding-box`), cada um com um teste; o `application/` sem arquivos na raiz, com as pastas `use-cases/` (`find-nearby-ceps.ts` e a porta `cep-repository.ts`), `cache/` (porta `Cache` com as chaves e `clear-cache.ts`), `errors/` (`errors.ts`) e `providers/` (portas `cep-address-provider.ts` e `geocoder.ts`, `caching-cep-address-provider.ts` e `origin-geocoder.ts`), sem `ports.ts`; o `presentation/http/` com `app.ts` na raiz e as pastas `routes/` (só os `Router`s), `middlewares/` (`bearer-auth.ts`, `rate-limit.ts`, `error-handler.ts`), `errors/` (catálogo, `HTTP_ERRORS` e `sendError` em `errors.ts`, sem a const `ErrorCode`) e `mappers/` (`nearby-ceps-mapper.ts`, com a leitura da query e a tradução para o contrato); o `WindowRateLimiter` em `infrastructure/rate-limit/`; e o `InMemoryCache` em `tests/fakes/`.
- [x] 6. Dado os providers da BrasilAPI e do Nominatim, então limite, timeout e log de falha ficam no `limitedFetch`, cada provider só monta a URL e interpreta a resposta, e o `limitedFetch` tem teste próprio para limite, timeout e falha de rede.
- [x] 7. Dado os trechos repetidos da análise, então cada um existe uma vez só: `toRad` (o `bounding-box` usa o de `haversine`); a deduplicação dos pontos (só no `assessCep`; o `centroid` só tira a média); `errorMessage(e)` no seed; o header do CSV (`DATASET_HEADER`); e um `split` por linha no seed. O `findNearbyCeps` fica sem a compatibilidade com cache antigo e com `neighbors: Neighbor[]`.
- [x] 8. Dado a raiz, então `.git-blame-ignore-revs`, `.nvmrc`, `vitest.config.ts` e `.prettierrc.json` não existem, a config do Prettier está no `package.json`, e o `graphify-out` continua em `.gitignore`, `.prettierignore`, `eslint.config.js` e `.dockerignore`. No commit que remove o `vitest.config.ts`, o Vitest roda os mesmos arquivos e testes do commit anterior.
- [x] 9. Dado o projeto, quando rodo `npm test`, `npm run lint`, `npm run typecheck` e `npm run format:check`, então todos passam.
- [x] 10. Dado a documentação, então o README e o `DECISOES.md` descrevem os dois limites em memória, por processo, com o custo do contador de entrada (~205 bytes por IP) e o trade-off com réplicas; a D22 foi reescrita e a D30 continua; e o mapa traz a US12 e a nota de simplificação na US7.
- [x] 11. Dado as camadas, então cada uma só importa as de baixo (`domain` ← `application` ← `infrastructure` e `presentation`), a `application` não tem erro que só a borda HTTP gera (o `429` sai do `HTTP_ERRORS`), o cálculo dos vizinhos (raio, ordem e desempate) está no `domain`, e o `npm run lint` falha quando uma camada importa outra que não pode.

## Escopo
**Dentro:**
- Rate limit de entrada em memória: sai o store do Redis (`redis-rate-limit-store.ts` e `rate-limit-redis`), e o `rateLimitMiddleware` passa a usar o store padrão do `express-rate-limit`.
- Rate limit de saída só em memória: saem o limiter Redis/Lua e a interface `RateLimiter`, e o `WindowRateLimiter` vai para `infrastructure/rate-limit/`.
- `index.ts` sem o `await` do `redis.connect()`.
- `limitedFetch` para as chamadas da BrasilAPI e do Nominatim.
- `application/` em pastas por responsabilidade (`use-cases/`, `cache/`, `errors/`, `providers/`), com cada porta num arquivo, junto do código que a usa.
- `presentation/http/errors/errors.ts` com o catálogo, a tabela `HTTP_ERRORS` e `sendError(res, entry)`.
- `presentation/http/` em pastas: `routes/`, `middlewares/`, `errors/` e `mappers/`; a rota fica só com o `Router`.
- `InMemoryCache` e o teste dele em `tests/fakes/`.
- Domínio com um arquivo por pasta: `domain/cep/cep.ts` e `domain/geo/geo.ts`, com os testes juntados.
- Trechos repetidos: `toRad`, `centroid`, compatibilidade com cache antigo e `Neighbor[]` no `findNearbyCeps`, `errorMessage`, `DATASET_HEADER` e `allowedUf` no seed.
- Raiz: remover `.git-blame-ignore-revs`, `.nvmrc` e `vitest.config.ts`; Prettier no `package.json`.
- README, `DECISOES.md` e o mapa.

**Fora** (fica para outra US do mapa ou fora do card):
- Mover `docs/specs/` e `docs/HISTORIAS.md` para a branch `docs` → passo final, depois do close-spec da US10.
- Limites compartilhados entre réplicas → fora (trade-off registrado na D22).
- Janela deslizante na entrada → fora: custa até 4 vezes mais memória por IP (medido), e o pico na virada da janela fixa fica registrado na D22.
- Helper genérico de cache (`getOrCompute`) → fora, porque piora a leitura.
- Juntar as subclasses de `AppError`, deixar `logger.ts` e `prisma-client.ts` inline, juntar `bearer-auth.ts` ao `cache-route.ts` → fora.
- Achatar pastas (as pastas `domain/cep` e `domain/geo` ficam) → fora.
- `ALL_UFS` (a repetição fica) e `data/ceps-removidos.csv` (fica no repositório) → fora.

## Decisões e respostas do usuário
- P: O projeto escalou demais para um teste técnico? → R: Sim. Reduzir arquivos e complexidade sem perder o que o enunciado pede.
- P: Juntar as interfaces da aplicação num `ports.ts`? → R: Primeiro sim, e o `ports.ts` foi feito na tarefa 5. Depois do `/implement`, o usuário revisou e não gostou: o `application/` passa a ter as pastas `cache/`, `errors/` e `providers/`, cada porta volta a um arquivo próprio, e o caso de uso `find-nearby-ceps.ts` e a porta `cep-repository.ts` ficam em `use-cases/`, pasta que o próprio usuário criou durante a tarefa 11. As chaves do cache continuam junto da interface `Cache`.
- P: Juntar `errors.ts` e `error-catalog.ts` da apresentação e tirar a const `ErrorCode`? → R: Sim.
- P: Onde ficam os erros que só a camada HTTP gera (401, 404 de rota, 400 genérico, 500)? → R: Numa tabela `HTTP_ERRORS` no `errors.ts`, com `sendError(res, entry)`.
- P: Trocar as 9 subclasses de `AppError` por `new AppError(kind)`? → R: Não.
- P: Juntar `haversine` + `bounding-box` e `cep-code` + `cep-centroid`? → R: Primeiro não, e a duplicação do `toRad` e do `centroid` foi corrigida no lugar. Depois do `/implement`, o usuário revisou e pediu a unificação: um arquivo por pasta, `domain/cep/cep.ts` e `domain/geo/geo.ts`, com as pastas mantidas e os testes juntados (tarefa 10).
- P: Deixar `logger.ts` e `prisma-client.ts` inline? E o `bearer-auth.ts` dentro do `cache-route.ts`? → R: Não.
- P: O `InMemoryCache` vira fake de teste? → R: Sim, em `tests/fakes/`.
- P: O cache da BrasilAPI e do Nominatim é em memória? → R: Não. Ele fica no Redis (`address:`, `geocode:` e `result:`). Em memória ficam só os rate limits, e o `InMemoryCache` é usado só nos testes.
- P: Que rate limit fica? → R: Primeiro, só o de saída. Depois, o usuário decidiu manter também o de entrada, com o `429`. Os dois ficam em memória, por processo, sem Redis nem Lua.
- P: Se o limite de saída existe, por que ele não responde 429? → R: O 429 só vinha do limite de entrada. O de saída é a cota da API com o terceiro, e por isso responde `503 PROVEDOR_INDISPONIVEL`, como hoje.
- P: O limite de entrada reaproveita o `WindowRateLimiter`? → R: Não. Ele guarda um timestamp por chamada (até ~830 bytes por IP, medido) e não descarta IPs parados. Fica o `express-rate-limit` com o store em memória padrão (~205 bytes por IP, fixo, e descarta IPs sem requisição por uma janela), que já agrupa IPv6 e monta os headers.
- P: E o `await` do `redis.connect()`, que existia por causa do store do rate limit? → R: Sai.
- P: Helper genérico de cache (`getOrCompute`)? → R: Não, porque piora a leitura.
- P: `limitedFetch` para os providers? → R: Sim, porque facilita um terceiro provider de CEP.
- P: O `limitedFetch` tem teste próprio? → R: Sim, com limite, timeout e falha de rede. Os testes dos providers ficam com URL, status e parse.
- P: `ALL_UFS` em 29 linhas? → R: Fica como está.
- P: Arquivos da raiz? → R: Saem `.git-blame-ignore-revs`, `.nvmrc` e `vitest.config.ts`, e o Prettier vai para o `package.json`. O `graphify-out` fica, porque é a ferramenta de economia de tokens.
- P: E o `data/ceps-removidos.csv`? → R: Fica.
- P: `docs/specs/` e `HISTORIAS.md`? → R: Vão para uma branch `docs`, mas fora desta US: a spec desta US fica em `docs/specs/` até o close-spec, e o mapa ainda tem a US9 e a US10.
- P: A US9 e a US10 continuam? → R: Sim, depois desta. A US9 mantém o critério do `/saude` fora do rate limit.
- P: Como o `DECISOES.md` registra a mudança? → R: Reescrever a D22. A D30 fica, porque o contador de entrada continua (a primeira resposta, apagar a D30, partia da saída do limite de entrada).
- P: Uma US ou duas? → R: Uma, a US12.
- P: Auditoria da arquitetura em camadas (ports and adapters, service layer, repository, dependências só para baixo): o que entra? → R: Os três ajustes da auditoria: o `429` sai da `application` para o `HTTP_ERRORS` (o `RateLimitExceededError` era um erro da borda HTTP que nenhum caso de uso lançava); o cálculo dos vizinhos vai para o `domain` (`nearestCeps`, no `cep.ts`); e o ESLint passa a barrar import entre camadas (tarefas 13 a 15). Ficam como estão: o seed com `pg` + `COPY` direto, o caso de uso tipado por `ReturnType` na apresentação e o `'nominatim'` em `OriginSource`.
- P: O `presentation/` também se divide? As funções da `nearby-ceps-route.ts` que não são rota (leitura da query, `round2`, `toSummaryResponse`, `toDetailedResponse`...) se movem ou a lógica muda? → R: Depois do `/implement`, o usuário pediu a divisão. As funções se movem para `mappers/nearby-ceps-mapper.ts`, que traduz nos dois sentidos (req → input do caso de uso, resultado → JSON em português), porque a tradução do contrato é da borda (AGENTS.md) e não pode subir para `application/`. O `errors.ts` se divide: o catálogo e o `sendError` em `errors/`, o `notFoundHandler` e o `errorHandler` em `middlewares/error-handler.ts` (tarefa 12).

## Premissas
Nenhuma.

## Design técnico

### Rate limit de entrada (em memória)
- Remover `infrastructure/rate-limit/redis-rate-limit-store.ts` e a dependência `rate-limit-redis`.
- `presentation/http/rate-limit.ts`: o `rateLimitMiddleware` perde `store` e `passOnStoreError` e passa a usar o store padrão do `express-rate-limit` (`MemoryStore`). O `logger` recebe o do pino direto (`Pick<Logger, 'warn' | 'error'>`): sem store remoto, só sobram os avisos de configuração da biblioteca, e o adaptador que rebaixava falha de store para `warn` perde o motivo. O resto fica igual: `429 LIMITE_EXCEDIDO` (pelo `HTTP_ERRORS` desde a tarefa 13), headers draft-8 e `skip` para contar uma vez por requisição (D30).
- `app.ts`: o `rateLimit` de `AppDeps` perde o `store`. O `trustProxy` fica.
- Como o `MemoryStore` (express-rate-limit 8.7.1) gasta memória:
  - um contador por IP (janela fixa), com custo fixo de ~205 bytes por IP, medido com 100 mil IPs;
  - dois `Map`s, um da janela atual e um da anterior; a cada `windowMs`, os IPs que não voltaram são descartados (o timer usa `unref`);
  - IPv6 agrupado por sub-rede /56;
  - a memória fica limitada aos IPs distintos das últimas ~2 janelas: 10 mil IPs ≈ 2–4 MB, 100 mil ≈ 20–40 MB.
- O `WindowRateLimiter` não serve para a entrada: ele guarda um timestamp por chamada (até ~830 bytes por IP a 60 req/min, medido) e não descarta IPs parados.

### Rate limit de saída (em memória)
- Remover `infrastructure/rate-limit/redis-window-rate-limiter.ts` e `infrastructure/http/rate-limiter.ts`.
- Mover `infrastructure/http/window-rate-limiter.ts` e o teste dele para `infrastructure/rate-limit/`, sem o `implements RateLimiter`. O `tryAcquire()` continua síncrono.
- Os providers recebem `limiter?: WindowRateLimiter`. O default de cada um é o único lugar com o limite: `new WindowRateLimiter(5, 1000)` na BrasilAPI e `new WindowRateLimiter(1, 1000)` no Nominatim. O `index.ts` não passa limiter.
- Nos testes, `new WindowRateLimiter(0, 1000)` é o limiter que sempre recusa.

### Subida sem esperar o Redis (`index.ts`)
```ts
const redis = createRedisClient(env.redisUrl, logger);
// Not awaited: until Redis connects, the cache degrades to miss, as it does when Redis drops at runtime.
// The client keeps retrying and logs each failure through its 'error' handler, so connect() rarely rejects.
void redis.connect().catch(() => undefined);
```
O `await` só existia para o store do rate limit no Redis carregar os scripts com o cliente conectado. O `REDIS_CONNECT_TIMEOUT_MS` sai, e o `withTimeout` deixa de ser exportado, porque só o `redis-cache.ts` o usa.

### `limitedFetch` (`infrastructure/http/limited-fetch.ts`)
```ts
export interface LimitedFetchOptions {
  /** Names the service in the logs, e.g. 'BrasilAPI'. */
  service: string;
  limiter: WindowRateLimiter;
  timeoutMs: number;
  logger: Pick<Logger, 'warn'>;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

export type HttpOutcome = { ok: true; status: number; body: unknown } | { ok: false };

/** GET with rate limit and timeout; a refused, failed or timed-out call is logged and returns `{ ok: false }`. */
export async function limitedFetch(url: string, options: LimitedFetchOptions): Promise<HttpOutcome>
```
- Sem vaga no limiter: log `warn` (`<service> rate limit reached, skipping call`) e `{ ok: false }`, sem chamar o `fetch`.
- Falha de rede ou timeout (`AbortSignal.timeout`): log `warn` (`<service> request failed`) e `{ ok: false }`.
- Com resposta: `{ ok: true, status, body }`, com `body` igual a `undefined` quando o corpo não é JSON.
- Cada provider monta um `LimitedFetchOptions` no construtor e fica só com URL, status e parse:

```ts
async lookup(cep: string): Promise<AddressLookup> {
  const response = await limitedFetch(`${this.baseUrl}/${cep}`, this.http);
  if (!response.ok) return { status: 'unavailable' };
  if (response.status === 200) return this.parseFound(cep, response.body);
  if (response.status === 404) return this.parseNotFound(cep, response.body);
  this.logger.warn({ cep, status: response.status }, 'BrasilAPI unexpected status');
  return { status: 'unavailable' };
}
```

O Nominatim passa `User-Agent` e `Accept-Language` em `headers`. Os logs de "unexpected status" e "invalid body" continuam nos providers, com o `cep` ou a consulta.

### Portas da aplicação (pastas por responsabilidade)
O `ports.ts` da tarefa 5 sai na tarefa 11, e cada porta volta a ter um arquivo, sem mudar nenhum tipo:

```
src/application/
  use-cases/
    find-nearby-ceps.ts (+test)    caso de uso principal
    cep-repository.ts              CepRepository e StoredCep
  cache/
    cache.ts                       Cache, prefixos e resultKey/addressKey/geocodeKey
    clear-cache.ts (+test)
  errors/
    errors.ts (+test)              AppError e subclasses
  providers/
    cep-address-provider.ts        CepAddressProvider, CepAddress e AddressLookup
    caching-cep-address-provider.ts (+test)
    geocoder.ts                    Geocoder, GeocodeQuery, GeocodeCandidate e GeocodeLookup
    origin-geocoder.ts (+test)
```

Os imports de `application`, `infrastructure`, `presentation`, `index.ts`, `scripts/seed` e `tests/fakes` passam a apontar para os arquivos novos.

### Erros na apresentação (`presentation/http/errors.ts`)
- Absorve `ERROR_CATALOG` (com todas as entradas de hoje; o `rate_limit_exceeded` → `429 LIMITE_EXCEDIDO` sai na tarefa 13 e vira `HTTP_ERRORS.rateLimitExceeded`) e `ErrorCatalogEntry`, com `codigo: string`. Sai a const `ErrorCode`.
- Ganha a tabela dos erros que só a camada HTTP gera:

```ts
/** Errors raised by the HTTP layer itself, outside the use cases. */
export const HTTP_ERRORS = {
  unauthorized: { status: 401, codigo: 'NAO_AUTORIZADO', mensagem: 'Token de acesso inválido ou ausente' },
  routeNotFound: { status: 404, codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado' },
  badRequest: { status: 400, codigo: 'PARAMETRO_INVALIDO', mensagem: 'Requisição inválida' },
  internal: { status: 500, codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' },
} satisfies Record<string, ErrorCatalogEntry>;

export function sendError(res: Response, { status, codigo, mensagem }: ErrorCatalogEntry): void
```

- `notFoundHandler`, `errorHandler` e `bearer-auth.ts` chamam `sendError(res, HTTP_ERRORS.<erro>)` ou `sendError(res, ERROR_CATALOG[err.kind])`. As respostas ficam iguais, byte a byte.

### Apresentação em pastas (`presentation/http/`)
```
src/presentation/http/
  app.ts (+test)
  routes/
    nearby-ceps-route.ts           só o Router
    cache-route.ts (+test)
  middlewares/
    bearer-auth.ts
    rate-limit.ts (+test)
    error-handler.ts (+test)       notFoundHandler e errorHandler
  errors/
    errors.ts (+test)              ErrorCatalogEntry, ERROR_CATALOG, HTTP_ERRORS e sendError
  mappers/
    nearby-ceps-mapper.ts          toNearbyCepsInput(req, withAddress), toSummaryResponse e toDetailedResponse
```

- O `nearbyCepsRouter` só registra as duas rotas: `res.json(toSummaryResponse(await find(toNearbyCepsInput(req, false))))`.
- O `parseQueryNumber`, o `round2`, o `toPagination`, o `toCeps` e o `toAddress` ficam privados no mapper. As respostas não mudam.
- O `errors.test.ts` fica com a cobertura do catálogo, e os casos do `errorHandler` vão para `error-handler.test.ts`.

### Arquitetura em camadas (tarefas 13 a 15)
- **Tarefa 13 — 429 na borda:** saem o `RateLimitExceededError` e o kind `rate_limit_exceeded` da `application`, e a entrada do `ERROR_CATALOG`. O `HTTP_ERRORS` ganha `rateLimitExceeded: { status: 429, codigo: 'LIMITE_EXCEDIDO', mensagem: 'Limite de requisições excedido' }`, e o handler do `rateLimitMiddleware` chama `sendError(res, HTTP_ERRORS.rateLimitExceeded)`. O `express-rate-limit` grava o `Retry-After` e os headers `RateLimit` antes de chamar o handler, e o contrato não muda.
- **Tarefa 14 — vizinhos no domínio:** `domain/cep/cep.ts` ganha `nearestCeps(origin, ceps, radiusKm)`, com os tipos `CepPoint` e `Neighbor`: calcula `distanceKm`, filtra pelo raio e ordena por distância e depois por CEP. Fica no `cep.ts`, e não no `geo.ts`, porque trabalha com CEPs, e o `geo.ts` só tem geometria. O `findNearbyCeps` tira a origem da lista, converte `StoredCep` em `CepPoint` e chama o `nearestCeps`; fica com cache, repositório, providers e paginação, e usa o `Neighbor` do domínio no lugar da interface local.
- **Tarefa 15 — camadas no lint:** `no-restricted-imports` por pasta no `eslint.config.js`: `src/domain` não importa `application`, `infrastructure`, `presentation` nem `config`; `src/application` não importa `infrastructure`, `presentation` nem `config`; `src/infrastructure` não importa `presentation`; `src/presentation` não importa `infrastructure` nem `config`. `domain`, `application` e `presentation` também não importam `src/generated` (o cliente do Prisma). A composition root (`src/index.ts`) e os `scripts/` ficam fora da regra.

### Fake de cache (`tests/fakes/in-memory-cache.ts`)
O `InMemoryCache` e o teste dele saem de `src/infrastructure/cache/` para `tests/fakes/`, sem mudar o comportamento (TTL com relógio injetável). O `tsconfig.json` já inclui `tests`. Como nenhum código de produção o usa, ele passa a ser código de teste.

### Trechos repetidos
- `domain/geo/haversine.ts`: exporta o `toRad`. O `bounding-box.ts` usa `toRad(center.lat)` e `EARTH_RADIUS_KM * toRad(1)` no lugar de `* Math.PI / 180`.
- `domain/cep/cep-centroid.ts`: `uniquePointsCentroid(points)` vira `centroid(points)`, que só tira a média. O `assessCep` deduplica uma vez e passa os pontos únicos para o `centroid` e para o p90.
- `application/find-nearby-ceps.ts`: `CachedResult.origin.source` passa a ser obrigatório e sai o `?? 'dataset'`. Não sobra entrada antiga, porque o seed limpa os resultados em cache. `NearbyCepsResult.neighbors` passa a ser `Neighbor[]`, com a interface `Neighbor` declarada antes.
- `scripts/build-dataset/index.ts`: `export const DATASET_HEADER = 'cep;uf;latitude;longitude'`, usado no CSV gerado.
- `scripts/seed/index.ts`:
  - importa `DATASET_HEADER` no lugar do `HEADER` local;
  - `errorMessage(error)` substitui as 4 cópias de `error instanceof Error ? error.message : String(error)`;
  - `matchesUf(line, ufs): boolean` vira `allowedUf(line, ufs): string | null`, que devolve a UF da linha, e o `filteredLines` usa o retorno sem um segundo `split`.

### Domínio com um arquivo por pasta
- `domain/geo/geo.ts` junta `haversine.ts` e `bounding-box.ts`: `Point`, `EARTH_RADIUS_KM`, `toRad`, `haversineKm`, `BoundingBox` e `boundingBox`, nessa ordem.
- `domain/cep/cep.ts` junta `cep-code.ts` e `cep-centroid.ts`: `normalizeCep` e depois `P90_THRESHOLD_KM`, `uniquePoints`, `centroid`, `percentile`, `CepAssessment` e `assessCep`.
- Os testes viram `geo.test.ts` e `cep.test.ts`, com os mesmos casos. Os imports de `application`, `infrastructure` e `scripts/build-dataset` passam a apontar para os arquivos novos.

### Raiz
- Remover `.git-blame-ignore-revs`, `.nvmrc` e `vitest.config.ts`. O Vitest passa a usar o `include` padrão.
- O `.prettierrc.json` vira a chave `"prettier"` do `package.json`, com os mesmos valores.
- `tsconfig.json`: o `include` perde `vitest.config.ts`.
- `.prettierignore`, `.gitignore` e `.dockerignore` não mudam, e o `graphify-out` fica. O `eslint.config.js` só ganha as regras de camada da tarefa 15 e mantém o `graphify-out` no `ignores`.

### Contrato e configuração
- O contrato não muda: continuam o `429 LIMITE_EXCEDIDO`, o `Retry-After` e os headers `RateLimit` e `RateLimit-Policy`.
- Continuam as variáveis `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY`. O `.env.example` e o `docker-compose.yml` não mudam.
- Sem migração e sem dependência nova. Sai a `rate-limit-redis`.

### Documentação
- README:
  - a nota do Nominatim diz "limite em memória, por processo";
  - a seção "Rate limit" descreve a entrada com contador em memória, por processo (janela fixa, ~205 bytes por IP; um IP sem requisição por uma janela sai da memória; IPv6 por /56) e a saída em memória, por processo (janela deslizante). Diz também que os limites não dependem do Redis e que, com mais de uma réplica, cada uma conta separado;
  - sai a frase do `.git-blame-ignore-revs`.
- `DECISOES.md`:
  - na tabela de status, a D22 vira "Nossa API 60 req/min por IP · BrasilAPI 5 req/s · Nominatim 1 req/s, em memória por processo";
  - a "D22 (cont.) — Rate limit na US7" vira "D22 (cont.) — Rate limits em memória (US12)", com o que mudou (os contadores saíram do Redis), como cada limite guarda os dados e quanto custa, e os trade-offs: limite por processo; pico de até 2 vezes o limite na virada da janela fixa; Redis fora não afeta os limites;
  - a D30 continua como está;
  - a D11 (cont.) da US5 deixa de citar o Redis, e a D21 (cont.) troca "o contador do rate limit da US7" por "chaves que não são da API".
- `docs/HISTORIAS.md` já foi atualizado neste `/spec`: US12 no mapa, nota na US7 e o passo final da branch `docs`.

## Arquivos que a mudança toca

Produção e scripts (contam no limite):
- `src/application/ports.ts` — criado na tarefa 5 e removido na tarefa 11 — 0
- `src/application/cache/cache.ts`, `src/application/use-cases/cep-repository.ts`, `src/application/providers/cep-address-provider.ts`, `src/application/providers/geocoder.ts` — as portas, um arquivo cada (tarefa 11) — ~75 linhas
- `src/application/errors.ts`, `clear-cache.ts`, `caching-cep-address-provider.ts`, `origin-geocoder.ts`, `find-nearby-ceps.ts` → `errors/`, `cache/`, `providers/` e `use-cases/` — mover e ajustar imports (tarefa 11) — ~10 linhas
- `src/application/cache.ts`, `src/application/cep-address-provider.ts`, `src/application/cep-repository.ts`, `src/application/geocoder.ts` — remover — 0
- `src/application/caching-cep-address-provider.ts` — import do `ports` — ~2 linhas
- `src/application/clear-cache.ts` — import do `ports` — ~1 linha
- `src/application/origin-geocoder.ts` — import do `ports` — ~2 linhas
- `src/application/find-nearby-ceps.ts` — import do `ports`; `CachedResult.origin.source` obrigatório; `Neighbor[]` — ~8 linhas
- `src/index.ts` — sem os limiters do Redis e o store, `redis.connect()` sem `await` (o `catch` só evita rejeição sem tratamento; quem loga a falha é o handler `'error'` do cliente) — ~10 linhas
- `src/domain/geo/haversine.ts` — exportar `toRad` — ~1 linha
- `src/domain/geo/bounding-box.ts` — usar `toRad` — ~3 linhas
- `src/domain/cep/cep-centroid.ts` — `uniquePointsCentroid` → `centroid`; `assessCep` — ~4 linhas
- `src/infrastructure/cache/redis-cache.ts` — import do `ports`; `withTimeout` privado; sai `REDIS_CONNECT_TIMEOUT_MS` — ~2 linhas
- `src/infrastructure/cache/in-memory-cache.ts` → `tests/fakes/in-memory-cache.ts` — mover, com import do `ports` — 0 (vira teste)
- `src/infrastructure/db/prisma-cep-repository.ts` — import do `ports` — ~1 linha
- `src/infrastructure/http/limited-fetch.ts` — criar: `limitedFetch`, `LimitedFetchOptions`, `HttpOutcome` — ~35 linhas
- `src/infrastructure/http/brasil-api-cep-provider.ts` — usa `limitedFetch`; `limiter?: WindowRateLimiter`; imports — ~20 linhas
- `src/infrastructure/http/nominatim-geocoder.ts` — idem — ~20 linhas
- `src/infrastructure/http/rate-limiter.ts` — remover — 0
- `src/infrastructure/http/window-rate-limiter.ts` → `src/infrastructure/rate-limit/window-rate-limiter.ts` — mover, sem `implements RateLimiter` — ~1 linha
- `src/infrastructure/rate-limit/redis-window-rate-limiter.ts`, `src/infrastructure/rate-limit/redis-rate-limit-store.ts` — remover — 0
- `src/presentation/http/app.ts` — `rateLimit` sem `store` — ~1 linha
- `src/presentation/http/rate-limit.ts` — sem `store` e `passOnStoreError`; `logger` do pino direto — ~4 linhas
- `src/presentation/http/errors.ts` — `ERROR_CATALOG`, `ErrorCatalogEntry`, `HTTP_ERRORS`, `sendError(res, entry)`; sem `ErrorCode` — ~65 linhas
- `src/presentation/http/error-catalog.ts` — remover — 0
- `src/presentation/http/bearer-auth.ts` — `sendError(res, HTTP_ERRORS.unauthorized)` — ~2 linhas
- `src/presentation/http/nearby-ceps-route.ts` → `routes/` — só o `Router` (tarefa 12) — ~5 linhas
- `src/presentation/http/mappers/nearby-ceps-mapper.ts` — criar com as funções que saem da rota (tarefa 12) — ~65 linhas
- `src/presentation/http/middlewares/error-handler.ts` — criar com `notFoundHandler` e `errorHandler`, que saem do `errors.ts` (tarefa 12) — ~25 linhas
- `src/presentation/http/errors.ts`, `bearer-auth.ts`, `rate-limit.ts`, `cache-route.ts` → `errors/`, `middlewares/` e `routes/` — mover e ajustar imports (tarefa 12) — ~10 linhas
- `src/domain/geo/geo.ts` — criar a partir de `haversine.ts` + `bounding-box.ts` — ~40 linhas
- `src/domain/cep/cep.ts` — criar a partir de `cep-code.ts` + `cep-centroid.ts` — ~50 linhas
- `src/domain/geo/haversine.ts`, `src/domain/geo/bounding-box.ts`, `src/domain/cep/cep-code.ts`, `src/domain/cep/cep-centroid.ts` — remover — 0
- `scripts/build-dataset/index.ts` — `DATASET_HEADER`; import do `cep.ts` — ~4 linhas
- `scripts/seed/index.ts` — import do `ports`; `DATASET_HEADER`; `errorMessage` (inclusive no `catch` do `clearResultCache`); `allowedUf` — ~12 linhas
- `eslint.config.js` — `no-restricted-imports` por camada (tarefa 15). Além das camadas de cima, `domain`, `application` e `presentation` também não importam `src/generated` (o cliente do Prisma), que só a `infrastructure` usa — ~23 linhas

Testes (não contam):
- Criar: `src/infrastructure/http/limited-fetch.test.ts`; `src/presentation/http/middlewares/error-handler.test.ts` (a partir do `errors.test.ts` da `main`, com `notFoundHandler` e `errorHandler`).
- Juntar: `haversine.test.ts` + `bounding-box.test.ts` → `src/domain/geo/geo.test.ts`; `cep-code.test.ts` + `cep-centroid.test.ts` → `src/domain/cep/cep.test.ts` (com os casos do `nearestCeps`).
- Mover para as pastas novas, junto dos arquivos: os testes da `application` (`cache/`, `errors/`, `providers/`, `use-cases/`) e da `presentation/http` (`errors/`, `middlewares/`, `routes/`); o `error-catalog.test.ts` vira `src/presentation/http/errors/errors.test.ts`, com o teste de cobertura do catálogo; `src/infrastructure/cache/in-memory-cache.test.ts` → `tests/fakes/in-memory-cache.test.ts`; `src/infrastructure/http/window-rate-limiter.test.ts` → `src/infrastructure/rate-limit/window-rate-limiter.test.ts`.
- Remover: `src/infrastructure/rate-limit/redis-rate-limit-store.test.ts` e `src/infrastructure/rate-limit/redis-window-rate-limiter.test.ts`.
- Alterar (caminhos finais): `src/presentation/http/middlewares/rate-limit.test.ts` (saem os casos de falha do store e do adaptador de logger), `src/infrastructure/http/brasil-api-cep-provider.test.ts`, `src/infrastructure/http/nominatim-geocoder.test.ts`, `src/presentation/http/app.test.ts`, `src/presentation/http/routes/cache-route.test.ts`, `src/application/providers/caching-cep-address-provider.test.ts`, `src/application/cache/clear-cache.test.ts`, `src/application/use-cases/find-nearby-ceps.test.ts`, `src/application/providers/origin-geocoder.test.ts` e `scripts/seed/index.test.ts`.

Configuração e documentação (não contam):
- Alterar: `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `docs/DECISOES.md` e `docs/HISTORIAS.md` (já alterado neste `/spec`).
- Remover: `.git-blame-ignore-revs`, `.nvmrc`, `vitest.config.ts` e `.prettierrc.json`.

## Limite de tamanho
A US inteira sai num PR, mergeável sozinho, com **até 500 linhas de lógica** adicionadas ou modificadas. Remoção não conta.

- **Estimativa:** ~270 linhas (bc_giross: ~270), a soma da lista acima. Linhas que só mudam de arquivo (o `ports.ts` e o catálogo no `errors.ts`) contam como adicionadas, porque o git não as reconhece como renomeação, e já estão na estimativa.
- **Não contam:** testes (incluindo `tests/fakes/`), documentação, configuração e dados, lockfiles e código gerado. O `src/generated/` (Prisma, gerado no `npm run postinstall`) não muda.
- **Medição**, sobre os commits da branch:

  ```bash
  git diff --numstat main...HEAD | awk -F'\t' '
    $1 == "-" { next }                                                             # binário
    $3 ~ /(^|\/)(tests?|__tests__|__snapshots__|e2e|docs|migrations)\// { next }  # pastas de teste, doc e gerados
    $3 ~ /\.(test|spec|e2e-spec)\.|_test\.|(^|\/)test_|-contract-test\./ { next } # arquivos de teste
    $3 ~ /\.(md|mdx|json|ya?ml|toml|lock|snap)$/ { next }                          # docs, config e dados
    { s += $1 } END { print s + 0 }'
  ```

Passou de 500? Não divida em partes nem abra mais de um PR: reduza o escopo da US (os critérios cortados viram outra US no mapa) ou simplifique, decidindo com o usuário.

## Triagem de implementação
Preenchido no `/pato/spec`; o `/pato/implement` confirma o modo com o usuário antes de começar.

| Métrica | Valor |
| --- | --- |
| Tarefas | 9 estimadas; 15 ao fim (as tarefas 10 a 15 entraram durante a implementação) |
| Arquivos que a mudança toca | ~59 estimados (31 de produção e scripts, 18 de teste, 10 de configuração e docs); 71 ao fim, pelas tarefas 10 a 15 |
| Linhas de lógica estimadas | ~270; 339 medidas ao fim (ver "Riscos") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Não |
| Dependência nova | Não (sai a `rate-limit-redis`) |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são 9 tarefas e dezenas de arquivos.

## Tarefas
Passos (commits) desta US. Todos entram no mesmo PR; tarefa não é entregável.
- [x] 1. Rate limit de entrada em memória: saem o `redis-rate-limit-store.ts` (e o teste dele) e a dependência `rate-limit-redis`; o `rateLimitMiddleware` perde `store` e `passOnStoreError` e recebe o logger do pino direto; `app.ts` e `index.ts` ficam sem o store. O `rate-limit.test.ts` perde os casos de falha do store.
- [x] 2. Rate limit de saída em memória: saem o `redis-window-rate-limiter.ts` e a interface `RateLimiter`; o `window-rate-limiter.ts` e o teste dele vão para `infrastructure/rate-limit/`; os providers recebem `WindowRateLimiter`, com o limite no default; o `index.ts` não passa limiter nem espera o `redis.connect()`; o `withTimeout` fica privado e sai o `REDIS_CONNECT_TIMEOUT_MS`.
- [x] 3. `limitedFetch`: cria `limited-fetch.ts` e o teste dele (limite, timeout, falha de rede, corpo não JSON, headers). BrasilAPI e Nominatim passam a usá-lo, e os testes dos providers ficam com URL, status e parse.
- [x] 4. `InMemoryCache` em `tests/fakes/`: move o fake e o teste dele e atualiza os imports dos testes.
- [x] 5. `application/ports.ts`: junta as 4 interfaces e as chaves do cache e atualiza os imports de produção, testes, fake e seed.
- [x] 6. Erros da apresentação: o `errors.ts` absorve o catálogo e ganha `HTTP_ERRORS` e `sendError(res, entry)`; saem a const `ErrorCode` e o `error-catalog.ts`; o `bearer-auth.ts` passa a usar a tabela; o teste do catálogo vai para `errors.test.ts`.
- [x] 7. Trechos repetidos: `toRad` no `bounding-box`, `centroid`, `findNearbyCeps` sem compatibilidade com cache antigo e com `Neighbor[]`, e `DATASET_HEADER`, `errorMessage` e `allowedUf` no seed.
- [x] 8. Raiz: remove `.git-blame-ignore-revs` e `.nvmrc`; move o Prettier para o `package.json` (`npm run format:check` sem diferença); remove o `vitest.config.ts` e o tira do `tsconfig.json`, conferindo que o Vitest roda os mesmos arquivos e testes antes e depois.
- [x] 9. Documentação: README e `DECISOES.md` (D22, D11 cont., D21 cont. e tabela de status).
- [x] 10. Domínio com um arquivo por pasta: `domain/geo/geo.ts` (`haversine` + `bounding-box`) e `domain/cep/cep.ts` (`cep-code` + `cep-centroid`), com os testes juntados e os imports atualizados.
- [x] 11. `application/` em pastas: sai o `ports.ts`; `cache/` (`cache.ts`, `clear-cache.ts`), `errors/` (`errors.ts`) e `providers/` (`cep-address-provider.ts`, `geocoder.ts`, `caching-cep-address-provider.ts`, `origin-geocoder.ts`); `use-cases/` (`find-nearby-ceps.ts`, `cep-repository.ts`); testes junto dos arquivos e imports atualizados.
- [x] 12. `presentation/http/` em pastas: `routes/`, `middlewares/` (`bearer-auth`, `rate-limit`, `error-handler`), `errors/` e `mappers/nearby-ceps-mapper.ts`; a rota fica só com o `Router`; testes junto dos arquivos e imports atualizados.
- [x] 13. `429` na borda: sai o `RateLimitExceededError` da `application`; `HTTP_ERRORS.rateLimitExceeded` e `sendError` no handler do `rateLimitMiddleware`; testes do `429` sem mudar o esperado.
- [x] 14. `nearestCeps` em `domain/cep/cep.ts`, com teste próprio (raio, ordem, desempate por CEP, borda do raio, lista vazia); o `findNearbyCeps` passa a usá-lo.
- [x] 15. Camadas no ESLint: `no-restricted-imports` por pasta no `eslint.config.js`, conferindo que um import proibido faz o `npm run lint` falhar.

## Telas e fluxos E2E (Playwright)
Não se aplica (API sem telas).

## Testes
- **Automatizados:** `npm test`, `npm run lint`, `npm run typecheck` e `npm run format:check`, todos passando a cada tarefa. A linha de base na `main` é de 26 arquivos de teste e 258 testes. Ao fim da US, a contagem cai com a saída dos testes do store e do limiter do Redis e dos casos de limite, timeout e rede que deixam os providers, e sobe com os testes do `limitedFetch`. Na tarefa 8, a contagem do Vitest é a mesma antes e depois de remover o `vitest.config.ts`.
- **Novos:** `limited-fetch.test.ts` cobre: sem vaga → `{ ok: false }` sem chamar o `fetch`; falha de rede e timeout → `{ ok: false }` com `warn`; com resposta → `{ ok: true, status, body }`; corpo não JSON → `body: undefined`; headers repassados ao `fetch`.
- **Ajustados:**
  - os testes HTTP (`rate-limit`, `app`, `cache-route`, `errors`) mantêm os mesmos status, corpos e headers esperados, inclusive o `429` com `Retry-After`;
  - o `cep-centroid.test.ts` testa o `centroid` como média simples e a deduplicação pelo `assessCep`;
  - o `seed/index.test.ts` testa o `allowedUf` no lugar do `matchesUf`.
- **Manual** (`docker compose up -d --build`, com um Redis novo):
  1. `for i in $(seq 1 70); do curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/ceps-proximos/01310100; done | sort | uniq -c` → 60 respostas `200` e 10 respostas `429`.
  2. `curl -si localhost:3000/ceps-proximos/01310100 | grep -i ratelimit` → headers `RateLimit` e `RateLimit-Policy` presentes.
  3. `docker compose exec redis redis-cli --scan --pattern 'ratelimit:*'` → nada.
  4. `docker compose stop redis && docker compose restart api` e depois repetir o passo 1 → a API responde sem cache, com log `warn` do Redis, e continua devolvendo `429` depois da 60ª requisição.
  5. `curl -s localhost:3000/ceps-proximos/01001000/detalhes` → mesma resposta de antes (fallback do Nominatim).

## Verificação independente
Preenchido no `/pato/verify`; o `/pato/close-spec` não começa sem esta seção.

- **Data:** 2026-10-28.
- **Verificador:** subagente em contexto limpo, em duas rodadas: a verificação completa até `0668cdf` e uma re-verificação das correções (`0b36c87` e `3512a4d`).
- **Suítes rodadas:** `npm test` (23 arquivos e 256 testes, 0 falhas), `npm run lint`, `npm run typecheck` e `npm run format:check`, todos com exit 0 no HEAD das duas rodadas. Na primeira rodada, as quatro suítes passaram em cada commit da branch, rodadas via `git archive`. No commit da tarefa 8, o Vitest rodou os mesmos 24 arquivos e 252 testes antes e depois de remover o `vitest.config.ts`. Não há Playwright, porque a API não tem telas.
- **Critérios de aceite:** os 11 foram atendidos.
  - O 1 e o 3 foram conferidos subindo o `src/index.ts`. Com `REDIS_URL=redis://127.0.0.1:1` e `RATE_LIMIT_MAX=3`, a API logou "api listening" antes do erro do Redis e respondeu `404 404 429 429 429`. O `429` veio com `Retry-After: 60`, `RateLimit`, `RateLimit-Policy` e o corpo `LIMITE_EXCEDIDO`, sem unhandled rejection.
  - O 2 foi conferido com um script de teste, com o Redis fora e um `fetch` falso. Das 7 consultas de CEP fora da base, todas deram `503` e só 5 chamaram o `fetch`. O `/detalhes` de CEP na base deu `endereco: null`, e não sobra nenhum `ratelimit:` em `src/`.
  - Para o 11, imports proibidos passados pelo `eslint --stdin` deram erro `no-restricted-imports`, inclusive um da `application` para o `src/generated`.
- **Entregável:** sim. A branch parte da `main` (`89015ce`) e só tem commits desta US. Não há `TODO`, flag nem camada faltando, e a API sobe e atende de ponta a ponta.
- **Linhas de lógica:** 339 contra 500 (337 ao fim da tarefa 15, mais 2 das correções).
- **Achados:** nenhum de severidade Alta ou Média. Os de severidade Baixa foram:
  1. Spec defasada: a triagem, a lista de arquivos e de testes, o `eslint.config.js` "não muda", o trecho antigo do `connect` e o critério 3 desmarcado. Foi corrigida em `3512a4d` e `1ae1bfd`.
  2. A regra de camadas também barra o `src/generated`, o que a spec não registrava. Ficou registrado na tarefa 15 e na lista de arquivos.
  3. O seed importa o `DATASET_HEADER` do `build-dataset` e, com ele, carrega o `read-cnefe` e o `yauzl`. Foi aceito e registrado em Riscos, para não criar um arquivo só para a constante.
  4. Um `(error as Error).message` sobrava no seed. Agora usa o `errorMessage` (`0b36c87`).
  5. O `.catch` do `redis.connect()` logava um warn que nunca aparecia. Agora o `catch` é vazio, com um comentário dizendo que quem loga a falha é o handler `'error'` (`0b36c87`).
- **Não verificado:** o teste manual com `docker compose` (passos 1 a 5), o fluxo com Postgres e Redis reais, a reconexão do Redis depois de subir sem ele e o custo de ~205 B/IP do `MemoryStore`.
- **Decisão do usuário:** corrigir os achados de severidade Baixa. Os itens 1, 2, 4 e 5 foram corrigidos, e o 3 foi aceito com registro.

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-28 | Automatizado | local | local | `npm test` (23 arquivos, 256 testes), `npm run lint`, `npm run typecheck` e `npm run format:check` | Aprovado | — |
| 2026-10-28 | Verificação independente | subagente (contexto limpo) | local | diff contra a spec em duas rodadas, suítes em cada commit e a API subida sem Redis | Aprovado | seção "Verificação independente" |
| 2026-10-28 | Manual | owhenrique | local (`docker compose`) | passos 1 a 5 de "Testes": `429` depois de 60 requisições, headers `RateLimit`, nenhuma chave `ratelimit:*` no Redis, API respondendo sem Redis e `/detalhes` com fallback do Nominatim | Aprovado | — |

## Riscos e pontos em aberto
- **Limites por processo:** com mais de uma réplica, cada uma conta separado. Na entrada, o total vira N × 60/min; na saída, a política do Nominatim pede 1 req/s no total. O compose sobe uma réplica, e o trade-off fica registrado na D22.
- **Janela fixa na entrada:** um cliente consegue até 2 vezes o limite em poucos segundos, na virada da janela.
- **Memória da entrada:** ~205 bytes por IP distinto nas últimas ~2 janelas. Um volume de ataque precisa ser barrado antes da API (proxy ou WAF).
- **Logger do rate limit:** os avisos de configuração da biblioteca passam a sair no pino com o nível dela (`warn` ou `error`).
- **Logs do `limitedFetch`:** os `warn` de limite e de falha passam a trazer a `url` no lugar do `cep` ou da consulta, e as mensagens mudam de texto.
- **Subida sem `await`:** logo depois da subida, as primeiras requisições podem dar miss no cache até o Redis conectar (milissegundos).
- **Vitest sem config:** o `include` padrão pode encontrar testes fora de `src/`, `scripts/` e `tests/`. A contagem da tarefa 8 cobre isso.
- **Medição:** conteúdo que muda de arquivo conta como linha adicionada. A estimativa já inclui isso.
- **Branch `fix/compose-env`:** é local, parece obsoleta e toca README e `package.json`, que esta US também altera. Se for mergeada depois, precisa de rebase.
- **Branch `docs`:** mover `docs/specs/` e `docs/HISTORIAS.md` é o passo final, depois do close-spec da US10, e está registrado no mapa.
- **Critério 3 sem teste automatizado:** o `redis.connect()` sem `await` está no `index.ts`. A verificação independente subiu a API com o Redis inacessível e confirmou a subida, o cache em miss e os dois limites valendo; o passo 4 do teste manual repete isso com o compose.
- **Header do `ceps-removidos.csv`:** o `build-dataset` também passou a montar esse header a partir do `DATASET_HEADER` (`${DATASET_HEADER};p90_km`). A saída não muda.
- **`(error as Error).message` restante:** só o do `main()` do `build-dataset`, que não tem o `errorMessage`. O do `catch` do `clearResultCache` no seed passou a usar o `errorMessage` depois da verificação.
- **Seed importa o `build-dataset`:** para usar o `DATASET_HEADER`, o seed carrega o módulo do `build-dataset`, que traz o `read-cnefe` e o `yauzl`. O `main()` do build não roda (guard no fim do `index.ts`), e o `yauzl` está em `dependencies`, então a imagem do compose tem tudo. Ficou assim para não criar um arquivo só para a constante.
- **Medição:** o placar final é 339, contra ~270 estimados (292 até a tarefa 9; 340 com a tarefa 10, porque o git vê `geo.ts` e `cep.ts` como arquivos novos; 267 com a tarefa 11, porque as portas voltaram aos arquivos da `main` e o git as vê como renomeação; 294 com a tarefa 12, pelo mapper e pelo `error-handler.ts` novos; 337 com as tarefas 13 a 15, pelo `nearestCeps` e pelas regras de camada no `eslint.config.js`, que a medição conta por ser `.js`; 339 com as correções da verificação, pelo comentário do `connect` no `index.ts` e pelo `errorMessage` no seed). O resto da diferença vem do Prettier, que quebrou em várias linhas os imports juntados e as entradas do `HTTP_ERRORS`, e dos comentários de seção do `ports.ts`.
