# bc-giross

API que lista os CEPs num raio de um CEP de referência, com a distância de cada um. A base (`data/ceps.csv.gz`, 898.455 CEPs com latitude/longitude) é carregada no Postgres por um seed.

## Como rodar

```bash
docker compose up --build
```

Sobem o Postgres, o Redis, o `seed` (aplica a migration, carrega a base e termina) e, só depois, a `api` em `http://localhost:3000`.

Para subir mais rápido, carregue só algumas UFs:

```bash
SEED_UFS=SP,RJ docker compose up --build
```

`SEED_UFS` vazio carrega o Brasil inteiro. Para recarregar com outras UFs: `SEED_UFS=SP docker compose run --rm seed`.

### Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | — | credenciais do Postgres (obrigatórias no compose, que monta a `DATABASE_URL` dos contêineres a partir delas) |
| `POSTGRES_PORT`, `API_PORT` | `5432`, `3000` | portas publicadas no host pelo compose |
| `DATABASE_URL` | — | conexão Postgres (obrigatória; o compose a monta sozinho, defina à mão só para rodar fora do docker) |
| `PORT` | `3000` | porta da API |
| `SEARCH_RADIUS_KM` | `1` | raio de busca em km |
| `SEED_UFS` | vazio | UFs a carregar, separadas por vírgula |
| `REDIS_URL` | — | conexão Redis (obrigatória; o compose já define) |
| `CACHE_TTL_ADDRESS_SECONDS` | `2592000` (30 d) | TTL do endereço (BrasilAPI) e da coordenada do Nominatim |
| `CACHE_TTL_RESULT_SECONDS` | `86400` (24 h) | TTL do resultado (origem + lista de vizinhos) |
| `CACHE_TTL_NOT_FOUND_SECONDS` | `3600` (1 h) | TTL do CEP que a BrasilAPI não encontra e do "sem match" do Nominatim |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | base do Nominatim, usado como fallback de coordenada |
| `NOMINATIM_USER_AGENT` | `bc_giross/1.0 (+https://github.com/owhenrique/bc_giross)` | `User-Agent` enviado ao Nominatim (a política de uso exige identificar o cliente) |
| `CACHE_ADMIN_TOKEN` | vazio | token dos endpoints de limpeza de cache (mínimo de 12 caracteres; vazio desliga os endpoints) |
| `RATE_LIMIT_MAX` | `60` | requisições por IP dentro da janela (inteiro ≥ 1) |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | janela do limite de entrada, em segundos (inteiro ≥ 1) |
| `TRUST_PROXY` | vazio | de onde sai o IP do cliente atrás de proxy: número de saltos (`1`), `loopback`, lista de CIDRs. Vazio usa o IP do socket e ignora o `X-Forwarded-For` |
| `LOG_LEVEL` | `info` | nível do Pino |

### Cache (Redis)

O compose tem o serviço `redis` (`maxmemory` de 256 MB com política `allkeys-lru`, sem persistência), e a `api` e o `seed` só sobem com ele saudável. Para rodar a API localmente, suba só o Redis com `docker compose up redis` e use `REDIS_URL=redis://localhost:6379` (exemplo no `.env.example`).

- **Resultado** (`result:<raio>:<cep>`): a lista inteira de vizinhos; `pagina` e `limite` saem dela.
- **Endereço** (`address:<cep>`): o lookup da BrasilAPI. `found` usa `CACHE_TTL_ADDRESS_SECONDS` e `not_found` usa `CACHE_TTL_NOT_FOUND_SECONDS`. Indisponibilidade nunca entra no cache.
- **Redis fora do ar:** a API sobe sem esperar por ele e segue respondendo, só sem cache, e cada falha vira log `warn`. Quando o Redis volta, o cache volta sem reiniciar a API. Já o seed falha (código ≠ 0) se não alcançar o Redis, antes de mexer no banco. No compose, a `api` não depende do Redis e o seed é dependência opcional dela: com o Redis fora na subida, o compose avisa, o seed falha e a API sobe com a base que já estava carregada.
- **Seed:** ao terminar, apaga as chaves `result:*` e mantém as `address:*`. Se a limpeza falhar depois do `COMMIT`, ele sai com código ≠ 0 e avisa que a base foi carregada mas o cache não foi limpo.

