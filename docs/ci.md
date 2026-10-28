# Integração Contínua (CI) e Docker

Este documento descreve o pipeline do GitHub Actions, a proteção da `main` e como a aplicação roda em containers.

---

## 1. Pipeline (`.github/workflows/ci.yml`)

- **Gatilho:** todo pull request para a `main`.
- **Ambiente:** `ubuntu-latest`, Node 24 (o mesmo major do `Dockerfile`), `npm ci` com cache de dependências. O `postinstall` gera o client do Prisma.
- **Passos, em ordem:** `npm run lint` → `npm run typecheck` → `npm run format:check` → `npm test`. O job para no primeiro que falhar.
- **Cuidados:** token só de leitura, timeout de 10 min, e um push novo no mesmo PR cancela a execução anterior.

**Proteção da `main`:** todo merge exige PR e o check `check` verde, inclusive para admin.

---

## 2. Testes

- **Vitest + Supertest:** domínio (Haversine contra distâncias conhecidas, centróide, p90, vizinhos), casos de uso com fakes das portas, adaptadores com `fetch` falso e rotas HTTP sem Postgres nem Redis.
- **Teste de contrato:** cada resposta de sucesso e de erro de cada rota é validada (Ajv) contra o schema do `openapi.yaml`. Se o código e o contrato divergirem, o teste quebra.
- **Regra de camadas:** o `npm run lint` falha quando uma camada importa outra que não pode (ver [Arquitetura](./architecture.md#4-princípios)).

---

## 3. Docker

- **Imagem (`Dockerfile`):** `node:24-slim`, `npm ci` (com o `prisma generate`) e a aplicação rodando TypeScript com `tsx`, sem etapa de build.
- **Compose:** `postgres`, `redis`, `seed` (one-shot) e `api`. O `.env` fica fora da imagem, e as variáveis vêm do compose; por isso a `api` e o `seed` rodam `start:container` e `seed:container`, sem o `--env-file-if-exists`.
- **Credenciais:** o compose lê `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` do `.env` e monta a `DATABASE_URL`, sem credenciais fixas no arquivo.
- **Dependências entre serviços:** o `seed` espera o Postgres saudável e o Redis como dependência opcional; a `api` espera o seed terminar com sucesso. Uma falha do seed (ex.: a migration) impede a API de subir. Uma porta do host ocupada derruba a subida inteira; nesse caso, troque `POSTGRES_PORT`, `API_PORT` ou `REDIS_PORT`.
