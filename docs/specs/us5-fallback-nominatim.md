---
id: us5
card: —
mapa: docs/HISTORIAS.md
depende_de: US4 (PR #6, mergeada)
titulo: Fallback de coordenada (Nominatim)
status: em implementação
modo: agent-driven
criada_em: 2026-10-27
implementada_em:
verificada_em:
branch: feat/us5-fallback-nominatim
merge_request:
---

# US5 — Fallback de coordenada (Nominatim)

## História
Como **Giross**, quero resultados mesmo quando o CEP de referência não está na base, para não perder a consulta em CEPs novos ou mal cadastrados no Censo.

## Contexto
Hoje um CEP fora da base passa pela BrasilAPI (`findNearbyCeps`, em `src/application/find-nearby-ceps.ts`) e termina em `404 CEP_NAO_ENCONTRADO`, `422 CEP_FORA_DA_COBERTURA`, `422 CEP_SEM_GEOLOCALIZACAO` ou `503 PROVEDOR_INDISPONIVEL`. O `422 CEP_SEM_GEOLOCALIZACAO` aparece quando o CEP existe e é de uma UF carregada, mas não está na base: é um CEP novo, ou um "sujo" removido pelo `build-dataset` (p90 > 2 km, D4/D11). Esta US troca esse `422` por uma tentativa de achar a coordenada no Nominatim, a partir do endereço da BrasilAPI, validando a cidade e a UF, como definem a D11 (e a continuação dela) e a D22. No mapa (`docs/HISTORIAS.md`), ela vem depois da US4, cujo cache ela reusa.

## Critérios de aceite
- [ ] 1. Dado um CEP fora da base, de UF carregada, com rua, cidade e UF na BrasilAPI (ex.: `01001000` com `SEED_UFS=SP`), quando chamo `GET /ceps-proximos/:cep/detalhes`, então recebo `200` com `origem.fonte = "nominatim"`, `latitude`/`longitude` do Nominatim, o endereço da BrasilAPI e os vizinhos da base calculados a partir dessa coordenada (ordem, raio, paginação e 2 casas, como hoje). O resumo `GET /ceps-proximos/:cep` também responde `200`, com o mesmo `ceps`.
- [x] 2. Dado que o Nominatim não devolve nenhum candidato, ou só devolve candidatos de outra cidade ou outra UF que a BrasilAPI (comparação sem acento, sem diferença de maiúsculas e sem espaços extras), então `422 CEP_SEM_GEOLOCALIZACAO`.
- [ ] 3. Dado um endereço da BrasilAPI sem rua, sem cidade ou sem UF, então `422 CEP_SEM_GEOLOCALIZACAO`, sem chamar o Nominatim.
- [ ] 4. Dado o Nominatim fora do ar (timeout de 3 s, erro de rede, status ≠ 200, corpo inválido) ou o limite de 1 req/s atingido, então `503 PROVEDOR_INDISPONIVEL`, e nada vai para o cache de geocoding.
- [ ] 5. Dado uma coordenada aceita, então ela fica em cache por `CACHE_TTL_ADDRESS_SECONDS` (padrão 30 d). Dado "sem match" (critério 2), ele fica em cache por `CACHE_TTL_NOT_FOUND_SECONDS` (padrão 1 h). Dentro do TTL, a mesma consulta não chama o Nominatim. O resultado com os vizinhos entra no `result:<raio>:<cep>` junto com a fonte, então a repetição responde `fonte = "nominatim"` sem ir ao banco nem ao Nominatim.
- [ ] 6. Dado qualquer chamada ao Nominatim, então ela leva o header `User-Agent` com o valor de `NOMINATIM_USER_AGENT` (padrão `bc_giross/1.0 (+https://github.com/owhenrique/bc_giross)`) e vai para `NOMINATIM_URL` (padrão `https://nominatim.openstreetmap.org`). As chamadas ficam limitadas a 1 req/s.
- [ ] 7. Dado um CEP fora da base de UF **não** carregada, então continua `422 CEP_FORA_DA_COBERTURA`, sem chamar o Nominatim. Dado um CEP na base, então continua `fonte = "base"`, também sem chamar o Nominatim.

## Escopo
**Dentro:**
- Porta `Geocoder` em `application` e o adapter `NominatimGeocoder` em `infrastructure/http`.
- `OriginGeocoder` em `application`: monta a busca a partir do endereço da BrasilAPI, valida cidade/UF e cuida do cache do geocoding.
- Fallback no `findNearbyCeps` (os dois endpoints), com a fonte gravada no resultado em cache.
- `fonte: "nominatim"` no `/detalhes`.
- Variáveis `NOMINATIM_URL` e `NOMINATIM_USER_AGENT` (opcionais), no `env.ts`, no `.env.example` e no compose.
- README e `DECISOES.md` atualizados.

**Fora** (fica para outra US do mapa ou fora do card):
- Fallback para UF não carregada → fora do card (decisão desta US)
- Busca por `postalcode` no Nominatim (cobertura baixa no OSM, D11) → fora do card
- Usar o centro da cidade quando não há rua → fora do card (decisão desta US)
- Componente Nominatim no `/saude` → US9, se ela quiser
- Limpeza manual das chaves `geocode:*` → US6 (`DELETE /cache` apaga tudo, e `DELETE /cache/:cep` deve incluir `geocode:<cep>`)

## Decisões e respostas do usuário
- P: Em que casos o fallback entra? → R: **só para UF carregada**. Ele substitui o `422 CEP_SEM_GEOLOCALIZACAO`. Para UF não carregada, continua `422 CEP_FORA_DA_COBERTURA`, porque não haveria vizinhos na base.
- P: Nominatim fora do ar (timeout, erro, 429 ou o limite de 1 req/s) → R: **`503 PROVEDOR_INDISPONIVEL`**, como a BrasilAPI: é transitório, e o cliente pode tentar de novo. Reusa o código do catálogo.
- P: A BrasilAPI não traz rua (CEP geral de cidade pequena) → R: **`422` sem consultar o Nominatim**, porque o centro da cidade deixaria o raio de ~1 km sem sentido.
- P: O que entra no cache do geocoding? → R: **coordenada aceita por 30 d e "sem match" por 1 h**. Indisponível nunca entra. O resultado final (vizinhos) entra no `result:<raio>:<cep>`, com a fonte.
- P: Como configurar o `User-Agent`? → R: **env com default**. `NOMINATIM_USER_AGENT` é opcional, com default identificando o projeto, e vem junto com `NOMINATIM_URL`, também opcional (default: o Nominatim público).
- P: Como comparar a cidade e a UF? → R: **normalizada**: sem acento, sem diferença de maiúsculas e sem espaços extras. A cidade vem de `city`/`town`/`village`/`municipality`, e a UF vem de `ISO3166-2-lvl4` (`BR-SP` → `SP`). As duas precisam bater.
- P: Aprova a US5 com os 7 critérios? → R: aprovada.

## Premissas
—

## Design técnico
- **Porta** (`src/application/geocoder.ts`):
  - `interface GeocodeQuery { street: string; city: string }`.
  - `interface GeocodeCandidate { lat: number; lon: number; city: string | null; uf: string | null }`.
  - `type GeocodeLookup = { status: 'found'; candidates: GeocodeCandidate[] } | { status: 'unavailable' }` (lista vazia = nada encontrado).
  - `interface Geocoder { search(query: GeocodeQuery): Promise<GeocodeLookup> }`. Como o `CepAddressProvider`, nunca lança.
- **`OriginGeocoder`** (`src/application/origin-geocoder.ts`):
  - `class OriginGeocoder { constructor(geocoder, cache, { foundTtlSeconds, noMatchTtlSeconds }); locate(cep, address: CepAddress): Promise<OriginLocation> }`.
  - `type OriginLocation = { status: 'found'; lat: number; lon: number } | { status: 'no_match' } | { status: 'unavailable' }`.
  - Fluxo:
    1. Sem `street`, `city` ou `uf` → `no_match`, sem cache e sem chamada.
    2. `cache.get<OriginLocation>(geocodeKey(cep))`. No hit, devolve.
    3. `geocoder.search({ street, city })`. `unavailable` → devolve sem gravar.
    4. Pega o primeiro candidato com `sameName(candidate.city, address.city)` e `candidate.uf === address.uf` → `found` (TTL de 30 d). Nenhum → `no_match` (TTL de 1 h).
  - `sameName`: compara `normalize('NFD')`, sem diacríticos, `toLowerCase()`, espaços colapsados e `trim()`, como função local do módulo.
- **Chave** (`src/application/cache.ts`): `geocodeKey(cep)` → `geocode:<cep>`. O seed não apaga essas chaves, porque a coordenada do Nominatim não depende da base.
- **Caso de uso** (`findNearbyCeps`):
  - A assinatura passa a ser `findNearbyCeps(repository, addressProvider, originGeocoder, cache, options)`.
  - Em `computeResult`, com o CEP fora da base e `found` com UF carregada: chama `originGeocoder.locate(cep, lookup.address)`. `found` → a origem é `{ lat, lon }`, com `source: 'nominatim'`. `no_match` → `CepWithoutLocationError`. `unavailable` → `AddressProviderUnavailableError`.
  - O cálculo dos vizinhos (bounding box + Haversine + filtro + ordenação) passa a receber a origem, e não o registro da base. O filtro `candidate.cep !== cep` continua valendo.
  - `CachedResult.origin` ganha `source: 'dataset' | 'nominatim'`. Um valor antigo no Redis, sem `source`, é tratado como `'dataset'`.
  - `NearbyCepsResult.origin.source` passa a ser `'dataset' | 'nominatim'`.
- **Apresentação** (`nearby-ceps-route.ts`): `fonte: origin.source === 'nominatim' ? 'nominatim' : 'base'`. O resumo não muda.
- **Adapter** (`src/infrastructure/http/nominatim-geocoder.ts`), no molde do `BrasilApiCepProvider`:
  - Opções: `fetch?`, `baseUrl` e `userAgent` (vindos do env), `timeoutMs?` (3000), `limiter?` (`new WindowRateLimiter(1, 1000)`) e `logger`.
  - `GET ${baseUrl}/search?street=<rua>&city=<cidade>&countrycodes=br&format=jsonv2&addressdetails=1&limit=5`, com os parâmetros via `URLSearchParams`, header `User-Agent`, `Accept-Language: pt-BR` e `AbortSignal.timeout`.
  - A UF **não** entra na busca: o parâmetro `state` do Nominatim espera o nome do estado, e a UF é validada depois, pelo `ISO3166-2-lvl4`. O `limit=5` dá a chance de achar o candidato certo quando o primeiro é homônimo.
  - Schema Zod: array de `{ lat: string, lon: string, address: { city?, town?, village?, municipality?, 'ISO3166-2-lvl4'? } }`. `lat`/`lon` viram `Number` (descarta o candidato se não for finito). A cidade é `city ?? town ?? village ?? municipality ?? null`. A UF é `/^BR-([A-Z]{2})$/` sobre o ISO, ou `null`.
  - Limite atingido, erro, timeout, status ≠ 200 ou corpo inválido → `warn` + `unavailable`.
- **Ambiente** (`src/config/env.ts`):
  - `NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org')`.
  - `NOMINATIM_USER_AGENT: z.string().min(1).default('bc_giross/1.0 (+https://github.com/owhenrique/bc_giross)')`.
  - O `Env` ganha `nominatim: { url, userAgent }`.
- **Composição** (`src/index.ts`): `new OriginGeocoder(new NominatimGeocoder({ baseUrl, userAgent, logger }), cache, { foundTtlSeconds: env.cacheTtl.addressSeconds, noMatchTtlSeconds: env.cacheTtl.notFoundSeconds })`, passado ao `findNearbyCeps`.
- **Compose e `.env.example`:** a `api` recebe `NOMINATIM_URL` e `NOMINATIM_USER_AGENT` com `${...:-padrão}`, e o `.env.example` traz as duas, comentadas com o padrão.
- **Contrato HTTP:** aditivo. `origem.fonte` passa a aceitar `"nominatim"` no `/detalhes`. Os códigos de erro são os mesmos do catálogo.
- **Casos de borda:**
  - O Nominatim devolve `lat`/`lon` inválidos → o candidato é descartado. Se não sobrar nenhum, `no_match`.
  - O endereço da BrasilAPI vem do cache (`address:<cep>`) → o fluxo é o mesmo, e só o geocoding é novo.
  - O resumo também passa pelo fallback, porque o CEP fora da base já consulta a BrasilAPI hoje.
  - O seed limpa `result:*`. Um CEP que entrar na base depois da recarga volta a ter `fonte = "base"`.

## Arquivos que a mudança toca
- `src/application/geocoder.ts` — criar: `Geocoder`, `GeocodeQuery`, `GeocodeCandidate`, `GeocodeLookup` — ~12 linhas
- `src/application/origin-geocoder.ts` — criar: `OriginGeocoder`, `OriginLocation`, `sameName` — ~50 linhas
- `src/application/cache.ts` — alterar: `geocodeKey` — ~3 linhas
- `src/application/find-nearby-ceps.ts` — alterar: assinatura, ramo do fallback em `computeResult`, vizinhos a partir da origem, `source` em `CachedResult`/`NearbyCepsResult` — ~35 linhas
- `src/infrastructure/http/nominatim-geocoder.ts` — criar: `NominatimGeocoder`, schema Zod, mapeamento cidade/UF — ~85 linhas
- `src/presentation/http/nearby-ceps-route.ts` — alterar: `fonte` a partir de `origin.source` — ~2 linhas
- `src/config/env.ts` — alterar: `NOMINATIM_URL`, `NOMINATIM_USER_AGENT`, `Env.nominatim` — ~8 linhas
- `src/index.ts` — alterar: montagem do `NominatimGeocoder` e do `OriginGeocoder` — ~10 linhas
- `docker-compose.yml`, `.env.example` — variáveis do Nominatim (config, não conta)
- Testes (não contam):
  - `src/application/origin-geocoder.test.ts` — criar: sem rua/cidade/UF não chama; match normalizado (acento, maiúsculas); rejeição por cidade e por UF; homônimo no 1º candidato e certo no 2º; TTLs de `found` e `no_match`; `unavailable` fora do cache; hit sem chamar o geocoder;
  - `src/infrastructure/http/nominatim-geocoder.test.ts` — criar: com `fetch` fake, URL e parâmetros, `User-Agent`, mapeamento de `town`/`village` e de `BR-SP`, lista vazia, status ≠ 200, corpo inválido, timeout, limiter esgotado;
  - `src/application/find-nearby-ceps.test.ts` — fallback `found` (vizinhos a partir da coordenada, `source: 'nominatim'`), `no_match` → `CepWithoutLocationError`, `unavailable` → `AddressProviderUnavailableError`, UF não carregada sem chamar o geocoder, CEP na base sem chamar o geocoder, cache do resultado com a fonte, valor antigo sem `source`;
  - `src/presentation/http/app.test.ts` — `200` com `fonte: "nominatim"` no `/detalhes` e no resumo, `422` e `503` pelo fallback;
  - `src/config/env.test.ts` — padrões e override das duas variáveis.
- Docs (não contam): `README.md` (fallback, variáveis, política de uso do Nominatim) e `docs/DECISOES.md` (decisões desta US: escopo só UF carregada, `503` para Nominatim fora, sem rua → `422`, TTLs, comparação normalizada, busca sem `state` com `limit=5`).

## Limite de tamanho
- **Estimativa:** ~205 linhas de lógica (`bc_giross`), soma da lista acima.
- **Não contam:** testes, docs, config (`docker-compose.yml`, `.env.example`). Nenhum arquivo gerado.
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
| Tarefas | 5 |
| Arquivos que a mudança toca | 8 de lógica + 5 de teste + 2 de config + 2 de doc |
| Linhas de lógica estimadas | ~205 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Sim (aditivo: `fonte: "nominatim"`) |
| Dependência nova | Não |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são 5 tarefas, 8 arquivos de lógica, ~205 linhas e uma mudança de contrato.

## Tarefas
- [x] 1. Porta `Geocoder` e `NominatimGeocoder` (URL, `User-Agent`, 1 req/s, timeout, mapeamento cidade/UF), mais `NOMINATIM_URL`/`NOMINATIM_USER_AGENT` no `env.ts`, com testes.
- [x] 2. `OriginGeocoder` e `geocodeKey` (validação de cidade/UF normalizada, cache de `found` 30 d e `no_match` 1 h), com testes.
- [ ] 3. Fallback no `findNearbyCeps` (nova assinatura, vizinhos a partir da origem, `source` no resultado em cache) e `fonte` na rota, com testes do caso de uso e do `app.test.ts`.
- [ ] 4. Composição em `src/index.ts`, mais as variáveis no `docker-compose.yml` e no `.env.example`.
- [ ] 5. README e `DECISOES.md`.

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- `npm test`, `npm run typecheck`, `npm run lint` e `npm run format:check` passam.
- **Automatizados:** os listados em "Arquivos que a mudança toca". Nenhum teste chama o Nominatim real: o adapter usa `fetch` fake, e o caso de uso usa um `Geocoder` fake que conta as chamadas (critérios 3, 5 e 7).
- **Manual:**
  1. `docker compose up` com `SEED_UFS=SP`.
  2. `GET /ceps-proximos/01001000/detalhes` → `200`, `fonte: "nominatim"`, coordenada perto da Praça da Sé e vizinhos.
  3. Repetir a chamada e ver em `docker compose exec redis redis-cli keys 'geocode:*'` a chave `geocode:01001000`, sem nova linha de log do Nominatim.
  4. Com `NOMINATIM_URL=http://127.0.0.1:9` (porta fechada) e o cache limpo, a mesma consulta → `503 PROVEDOR_INDISPONIVEL`.
  5. Um CEP de UF não carregada (ex.: `20040020`, RJ) → `422 CEP_FORA_DA_COBERTURA`, sem chamada ao Nominatim no log.

## Verificação independente
Preenchido no `/pato/verify`; o `/pato/close-spec` não começa sem esta seção.

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |

## Riscos e pontos em aberto
- **Ruas longas:** o Nominatim devolve algum trecho da rua, não o centro do CEP (D11: 3 de 25 entre 250 m e 1 km, a Av. Paulista a 2,8 km). Aceito: é melhor que o `422`.
- **Homônimo na mesma cidade:** a validação por cidade/UF não pega uma rua homônima em outro bairro da mesma cidade. Aceito.
- **Grafia diferente da cidade** entre a BrasilAPI e o OSM (ex.: "Embu" × "Embu das Artes") vira `422`. A normalização cobre acento e maiúsculas, não nomes diferentes.
- **Limite de 1 req/s por processo:** o limiter é em memória. Com mais de uma réplica da API, o limite agregado passa de 1 req/s. Hoje há uma réplica só (compose). Se isso mudar, o limiter vai para o Redis.
- **Política do Nominatim público:** uso pesado pode levar a bloqueio. O cache de 30 d e o `NOMINATIM_URL` (instância própria) mitigam.
