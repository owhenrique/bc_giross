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
| `CACHE_TTL_ADDRESS_SECONDS` | `2592000` (30 d) | TTL do endereço (BrasilAPI) |
| `CACHE_TTL_RESULT_SECONDS` | `604800` (7 d) | TTL do resultado (origem + lista de vizinhos) |
| `CACHE_TTL_NOT_FOUND_SECONDS` | `3600` (1 h) | TTL do CEP que a BrasilAPI não encontra |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | base do Nominatim, usado como fallback de coordenada |
| `NOMINATIM_USER_AGENT` | `bc_giross/1.0 (+https://github.com/owhenrique/bc_giross)` | `User-Agent` enviado ao Nominatim (a política de uso exige identificar o cliente) |
| `LOG_LEVEL` | `info` | nível do Pino |

### Cache (Redis)

O compose tem o serviço `redis` (`maxmemory` com política `allkeys-lru`, sem persistência), e a `api` e o `seed` só sobem com ele saudável. Para rodar a API localmente, suba só o Redis com `docker compose up redis` e use `REDIS_URL=redis://localhost:6379` (exemplo no `.env.example`).

- **Resultado** (`result:<raio>:<cep>`): a lista inteira de vizinhos; `pagina` e `limite` saem dela.
- **Endereço** (`address:<cep>`): o lookup da BrasilAPI. `found` usa `CACHE_TTL_ADDRESS_SECONDS` e `not_found` usa `CACHE_TTL_NOT_FOUND_SECONDS`. Indisponibilidade nunca entra no cache.
- **Redis fora do ar:** a API segue respondendo, só sem cache, e cada falha vira log `warn`. Quando o Redis volta, o cache volta sem reiniciar a API. Já o seed falha (código ≠ 0) se não alcançar o Redis, antes de mexer no banco.
- **Seed:** ao terminar, apaga as chaves `result:*` e mantém as `address:*`. Se a limpeza falhar depois do `COMMIT`, ele sai com código ≠ 0 e avisa que a base foi carregada mas o cache não foi limpo.

### Fallback de coordenada (Nominatim)

Quando o CEP não está na base mas a UF dele foi carregada (um CEP novo, ou um "sujo" removido pelo `build-dataset`), a API busca a coordenada no Nominatim a partir do endereço da BrasilAPI (rua e cidade) e calcula os vizinhos da base a partir dela. Nas duas rotas a resposta é `200`; no `/detalhes`, `origem.fonte` vem `"nominatim"`.

- **Validação:** o Nominatim só vale se a cidade e a UF do candidato baterem com as da BrasilAPI (sem acento, sem diferença de maiúsculas e sem espaços extras). Sem candidato válido: `422 CEP_SEM_GEOLOCALIZACAO`.
- **Sem rua, cidade ou UF** na BrasilAPI: `422 CEP_SEM_GEOLOCALIZACAO`, sem chamar o Nominatim. UF não carregada continua `422 CEP_FORA_DA_COBERTURA`.
- **Nominatim fora do ar** (timeout de 3 s, erro, status ≠ 200, corpo inválido) ou limite de 1 req/s atingido: `503 PROVEDOR_INDISPONIVEL`.
- **Cache** (`geocode:<cep>`): coordenada aceita por `CACHE_TTL_ADDRESS_SECONDS` e "sem match" por `CACHE_TTL_NOT_FOUND_SECONDS`. Indisponibilidade nunca entra. O seed não apaga essas chaves.
- **Política de uso do Nominatim público:** máximo de 1 req/s (a API aplica esse limite por processo), `User-Agent` identificado e cache dos resultados. Uso pesado pode levar a bloqueio; para isso, aponte `NOMINATIM_URL` para uma instância própria.
- **Precisão:** em ruas longas o ponto devolvido é algum trecho da rua, não o centro do CEP.

**Atenção ao migrar à mão:** a tabela `loaded_uf` (UFs carregadas) é preenchida pelo seed. Depois de um `prisma migrate deploy`, rode o seed; sem ele, todo CEP fora da base com UF existente cai em `CEP_FORA_DA_COBERTURA`. O `docker compose up` já roda o seed antes da API.

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
| 404 | `NAO_ENCONTRADO` | rota ou método inexistente |
| 422 | `CEP_FORA_DA_COBERTURA` | o CEP existe, mas a UF dele não foi carregada na base |
| 422 | `CEP_SEM_GEOLOCALIZACAO` | o CEP existe e a UF está carregada, mas nem a base nem o Nominatim dão a coordenada dele (ou o endereço não tem rua, cidade ou UF) |
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

Para formatar o código, rode `npm run format`. Para o `git blame` ignorar o commit de reformatação com Prettier, rode uma vez `git config blame.ignoreRevsFile .git-blame-ignore-revs` (o GitHub já lê o arquivo sozinho).