#### TTLs

Longos o bastante para poupar o banco e as APIs externas, curtos o bastante para não servir dado velho nem ocupar o Redis com CEP que ninguém consulta mais.

- **Endereço e coordenada encontrados** (`address:` e `geocode:`, 30 d): rua, bairro e coordenada de um CEP quase nunca mudam. Cada miss custa uma chamada externa com limite (BrasilAPI a 5 req/s; Nominatim a 1 req/s, cuja política exige cache), e cada chave ocupa ~200 bytes. Para corrigir antes do prazo: `DELETE /cache/:cep`.
- **Resultado** (`result:`, 24 h): a lista de vizinhos sai da base (CNEFE 2022), que só muda num seed novo, e o seed já apaga essas chaves. Aqui o TTL não evita dado velho, só controla a memória. Como os mesmos CEPs são consultados com frequência, os que voltam todo dia ficam em cache e são recalculados no máximo uma vez por dia, só com consultas indexadas ao banco; os consultados uma vez saem no dia seguinte. Um TTL menor recalcularia várias vezes por dia os CEPs que voltam, sem liberar memória que falte.
- **Não encontrado e sem match** (`address:` e `geocode:`, 1 h): segura as repetições de um mesmo CEP sem prender por muito tempo um CEP ou uma rua que acabaram de surgir, nem um falso `404`, que a BrasilAPI pode devolver quando um serviço interno dela cai.

A conta do resultado, num raio de 1 km, sobre os 898.455 CEPs da base:

| | Brasil | Capital paulista |
| --- | --- | --- |
| Vizinhos por CEP (média · máximo) | 115 · 971 | 171 · 437 |
| Resultado no Redis (média) | ~6,5 KB | ~9,6 KB |
| Todos os resultados | ~5,5 GB | ~430 MB |
| Cabem nos 256 MB do Redis | ~40 mil | ~27 mil |

Com 10 mil origens novas por dia na capital, os resultados ocupam ~90 MB com 24 h e chegariam a ~650 MB com 7 d. Acima dos 256 MB, o `allkeys-lru`, que despeja pela ordem de uso sem saber o custo, tiraria também endereços e coordenadas, que custam uma chamada externa, para guardar resultados que o banco recalcula.

### Limpeza de cache

Dois endpoints protegidos por token, para forçar dados atualizados sem reiniciar a API. Ficam ligados só quando `CACHE_ADMIN_TOKEN` está definido (mínimo de 12 caracteres; menos que isso faz a API falhar ao subir). Vazio ou ausente, eles respondem `404 NAO_ENCONTRADO`, como qualquer rota inexistente.

```bash
export TOKEN=troque-por-um-token-longo
curl -X DELETE -H "Authorization: Bearer $TOKEN" localhost:3000/cache
curl -X DELETE -H "Authorization: Bearer $TOKEN" localhost:3000/cache/04551000
```

- **`DELETE /cache`:** apaga todas as chaves `result:*`, `address:*` e `geocode:*`. Outras chaves do Redis ficam.
- **`DELETE /cache/:cep`:** apaga `address:<cep>`, `geocode:<cep>` e `result:<raio>:<cep>` (o raio atual). `:cep` aceita `04551000` ou `04551-000`.
- **Autenticação:** header `Authorization: Bearer <token>` (esquema sem diferença de maiúsculas). Sem header, com outro esquema ou com token errado: `401 NAO_AUTORIZADO` com `WWW-Authenticate: Bearer`. A autenticação vem antes da validação do CEP.
- **Respostas:** `204` sem corpo (idempotente, também para CEP sem nada em cache), `400 CEP_INVALIDO`, `401 NAO_AUTORIZADO`, `404 NAO_ENCONTRADO` (endpoints desligados) e `503 CACHE_INDISPONIVEL` (Redis fora do ar ou timeout; pode ter apagado só parte, e repetir é seguro).
- **Limitação:** o `DELETE /cache/:cep` não tira o CEP limpo das listas de vizinhos de outros CEPs. Essas listas (`result:*`) só saem por TTL (24 h) ou por um `DELETE /cache`.

