# bc-giross

API que lista os CEPs num raio de um CEP de referência, com a distância de cada um. A base (`data/ceps.csv.gz`, 898.455 CEPs com latitude/longitude) é carregada no Postgres por um seed.

## Como rodar

```bash
docker compose up --build
```

Sobem o Postgres, o `seed` (aplica a migration, carrega a base e termina) e, só depois, a `api` em `http://localhost:3000`.

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
| `LOG_LEVEL` | `info` | nível do Pino |

## Contrato

`GET /ceps-proximos/:cep` — `:cep` aceita `04551000` ou `04551-000`.

Query: `pagina` (inteiro ≥ 1, padrão 1) e `limite` (inteiro 1–200, padrão 50).

```bash
curl "localhost:3000/ceps-proximos/04551000?pagina=1&limite=50"
```

```json
{
  "origem": { "cep": "04551000", "latitude": -23.59, "longitude": -46.68, "fonte": "base" },
  "raio_km": 1,
  "paginacao": { "pagina": 1, "limite": 50, "total": 174, "total_paginas": 4 },
  "ceps": [{ "cep": "04551010", "distancia_km": 0.12 }]
}
```

`ceps` vem ordenado por distância (empate por CEP), sem a própria origem. Página além da última devolve `ceps: []`.

### Erros

Formato: `{ "erro": { "codigo": "...", "mensagem": "..." } }`.

| Status | `codigo` | Quando |
| --- | --- | --- |
| 400 | `CEP_INVALIDO` | `:cep` fora do formato `00000000`/`00000-000` |
| 400 | `PARAMETRO_INVALIDO` | `pagina` ou `limite` inválidos |
| 404 | `CEP_NAO_ENCONTRADO` | CEP com formato válido que não está na base |
| 404 | `NAO_ENCONTRADO` | rota ou método inexistente |
| 500 | `ERRO_INTERNO` | erro inesperado (sem detalhes na resposta) |

## Testes

```bash
npm ci
npm test
npm run lint
npm run typecheck
```
