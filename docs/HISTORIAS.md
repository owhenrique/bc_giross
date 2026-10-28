# Histórias de usuário — API de CEPs próximos

Quebra do business case da Giross em histórias entregáveis. Cada uma vira uma spec, uma branch e um PR, com até 500 linhas de lógica. As decisões que valem para todas estão em [`DECISOES.md`](./DECISOES.md). O enunciado está em `../../docs/BC - Dev Fullstack.pdf`.

## Personas
- **Giross** (time de operações/logística, consumindo a API): consulta CEPs próximos a um CEP de referência.
- **Operador da API**: mantém o serviço no ar (cache, proteção contra abuso).
- **Mantenedor da API**: gera e audita a base de CEPs.
- **Time de desenvolvimento**: evolui a API (US técnicas, só quando se sustentam sozinhas).
- **Integrador da Giross**: o desenvolvedor que lê o contrato para integrar com a API.

## Visão geral

| US | Título | Estimativa | Depende de |
| --- | --- | --- | --- |
| US1 | Base de CEPs com coordenadas | ~200 | — |
| US2 | Consultar CEPs próximos | ~370 | US1 |
| US3 | Endereço da origem e erros claros | ~200 | US2 |
| US11 | Formatação automática com Prettier (roda logo após a US3) | ~50 (reformatação) | US3 |
| US4 | Cache | ~250 | US3 |
| US5 | Fallback de coordenada (Nominatim) | ~205 | US4 |
| US6 | Limpeza de cache protegida | ~80 | US4 |
| US7 | Rate limit da API (entrada e saída no Redis) | ~150 | US2 |
| US8 | Error middleware com catálogo de erros | ~100 | US2 (migra os erros que existem; as US3–US7 já usam o catálogo) |
| US12 | Simplificação do projeto (roda antes da US9) | ~270 | US7, US8 |
| US9 | Healthcheck (`/saude`) | ~10 | US8, US12 |
| US10 | Documentação da API com Scalar | ~40 | US8, US9 |

Depois da US10, `docs/specs/` e este arquivo vão para a branch `docs` (decidido na US12).

---

## US1 — Base de CEPs com coordenadas
Como **mantenedor da API**, quero uma base unificada de CEPs do Brasil com coordenadas e qualidade controlada, gerada de forma auditável a partir do CNEFE, para que a busca por proximidade cubra o país sem depender de download na hora de rodar.

História técnica de dados, aprovada explicitamente. Juntar com a US2 daria ~540 linhas.

- Dado os ZIPs do CNEFE numa pasta local, quando o mantenedor roda `npm run build-dataset -- --pasta <dir>`, então é gerado `data/ceps.csv.gz` (`cep;uf;latitude;longitude`, uma linha por CEP).
- Dado um CEP com endereços de precisão 1–4, então a coordenada dele é a média dos pontos únicos.
- Dado um CEP com espalhamento p90 > 2 km, então ele fica fora da base.
- Dado o processamento concluído, então um relatório traz os totais por UF, os removidos e o tempo.

Contexto:
- O script é rodado pelo mantenedor, uma vez, lendo os ZIPs de uma pasta local, sem lógica de download. Os 27 ZIPs já estão em `giross_teste_tecnico/cnefe-raw`.
- O avaliador nunca roda o script, porque usa o CSV commitado.
- Inclui o esqueleto do projeto (Node 24, TypeScript, Vitest, ESLint) e a função Haversine no domínio.

Fica para outra US: carga no Postgres, endpoint, docker compose (US2).

## US2 — Consultar CEPs próximos
Como **Giross**, quero consultar os CEPs num raio de um CEP de referência, com a distância de cada um, para agrupar entregas e avaliar a cobertura de uma praça.

- Dado o `docker compose up`, então o Postgres sobe, o seed carrega o CSV (filtrável por `SEED_UFS`, idempotente) e a API responde.
- Dado um CEP na base, quando chamo `GET /ceps-proximos/04551000`, então recebo `{ origem: {cep, latitude, longitude, fonte}, raio_km, paginacao, ceps: [{cep, distancia_km}] }`, ordenado por distância, com 2 casas decimais e sem a origem.
- Dado um CEP a mais de `SEARCH_RADIUS_KM` (distância exata, ex.: 1,004 km), então ele não aparece. `04551-000` funciona igual a `04551000`.
- Dado `?pagina=2&limite=50`, então recebo a página 2 com `total` e `total_paginas`. O limite máximo é 200.
- Dado `123`, então `400`. Dado um CEP fora da base, então `404 CEP não encontrado` (refinado na US3).
- O Haversine é testado contra distâncias conhecidas.

