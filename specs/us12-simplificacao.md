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
Como **time de desenvolvimento**, quero os rate limits em memória, sem depender do Redis, e o código sem arquivos de poucas linhas nem trechos repetidos, para entender a solução de relance e evoluí-la com menos peças.

## Contexto
O enunciado é para uma vaga Jr com prazo de 2 dias, e quem lê o código, inclusive quem avalia o teste, paga por cada peça a mais. Esta US deixa os dois rate limits em memória, por processo, sem depender do Redis: a entrada (60 req/min por IP, com `429 LIMITE_EXCEDIDO`) no store padrão do `express-rate-limit` e a saída (BrasilAPI 5 req/s, Nominatim 1 req/s) no `WindowRateLimiter`. Também organiza o código em pastas por responsabilidade, concentra as chamadas externas no `limitedFetch` e os erros da borda HTTP numa tabela, leva o cálculo dos vizinhos para o domínio e faz o lint barrar import entre camadas. O contrato da API não muda.

No mapa (`docs/HISTORIAS.md`), a US12 roda depois da US8 e antes da US9; o número é só de cadastro.

## Critérios de aceite
- [x] 1. Dado mais de `RATE_LIMIT_MAX` requisições (padrão 60) do mesmo IP dentro da janela, quando ele chama a API, então recebe `429 LIMITE_EXCEDIDO` com `Retry-After` e os headers `RateLimit`/`RateLimit-Policy`. O contador fica em memória, por processo, no store padrão do `express-rate-limit`: um contador por IP, que sai da memória depois de uma janela sem requisições.
- [x] 2. Dado a BrasilAPI já chamada 5 vezes no último segundo, quando uma consulta precisa dela, então o provider devolve indisponível sem chamá-la: `503 PROVEDOR_INDISPONIVEL` para CEP fora da base, `origem.endereco: null` no `/detalhes` para CEP na base. O mesmo vale para o Nominatim com 1 req/s. A contagem fica em memória, por processo.
- [x] 3. Dado o Redis fora do ar, quando a API sobe, então ela sobe sem esperar por ele e responde sem cache, como quando ele cai com a API rodando, e os dois rate limits valem.
- [x] 4. Dado as rotas e os erros (`GET /ceps-proximos/:cep`, `GET /ceps-proximos/:cep/detalhes`, `DELETE /cache`, `DELETE /cache/:cep`, rota inexistente, token errado, requisição malformada, limite excedido e erro interno), quando chamados, então status, corpo e headers não mudam: os testes HTTP passam sem mudar o status, o corpo nem os headers esperados.
- [x] 5. Dado o `src/` (fora `src/generated`), então ele tem 29 arquivos de produção e nenhuma pasta foi achatada: `domain/cep/cep.ts` (normalização do CEP, centróide, p90 e `nearestCeps`) e `domain/geo/geo.ts` (Haversine e bounding box), cada um com um teste; o `application/` sem arquivos na raiz, com as pastas `use-cases/` (`find-nearby-ceps.ts` e a porta `cep-repository.ts`), `cache/` (porta `Cache` com as chaves e `clear-cache.ts`), `errors/` (`errors.ts`) e `providers/` (portas `cep-address-provider.ts` e `geocoder.ts`, `caching-cep-address-provider.ts` e `origin-geocoder.ts`); o `presentation/http/` com `app.ts` na raiz e as pastas `routes/` (só os `Router`s), `middlewares/` (`bearer-auth.ts`, `rate-limit.ts`, `error-handler.ts`), `errors/` (catálogo, `HTTP_ERRORS` e `sendError` em `errors.ts`) e `mappers/` (`nearby-ceps-mapper.ts`, com a leitura da query e a tradução para o contrato); o `WindowRateLimiter` em `infrastructure/rate-limit/`; e o `InMemoryCache` em `tests/fakes/`.
- [x] 6. Dado os providers da BrasilAPI e do Nominatim, então limite, timeout e log de falha ficam no `limitedFetch`, cada provider só monta a URL e interpreta a resposta, e o `limitedFetch` tem teste próprio para limite, timeout e falha de rede.
- [x] 7. Dado os trechos repetidos da análise, então cada um existe uma vez só: `toRad` (o bounding box usa o do Haversine); a deduplicação dos pontos (só no `assessCep`; o `centroid` só tira a média); `errorMessage(e)` no seed; o header do CSV (`DATASET_HEADER`); e um `split` por linha no seed. O `findNearbyCeps` usa `neighbors: Neighbor[]`.
- [x] 8. Dado o projeto, quando rodo `npm test`, `npm run lint`, `npm run typecheck` e `npm run format:check`, então todos passam.
- [x] 9. Dado a documentação, então o README e o `DECISOES.md` (D22) descrevem os dois limites em memória, por processo, com o custo do contador de entrada (~205 bytes por IP) e o trade-off com réplicas, e o mapa traz a US12.
- [x] 10. Dado as camadas, então cada uma só importa as de baixo (`domain` ← `application` ← `infrastructure` e `presentation`), a `application` não tem erro que só a borda HTTP gera (o `429` sai do `HTTP_ERRORS`), o cálculo dos vizinhos (raio, ordem e desempate) está no `domain`, e o `npm run lint` falha quando uma camada importa outra que não pode.