### Fallback de coordenada (Nominatim)

Quando o CEP não está na base mas a UF dele foi carregada (um CEP novo, ou um "sujo" removido pelo `build-dataset`), a API busca a coordenada no Nominatim a partir do endereço da BrasilAPI (rua e cidade) e calcula os vizinhos da base a partir dela. Nas duas rotas a resposta é `200`; no `/detalhes`, `origem.fonte` vem `"nominatim"`.

- **Validação:** o Nominatim só vale se a cidade e a UF do candidato baterem com as da BrasilAPI (sem acento, sem diferença de maiúsculas e sem espaços extras). Sem candidato válido: `422 CEP_SEM_GEOLOCALIZACAO`.
- **Sem rua, cidade ou UF** na BrasilAPI: `422 CEP_SEM_GEOLOCALIZACAO`, sem chamar o Nominatim. UF não carregada continua `422 CEP_FORA_DA_COBERTURA`.
- **Nominatim fora do ar** (timeout de 3 s, erro, status ≠ 200, corpo inválido) ou limite de 1 req/s atingido: `503 PROVEDOR_INDISPONIVEL`.
- **Cache** (`geocode:<cep>`): coordenada aceita por `CACHE_TTL_ADDRESS_SECONDS` (30 d) e "sem match" por `CACHE_TTL_NOT_FOUND_SECONDS` (1 h). Indisponibilidade nunca entra. O seed não apaga essas chaves.
- **Política de uso do Nominatim público:** máximo de 1 req/s (limite em memória, por processo), `User-Agent` identificado e cache dos resultados. Uso pesado pode levar a bloqueio; para isso, aponte `NOMINATIM_URL` para uma instância própria.
- **Precisão:** em ruas longas o ponto devolvido é algum trecho da rua, não o centro do CEP.

**Atenção ao migrar à mão:** a tabela `loaded_uf` (UFs carregadas) é preenchida pelo seed. Depois de um `prisma migrate deploy`, rode o seed; sem ele, todo CEP fora da base com UF existente cai em `CEP_FORA_DA_COBERTURA`. O `docker compose up` já roda o seed antes da API.

### Rate limit

- **Entrada:** 60 req/min por IP (`RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW_SECONDS`), em todas as rotas. Passou do limite: `429 LIMITE_EXCEDIDO` com `Retry-After`. Toda resposta traz `RateLimit` e `RateLimit-Policy` (IETF draft-8). IPv6 conta por sub-rede /56. O contador fica em memória, por processo, em janela fixa: ~205 bytes por IP, e um IP sem requisição por uma janela sai da memória.
- **Atrás de proxy:** sem `TRUST_PROXY`, todos os clientes atrás do mesmo proxy dividem um contador. Prefira o número de saltos (`TRUST_PROXY=1`); `true` confia em qualquer `X-Forwarded-For`.
- **Saída:** BrasilAPI (5 req/s) e Nominatim (1 req/s) também contam em memória, por processo, em janela deslizante. Passou do limite, a chamada não sai e o serviço conta como fora do ar: `503 PROVEDOR_INDISPONIVEL` para CEP fora da base e `origem.endereco: null` no `/detalhes` de CEP na base.
- **Sem Redis:** os limites não dependem dele e continuam valendo com o Redis fora do ar.
- **Réplicas:** com mais de uma réplica da API, cada uma conta separado. O compose sobe uma.

## Contrato