Fica para outra US: endereço e erros da BrasilAPI (US3), cache (US4), fallback (US5).

## US3 — Endereço da origem e erros claros
Como **Giross**, quero ver o endereço do CEP consultado e receber erros claros para CEP inexistente ou fora da cobertura, para confiar na resposta e entender por que ela falhou.

- Dado um CEP válido, quando chamo `GET /ceps-proximos/:cep/detalhes`, então `origem.endereco` traz rua, bairro, cidade e UF da BrasilAPI v2 (campos vazios como `null`).
- Dado `GET /ceps-proximos/:cep` (resumo), então a resposta é enxuta (`origem` é só o CEP, sem raio nem endereço) e, com o CEP na base, não chama a BrasilAPI.
- Dado um CEP fora da base que a BrasilAPI também não acha, então `404 CEP_NAO_ENCONTRADO`.
- Dado um CEP fora da base que existe, com UF não carregada, então `422 CEP_FORA_DA_COBERTURA`.
- Dado um CEP fora da base que existe, com UF carregada, então `422 CEP_SEM_GEOLOCALIZACAO` (refinado na US5).
- Dado um CEP fora da base e a BrasilAPI fora do ar, com timeout (3 s) ou sem vaga no limite, então `503 PROVEDOR_INDISPONIVEL`.
- Dado um CEP na base e a BrasilAPI fora do ar, estourando o timeout ou respondendo `404`, então `/detalhes` responde `200` com `origem.endereco: null`.
- As chamadas à BrasilAPI ficam limitadas a 5 req/s.

Decisões: duas rotas, a simples (`/ceps-proximos/:cep`) e a completa (`/ceps-proximos/:cep/detalhes`); quem usava o contrato completo migra para `/detalhes`. O `404` da BrasilAPI só vale como "não encontrado" se algum item de `errors[]` disser isso; senão é indisponível. O adapter traduz os erros da BrasilAPI para um resultado neutro, sem tocar o domínio.

Fica para outra US: cache (US4), fallback Nominatim (US5).

## US11 — Formatação automática com Prettier
Como **time de desenvolvimento**, quero que o código seja formatado por uma ferramenta, com um estilo único, para que revisão e diff mostrem só mudança de comportamento, e não idas e vindas de formatação (como o `refactor(us3): volta ao estilo de formatação do projeto`).

US técnica, pedida explicitamente. Roda logo depois da US3 e antes da US4: o número 11 é só de cadastro, e a ordem é a da tabela.