## Escopo
**Dentro:**
- Rate limit de entrada em memória, no store padrão do `express-rate-limit`.
- Rate limit de saída em memória: o `WindowRateLimiter` em `infrastructure/rate-limit/`, com o limite só no default de cada provider.
- `index.ts` sem esperar o `redis.connect()`.
- `limitedFetch` para as chamadas da BrasilAPI e do Nominatim.
- `application/` em pastas por responsabilidade (`use-cases/`, `cache/`, `errors/`, `providers/`), com cada porta num arquivo, junto do código que a usa.
- `presentation/http/errors/errors.ts` com o catálogo, a tabela `HTTP_ERRORS` e `sendError(res, entry)`.
- `presentation/http/` em pastas: `routes/`, `middlewares/`, `errors/` e `mappers/`; a rota fica só com o `Router`.
- `InMemoryCache` e o teste dele em `tests/fakes/`.
- Domínio com um arquivo por pasta: `domain/cep/cep.ts` e `domain/geo/geo.ts`.
- Trechos repetidos: `toRad`, `centroid`, `Neighbor[]` no `findNearbyCeps`, `errorMessage`, `DATASET_HEADER` e `allowedUf` no seed.
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
- P: Como organizar as interfaces da aplicação? → R: Em pastas por responsabilidade: `cache/`, `errors/` e `providers/`, com cada porta num arquivo próprio, e o caso de uso `find-nearby-ceps.ts` e a porta `cep-repository.ts` em `use-cases/`. As chaves do cache ficam junto da interface `Cache`.
- P: Onde ficam o catálogo e os códigos de erro da apresentação? → R: Num arquivo só, `errors/errors.ts`, e o catálogo é a fonte dos códigos.
- P: Onde ficam os erros que só a camada HTTP gera (401, 404 de rota, 400 genérico, 429, 500)? → R: Numa tabela `HTTP_ERRORS` no `errors.ts`, com `sendError(res, entry)`.
- P: Trocar as subclasses de `AppError` por `new AppError(kind)`? → R: Não.
- P: Como fica o domínio? → R: Um arquivo por pasta, `domain/cep/cep.ts` e `domain/geo/geo.ts`, com as pastas mantidas e os testes juntados.
- P: Deixar `logger.ts` e `prisma-client.ts` inline? E o `bearer-auth.ts` dentro do `cache-route.ts`? → R: Não.
- P: O `InMemoryCache` vira fake de teste? → R: Sim, em `tests/fakes/`.
- P: O cache da BrasilAPI e do Nominatim é em memória? → R: Não. Ele fica no Redis (`address:`, `geocode:` e `result:`). Em memória ficam só os rate limits, e o `InMemoryCache` é usado só nos testes.
- P: Que rate limits ficam? → R: Os dois: o de entrada, com o `429`, e o de saída, em memória, por processo.
- P: Se o limite de saída existe, por que ele não responde 429? → R: O `429` é do limite de entrada. O de saída é a cota da API com o terceiro, e por isso responde `503 PROVEDOR_INDISPONIVEL`.
- P: O limite de entrada reaproveita o `WindowRateLimiter`? → R: Não. Ele guarda um timestamp por chamada (até ~830 bytes por IP, medido) e não descarta IPs parados. Fica o `express-rate-limit` com o store em memória padrão (~205 bytes por IP, fixo, e descarta IPs sem requisição por uma janela), que já agrupa IPv6 e monta os headers.
- P: A API espera o `redis.connect()` na subida? → R: Não: até o Redis conectar, o cache degrada para miss.
- P: Helper genérico de cache (`getOrCompute`)? → R: Não, porque piora a leitura.
- P: `limitedFetch` para os providers? → R: Sim, porque facilita um terceiro provider de CEP.
- P: O `limitedFetch` tem teste próprio? → R: Sim, com limite, timeout e falha de rede. Os testes dos providers ficam com URL, status e parse.
- P: `ALL_UFS` em 29 linhas? → R: Fica como está.
- P: E o `graphify-out` nas configs? → R: Fica, porque é a ferramenta de economia de tokens.
- P: E o `data/ceps-removidos.csv`? → R: Fica.
- P: `docs/specs/` e `HISTORIAS.md`? → R: Vão para uma branch `docs`, mas fora desta US: a spec desta US fica em `docs/specs/` até o close-spec, e o mapa ainda tem a US9 e a US10.
- P: Como o `DECISOES.md` registra os limites? → R: Na D22. A D30 vale, porque o contador de entrada conta uma vez por requisição do cliente.
- P: Uma US ou duas? → R: Uma, a US12.
- P: Auditoria da arquitetura em camadas (ports and adapters, service layer, repository, dependências só para baixo): o que entra? → R: Três ajustes: o `429` fica no `HTTP_ERRORS`, porque é um erro da borda HTTP que nenhum caso de uso lança; o cálculo dos vizinhos fica no `domain` (`nearestCeps`, no `cep.ts`); e o ESLint barra import entre camadas (tarefas 11 a 13). Ficam como estão: o seed com `pg` + `COPY` direto, o caso de uso tipado por `ReturnType` na apresentação e o `'nominatim'` em `OriginSource`.
- P: Como se divide o `presentation/`? → R: Em pastas. As funções da rota que não são rota (leitura da query, `round2`, `toSummaryResponse`, `toDetailedResponse`...) ficam em `mappers/nearby-ceps-mapper.ts`, que traduz nos dois sentidos (req → input do caso de uso, resultado → JSON em português), porque a tradução do contrato é da borda (AGENTS.md) e não pode subir para `application/`. O catálogo e o `sendError` ficam em `errors/`, e o `notFoundHandler` e o `errorHandler`, em `middlewares/error-handler.ts`.

