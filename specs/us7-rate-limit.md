---
id: us7
card: —
mapa: docs/HISTORIAS.md
depende_de: US2 (mergeada). Parte da `main` com a US6 (PR #8, mergeada)
titulo: Rate limit da API
status: implementado
modo: agent-driven
criada_em: 2026-10-27
implementada_em: 2026-10-27
verificada_em: 2026-10-27
branch: feat/us7-rate-limit
merge_request: https://github.com/owhenrique/bc_giross/pull/9
---

# US7 — Rate limit da API

## História
Como **operador da API**, quero limitar as requisições por cliente, para proteger o serviço, a BrasilAPI e o Nominatim de abuso.

## Contexto
Hoje nada limita quem chama a nossa API. Um cliente pode disparar milhares de consultas de CEPs fora da base, e cada uma gasta o limite da BrasilAPI (5 req/s) e do Nominatim (1 req/s, com risco de bloqueio do IP). Esta US limita a entrada: 60 req/min por IP, com `express-rate-limit`, e `429 LIMITE_EXCEDIDO`. Os limites de saída (`WindowRateLimiter`) não mudam.

No mapa (`docs/HISTORIAS.md`), a US7 depende só da US2. A branch parte da `main`, que já tem a US6 (o `DELETE /cache` também fica sob o rate limit).

## Critérios de aceite
**Entrada (nossa API)**
- [x] Dado 60 requisições do mesmo IP dentro da janela de 60 s, quando chega a 61ª, em qualquer rota (incluindo `DELETE /cache` e rotas inexistentes), então `429` com `{ erro: { codigo: "LIMITE_EXCEDIDO", mensagem: "Limite de requisições excedido" } }` e o header `Retry-After` com os segundos que faltam para a janela virar.
- [x] Dado um IP que estourou o limite, quando outro IP chama, então o outro é atendido normalmente: os contadores são por IP. IPv6 conta por sub-rede /56 (padrão do `express-rate-limit`).
- [x] Dado uma resposta dentro ou fora do limite, então ela traz os headers `RateLimit` e `RateLimit-Policy` (IETF draft-8). Os headers legados `X-RateLimit-*` não são enviados.
- [x] Dado `RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW_SECONDS` (padrão 60 e 60), então o limite e a janela seguem a env. Valor não inteiro ou < 1 faz o `loadEnv` falhar.
- [x] Dado `TRUST_PROXY` definido (ex.: `1`, `loopback`), então o IP do cliente sai do `X-Forwarded-For` conforme o `trust proxy` do Express. Sem a env (ou vazia), vale o IP do socket, e o `X-Forwarded-For` é ignorado.

**Requisição que gera outra internamente**
- [x] Dado uma requisição que passa pelo middleware de rate limit mais de uma vez (o mesmo `req` atravessa um router ou sub-app que monta o middleware de novo, ou é repassado internamente), então ela conta **uma vez só** e não recebe `429` por causa da própria passagem extra: o middleware pula quando `req.rateLimit` já está definido.
- [x] Dado a regra de arquitetura D30, então a composição interna (um caso de uso que precisa do resultado de outro) chama o caso de uso direto, em processo, e nunca faz HTTP para a própria API. Assim, a chamada interna não gasta o limite do cliente, não divide contador com `127.0.0.1` e não consome duas vezes a vaga da BrasilAPI ou do Nominatim. A regra fica registrada em `docs/DECISOES.md` (D30) e num comentário no `rateLimitMiddleware`.
- [x] Dado um teste com o middleware montado duas vezes no mesmo caminho (app e router) e limite 2, quando o mesmo IP faz 2 requisições, então as duas são `200` e o `RateLimit` mostra 0 restante. Um middleware que contasse em dobro bloquearia a 2ª, e o teste quebra.

**Docs**
- [x] O README documenta o limite de entrada, as envs `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY` e o `429 LIMITE_EXCEDIDO` na tabela de erros. O `docker-compose.yml` e o `.env.example` trazem as três envs.

## Escopo
**Dentro:**
- Middleware global de rate limit no `createApp`, com `express-rate-limit` (dependência nova).
- Resposta `429 LIMITE_EXCEDIDO` na borda HTTP.
- Envs `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY`. README, DECISOES e HISTORIAS.

**Fora** (fica para outra US do mapa ou fora do card):
- Documentação OpenAPI do `429` → US10.
- Limites diferentes por rota, allowlist de IPs, limite por token/cliente autenticado → fora do card.
- Janela deslizante no limite de entrada (a entrada usa janela fixa) → fora do card.
- Configurar por env os limites de saída (5/s e 1/s continuam fixos no código) → fora do card.

## Decisões e respostas do usuário
- P: De onde parte a branch, com a US6 em PR aberto? → R: o usuário já deu o pull. A US6 está na `main` (PR #8), e a US7 parte dela.
- P: Como implementar o limite de entrada? → R: `express-rate-limit`, em vez de código próprio.
- P: Como identificar o cliente atrás de proxy? → R: env `TRUST_PROXY`, repassada ao `trust proxy` do Express. Desligada por padrão.
- P: Quais headers? → R: `RateLimit` e `RateLimit-Policy` (draft-8) e `Retry-After` no `429`.
- P: Como garantir que, se a API evoluir e uma requisição fizer outra internamente, isso não quebre o limite? → R: contagem única por requisição (pula se `req.rateLimit` já existe) + regra de arquitetura D30 (composição interna chama o caso de uso em processo, nunca HTTP para a própria API) + teste que trava a contagem única. Foram descartados: o token interno com header que pula o limite (cria segredo e superfície de ataque) e o repasse assinado do IP original (complexo demais para um caso que a regra D30 evita).

## Premissas
Nenhuma.

## Design técnico
- **Modelos de dados / migrações:** nenhum.
- **Dependência:** `express-rate-limit@^8.7.1`. Lido no código do pacote:
  - o `Retry-After` só sai com `standardHeaders` ou `legacyHeaders` ligados;
  - a lib grava o `Retry-After` e os headers `RateLimit` antes de chamar o `handler`.
- **Middleware** (`src/presentation/http/rate-limit.ts`), com `rateLimitMiddleware({ limit, windowMs, logger })`:
  - `rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, skip, logger, handler })`;
  - `skip: (req) => req.rateLimit !== undefined`: a lib só define `req.rateLimit` depois de contar, então uma segunda passagem do mesmo `req` é pulada antes do `increment`. Isso evita contar em dobro e o aviso `ERR_ERL_DOUBLE_COUNT` da validação `singleCount`. O comentário no código aponta para a D30;
  - `logger`: o do pino, para os avisos de configuração da lib;
  - o `handler` responde `429 LIMITE_EXCEDIDO` pelo `sendError`, na borda HTTP, porque o limite de entrada não é de um caso de uso.
- **Erro:** `429` com `{ codigo: 'LIMITE_EXCEDIDO', mensagem: 'Limite de requisições excedido' }`, sem `AppError`: nenhum caso de uso o lança.
- **Composição** (`src/presentation/http/app.ts`):
  - `AppDeps` ganha `rateLimit: { limit: number; windowMs: number }` (obrigatório, para a produção não esquecer) e `trustProxy?: boolean | number | string`;
  - ordem: `app.set('trust proxy', trustProxy ?? false)`, `pinoHttp`, `rateLimitMiddleware`, routers, `notFoundHandler`, `errorHandler`. O 429 passa pelo `pinoHttp` e cobre as rotas inexistentes.
- **Configuração** (`src/config/env.ts`):
  - `RATE_LIMIT_MAX` (int ≥ 1, padrão 60) e `RATE_LIMIT_WINDOW_SECONDS` (int ≥ 1, padrão 60), expostos como `Env.rateLimit: { max, windowSeconds }`;
  - `TRUST_PROXY` opcional: vazio ou ausente → `false`, `true`/`false` → boolean, só dígitos → número de saltos, outro texto → string (ex.: `loopback, 10.0.0.0/8`). Exposto como `Env.trustProxy`;
  - no compose, `${RATE_LIMIT_MAX:-60}`, `${RATE_LIMIT_WINDOW_SECONDS:-60}` e `${TRUST_PROXY:-}`.
- **`src/index.ts`:** `createApp({ ..., trustProxy: env.trustProxy, rateLimit: { limit: env.rateLimit.max, windowMs: env.rateLimit.windowSeconds * 1000 } })`.
- **Requisição interna (D30):** em `docs/DECISOES.md`, nova D30 ("Composição interna em processo"). Um fluxo que precise do resultado de outro chama o caso de uso (`findNearbyCeps`, `clearCache`...) direto, pela composição em `src/index.ts`, e nunca faz `fetch` para a própria API. Motivos:
  - a requisição interna sairia de `127.0.0.1` (ou do IP do pod), dividindo um contador só entre todos os clientes;
  - gastaria o limite do cliente duas vezes;
  - repetiria a vaga dos limiters de saída.

  Somada ao `skip`, a regra garante uma contagem por requisição do cliente. Os limiters de saída não mudam: em processo, cada chamada externa real pede uma vaga só.
- **Casos de borda:**
  - `TRUST_PROXY=true` confia em qualquer `X-Forwarded-For` e a lib loga `ERR_ERL_PERMISSIVE_TRUST_PROXY`. O README recomenda o número de saltos;
  - as requisições que recebem `429` também contam na janela (comportamento da lib). Em janela fixa, isso não estende o bloqueio.

## Arquivos que a mudança toca
- `src/presentation/http/rate-limit.ts` — criar: `rateLimitMiddleware`, com `skip` de contagem única — ~28 linhas
- `src/presentation/http/errors.ts` — a entrada do `429 LIMITE_EXCEDIDO` — ~5 linhas
- `src/presentation/http/app.ts` — `AppDeps.rateLimit`, `AppDeps.trustProxy`, `trust proxy`, `app.use` — ~10 linhas
- `src/config/env.ts` — `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `TRUST_PROXY`, `Env.rateLimit`, `Env.trustProxy` — ~20 linhas
- `src/index.ts` — `rateLimit` e `trustProxy` no `createApp` — ~5 linhas
- Testes (não contam): `src/presentation/http/rate-limit.test.ts` (criar, Supertest), `src/config/env.test.ts`, `src/presentation/http/app.test.ts` e `cache-route.test.ts` (helpers passam `rateLimit`)
- Config/docs (não contam): `package.json`, `package-lock.json`, `docker-compose.yml`, `.env.example`, `README.md`, `docs/DECISOES.md` (D22 cont. e D30), `docs/HISTORIAS.md` (US7)

## Limite de tamanho
A US inteira sai num PR, mergeável sozinho, com **até 500 linhas de lógica** adicionadas ou modificadas. Remoção não conta.

- **Estimativa:** ~153 linhas (bc_giross: ~153).
- **Não contam:** testes, documentação, configuração e dados, lockfiles, migrations e código gerado. Nenhum arquivo gerado nesta US (`src/generated/prisma` não muda).
- **Medição**, sobre os commits da branch:

  ```bash
  git diff --numstat main...HEAD | awk -F'\t' '
    $1 == "-" { next }                                                             # binário
    $3 ~ /(^|\/)(tests?|__tests__|__snapshots__|e2e|docs|migrations|generated)\// { next }
    $3 ~ /\.(test|spec|e2e-spec)\.|_test\.|(^|\/)test_|-contract-test\./ { next }
    $3 ~ /\.(md|mdx|json|ya?ml|toml|lock|snap)$/ { next }
    { s += $1 } END { print s + 0 }'
  ```

Passou de 500? Não divida em partes nem abra mais de um PR: reduza o escopo (os critérios cortados viram outra US no mapa) ou simplifique, decidindo com o usuário.

## Triagem de implementação
Preenchido no `/pato/spec`; o `/pato/implement` confirma o modo com o usuário antes de começar.

| Métrica | Valor |
| --- | --- |
| Tarefas | 2 |
| Arquivos que a mudança toca | 5 de código (+4 de teste, +7 de config/docs) |
| Linhas de lógica estimadas | ~153 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Sim (novo `429 LIMITE_EXCEDIDO` e headers `RateLimit*`, aditivo) |
| Dependência nova | Sim (`express-rate-limit`) |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, por causa da dependência nova e da mudança de contrato.

## Tarefas
Passos (commits) desta US. Todos entram no mesmo PR, e tarefa não é entregável.
- [x] 1. Limite de entrada: instalar `express-rate-limit`; a resposta `429 LIMITE_EXCEDIDO`; `rateLimitMiddleware` com `skip` de contagem única; `AppDeps.rateLimit`/`trustProxy` no `createApp`; `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` e `TRUST_PROXY` no `loadEnv` e no `index.ts`. Testes: `rate-limit.test.ts`, `env.test.ts` e os helpers de `app.test.ts`/`cache-route.test.ts`.
- [x] 2. Config e docs: `docker-compose.yml`, `.env.example`, README (limite, envs, `429`, `TRUST_PROXY`), DECISOES (D22 cont. e D30, composição interna em processo) e HISTORIAS (US7).

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- **Unitários:**
  - `loadEnv`:
    - padrões 60/60;
    - `RATE_LIMIT_MAX=0` ou `abc` falham;
    - `TRUST_PROXY` vazio → `false`, `1` → `1`, `true` → `true`, `loopback` → `'loopback'`.
- **HTTP (Supertest, `rate-limit.test.ts`, com limite baixo, ex.: 2):**
  - 3ª requisição → `429 LIMITE_EXCEDIDO` com `Retry-After` numérico, `RateLimit` e `RateLimit-Policy`, e sem `X-RateLimit-*`;
  - rota inexistente também conta e bloqueia;
  - com `trustProxy: 1`, `X-Forwarded-For` diferente → contadores separados;
  - sem `trustProxy`, `X-Forwarded-For` diferente → mesmo contador;
  - contagem única: o middleware montado no app e de novo num router do mesmo caminho, com limite 2, faz 2 requisições → as duas `200`, e a 3ª `429`.
- **Suítes:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.
- **Manual**, com `docker compose up`:
  1. `for i in $(seq 61); do curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/ceps-proximos/04551000; done | sort | uniq -c` → 60 × `200` e 1 × `429`. Depois, `curl -i` mostra `Retry-After`.

## Verificação independente
Preenchido no `/pato/verify`; o `/pato/close-spec` não começa sem esta seção.

- **Data:** 2026-10-27
- **Verificador:** subagente em contexto limpo (general-purpose)
- **Suítes rodadas:** `npm test` (26 arquivos, 258 testes, 0 falhas), `npm run typecheck`, `npm run lint`, `npm run format:check`: todas OK. Sem telas (sem Playwright).
- **Critérios de aceite:** todos atendidos.
- **Entregável:** sim. A branch parte da `main`, tem só commits da US7, sem TODO nem flag escondida.
- **Linhas de lógica:** 221 / 500 (estimativa 153; inclui 5 linhas do `.env.example`, que o awk não exclui).
- **Achados:** (Baixa) cast em `rate-limit.ts:25`: o verificador sugeriu removê-lo, mas o tipo `Request` não declara `rateLimit` aqui (TS2339), então o cast fica. (Baixa) medição acima da estimativa por causa do `.env.example`: sem ação.
- **Decisão do usuário:** corrigir os achados menores; aplicado o que cabia.
- **Não verificado:** `docker compose up` e o passo manual da spec, `TRUST_PROXY=true` e o aviso `ERR_ERL_PERMISSIVE_TRUST_PROXY`.

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-27 | Automatizado | local | local | `npm test` (26 arquivos, 258 testes), typecheck, lint, format:check | Aprovado | — |
| 2026-10-27 | Verificação independente | subagente (contexto limpo) | local | diff contra a spec e suítes | Aprovado | seção "Verificação independente" |
| 2026-10-27 | Manual | Henrique | local (docker compose) | teste manual da spec: 60×200 + 1×429 | Aprovado | — |

## Riscos e pontos em aberto
- **Regra D30 só por convenção:** nada impede, no código, que alguém faça `fetch` para a própria API. A defesa é a D30 e o comentário no middleware. Se a regra for quebrada, a chamada interna conta como um cliente `127.0.0.1`. Se um dia houver outro serviço chamando a API, o token interno descartado nesta US volta a ser opção (fora do card).
- **IP errado atrás de proxy:** sem `TRUST_PROXY`, todos os clientes atrás do mesmo proxy dividem o contador. Fica documentado no README.