- Dado o projeto, então existe `.prettierrc.json` com `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `arrowParens: "always"`, `endOfLine: "lf"` e `printWidth: 100`.
- O `printWidth: 100` equilibra leitura e tokens: a 80, 137 linhas do código atual quebrariam e cada chamada viraria 3–5 linhas; a 120, as linhas ficam longas demais para diff lado a lado. Hoje só 17 linhas passam de 100.
- Dado `npm run format`, então o Prettier formata o projeto inteiro (`prettier --write .`), TS/JS, JSON e YAML, menos o que está no `.prettierignore`. Dado `npm run format:check`, então ele sai com código ≠ 0 se algum arquivo estiver fora do padrão.
- Dado `.prettierignore`, então ficam de fora `data/`, `graphify-out/`, `src/generated/`, `prisma/migrations/`, `package-lock.json` e os `*.md` (docs em português, com tabelas, que não mudam de formato nesta US).
- Dado o ESLint, então `eslint-config-prettier` desliga as regras de estilo que brigam com o Prettier, e `npm run lint` passa.
- Dado o código existente, então a reformatação vai num commit só, sem nenhuma outra mudança, e o hash dele entra em `.git-blame-ignore-revs`, para o `git blame` pular esse commit.
- Dado a reformatação, então `npm test` e `npm run typecheck` passam sem alterar nenhum teste, porque não há mudança de comportamento.

Tamanho: medido de novo com `prettier@3` sobre a main com a US3, a reformatação altera ~156 linhas em 13 arquivos de código: ~51 de produção, que contam no limite, e ~105 de testes, que não contam. Além disso, 3 linhas do `docker-compose.yml`, que é config. Não há lógica nova. Spec: `docs/specs/us11-prettier.md`.

Fica para outra US: hook de pre-commit (husky/lint-staged) e CI com `format:check`.

## US4 — Cache
Como **Giross**, quero respostas rápidas para CEPs já consultados, para não esperar nem depender das APIs externas a cada chamada.

- Dado um CEP já consultado, então a segunda chamada não acessa o banco nem a BrasilAPI.
- TTLs: endereço 30 d, resultado 7 d, inexistente 1 h, configuráveis. O seed limpa o cache de resultados.
- Trocar de página usa a lista em cache.
- Redis no compose com `maxmemory` + `allkeys-lru`. Implementação em memória para os testes.
- Redis fora do ar → a API degrada (responde sem cache). `REDIS_URL` obrigatória; o seed falha sem Redis. CEP fora da base: só o lookup da BrasilAPI vai para o cache, e as UFs carregadas passam a vir da tabela `loaded_uf`, gravada pelo seed (sem `DISTINCT` sobre ~900 mil linhas). Spec: `docs/specs/us4-cache.md`.

Fica para outra US: limpeza manual (US6).

Ajustada depois da US12: o TTL do resultado passou de 7 d para 24 h, com a conta de memória na D20, e o seed passou a seguir sem o Redis, como a API (D19).

## US5 — Fallback de coordenada (Nominatim)
Como **Giross**, quero resultados mesmo quando o CEP de referência não está na base, para não perder a consulta em CEPs novos ou mal cadastrados no Censo.

- Dado um CEP existente fora da base (ex.: `01001000`), então a coordenada vem do Nominatim, com `origem.fonte = "nominatim"`.
- Dado que o Nominatim devolve uma cidade ou UF diferente da BrasilAPI, então o resultado é rejeitado e a resposta é `422 sem geolocalização`.
- Limite de 1 req/s, `User-Agent` identificado e cache de 30 d.
- Só para UF carregada: UF não carregada continua `422 CEP_FORA_DA_COBERTURA`. Sem rua na BrasilAPI → `422` sem consultar. Nominatim fora do ar → `503 PROVEDOR_INDISPONIVEL`. "Sem match" fica 1 h em cache. Spec: `docs/specs/us5-fallback-nominatim.md`.

## US6 — Limpeza de cache protegida
Como **operador da API**, quero limpar o cache manualmente, de forma protegida, para forçar dados atualizados sem reiniciar o serviço.

- `DELETE /cache` e `DELETE /cache/:cep`, com `Authorization: Bearer <CACHE_ADMIN_TOKEN>`. Token errado → `401`.
- Sem `CACHE_ADMIN_TOKEN`, os endpoints respondem `404`.
- `DELETE /cache` apaga só os prefixos da API (`result:`, `address:`, `geocode:`). `DELETE /cache/:cep` apaga só as chaves do próprio CEP. Sucesso → `204`. Redis fora → `503 CACHE_INDISPONIVEL`. Header ausente, malformado ou token errado → `401 NAO_AUTORIZADO` com `WWW-Authenticate: Bearer`, antes da validação do CEP. Token com menos de 12 caracteres faz o `loadEnv` falhar. Spec: `docs/specs/us6-limpeza-de-cache.md`.

Implementada em 4 tarefas: porta `Cache` com `delete(keys)`, caso de uso `clearCache` com `CacheUnavailableError`, HTTP (`requireBearerToken`, `cacheRouter`, registro condicional) e config/docs. Decisões na D21 (cont.) de `docs/DECISOES.md`.

Fica para outra US: invalidar o CEP limpo nas listas de vizinhos de outros CEPs (saem por TTL ou `DELETE /cache`), rate limit dos endpoints (US7) e OpenAPI (US10).

## US7 — Rate limit da API
Como **operador da API**, quero limitar as requisições por cliente, para proteger o serviço e as APIs externas de abuso.

- Mais de 60 req/min do mesmo IP → `429 LIMITE_EXCEDIDO` em JSON com `Retry-After` e headers `RateLimit`/`RateLimit-Policy` (draft-8). O contador fica no Redis (`express-rate-limit` + `rate-limit-redis`), e o limite é configurável (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`).
- Todo limiter fica no Redis: os de saída, BrasilAPI 5 req/s e Nominatim 1 req/s, passam a contar em `ratelimit:brasilapi`/`ratelimit:nominatim` (janela deslizante), compartilhados entre réplicas.
- Redis fora: a entrada é fail-open (passa sem limite, com log). A saída cai no `WindowRateLimiter` em memória do processo.
- `TRUST_PROXY` define de onde vem o IP do cliente atrás de proxy.
- Requisição que gera outra internamente: cada requisição conta uma vez só (o middleware pula se `req.rateLimit` já existe), e a composição interna chama o caso de uso em processo, nunca HTTP para a própria API (D30). Spec: `docs/specs/us7-rate-limit.md`.