## Premissas
Nenhuma.

## Design técnico

### Rate limit de entrada (em memória)
- `presentation/http/middlewares/rate-limit.ts`: o `rateLimitMiddleware` usa o store padrão do `express-rate-limit` (`MemoryStore`) e recebe o `logger` do pino direto (`Pick<Logger, 'warn' | 'error'>`), para os avisos de configuração da biblioteca. O `429 LIMITE_EXCEDIDO` sai do `HTTP_ERRORS`, com os headers draft-8 e o `skip` para contar uma vez por requisição (D30).
- `app.ts`: o `rateLimit` de `AppDeps` é `{ limit, windowMs }`.
- Como o `MemoryStore` (express-rate-limit 8.7.1) gasta memória:
  - um contador por IP (janela fixa), com custo fixo de ~205 bytes por IP, medido com 100 mil IPs;
  - dois `Map`s, um da janela atual e um da anterior; a cada `windowMs`, os IPs que não voltaram são descartados (o timer usa `unref`);
  - IPv6 agrupado por sub-rede /56;
  - a memória fica limitada aos IPs distintos das últimas ~2 janelas: 10 mil IPs ≈ 2–4 MB, 100 mil ≈ 20–40 MB.
- O `WindowRateLimiter` não serve para a entrada: ele guarda um timestamp por chamada (até ~830 bytes por IP a 60 req/min, medido) e não descarta IPs parados.

### Rate limit de saída (em memória)
- `infrastructure/rate-limit/window-rate-limiter.ts`: o `WindowRateLimiter`, com o `tryAcquire()` síncrono.
- Os providers recebem `limiter?: WindowRateLimiter`. O default de cada um é o único lugar com o limite: `new WindowRateLimiter(5, 1000)` na BrasilAPI e `new WindowRateLimiter(1, 1000)` no Nominatim. O `index.ts` não passa limiter.
- Nos testes, `new WindowRateLimiter(0, 1000)` é o limiter que sempre recusa.

### Subida sem esperar o Redis (`index.ts`)
```ts
const redis = createRedisClient(env.redisUrl, logger);
// Not awaited: until Redis connects, the cache degrades to miss, as it does when Redis drops at runtime.
// The client keeps retrying and logs each failure through its 'error' handler, so connect() rarely rejects.
void redis.connect().catch(() => undefined);
```
O `withTimeout` é privado do `redis-cache.ts`, o único que o usa.

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

O Nominatim passa `User-Agent` e `Accept-Language` em `headers`. Os logs de "unexpected status" e "invalid body" ficam nos providers, com o `cep` ou a consulta.

### Portas da aplicação (pastas por responsabilidade)
Cada porta tem um arquivo, junto do código que a usa:

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

Os imports de `application`, `infrastructure`, `presentation`, `index.ts`, `scripts/seed` e `tests/fakes` apontam para esses arquivos.

### Erros na apresentação (`presentation/http/errors/errors.ts`)
- Tem o `ERROR_CATALOG` (`kind` → `{ status, codigo, mensagem }`) e o `ErrorCatalogEntry`, com `codigo: string`: o catálogo é a fonte dos códigos.
- Tem a tabela dos erros que só a camada HTTP gera:

```ts
/** Errors raised by the HTTP layer itself, outside the use cases. */
export const HTTP_ERRORS = {
  unauthorized: { status: 401, codigo: 'NAO_AUTORIZADO', mensagem: 'Token de acesso inválido ou ausente' },
  rateLimitExceeded: { status: 429, codigo: 'LIMITE_EXCEDIDO', mensagem: 'Limite de requisições excedido' },
  routeNotFound: { status: 404, codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado' },
  badRequest: { status: 400, codigo: 'PARAMETRO_INVALIDO', mensagem: 'Requisição inválida' },
  internal: { status: 500, codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' },
} satisfies Record<string, ErrorCatalogEntry>;

export function sendError(res: Response, { status, codigo, mensagem }: ErrorCatalogEntry): void
```

- `notFoundHandler`, `errorHandler`, `bearer-auth.ts` e o handler do `rateLimitMiddleware` chamam `sendError(res, HTTP_ERRORS.<erro>)` ou `sendError(res, ERROR_CATALOG[err.kind])`. As respostas ficam iguais, byte a byte.

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
- O `errors.test.ts` fica com a cobertura do catálogo, e os casos do `errorHandler` ficam em `error-handler.test.ts`.

### Arquitetura em camadas
- **429 na borda:** o `429` é um erro da borda HTTP, que nenhum caso de uso lança: fica no `HTTP_ERRORS` (`rateLimitExceeded`), e o handler do `rateLimitMiddleware` chama `sendError(res, HTTP_ERRORS.rateLimitExceeded)`. O `express-rate-limit` grava o `Retry-After` e os headers `RateLimit` antes de chamar o handler.
- **Vizinhos no domínio:** `domain/cep/cep.ts` tem `nearestCeps(origin, ceps, radiusKm)`, com os tipos `CepPoint` e `Neighbor`: calcula `distanceKm`, filtra pelo raio e ordena por distância e depois por CEP. Fica no `cep.ts`, e não no `geo.ts`, porque trabalha com CEPs, e o `geo.ts` só tem geometria. O `findNearbyCeps` tira a origem da lista, converte `StoredCep` em `CepPoint` e chama o `nearestCeps`; fica com cache, repositório, providers e paginação, e usa o `Neighbor` do domínio.
- **Camadas no lint:** `no-restricted-imports` por pasta no `eslint.config.js`: `src/domain` não importa `application`, `infrastructure`, `presentation` nem `config`; `src/application` não importa `infrastructure`, `presentation` nem `config`; `src/infrastructure` não importa `presentation`; `src/presentation` não importa `infrastructure` nem `config`. `domain`, `application` e `presentation` também não importam `src/generated` (o cliente do Prisma). A composition root (`src/index.ts`) e os `scripts/` ficam fora da regra.

### Fake de cache (`tests/fakes/in-memory-cache.ts`)
O `InMemoryCache` e o teste dele ficam em `tests/fakes/` (TTL com relógio injetável), porque nenhum código de produção o usa. O `tsconfig.json` inclui `tests`.

### Trechos repetidos
- `toRad`: um só, no `geo.ts`, usado pelo Haversine e pelo bounding box (`toRad(center.lat)` e `EARTH_RADIUS_KM * toRad(1)`).
- Centróide: o `assessCep` deduplica os pontos uma vez e passa os pontos únicos para o `centroid`, que só tira a média, e para o p90.
- `findNearbyCeps`: `NearbyCepsResult.neighbors` é `Neighbor[]`.
- `scripts/build-dataset/index.ts`: `export const DATASET_HEADER = 'cep;uf;latitude;longitude'`, usado no CSV gerado.
- `scripts/seed/index.ts`:
  - importa o `DATASET_HEADER`;
  - `errorMessage(error)` para as mensagens de erro;
  - `allowedUf(line, ufs): string | null` devolve a UF da linha, e o `filteredLines` usa o retorno sem um segundo `split`.

### Domínio com um arquivo por pasta
- `domain/geo/geo.ts`: `Point`, `EARTH_RADIUS_KM`, `toRad`, `haversineKm`, `BoundingBox` e `boundingBox`, nessa ordem.
- `domain/cep/cep.ts`: `normalizeCep` e depois `P90_THRESHOLD_KM`, `uniquePoints`, `centroid`, `percentile`, `CepAssessment`, `assessCep` e o `nearestCeps`.
- Os testes ficam em `geo.test.ts` e `cep.test.ts`.

### Contrato e configuração
- O contrato não muda: continuam o `429 LIMITE_EXCEDIDO`, o `Retry-After` e os headers `RateLimit` e `RateLimit-Policy`.
- Continuam as variáveis `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY`. O `.env.example` e o `docker-compose.yml` não mudam.
- Sem migração e sem dependência nova.

### Documentação
- README:
  - a nota do Nominatim diz "limite em memória, por processo";
  - a seção "Rate limit" descreve a entrada com contador em memória, por processo (janela fixa, ~205 bytes por IP; um IP sem requisição por uma janela sai da memória; IPv6 por /56) e a saída em memória, por processo (janela deslizante). Diz também que os limites não dependem do Redis e que, com mais de uma réplica, cada uma conta separado.
