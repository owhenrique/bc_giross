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
| `DATABASE_URL` | — | conexão Postgres (obrigatória; o compose já define) |
| `PORT` | `3000` | porta da API |
| `SEARCH_RADIUS_KM` | `1` | raio de busca em km |
| `SEED_UFS` | vazio | UFs a carregar, separadas por vírgula |
| `REDIS_URL` | — | conexão Redis (obrigatória; o compose já define) |
| `CACHE_TTL_ADDRESS_SECONDS` | `2592000` (30 d) | TTL do endereço (BrasilAPI) |
| `CACHE_TTL_RESULT_SECONDS` | `604800` (7 d) | TTL do resultado (origem + lista de vizinhos) |
| `CACHE_TTL_NOT_FOUND_SECONDS` | `3600` (1 h) | TTL do CEP que a BrasilAPI não encontra |
| `LOG_LEVEL` | `info` | nível do Pino |

### Cache (Redis)

O compose tem o serviço `redis` (`maxmemory` com política `allkeys-lru`, sem persistência), e a `api` e o `seed` só sobem com ele saudável. Para rodar a API localmente, suba só o Redis com `docker compose up redis` e use `REDIS_URL=redis://localhost:6379` (exemplo no `.env.example`).

- **Resultado** (`result:<raio>:<cep>`): a lista inteira de vizinhos; `pagina` e `limite` saem dela.
- **Endereço** (`address:<cep>`): o lookup da BrasilAPI. `found` usa `CACHE_TTL_ADDRESS_SECONDS` e `not_found` usa `CACHE_TTL_NOT_FOUND_SECONDS`. Indisponibilidade nunca entra no cache.
- **Redis fora do ar:** a API segue respondendo, só sem cache, e cada falha vira log `warn`. Quando o Redis volta, o cache volta sem reiniciar a API. Já o seed falha (código ≠ 0) se não alcançar o Redis, antes de mexer no banco.
- **Seed:** ao terminar, apaga as chaves `result:*` e mantém as `address:*`. Se a limpeza falhar depois do `COMMIT`, ele sai com código ≠ 0 e avisa que a base foi carregada mas o cache não foi limpo.

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

`origem.endereco` é `null` quando a BrasilAPI está fora do ar, estoura o timeout (3 s) ou não acha o CEP; a lista vem normalmente. Campos vazios do endereço saem como `null`.

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
| 422 | `CEP_SEM_GEOLOCALIZACAO` | o CEP existe e a UF está carregada, mas a base não tem a coordenada dele |
| 503 | `PROVEDOR_INDISPONIVEL` | CEP fora da base e o serviço de CEP está fora do ar, estourou o timeout ou o limite de 5 req/s |
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