Fica para outra US: o `429` no OpenAPI (US10). A isenção do `/saude` saiu na US9.

Simplificada na US12: os contadores de entrada e de saída saíram do Redis e ficam em memória, por processo (D22).

## US8 — Error middleware com catálogo de erros
Como **time de desenvolvimento**, quero que os erros de negócio sejam traduzidos para HTTP num único middleware, a partir de um catálogo, para que um erro novo custe uma classe e uma linha no catálogo, e não um `case` em cada rota.

US técnica, pedida explicitamente. Ela não muda o contrato: as respostas de erro continuam byte a byte iguais às de antes.

- Dado um caso de uso que encontra um erro esperado (CEP inválido, paginação inválida, CEP não encontrado; os erros da US3 em diante já nascem como `AppError`), então ele lança uma subclasse de `AppError` com um `kind` estável em inglês (ex.: `CepNotFoundError`, `kind: 'cep_not_found'`).
- Dado um `AppError`, quando ele chega ao error middleware, então a resposta sai do catálogo em `presentation` (`kind → { status, codigo, mensagem }`) no formato `{ erro: { codigo, mensagem } }`.
- Dado um erro que não é `AppError` ou um `kind` fora do catálogo, então `500 ERRO_INTERNO`, com log do erro e sem stack na resposta.
- Dado as rotas existentes, então nenhuma tem `switch`/`if` de status de erro: a rota chama o caso de uso e devolve `toResponse(resultado)`. O Express 5 já encaminha a rejeição para o middleware.
- Dado o catálogo, então um teste garante que todo `kind` de `AppError` tem entrada nele. Erro novo sem entrada quebra o teste, não a produção.
- Os testes HTTP existentes passam sem alterar nenhuma asserção de corpo ou de status.

Decisões: os erros esperados passam de union no retorno para exceção tipada, por pedido do usuário. A regra de dependência se mantém: `AppError` fica em `application` (ou em `domain`, se o erro for de domínio) e não conhece HTTP. O status HTTP existe só no catálogo.

Fica para outra US: os erros da US3 a US7 (incluindo o `429` do rate limit). Cada uma nasce como `AppError` mais uma linha no catálogo.

## US12 — Simplificação do projeto
Como **time de desenvolvimento**, quero os rate limits em memória, sem Redis, e o código sem arquivos de poucas linhas nem trechos repetidos, para entender a solução de relance e evoluí-la com menos peças.

US técnica, pedida explicitamente. Roda depois da US8 e antes da US9: o número 12 é só de cadastro, e a ordem é a da tabela.