- `DECISOES.md`: na tabela de status, a D22 diz "Nossa API 60 req/min por IP · BrasilAPI 5 req/s · Nominatim 1 req/s, em memória por processo"; a D22 (cont.) descreve como cada limite guarda os dados e quanto custa, e os trade-offs: limite por processo; pico de até 2 vezes o limite na virada da janela fixa; Redis fora não afeta os limites.
- `docs/HISTORIAS.md`: US12 no mapa e o passo final da branch `docs`.

## Arquivos que a mudança toca

Produção e scripts (contam no limite):
- `src/application/cache/cache.ts`, `src/application/use-cases/cep-repository.ts`, `src/application/providers/cep-address-provider.ts`, `src/application/providers/geocoder.ts` — as portas, um arquivo cada — ~75 linhas
- `src/application/errors.ts`, `clear-cache.ts`, `caching-cep-address-provider.ts`, `origin-geocoder.ts`, `find-nearby-ceps.ts` → `errors/`, `cache/`, `providers/` e `use-cases/` — mover e ajustar imports — ~10 linhas
- `src/application/cache.ts`, `src/application/cep-address-provider.ts`, `src/application/cep-repository.ts`, `src/application/geocoder.ts` — remover — 0
- `src/application/find-nearby-ceps.ts` — `Neighbor[]` — ~8 linhas
- `src/index.ts` — `redis.connect()` sem `await` (o `catch` só evita rejeição sem tratamento; quem loga a falha é o handler `'error'` do cliente) — ~10 linhas
- `src/domain/geo/haversine.ts` — exportar `toRad` — ~1 linha
- `src/domain/geo/bounding-box.ts` — usar `toRad` — ~3 linhas
- `src/domain/cep/cep-centroid.ts` — `centroid` e `assessCep` — ~4 linhas
- `src/infrastructure/cache/redis-cache.ts` — `withTimeout` privado — ~2 linhas
- `src/infrastructure/cache/in-memory-cache.ts` → `tests/fakes/in-memory-cache.ts` — mover — 0 (vira teste)
- `src/infrastructure/db/prisma-cep-repository.ts` — import da porta — ~1 linha
- `src/infrastructure/http/limited-fetch.ts` — criar: `limitedFetch`, `LimitedFetchOptions`, `HttpOutcome` — ~35 linhas
- `src/infrastructure/http/brasil-api-cep-provider.ts` — usa `limitedFetch`; `limiter?: WindowRateLimiter`; imports — ~20 linhas
- `src/infrastructure/http/nominatim-geocoder.ts` — idem — ~20 linhas
- `src/infrastructure/http/window-rate-limiter.ts` → `src/infrastructure/rate-limit/window-rate-limiter.ts` — mover — ~1 linha
- `src/presentation/http/app.ts` — `rateLimit` com `limit` e `windowMs` — ~1 linha
- `src/presentation/http/rate-limit.ts` — store padrão da lib e `logger` do pino direto — ~4 linhas
- `src/presentation/http/errors.ts` — `ERROR_CATALOG`, `ErrorCatalogEntry`, `HTTP_ERRORS`, `sendError(res, entry)` — ~65 linhas
- `src/presentation/http/error-catalog.ts` — remover — 0
- `src/presentation/http/bearer-auth.ts` — `sendError(res, HTTP_ERRORS.unauthorized)` — ~2 linhas
- `src/presentation/http/nearby-ceps-route.ts` → `routes/` — só o `Router` — ~5 linhas
- `src/presentation/http/mappers/nearby-ceps-mapper.ts` — criar com as funções que saem da rota — ~65 linhas
- `src/presentation/http/middlewares/error-handler.ts` — criar com `notFoundHandler` e `errorHandler`, que saem do `errors.ts` — ~25 linhas
- `src/presentation/http/errors.ts`, `bearer-auth.ts`, `rate-limit.ts`, `cache-route.ts` → `errors/`, `middlewares/` e `routes/` — mover e ajustar imports — ~10 linhas
- `src/domain/geo/geo.ts` — criar a partir de `haversine.ts` + `bounding-box.ts` — ~40 linhas
- `src/domain/cep/cep.ts` — criar a partir de `cep-code.ts` + `cep-centroid.ts` — ~50 linhas
- `src/domain/geo/haversine.ts`, `src/domain/geo/bounding-box.ts`, `src/domain/cep/cep-code.ts`, `src/domain/cep/cep-centroid.ts` — remover — 0
- `scripts/build-dataset/index.ts` — `DATASET_HEADER`; import do `cep.ts` — ~4 linhas
- `scripts/seed/index.ts` — `DATASET_HEADER`; `errorMessage` (inclusive no `catch` do `clearResultCache`); `allowedUf` — ~12 linhas
- `eslint.config.js` — `no-restricted-imports` por camada. Além das camadas de cima, `domain`, `application` e `presentation` também não importam `src/generated` (o cliente do Prisma), que só a `infrastructure` usa — ~23 linhas

