---
id: us2
card: —
mapa: docs/HISTORIAS.md
depende_de: US1 (mergeada em main, PR #1)
titulo: Consultar CEPs próximos
status: implementado
modo: agent-driven
criada_em: 2026-10-26
implementada_em: 2026-10-27
verificada_em: 2026-10-27
branch: feat/us2-ceps-proximos
merge_request: https://github.com/owhenrique/bc_giross/pull/2
---

# US2 — Consultar CEPs próximos

## História
Como **Giross**, quero consultar os CEPs num raio de um CEP de referência, com a distância de cada um, para agrupar entregas e avaliar a cobertura de uma praça.

## Contexto
A US1 entregou a base `data/ceps.csv.gz` (898.455 CEPs, `cep;uf;latitude;longitude`), a função `haversineKm` no domínio e o esqueleto do projeto. Ainda não existem API, banco nem compose. Esta US entrega o primeiro uso da base: subir tudo com `docker compose up` e consultar `GET /ceps-proximos/:cep`. A origem vem só da base. O endereço da BrasilAPI e as respostas para CEP fora da base ficam para a US3, o cache para a US4 e o fallback Nominatim para a US5.

Decisões que valem aqui: D1, D2, D3, D8, D9, D10, D14, D15, D16, D17, D18, D24, D25, D26, D27, D28.

## Critérios de aceite
- [x] 1. Dado um checkout limpo, quando rodo `docker compose up`, então o Postgres sobe, o serviço `seed` aplica a migration, carrega `data/ceps.csv.gz` e termina, e só depois a `api` começa a responder na porta `3000`.
- [x] 2. Dado `SEED_UFS=SP,RJ`, quando o seed roda, então a tabela tem só CEPs de SP e RJ. Dado `SEED_UFS` vazio ou ausente, então o Brasil inteiro é carregado. Dado uma UF inválida (ex.: `XX`), então o seed sai com código ≠ 0 e mensagem clara, sem alterar a tabela.
- [x] 3. Dado o seed rodando de novo (com as mesmas UFs ou com outras), então a tabela fica exatamente com as UFs pedidas, sem duplicatas, e a API nunca vê a tabela vazia ou pela metade (TRUNCATE + COPY na mesma transação).
- [x] 4. Dado `04551000` na base, quando chamo `GET /ceps-proximos/04551000`, então recebo `200` com:
  ```json
  {
    "origem": "04551000",
    "paginacao": { "pagina": 1, "limite": 50, "total": 174, "total_paginas": 4 },
    "ceps": [{ "cep": "04551010", "distancia_km": 0.12 }]
  }
  ```
  com `ceps` ordenado por distância crescente (empate por CEP crescente), `distancia_km` com 2 casas decimais e sem a própria origem. Os números acima são ilustrativos.
- [x] 5. Dado `SEARCH_RADIUS_KM=1` e um CEP a 1,004 km da origem, então ele não aparece, mesmo que a saída arredondada fosse `1.00`. Um CEP a exatamente ≤ 1 km aparece (D15).
- [x] 6. Dado `GET /ceps-proximos/04551-000`, então a resposta é igual à de `04551000`, com `origem` normalizado (`04551000`).
- [x] 7. Dado `?pagina=2&limite=50`, então recebo os itens 51 a 100 da lista ordenada, com `total` e `total_paginas` corretos. Sem parâmetros, valem `pagina=1` e `limite=50`. Dado `pagina` além da última, então `200` com `ceps: []`. Dado nenhum vizinho no raio, então `200` com `ceps: []`, `total: 0` e `total_paginas: 0`.
- [x] 8. Dado `limite` fora de 1–200, `pagina` < 1 ou um valor não inteiro, então `400` com `{ "erro": { "codigo": "PARAMETRO_INVALIDO", "mensagem": "..." } }`.
- [x] 9. Dado `GET /ceps-proximos/123` (ou qualquer valor que não seja `00000000`/`00000-000`), então `400` com `codigo: "CEP_INVALIDO"`.
- [x] 10. Dado uma rota ou um método inexistente (ex.: `GET /admin`, `POST /ceps-proximos/04551000`), então `404` com o corpo genérico `{ "erro": { "codigo": "NAO_ENCONTRADO", "mensagem": "Recurso não encontrado" } }`. A resposta é a mesma para qualquer caminho, sem HTML padrão do Express, sem ecoar o caminho pedido e sem o header `X-Powered-By`, para não revelar quais rotas existem nem a stack. Dado um erro inesperado, então `500` com `codigo: "ERRO_INTERNO"`, sem stack na resposta, e o erro vai para o log.
- [x] 11. Cada requisição gera uma linha de log Pino (método, rota, status, tempo).
- [x] 12. O Haversine segue testado contra distâncias conhecidas (testes da US1 mantidos verdes).

## Escopo
**Dentro:**
- Prisma com a tabela `cep` (nome no singular) e migration; seed com `COPY` (`pg` + `pg-copy-streams`).
- `docker-compose.yml` com `postgres`, `seed` (one-shot) e `api`; `Dockerfile` da aplicação.
- Env validado com Zod: `DATABASE_URL`, `PORT`, `SEARCH_RADIUS_KM`, `SEED_UFS`, `LOG_LEVEL`.
- Endpoint `GET /ceps-proximos/:cep` com paginação e erros `400`/`404`/`500` no formato `{ erro: { codigo, mensagem } }`.
- Logs Pino mínimos (`pino-http` + erro inesperado).
- README curto com "como rodar" e o contrato do endpoint.

**Fora:**
- A rota `/detalhes`, com `origem.endereco`, e as respostas para CEP fora da base (BrasilAPI, `404`, `422` de cobertura e de geolocalização, `503`) → US3
- Cache e limpeza do cache de resultados pelo seed → US4
- Fallback Nominatim (`fonte: "nominatim"`) → US5
- Limpeza de cache protegida → US6
- Rate limit → US7
- Swagger, métricas, CI, Docker multi-stage → fora desta US (podem virar US técnica depois)
- Raio por query string → fora do card

## Decisões e respostas do usuário
- P: A US2 do mapa mudou com a entrega da US1? → R: Não, segue como está no mapa.
- P: Como o seed roda no `docker compose up`? → R: Serviço one-shot `seed` (migration + COPY), e a `api` sobe com `depends_on: condition: service_completed_successfully`. Com `SEED_UFS` vazio, carrega o Brasil inteiro.
- P: Qual o formato do corpo de erro? → R: `{ erro: { codigo, mensagem } }`, com código estável (`CEP_INVALIDO`, `PARAMETRO_INVALIDO`, `CEP_NAO_ENCONTRADO`...). A US3 acrescenta novos códigos.
- P: Paginação inválida (`limite=500`, `pagina=0`, texto)? → R: `400`. Página além do total devolve `200` com `ceps: []`.
- P: Como testar a busca contra o banco? → R: Porta `CepRepository` com repositório em memória nos testes do caso de uso e no Supertest. O repositório Prisma é testado à mão via compose, sem dependência nova de teste.
- P: Valor de `origem.fonte` vindo da base? → R: `"base"`.
- P: O seed, se a tabela já tem dados? → R: Sempre recarrega, com TRUNCATE + COPY numa transação.
- P: Pino entra nesta US? → R: Sim, mínimo: `pino-http` e log do erro inesperado.
- P: Desempate de distância? → R: Por CEP crescente.
- P: O que responde uma rota inexistente? → R: Uma mensagem genérica, que não exponha quais rotas existem: `404 NAO_ENCONTRADO` / "Recurso não encontrado", com corpo idêntico para qualquer caminho ou método e sem `X-Powered-By`. O `503` foi descartado porque diz ao cliente que o serviço caiu e que ele deve tentar de novo, e dispara alerta de indisponibilidade.
- P: Nome da tabela? → R: Tabelas no singular (`cep`, `user`...). A tabela é `cep` (`@@map("cep")`), e qualquer tabela futura segue a mesma regra.
- P: Tipo de latitude e longitude no Postgres? → R: `double precision` explícito (`@db.DoublePrecision`), nunca `numeric`/`Decimal`, por performance. O motivo está em "Design técnico › Modelo".
- P: Onde ficam a normalização do CEP e os limites de paginação? → R: No `findNearbyCeps`; a rota só faz HTTP (parse da query e tradução do contrato).
- P: Idioma do código? → R: O do `AGENTS.md`. Os identificadores ficam em inglês (`origin`, `radiusKm`, `page`/`limit`, `totalPages`, `neighbors`, `distanceKm`), e a tradução para o contrato em português fica só em `presentation`. `cep`/`uf` seguem como termos do domínio, como na US1.

## Premissas
Nenhuma.

## Design técnico

**Camadas (D28)**: `presentation` (Express, Zod, mapeamento para HTTP) → `application` (caso de uso e porta) → `domain` (CEP, geo, puro) ← `infrastructure` (Prisma, Pino). O domínio e a aplicação não importam Express nem Prisma.

**Modelo (Prisma)**
```prisma
model Cep {
  cep       String @id @db.Char(8)
  uf        String @db.Char(2)
  latitude  Float  @db.DoublePrecision
  longitude Float  @db.DoublePrecision
  @@index([latitude, longitude])
  @@map("cep")
}
```
**Latitude/longitude em `double precision` (float8), nunca `numeric`/`Decimal`.** O `numeric` usa aritmética de precisão arbitrária feita em software: comparação e índice ficam mais lentos, cada valor ocupa mais espaço e o Prisma devolve `Decimal.js`, que precisa ser convertido a cada linha antes do Haversine. O `double precision` tem comparação nativa da CPU, 8 bytes fixos e chega ao JS como `number`. Os ~15 dígitos significativos sobram para as 6 casas do CSV (~0,11 m). O `real` (float4) foi descartado: com ~7 dígitos, ele arredonda `-46.634938` em até ~0,4 m, e a economia de 4 bytes por coluna não compensa. A migration gerada deve ter `DOUBLE PRECISION` nas duas colunas, e o `/pato:verify` confere isso.

Prisma estável (7.x) com `@prisma/adapter-pg`, se a versão exigir driver adapter. O client é gerado no `postinstall`/build da imagem e não é commitado.

**Seed (`npm run seed`)**
- Lê `SEED_UFS` (`"sp, rj"` → `['SP','RJ']`; vazio → todas) e valida contra as 27 UFs. Se houver UF inválida, sai antes de tocar no banco.
- Stream `data/ceps.csv.gz` → `gunzip` → linhas, pulando o cabeçalho e filtrando pela UF → `COPY cep (cep, uf, latitude, longitude) FROM STDIN (FORMAT csv, DELIMITER ';')`.
- Tudo numa transação: `BEGIN; TRUNCATE cep; COPY ...; COMMIT`. Falha → `ROLLBACK` e código ≠ 0.
- Log final com o total carregado por UF e o tempo.
- No compose: `command: sh -c "npx prisma migrate deploy && npm run seed:container"`.

**Busca (`FindNearbyCeps`)**
Entrada: `{ cep, page, limit }`, com a configuração `radiusKm`.
1. `repository.findByCep(cep)`. O CEP fora da base segue o caminho da US3.
2. `boundingBox(origin, radiusKm)`: `dLat = radiusKm / 111,195` km por grau (R = 6371,0088, igual ao Haversine), `dLon = dLat / cos(lat)`. Margem só para fora: a caixa contém o círculo.
3. `repository.findInBox(box)`: candidatos com `latitude BETWEEN` e `longitude BETWEEN`.
4. Exclui a origem, calcula `haversineKm` e mantém `≤ radiusKm` exato (D15).
5. Ordena por `distanceKm` e, no empate, por `cep`. Pagina com `slice((page−1)·limit, page·limit)`, `total` e `totalPages = ceil(total/limit)`.
6. Retorna `{ origin: { cep, lat, lon, source: 'dataset' }, radiusKm, pagination: { page, limit, total, totalPages }, neighbors: [{ cep, distanceKm }] }` com valores **não** arredondados. O arredondamento a 2 casas acontece só na apresentação.

**Idioma (D27, `AGENTS.md`)**: todo identificador, comentário e nome de `describe`/`it` fica em inglês. O português aparece só no contrato (rota, query, campos do JSON, códigos e mensagens de erro), na interface do seed (logs) e nas docs. A tradução fica só em `presentation`:

| Código (inglês) | Contrato (português) |
| --- | --- |
| `origin` / `origin.source: 'dataset'` | `origem` / `origem.fonte: "base"` |
| `origin.lat`, `origin.lon` | `origem.latitude`, `origem.longitude` |
| `radiusKm` | `raio_km` |
| `pagination.{page, limit, total, totalPages}` | `paginacao.{pagina, limite, total, total_paginas}` |
| `neighbors[].distanceKm` | `ceps[].distancia_km` |
| query `page`, `limit` (após o parse) | query `?pagina=&limite=` |
| `invalid_cep`, `invalid_page`/`invalid_limit`, `routeNotFound`, `internal` | `CEP_INVALIDO`, `PARAMETRO_INVALIDO`, `NAO_ENCONTRADO`, `ERRO_INTERNO` |

`cep` e `uf` seguem como termos do domínio, iguais à US1 (`src/domain/cep/`, `assessCep`, `ufFromZip`) e às colunas do D8.

**HTTP**
- `GET /ceps-proximos/:cep`. A rota só lida com HTTP: converte `pagina`/`limite` de string para número e passa tudo ao caso de uso. A normalização do CEP (`normalizeCep`) e as regras de paginação (`pagina` inteiro ≥ 1, padrão 1; `limite` inteiro 1–200, padrão 50) ficam em `findNearbyCeps`. CEP inválido vira `400 CEP_INVALIDO`, e paginação inválida, `400 PARAMETRO_INVALIDO`.
- Contrato em português, código em inglês (D27): a rota lê `pagina`/`limite` e entrega `page`/`limit` ao caso de uso. A resposta é montada pela tabela de tradução acima, numa função `toResponse` da rota.
- Rota ou método desconhecido → `404 NAO_ENCONTRADO` com a mensagem fixa "Recurso não encontrado", sem ecoar o caminho. `app.disable('x-powered-by')`. JSON malformado e qualquer outro erro 4xx do Express (inclusive 413) caem em `400 PARAMETRO_INVALIDO` com a mensagem fixa "Requisição inválida", nunca no HTML padrão. Handler de erro final → `500 ERRO_INTERNO`, com log via `req.log.error`.
- `createApp({ findNearbyCeps, logger })` recebe as dependências, o que permite o Supertest sem banco. O raio entra em `findNearbyCeps(repository, radiusKm)`, na composição em `src/index.ts`.

**Config (Zod, `src/config/env.ts`)**

| Variável | Padrão | Regra |
| --- | --- | --- |
| `DATABASE_URL` | — | obrigatória (api e seed) |
| `PORT` | `3000` | int > 0 |
| `SEARCH_RADIUS_KM` | `1` | número > 0 |
| `SEED_UFS` | vazio (todas) | lista separada por vírgula |
| `LOG_LEVEL` | `info` | nível do Pino |

Env inválido → o processo sai na subida com a mensagem do Zod.

**Execução**: a imagem roda TypeScript com `tsx`, como o `build-dataset` (`tsconfig` tem `noEmit`), então não há etapa de build. Se `tsx` só existir como dependência de desenvolvimento, a imagem instala as dependências de desenvolvimento.

## Arquivos que a mudança toca
Lógica (conta):
- `src/domain/cep/cep-code.ts` — criar: `normalizeCep(input): string | null` — ~10
- `src/domain/geo/bounding-box.ts` — criar: `BoundingBox`, `boundingBox(center, radiusKm)` — ~15
- `src/application/cep-repository.ts` — criar: porta `CepRepository` (`findByCep`, `findInBox`), tipo `StoredCep` — ~10
- `src/application/find-nearby-ceps.ts` — criar: `findNearbyCeps(repository, radiusKm)(input)`, `NearbyCepsResult` — ~55
- `src/infrastructure/db/prisma-client.ts` — criar: instância do client (adapter pg) — ~10
- `src/infrastructure/db/prisma-cep-repository.ts` — criar: `PrismaCepRepository` — ~35
- `src/infrastructure/logger.ts` — criar: `logger` Pino — ~8
- `src/config/env.ts` — criar: `loadEnv()` com Zod — ~25
- `src/presentation/http/errors.ts` — criar: `sendError`, `notFoundHandler`, `errorHandler` — ~22
- `src/presentation/http/nearby-ceps-route.ts` — criar: `querySchema`, handler, `toResponse` (tradução para o contrato e arredondamento) — ~55
- `src/presentation/http/app.ts` — criar: `createApp(deps)` (pino-http, rota, 404, erro) — ~30
- `src/index.ts` — alterar: compõe as dependências, `listen` e encerramento gracioso (SIGTERM fecha o servidor e o Prisma) — ~25
- `scripts/seed/index.ts` — criar: `parseSeedUfs`, stream do gz, filtro, transação com COPY — ~60

Não contam (config, dados, testes, docs, gerado):
- `prisma/schema.prisma`, `prisma/migrations/*` (gerada por `npx prisma migrate dev --name init`), `prisma.config.ts` se o Prisma 7 pedir
- `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `.env.example`
- `package.json` (deps `express`, `zod`, `pino`, `pino-http`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `pg-copy-streams`; dev `prisma`, `supertest` e os `@types`; scripts `start`, `dev`, `seed`, `postinstall: prisma generate`), `package-lock.json`
- `eslint.config.js` (ignorar o client gerado, se cair em pasta lintada)
- Testes `*.test.ts` ao lado do código
- `README.md`, `docs/specs/us2-ceps-proximos.md`

## Limite de tamanho
- **Estimativa:** ~360 linhas de lógica (`bc_giross`), soma da lista acima.
- **Não contam:** testes, docs, config (`Dockerfile`, compose, `.env.example`, `.dockerignore`, `*.prisma`, `prisma.config.ts`), lockfile, migration e client Prisma gerados (`npx prisma migrate dev`, `npx prisma generate`).
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
| Tarefas | 7 |
| Arquivos que a mudança toca | 13 de lógica + ~10 de config/teste/doc |
| Linhas de lógica estimadas | ~360 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Sim (migration inicial + seed) |
| Muda contrato de API | Sim (endpoint novo) |
| Dependência nova | Sim (express, prisma, zod, pino, pg...) |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são 7 tarefas, 13 arquivos de lógica, migration, contrato novo e dependências novas.

## Tarefas
Passos (commits) desta US. Todos entram no mesmo PR.
- [x] 1. Infra base: dependências, `src/config/env.ts`, Prisma (schema, migration `init`, client), `docker-compose.yml` com o `postgres`, `.env.example`. Testes do `loadEnv`.
- [x] 2. Seed: `scripts/seed/index.ts` (`parseSeedUfs`, stream do gz com filtro, TRUNCATE + COPY em transação), script `npm run seed`, serviço `seed` no compose. Testes de `parseSeedUfs` e do filtro de linhas.
- [x] 3. Domínio: `normalizeCep` e `boundingBox` + testes (hífen, tamanho, letras; um ponto a `radiusKm` em cada direção cabe na caixa).
- [x] 4. Aplicação: porta `CepRepository` e `findNearbyCeps` + testes com repositório em memória.
- [x] 5. Infraestrutura: `PrismaCepRepository` e `prisma-client`. Conferência manual contra o Postgres do compose.
- [x] 6. HTTP: `logger`, `errors`, `nearby-ceps-route`, `createApp` + testes Supertest com o repositório em memória.
- [x] 7. Entrada e empacotamento: `src/index.ts`, `Dockerfile`, `.dockerignore`, serviço `api` no compose, README ("como rodar" e contrato). Rodar `docker compose up` de ponta a ponta e registrar o resultado.

## Telas e fluxos E2E (Playwright)
Não se aplica (API sem tela).

## Testes
- **Unit (domínio):** `normalizeCep` (`04551000`, `04551-000` → `04551000`; `123`, `0455100a`, `04551-0000` → `null`); `boundingBox` (pontos a `radiusKm` ao N/S/L/O ficam dentro da caixa; caixa simétrica no equador). Os testes do `haversineKm` continuam como estão.
- **Unit (seed):** `parseSeedUfs` (vazio → todas; `" sp,RJ "` → `['SP','RJ']`; `XX` → erro); filtro de linha por UF e cabeçalho ignorado.
- **Unit (`loadEnv`):** padrões aplicados; `SEARCH_RADIUS_KM=0` ou texto → erro.
- **Aplicação (repo em memória):** origem fora da lista; CEP a 1,004 km fora com raio 1; CEP a 0,999 km dentro; ordenação por distância e empate por CEP; paginação (`total`, `total_paginas`, página 2, página além do fim → vazia, zero vizinhos → `total_paginas: 0`). Coordenadas sintéticas a partir de deslocamentos conhecidos.
- **HTTP (Supertest + repo em memória):** `200` com o formato do critério 4 e 2 casas decimais; hífen; `400 CEP_INVALIDO`; `400 PARAMETRO_INVALIDO` (`limite=201`, `pagina=0`, `limite=abc`); `404 NAO_ENCONTRADO` com corpo idêntico para `GET /admin`, `GET /qualquer/coisa` e `POST /ceps-proximos/04551000`, sem o caminho no corpo e sem `X-Powered-By`; `500 ERRO_INTERNO` com repositório que lança erro.
- **Manual (compose):** `docker compose up` do zero; `curl localhost:3000/ceps-proximos/04551000` (conferir que a ordem de grandeza bate com os ~174 vizinhos do D4); `04551-000`; `SEED_UFS=SP,RJ docker compose run --rm seed` e `SELECT uf, count(*) FROM cep GROUP BY uf`; rodar o seed duas vezes e conferir que o total não muda; tempo do seed do Brasil inteiro.
- **Idioma:** `describe`/`it` em inglês (ex.: `it('excludes a cep 1.004 km away when radius is 1 km')`). As asserções sobre o corpo HTTP usam os campos do contrato em português.
- **Banco (manual):** `\d cep` no `psql` mostra `latitude`/`longitude` como `double precision`.
- **Suítes:** `npm test`, `npm run lint`, `npm run typecheck`.

## Verificação independente
Em 2026-10-27, por subagente em contexto limpo, base `main`.

- **Suítes:** `npm test` 74/74 (75/75 após as correções), lint e typecheck sem erro.
- **Critérios:** 1 a 12 atendidos. Na verificação, 1, 2, 3 e 11 foram conferidos só por leitura do código, do compose e da stack já em execução.
- **Entregável:** sim. Seed, banco, caso de uso, rota, Dockerfile, compose, README e logs, sem TODO nem flag escondida. A branch parte de `main` e só tem commits da US2.
- **Linhas medidas:** 406 de 500.
- **Achados:** nenhum Alta ou Média. Três Baixa, corrigidos em `e5b70c4`: assinatura do `createApp` desatualizada na spec, erro 4xx sem teste e UF inválida do seed sem execução (rodado à mão: saída 1, mensagem clara). Sem releitura por novo subagente, porque as correções foram um teste e texto da spec.
- **Não verificado:** `docker compose up` de um checkout limpo e o tempo do seed do Brasil inteiro, o seed rodado duas vezes (idempotência, critério 3), `EXPLAIN ANALYZE` do índice e o conteúdo das linhas de log do Pino (critério 11).
- **Decisão do usuário:** corrigir os achados Baixa e registrar.

## Registro de testes

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-27 | Automatizado | local | local | `npm test` (10 arquivos, 75 testes), lint e typecheck | Aprovado | — |
| 2026-10-27 | Verificação independente | subagente (contexto limpo) | local | diff contra a spec, suítes e curls na stack em execução | Aprovado | seção "Verificação independente" |
| 2026-10-27 | Manual | Henrique | local (Docker) | US2 na stack do compose, relatado pelo usuário (sem detalhamento por fluxo) | Aprovado | — |

## Riscos e pontos em aberto
- **Prisma 7 (driver adapter, `prisma.config.ts`, client gerado fora de `node_modules`)**: a configuração muda entre versões. Fixar a versão estável no `package.json` e seguir a documentação dela. Se o client gerado cair em `src/`, ignorá-lo no ESLint e no git.
- **Seed do Brasil inteiro a cada `up`**: ~900 mil linhas via COPY, com estimativa de alguns segundos a dezenas de segundos. Medir e registrar o tempo; o avaliador pode usar `SEED_UFS=SP` para subir mais rápido.
- **Índice `(latitude, longitude)`**: o B-tree composto só restringe pela latitude; a longitude filtra dentro da faixa. Em raio de 1 km, a faixa de latitude é estreita e isso basta (D3). Conferir com `EXPLAIN ANALYZE` na conferência manual.
- **`04551000` ~174 vizinhos**: o número do D4 veio do protótipo e serve só como ordem de grandeza.
