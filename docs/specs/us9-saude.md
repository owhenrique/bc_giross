---
id: us9
card: —
mapa: docs/HISTORIAS.md
depende_de: US8 (PR #3) e US12 (PR #10), mergeadas
titulo: Healthcheck (`/saude`)
status: em-andamento
modo:
criada_em: 2026-10-28
implementada_em:
verificada_em:
branch: feat/us9-saude
merge_request:
---

# US9 — Healthcheck (`/saude`)

## História
Como **operador da API**, quero uma rota que diga se a API está no ar, para conferir de relance que o serviço responde, sem montar uma consulta de CEP.

## Contexto
O mapa (`docs/HISTORIAS.md`) previa um `/saude` completo: Postgres, Redis e BrasilAPI checados, `200`/`503` conforme o componente, porta `HealthIndicator`, healthcheck do compose e isenção do rate limit. No refinamento o escopo encolheu. A rota é consultada só por uma pessoa, nunca pelo container nem por um orquestrador, e responde só se a API está no ar, com corpo fixo e sem checar dependências.

Fica de fora a checagem do banco: um `SELECT 1` no `CepRepository` misturaria responsabilidades, porque a porta só trata CEP.

A US9 roda depois da US12 e antes da US10. A US10 documenta o `GET /saude` no OpenAPI.

## Critérios de aceite
- [ ] 1. Dado a API no ar, quando chamo `GET /saude`, então recebo `200` com o corpo `{ "status": "ok" }`.
- [ ] 2. Dado a API no ar com o Postgres ou o Redis fora, quando chamo `GET /saude`, então a resposta continua `200 { "status": "ok" }`: a rota não acessa banco, cache nem provedores externos.
- [ ] 3. Dado `POST /saude` (ou outro método que não `GET`), então a resposta é o `404 NAO_ENCONTRADO` genérico de hoje.
- [ ] 4. Dado mais de `RATE_LIMIT_MAX` requisições do mesmo IP na janela, somando `/saude` e as outras rotas, então o `/saude` recebe `429 LIMITE_EXCEDIDO` como qualquer rota: ele conta no rate limit da US7, sem isenção.
- [ ] 5. Dado o README, então a seção "Contrato" descreve o `GET /saude` e a resposta dele.
- [ ] 6. Dado o projeto, quando rodo `npm test`, `npm run lint`, `npm run typecheck` e `npm run format:check`, então todos passam.

## Escopo
**Dentro:**
- Router `healthRouter` com `GET /saude` e retorno fixo, registrado no `createApp` depois do rate limit.
- Teste HTTP da rota (Supertest).
- README (contrato). O mapa já foi ajustado nesta spec.

**Fora** (fora do card, decidido no refinamento):
- Checagem do Postgres, do Redis, da BrasilAPI e do Nominatim.
- Status `degradado`/`indisponivel` e `503`.
- Porta `HealthIndicator`.
- `healthcheck` do serviço `api` no `docker-compose.yml`.
- Isenção do `/saude` no rate limit.

## Decisões e respostas do usuário
- P: (proposta inicial do mapa: componentes `banco`, `cache`, `provedor_cep`, porta `HealthIndicator`, healthcheck no compose) → R: "quero uma rota simples de healthcheck, não precisa ser nada fancy".
- P: o `/saude` marca o container como saudável/doente? → R: não. A rota é usada só pelo usuário, e o container não a chama. Com isso, o healthcheck do compose e a isenção do rate limit saem.
- P: checar o banco com um `SELECT 1` via `CepRepository.ping()`? → R: não, porque o `CepRepository` só trata CEP. Fica só um status `ok`, verificando apenas a API, com um router de retorno fixo.

## Premissas
- O `/saude` conta no rate limit como as outras rotas, porque a isenção existia só por causa do orquestrador, que saiu do escopo.

## Design técnico
- **Contrato:** `GET /saude` → `200`, `Content-Type: application/json`, corpo `{ "status": "ok" }`. Sem parâmetros, sem autenticação.
- **Camadas:** a rota é só HTTP, sem caso de uso, porque não há lógica: `presentation/http/routes/health-route.ts` exporta `healthRouter(): Router`, no mesmo formato de `nearbyCepsRouter` e `cacheRouter`.
- **Registro:** em `createApp`, `app.use(healthRouter())` junto das outras rotas, depois do `rateLimitMiddleware` e antes do `notFoundHandler`. O `AppDeps` e o `index.ts` não mudam.
- **Erros:** nenhum novo. Método diferente de `GET` cai no `notFoundHandler`.

## Arquivos que a mudança toca
- `src/presentation/http/routes/health-route.ts` — criar: `healthRouter` com `GET /saude` → `res.json({ status: 'ok' })` — ~7 linhas
- `src/presentation/http/app.ts` — alterar: import e `app.use(healthRouter())` — ~2 linhas
- `src/presentation/http/routes/health-route.test.ts` — criar: testes dos critérios 1–4 via `createApp` — teste, não conta
- `README.md` — alterar: `### GET /saude` na seção "Contrato" — doc, não conta
- `docs/HISTORIAS.md` — já ajustado no /pato/spec (tabela, seção US9 e nota da US7); entra no primeiro commit — doc, não conta

## Limite de tamanho
A US inteira sai num PR, mergeável sozinho, com **até 500 linhas de lógica** adicionadas ou modificadas. Remoção não conta.

- **Estimativa:** ~10 linhas (bc_giross: ~10) — soma da lista acima.
- **Não contam:** testes, documentação, configuração e dados, lockfiles, migrations e código gerado. Nenhum gerado.
- **Medição**, sobre os commits da branch:

  ```bash
  git diff --numstat main...HEAD | awk -F'\t' '
    $1 == "-" { next }
    $3 ~ /(^|\/)(tests?|__tests__|__snapshots__|e2e|docs|migrations)\// { next }
    $3 ~ /\.(test|spec|e2e-spec)\.|_test\.|(^|\/)test_|-contract-test\./ { next }
    $3 ~ /\.(md|mdx|json|ya?ml|toml|lock|snap)$/ { next }
    { s += $1 } END { print s + 0 }'
  ```

## Triagem de implementação
| Métrica | Valor |
| --- | --- |
| Tarefas | 1 |
| Arquivos que a mudança toca | 2 de código (+ teste e 2 docs) |
| Linhas de lógica estimadas | ~10 |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Sim (rota nova, aditiva) |
| Dependência nova | Não |
| Repos envolvidos | 1 |

**Modo sugerido:** direto. É uma tarefa, com 2 arquivos de código e ~10 linhas. A rota nova é aditiva e não muda nenhum contrato existente.

## Tarefas
- [ ] 1. `GET /saude` com retorno fixo: `healthRouter`, registro no `createApp`, teste HTTP e README.

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- `src/presentation/http/routes/health-route.test.ts` (Supertest sobre `createApp`, com o `findNearbyCeps` fake como nos outros testes de rota):
  - `GET /saude` → `200` e corpo `{ status: 'ok' }` (critério 1);
  - o `findNearbyCeps` fake não é chamado (critério 2: a rota não toca dependências);
  - `POST /saude` → `404 NAO_ENCONTRADO` (critério 3);
  - com `rateLimit.limit = 1`, a segunda chamada ao `/saude` → `429 LIMITE_EXCEDIDO` (critério 4).
- Suítes: `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`.
- Manual: `docker compose up`, `curl -i localhost:3000/saude` → `200 {"status":"ok"}`. Com `docker compose stop postgres redis`, a mesma resposta.

## Verificação independente
Preenchido no `/pato/verify`; o `/pato/close-spec` não começa sem esta seção.

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |

## Riscos e pontos em aberto
- O `/saude` diz só que o processo responde HTTP. Ele não detecta o Postgres fora: nesse caso o `/saude` dá `200` e as consultas de CEP falham. Isso foi aceito no refinamento.
- A `main` local está 4 commits à frente da `origin/main` (fixes do compose e do seed). A branch da US9 parte da `main` local, e esses commits precisam ser enviados antes ou junto do PR.