Testes (não contam):
- Criar: `src/infrastructure/http/limited-fetch.test.ts`; `src/presentation/http/middlewares/error-handler.test.ts` (a partir do `errors.test.ts` da `main`, com `notFoundHandler` e `errorHandler`).
- Juntar: `haversine.test.ts` + `bounding-box.test.ts` → `src/domain/geo/geo.test.ts`; `cep-code.test.ts` + `cep-centroid.test.ts` → `src/domain/cep/cep.test.ts` (com os casos do `nearestCeps`).
- Mover para as pastas novas, junto dos arquivos: os testes da `application` (`cache/`, `errors/`, `providers/`, `use-cases/`) e da `presentation/http` (`errors/`, `middlewares/`, `routes/`); o `error-catalog.test.ts` vira `src/presentation/http/errors/errors.test.ts`, com o teste de cobertura do catálogo; `src/infrastructure/cache/in-memory-cache.test.ts` → `tests/fakes/in-memory-cache.test.ts`; `src/infrastructure/http/window-rate-limiter.test.ts` → `src/infrastructure/rate-limit/window-rate-limiter.test.ts`.
- Alterar (caminhos finais): `src/presentation/http/middlewares/rate-limit.test.ts`, `src/infrastructure/http/brasil-api-cep-provider.test.ts`, `src/infrastructure/http/nominatim-geocoder.test.ts`, `src/presentation/http/app.test.ts`, `src/presentation/http/routes/cache-route.test.ts`, `src/application/providers/caching-cep-address-provider.test.ts`, `src/application/cache/clear-cache.test.ts`, `src/application/use-cases/find-nearby-ceps.test.ts`, `src/application/providers/origin-geocoder.test.ts` e `scripts/seed/index.test.ts`.

Configuração e documentação (não contam):
- Alterar: `package.json`, `package-lock.json`, `README.md`, `docs/DECISOES.md` e `docs/HISTORIAS.md`.

## Limite de tamanho
A US inteira sai num PR, mergeável sozinho, com **até 500 linhas de lógica** adicionadas ou modificadas. Remoção não conta.

- **Estimativa:** ~270 linhas (bc_giross: ~270). Linhas que só mudam de arquivo (o catálogo no `errors.ts`) contam como adicionadas, porque o git não as reconhece como renomeação, e já estão na estimativa.
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
| Tarefas | 7 estimadas; 13 ao fim (as tarefas 8 a 13 entraram durante a implementação) |
| Arquivos que a mudança toca | ~59 estimados; 71 ao fim |
| Linhas de lógica estimadas | ~270; 339 medidas ao fim (ver "Riscos") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Não |
| Dependência nova | Não |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são várias tarefas e dezenas de arquivos.

## Tarefas
Passos (commits) desta US. Todos entram no mesmo PR; tarefa não é entregável.
- [x] 1. Rate limit de entrada em memória: o `rateLimitMiddleware` no store padrão do `express-rate-limit`, com o logger do pino direto, e o `app.ts` com `rateLimit: { limit, windowMs }`.
- [x] 2. Rate limit de saída em memória: o `WindowRateLimiter` e o teste dele em `infrastructure/rate-limit/`; os providers recebem `WindowRateLimiter`, com o limite no default; o `index.ts` não passa limiter nem espera o `redis.connect()`; o `withTimeout` fica privado.
- [x] 3. `limitedFetch`: cria `limited-fetch.ts` e o teste dele (limite, timeout, falha de rede, corpo não JSON, headers). BrasilAPI e Nominatim passam a usá-lo, e os testes dos providers ficam com URL, status e parse.
- [x] 4. `InMemoryCache` em `tests/fakes/`: move o fake e o teste dele e atualiza os imports dos testes.
- [x] 5. Erros da apresentação: o catálogo, o `HTTP_ERRORS` e o `sendError(res, entry)` no `errors.ts`; o `bearer-auth.ts` usa a tabela; o teste do catálogo fica no `errors.test.ts`.
- [x] 6. Trechos repetidos: `toRad`, `centroid`, `Neighbor[]` no `findNearbyCeps`, e `DATASET_HEADER`, `errorMessage` e `allowedUf` no seed.
- [x] 7. Documentação: README e `DECISOES.md` (D22 e tabela de status).
- [x] 8. Domínio com um arquivo por pasta: `domain/geo/geo.ts` (`haversine` + `bounding-box`) e `domain/cep/cep.ts` (`cep-code` + `cep-centroid`), com os testes juntados e os imports atualizados.
- [x] 9. `application/` em pastas: `cache/` (`cache.ts`, `clear-cache.ts`), `errors/` (`errors.ts`) e `providers/` (`cep-address-provider.ts`, `geocoder.ts`, `caching-cep-address-provider.ts`, `origin-geocoder.ts`); `use-cases/` (`find-nearby-ceps.ts`, `cep-repository.ts`); testes junto dos arquivos e imports atualizados.
- [x] 10. `presentation/http/` em pastas: `routes/`, `middlewares/` (`bearer-auth`, `rate-limit`, `error-handler`), `errors/` e `mappers/nearby-ceps-mapper.ts`; a rota fica só com o `Router`; testes junto dos arquivos e imports atualizados.
- [x] 11. `429` na borda: `HTTP_ERRORS.rateLimitExceeded` e `sendError` no handler do `rateLimitMiddleware`; testes do `429` sem mudar o esperado.
- [x] 12. `nearestCeps` em `domain/cep/cep.ts`, com teste próprio (raio, ordem, desempate por CEP, borda do raio, lista vazia); o `findNearbyCeps` passa a usá-lo.
- [x] 13. Camadas no ESLint: `no-restricted-imports` por pasta no `eslint.config.js`, conferindo que um import proibido faz o `npm run lint` falhar.

