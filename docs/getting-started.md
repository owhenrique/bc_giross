# Guia Rápido (Getting Started)

Este documento descreve como subir a API com Docker ou localmente, as variáveis de ambiente e os comandos de teste.

---

## 1. Pré-requisitos

- **Docker e Docker Compose**, para subir tudo com um comando.
- **Node.js 24**, só para rodar a API ou os testes fora do Docker.

---

## 2. Subindo com Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

O `.env` precisa de `NODE_ENV` (o `.env.example` já traz). Sem ela, o compose aborta com `defina NODE_ENV no .env`.

Sobem, nesta ordem:

```
postgres (healthy) ──┐
                     ├──▶ seed (migration + carga da base, termina) ──▶ api :3000
redis (opcional) ────┘
```

1. **`postgres`** e **`redis`**.
2. **`seed`**: aplica a migration, carrega `data/ceps.csv.gz` no Postgres e termina.
3. **`api`**: sobe em `http://localhost:3000` só depois que o seed termina com sucesso.

A `api` não depende do Redis, e o seed o tem como dependência opcional: se o Redis falhar na subida, o compose avisa e os dois sobem sem cache (ver [Cache](./cache.md)).

### Carregando só algumas UFs

O Brasil inteiro tem 898.455 CEPs. Para subir mais rápido:

```bash
SEED_UFS=SP,RJ docker compose up --build
```

`SEED_UFS` vazio carrega o Brasil inteiro. Para recarregar com outras UFs: `SEED_UFS=SP docker compose run --rm seed`.

---

## 3. Rodando fora do Docker

```bash
npm ci                         # o postinstall gera o client do Prisma
docker compose up -d postgres redis
npx prisma migrate deploy
npm run seed
npm run dev                    # ou npm start
```

Os scripts `start`, `dev` e `seed` leem o `.env` (`--env-file-if-exists`). Fora do Docker, defina `DATABASE_URL` e `REDIS_URL` apontando para `localhost`; o `.env.example` traz os exemplos.

**Atenção ao migrar à mão:** a tabela `loaded_uf` (UFs carregadas) é preenchida pelo seed. Depois de um `prisma migrate deploy`, rode o seed; sem ele, todo CEP fora da base com UF existente cai em `CEP_FORA_DA_COBERTURA`.

---

## 4. Variáveis de Ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | — | `development`, `test` ou `production` (obrigatória, sem padrão). `production` desliga o `/docs` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | — | credenciais do Postgres (obrigatórias no compose, que monta a `DATABASE_URL` dos contêineres a partir delas) |
| `POSTGRES_PORT`, `API_PORT`, `REDIS_PORT` | `5432`, `3000`, `6379` | portas publicadas no host pelo compose |
| `DATABASE_URL` | — | conexão Postgres (obrigatória; o compose a monta sozinho) |
| `REDIS_URL` | — | conexão Redis (obrigatória; o compose já define) |
| `PORT` | `3000` | porta da API |
| `SEARCH_RADIUS_KM` | `1` | raio de busca em km |
| `SEED_UFS` | vazio | UFs a carregar, separadas por vírgula |
| `CACHE_TTL_ADDRESS_SECONDS` | `2592000` (30 d) | TTL do endereço (BrasilAPI) e da coordenada do Nominatim |
| `CACHE_TTL_RESULT_SECONDS` | `86400` (24 h) | TTL do resultado (origem + lista de vizinhos) |
| `CACHE_TTL_NOT_FOUND_SECONDS` | `3600` (1 h) | TTL do CEP que a BrasilAPI não encontra e do "sem match" do Nominatim |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | base do Nominatim |
| `NOMINATIM_USER_AGENT` | `bc_giross/1.0 (+https://github.com/owhenrique/bc_giross)` | `User-Agent` enviado ao Nominatim (a política de uso exige identificar o cliente) |
| `CACHE_ADMIN_TOKEN` | vazio | token dos endpoints de limpeza de cache (mínimo de 12 caracteres; vazio desliga os endpoints) |
| `RATE_LIMIT_MAX` | `60` | requisições por IP dentro da janela |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | janela do limite de entrada, em segundos |
| `TRUST_PROXY` | vazio | de onde sai o IP do cliente atrás de proxy: número de saltos (`1`), `loopback`, lista de CIDRs |
| `LOG_LEVEL` | `info` | nível do Pino |

As variáveis são validadas com Zod na subida: valor inválido derruba o processo com a mensagem do erro.

---

## 5. Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/ceps-proximos/:cep` | CEPs no raio, ordenados pela distância (`?pagina=` e `?limite=`) |
| `GET` | `/ceps-proximos/:cep/detalhes` | o mesmo, com coordenada, fonte e endereço da origem e o raio |
| `GET` | `/saude` | `{ "status": "ok" }`, sem checar dependências |
| `DELETE` | `/cache` e `/cache/:cep` | limpeza de cache com token (ver [Cache](./cache.md)) |
| `GET` | `/docs` e `/docs/openapi.json` | documentação live (Scalar) e o documento OpenAPI |

```bash
curl localhost:3000/ceps-proximos/04551-000
curl localhost:3000/ceps-proximos/04551000/detalhes?limite=5
```

O contrato completo, com exemplos e erros, está em `/docs` e no [`openapi.yaml`](../openapi.yaml).

---

## 6. Testes

```bash
npm test               # Vitest + Supertest
npm run lint           # ESLint, incluindo a regra de camadas
npm run typecheck      # tsc --noEmit
npm run format:check   # Prettier
```

Para formatar o código, rode `npm run format`. Todo PR para a `main` roda esses comandos no CI (ver [CI](./ci.md)).