Duas rotas. `:cep` aceita `04551000` ou `04551-000`. Query (nas duas): `pagina` (inteiro ≥ 1, padrão 1) e `limite` (inteiro 1–200, padrão 50).

### `GET /ceps-proximos/:cep` (resumo)

Só a origem e a lista. Com o CEP na base, não consulta nenhum serviço de CEP.

```bash
curl "localhost:3000/ceps-proximos/04551000?pagina=1&limite=50"
```

```json
{
  "origem": "04551000",
  "paginacao": { "pagina": 1, "limite": 50, "total": 174, "total_paginas": 4 },
  "ceps": [{ "cep": "04551010", "distancia_km": 0.12 }]
}
```

### `GET /ceps-proximos/:cep/detalhes` (completa)

Traz a origem com coordenada e endereço (BrasilAPI v2), o raio e a lista.

```bash
curl "localhost:3000/ceps-proximos/04551000/detalhes?pagina=1&limite=50"
```

```json
{
  "origem": {
    "cep": "04551000",
    "latitude": -23.59,
    "longitude": -46.68,
    "fonte": "base",
    "endereco": { "rua": "Rua Funchal", "bairro": "Vila Olímpia", "cidade": "São Paulo", "uf": "SP" }
  },
  "raio_km": 1,
  "paginacao": { "pagina": 1, "limite": 50, "total": 174, "total_paginas": 4 },
  "ceps": [{ "cep": "04551010", "distancia_km": 0.12 }]
}
```

`origem.fonte` é `"base"` (coordenada do CEP na base) ou `"nominatim"` (CEP fora da base, coordenada do fallback). `origem.endereco` é `null` quando a BrasilAPI está fora do ar, estoura o timeout (3 s) ou não acha o CEP; a lista vem normalmente. Campos vazios do endereço saem como `null`.

Nas duas rotas, `ceps` vem ordenado por distância (empate por CEP), sem a própria origem. Página além da última devolve `ceps: []`.

**Migração:** quem usava `/ceps-proximos/:cep` com o contrato completo (`origem` objeto, `raio_km`) deve passar a usar `/ceps-proximos/:cep/detalhes`.

### Erros

Formato: `{ "erro": { "codigo": "...", "mensagem": "..." } }`.

| Status | `codigo` | Quando |
| --- | --- | --- |
| 400 | `CEP_INVALIDO` | `:cep` fora do formato `00000000`/`00000-000` |
| 400 | `PARAMETRO_INVALIDO` | `pagina` ou `limite` inválidos |
| 404 | `CEP_NAO_ENCONTRADO` | nem a base nem os serviços de CEP (BrasilAPI) encontram o CEP |
| 401 | `NAO_AUTORIZADO` | token ausente ou inválido nos endpoints de limpeza de cache |
| 404 | `NAO_ENCONTRADO` | rota ou método inexistente (inclui os endpoints de limpeza com `CACHE_ADMIN_TOKEN` vazio) |
| 422 | `CEP_FORA_DA_COBERTURA` | o CEP existe, mas a UF dele não foi carregada na base |
| 422 | `CEP_SEM_GEOLOCALIZACAO` | o CEP existe e a UF está carregada, mas nem a base nem o Nominatim dão a coordenada dele (ou o endereço não tem rua, cidade ou UF) |
| 429 | `LIMITE_EXCEDIDO` | mais de `RATE_LIMIT_MAX` requisições do mesmo IP dentro da janela |
| 503 | `CACHE_INDISPONIVEL` | Redis fora do ar ou com timeout durante a limpeza de cache |
| 503 | `PROVEDOR_INDISPONIVEL` | CEP fora da base e o serviço de CEP (BrasilAPI, limite de 5 req/s) ou o Nominatim (limite de 1 req/s) está fora do ar ou estourou o timeout |
| 500 | `ERRO_INTERNO` | erro inesperado (sem detalhes na resposta) |

## Testes

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run format:check
```

Para formatar o código, rode `npm run format`.