## Telas e fluxos E2E (Playwright)
Não se aplica (API sem telas).

## Testes
- **Automatizados:** `npm test`, `npm run lint`, `npm run typecheck` e `npm run format:check`, todos passando a cada tarefa. Os casos de limite, timeout e rede ficam nos testes do `limitedFetch`, e não nos dos providers.
- **Novos:** `limited-fetch.test.ts` cobre: sem vaga → `{ ok: false }` sem chamar o `fetch`; falha de rede e timeout → `{ ok: false }` com `warn`; com resposta → `{ ok: true, status, body }`; corpo não JSON → `body: undefined`; headers repassados ao `fetch`.
- **Ajustados:**
  - os testes HTTP (`rate-limit`, `app`, `cache-route`, `errors`) mantêm os mesmos status, corpos e headers esperados, inclusive o `429` com `Retry-After`;
  - o `cep-centroid.test.ts` testa o `centroid` como média simples e a deduplicação pelo `assessCep`;
  - o `seed/index.test.ts` testa o `allowedUf`.
- **Manual** (`docker compose up -d --build`, com um Redis novo):
  1. `for i in $(seq 1 70); do curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/ceps-proximos/01310100; done | sort | uniq -c` → 60 respostas `200` e 10 respostas `429`.
  2. `curl -si localhost:3000/ceps-proximos/01310100 | grep -i ratelimit` → headers `RateLimit` e `RateLimit-Policy` presentes.
  3. `docker compose stop redis && docker compose restart api` e depois repetir o passo 1 → a API responde sem cache, com log `warn` do Redis, e devolve `429` depois da 60ª requisição.
  4. `curl -s localhost:3000/ceps-proximos/01001000/detalhes` → resposta com o fallback do Nominatim.

## Verificação independente
Preenchido no `/pato/verify`; o `/pato/close-spec` não começa sem esta seção.

- **Data:** 2026-10-28.
- **Verificador:** subagente em contexto limpo, em duas rodadas: a verificação completa até `0668cdf` e uma re-verificação das correções (`0b36c87` e `3512a4d`).
- **Suítes rodadas:** `npm test` (23 arquivos e 256 testes, 0 falhas), `npm run lint`, `npm run typecheck` e `npm run format:check`, todos com exit 0 no HEAD das duas rodadas. Na primeira rodada, as quatro suítes passaram em cada commit da branch, rodadas via `git archive`. Não há Playwright, porque a API não tem telas.
- **Critérios de aceite:** os 10 foram atendidos.
  - O 1 e o 3 foram conferidos subindo o `src/index.ts`. Com `REDIS_URL=redis://127.0.0.1:1` e `RATE_LIMIT_MAX=3`, a API logou "api listening" antes do erro do Redis e respondeu `404 404 429 429 429`. O `429` veio com `Retry-After: 60`, `RateLimit`, `RateLimit-Policy` e o corpo `LIMITE_EXCEDIDO`, sem unhandled rejection.
  - O 2 foi conferido com um script de teste, com o Redis fora e um `fetch` falso. Das 7 consultas de CEP fora da base, todas deram `503` e só 5 chamaram o `fetch`. O `/detalhes` de CEP na base deu `endereco: null`.
  - Para o 10, imports proibidos passados pelo `eslint --stdin` deram erro `no-restricted-imports`, inclusive um da `application` para o `src/generated`.