- Dado mais de 60 req/min do mesmo IP, então `429 LIMITE_EXCEDIDO`, como hoje, com o contador em memória, por processo: store padrão do `express-rate-limit`, ~205 bytes por IP, descartado depois de uma janela sem requisições.
- Dado a BrasilAPI (5 req/s) ou o Nominatim (1 req/s) sem vaga, então a chamada não sai e a consulta degrada como hoje. O limite fica em memória, por processo, sem Redis nem Lua.
- Dado o Redis fora na subida, então a API sobe sem esperar por ele, responde sem cache e os limites continuam valendo.
- Dado as rotas e os erros, então status, corpo e headers não mudam.
- Dado o `src/`, então ele tem 29 arquivos de produção, sem achatar pastas: domínio com um arquivo por pasta (`cep.ts`, `geo.ts`), `application/` em pastas (`use-cases/`, `cache/`, `errors/`, `providers/`) com uma porta por arquivo, `presentation/http/` em pastas (`routes/`, `middlewares/`, `errors/`, `mappers/`) com as rotas só com o `Router`, catálogo e `HTTP_ERRORS` em `presentation/http/errors/errors.ts`, `limitedFetch` para as chamadas externas e `InMemoryCache` em `tests/fakes/`. A raiz perde `.git-blame-ignore-revs`, `.nvmrc`, `vitest.config.ts` e `.prettierrc.json`.

Decisões: D22 reescrita (os dois limites em memória, por processo); a D30 fica. Spec: `docs/specs/us12-simplificacao.md`.

Fica para depois da US10: mover `docs/specs/` e este arquivo para a branch `docs`.

## US9 — Healthcheck (`/saude`)
Como **operador da API**, quero uma rota que diga se a API está no ar, para conferir de relance que o serviço responde, sem montar uma consulta de CEP.

- Dado a API no ar, quando chamo `GET /saude`, então `200` com `{ "status": "ok" }`.
- A rota não acessa banco, cache nem provedores externos: com o Postgres ou o Redis fora, a resposta é a mesma.
- O `/saude` conta no rate limit como as outras rotas.

Decisões: o escopo encolheu no refinamento. A rota é consultada só por uma pessoa, nunca pelo container, e por isso o compose não ganha `healthcheck` e o `/saude` não tem isenção do rate limit. A checagem do banco ficou de fora porque o `CepRepository` só trata CEP. Spec: `docs/specs/us9-saude.md`.

Fica fora do card: checagem do Postgres, do Redis e dos provedores, status `degradado`/`indisponivel` e a porta `HealthIndicator`.

## US10 — Documentação da API com Scalar
Como **integrador da Giross**, quero uma documentação navegável do contrato da API, com exemplos e erros, para integrar sem ler o código nem adivinhar os formatos.

- Dado `NODE_ENV` diferente de `production`, quando abro `/docs`, então vejo a UI do Scalar com todos os endpoints existentes: `GET /ceps-proximos/:cep`, `GET /ceps-proximos/:cep/detalhes`, `GET /saude`, `DELETE /cache` e `DELETE /cache/:cep` (com o esquema Bearer).
- Dado o mesmo ambiente, então `GET /docs/openapi.json` devolve o documento OpenAPI 3.1.
- Dado `NODE_ENV=production`, então `/docs` e `/docs/openapi.json` caem no `404 NAO_ENCONTRADO` genérico, sem revelar as rotas.
- O OpenAPI vem de um `openapi.yaml` escrito à mão, em português (contrato), com os parâmetros, os exemplos de resposta e todos os códigos de erro do catálogo da US8.
- Um teste de contrato valida as respostas dos testes Supertest (sucesso e cada erro) contra os schemas do `openapi.yaml`. Se o contrato e o código divergirem, o teste quebra.
- O README aponta para `/docs`.

Decisões: o `openapi.yaml` fica na raiz do repo, porque `docs/` está no `.dockerignore` e vai para outra branch. `NODE_ENV` é obrigatório, sem padrão, para ninguém subir em produção com o `/docs` por esquecimento. O env e o compose (api e seed) falham sem ele. O teste de contrato fica num arquivo dedicado (Ajv contra os schemas do yaml). `/docs` conta no rate limit. O JS do Scalar vem do CDN. O README fica com o contrato enxuto, apontando para `/docs`. Spec: `docs/specs/us10-documentacao-scalar.md`.

Fica para outra US: nada. A partir daqui, toda US que mexer no contrato atualiza o `openapi.yaml`, e o teste de contrato cobra isso.

---

## Fora do escopo
- Front-end.
- PostGIS e buscas por polígono (registrado como evolução no README).
- Download automático dos ZIPs do IBGE.
- Raio por query string (o raio é só por variável de ambiente).