- **Entregável:** sim. A branch parte da `main` (`89015ce`) e só tem commits desta US. Não há `TODO`, flag nem camada faltando, e a API sobe e atende de ponta a ponta.
- **Linhas de lógica:** 339 contra 500 (337 ao fim da tarefa 13, mais 2 das correções).
- **Achados:** nenhum de severidade Alta ou Média. Os de severidade Baixa foram:
  1. Spec defasada: a triagem, a lista de arquivos e de testes, o `eslint.config.js` "não muda" e o critério 3 desmarcado. Foi corrigida em `3512a4d` e `1ae1bfd`.
  2. A regra de camadas também barra o `src/generated`, o que a spec não registrava. Ficou registrado na tarefa 13 e na lista de arquivos.
  3. O seed importa o `DATASET_HEADER` do `build-dataset` e, com ele, carrega o `read-cnefe` e o `yauzl`. Foi aceito e registrado em Riscos, para não criar um arquivo só para a constante.
  4. Um `(error as Error).message` sobrava no seed. Agora usa o `errorMessage` (`0b36c87`).
  5. O `.catch` do `redis.connect()` logava um warn que nunca aparecia. Agora o `catch` é vazio, com um comentário dizendo que quem loga a falha é o handler `'error'` (`0b36c87`).
- **Não verificado:** o teste manual com `docker compose` (passos 1 a 4), o fluxo com Postgres e Redis reais, a reconexão do Redis depois de subir sem ele e o custo de ~205 B/IP do `MemoryStore`.
- **Decisão do usuário:** corrigir os achados de severidade Baixa. Os itens 1, 2, 4 e 5 foram corrigidos, e o 3 foi aceito com registro.

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-28 | Automatizado | local | local | `npm test` (23 arquivos, 256 testes), `npm run lint`, `npm run typecheck` e `npm run format:check` | Aprovado | — |
| 2026-10-28 | Verificação independente | subagente (contexto limpo) | local | diff contra a spec em duas rodadas, suítes em cada commit e a API subida sem Redis | Aprovado | seção "Verificação independente" |
| 2026-10-28 | Manual | owhenrique | local (`docker compose`) | passos 1 a 4 de "Testes": `429` depois de 60 requisições, headers `RateLimit`, API respondendo sem Redis e `/detalhes` com fallback do Nominatim | Aprovado | — |

## Riscos e pontos em aberto
- **Limites por processo:** com mais de uma réplica, cada uma conta separado. Na entrada, o total vira N × 60/min; na saída, a política do Nominatim pede 1 req/s no total. O compose sobe uma réplica, e o trade-off fica registrado na D22.
- **Janela fixa na entrada:** um cliente consegue até 2 vezes o limite em poucos segundos, na virada da janela.
- **Memória da entrada:** ~205 bytes por IP distinto nas últimas ~2 janelas. Um volume de ataque precisa ser barrado antes da API (proxy ou WAF).
- **Logger do rate limit:** os avisos de configuração da biblioteca saem no pino com o nível dela (`warn` ou `error`).
- **Logs do `limitedFetch`:** os `warn` de limite e de falha trazem a `url`, e não o `cep` ou a consulta.
- **Subida sem `await`:** logo depois da subida, as primeiras requisições podem dar miss no cache até o Redis conectar (milissegundos).
- **Medição:** conteúdo que muda de arquivo conta como linha adicionada. A estimativa já inclui isso.
- **Branch `fix/compose-env`:** é local, parece obsoleta e toca README e `package.json`, que esta US também altera. Se for mergeada depois, precisa de rebase.
- **Branch `docs`:** mover `docs/specs/` e `docs/HISTORIAS.md` é o passo final, depois do close-spec da US10, e está registrado no mapa.
- **Critério 3 sem teste automatizado:** o `redis.connect()` sem `await` está no `index.ts`. A verificação independente subiu a API com o Redis inacessível e confirmou a subida, o cache em miss e os dois limites valendo; o passo 3 do teste manual repete isso com o compose.
- **Header do `ceps-removidos.csv`:** o `build-dataset` também monta esse header a partir do `DATASET_HEADER` (`${DATASET_HEADER};p90_km`). A saída não muda.
- **`(error as Error).message` restante:** só o do `main()` do `build-dataset`, que não tem o `errorMessage`. O do `catch` do `clearResultCache` no seed usa o `errorMessage`.
- **Seed importa o `build-dataset`:** para usar o `DATASET_HEADER`, o seed carrega o módulo do `build-dataset`, que traz o `read-cnefe` e o `yauzl`. O `main()` do build não roda (guard no fim do `index.ts`), e o `yauzl` está em `dependencies`, então a imagem do compose tem tudo. Ficou assim para não criar um arquivo só para a constante.
- **Medição:** o placar final é 339, contra ~270 estimados. A diferença vem das tarefas que entraram durante a implementação (o `nearestCeps`, o mapper, o `error-handler.ts` e as regras de camada no `eslint.config.js`, que a medição conta por ser `.js`), dos arquivos que o git vê como novos (`geo.ts` e `cep.ts`) e do Prettier, que quebrou em várias linhas os imports juntados e as entradas do `HTTP_ERRORS`.
