---
id: us10
card: —
mapa: docs/HISTORIAS.md
depende_de: US8 (PR #3) e US9 (PR #11), mergeadas
titulo: Documentação da API com Scalar
status: em-andamento
modo: agent-driven
criada_em: 2026-10-28
implementada_em: 2026-10-28
verificada_em:
branch: feat/us10-documentacao-scalar
merge_request:
---

# US10 — Documentação da API com Scalar

## História
Como **integrador da Giross**, quero uma documentação navegável do contrato da API, com exemplos e erros, para integrar sem ler o código nem adivinhar os formatos.

## Contexto
Hoje o contrato existe só na seção "Contrato" do README: rotas, exemplos e a tabela de erros, escritos à mão e sem nada que garanta que batem com o código. Esta US cria um `openapi.yaml` escrito à mão como fonte da verdade, serve esse documento numa UI do Scalar em `/docs` (fora de `production`) e acrescenta um teste de contrato que quebra quando o código e o yaml divergem.

É a última US do mapa (`docs/HISTORIAS.md`). Depende da US8 (catálogo de erros) e da US9 (`GET /saude`, que precisa estar documentado). O PR da US9 (#11) ainda está aberto: a implementação parte da `main` depois desse merge.

## Critérios de aceite
- [x] 1. Dado `NODE_ENV` diferente de `production`, quando abro `GET /docs`, então recebo `200` com o HTML da UI do Scalar apontando para `/docs/openapi.json`.
- [x] 2. Dado o mesmo ambiente, quando chamo `GET /docs/openapi.json`, então recebo `200` com o documento OpenAPI 3.1 (`openapi: 3.1.x`), igual ao conteúdo do `openapi.yaml` da raiz.
- [x] 3. Dado o documento, então ele descreve todos os endpoints existentes: `GET /ceps-proximos/{cep}`, `GET /ceps-proximos/{cep}/detalhes`, `GET /saude`, `DELETE /cache` e `DELETE /cache/{cep}`, estes dois com o esquema de segurança Bearer. Os parâmetros (`cep`, `pagina`, `limite`) e os exemplos de resposta também estão no documento.
- [x] 4. Dado o documento, então todo `codigo` do `ERROR_CATALOG` e do `HTTP_ERRORS` aparece nele, e cada endpoint lista os status de erro que pode devolver, com o schema `{ erro: { codigo, mensagem } }`.
- [x] 5. Dado `NODE_ENV=production`, quando chamo `GET /docs` ou `GET /docs/openapi.json`, então recebo o `404 NAO_ENCONTRADO` genérico, igual ao de qualquer rota inexistente.
- [x] 6. Dado o teste de contrato, então ele faz uma requisição Supertest para cada sucesso e cada erro de cada endpoint, valida o corpo de cada resposta contra o schema do `openapi.yaml` para aquele path, método e status e falha se o schema não existir ou não validar.
- [x] 7. Dado `NODE_ENV` ausente ou fora de `development|test|production`, quando a API ou o seed sobem, então a validação do env falha e o processo não sobe: não existe padrão, para que ninguém suba em produção com o `/docs` por esquecimento. No `docker compose up` sem `NODE_ENV` no `.env`, o compose aborta com `defina NODE_ENV no .env`.
- [x] 8. Dado mais de `RATE_LIMIT_MAX` requisições do mesmo IP na janela, então `/docs` e `/docs/openapi.json` recebem `429 LIMITE_EXCEDIDO` como qualquer rota, sem isenção.
- [x] 9. Dado o README, então a seção "Contrato" fica enxuta (lista das rotas e tabela de erros) e aponta para `/docs` e para o `openapi.yaml` como fonte da verdade do contrato.
- [x] 10. Dado o projeto, quando rodo `npm test`, `npm run lint`, `npm run typecheck` e `npm run format:check`, então todos passam.

## Escopo
**Dentro:**
- `openapi.yaml` (OpenAPI 3.1, em português) na raiz.
- `docsRouter` com `GET /docs/openapi.json` e a UI do Scalar em `/docs`, registrado só fora de `production`.
- `NODE_ENV` obrigatório no schema do env, no compose (serviços `api` e `seed`) e no `.env.example`.
- Teste de contrato com Ajv e teste HTTP das rotas de documentação.
- README enxuto e seção da US10 no mapa.

**Fora** (fora do card, decidido no refinamento):
- Servir o JS do Scalar pela própria API: a UI carrega o bundle do CDN (jsdelivr) padrão do pacote.
- Gerar o OpenAPI a partir do código (Zod, decorators): o yaml é escrito à mão.
- Isentar `/docs` do rate limit.

## Decisões e respostas do usuário
- P: o PR da US9 (#11) está aberto; seguir com a spec da US10? → R: seguir. O `/pato/implement` só começa depois do merge.
- P: onde fica o `openapi.yaml`, já que `docs/` está no `.dockerignore` e vai para outra branch? → R: na raiz do repo, porque é fácil de achar e entra na imagem pelo `COPY . .`.
- P: com que `NODE_ENV` o compose sobe a api? → R: primeiro a resposta foi `${NODE_ENV:-development}`, com padrão `development`. Na revisão da spec a decisão mudou: "NODE_ENV é necessário e obrigatório pq pode-se esquecer de settar isso no .env e subir pra produção com /docs". Agora o `NODE_ENV` é obrigatório no schema, sem padrão, e o compose usa `${NODE_ENV:?defina NODE_ENV no .env}`.
- P: como o teste de contrato valida? → R: num arquivo dedicado, com um cenário Supertest por rota e status, cada resposta validada com Ajv contra o schema do yaml, e um teste que confere que todo código do catálogo aparece no yaml.
- P: o que acontece com a seção "Contrato" do README? → R: fica enxuta (rotas e tabela de erros) e aponta para `/docs` e para o `openapi.yaml`.
- P: `/docs` conta no rate limit? → R: conta, como as outras rotas, porque é registrado depois do `rateLimitMiddleware`.
- P: o JS do Scalar vem do CDN? → R: sim, do CDN padrão.

## Premissas
Nenhuma.

## Design técnico
- **Contrato novo:**
  - `GET /docs` → `200 text/html` (UI do Scalar, `url: '/docs/openapi.json'`).
  - `GET /docs/openapi.json` → `200 application/json` com o documento.
  - Nenhum endpoint existente muda.
- **`openapi.yaml` (raiz):** `openapi: 3.1.0`, `info` em português e `servers: [{ url: http://localhost:3000 }]`. Em `components`:
  - `securitySchemes.bearerAuth` (`type: http`, `scheme: bearer`);
  - `parameters` (`cep`, `pagina`, `limite`);
  - `schemas` (`RespostaResumo`, `RespostaDetalhes`, `Paginacao`, `CepProximo`, `Endereco`, `Saude`, `Erro`), com `Erro.erro.codigo` como `enum` de todos os códigos;
  - `responses` reutilizáveis por erro, com exemplo.

  Campos que podem ser nulos usam `type: [..., 'null']` (3.1), por exemplo `origem.endereco` e os campos do endereço. Os schemas usam `additionalProperties: false`, para que um campo a mais no código quebre o teste.
- **Leitura do documento:** `loadOpenApiDocument()` lê o `openapi.yaml` da raiz (caminho resolvido a partir de `import.meta.url`), faz o parse com `yaml` e devolve o objeto. É chamada uma vez, no `index.ts`.
- **Camadas:** o `docsRouter(document)` é só HTTP: registra `GET /docs/openapi.json` (`res.json(document)`) antes de `router.use('/docs', apiReference({ url: '/docs/openapi.json' }))`, de `@scalar/express-api-reference`.
- **Registro:** `AppDeps` ganha `openApiDocument?: object`. Quando ausente, as rotas não são registradas e caem no `notFoundHandler`, no mesmo padrão do `cacheAdmin`. Em `createApp`, `if (openApiDocument) app.use(docsRouter(openApiDocument))` vem depois do `rateLimitMiddleware` e antes do `notFoundHandler`. No `index.ts`: `openApiDocument: env.nodeEnv === 'production' ? undefined : loadOpenApiDocument()`.
- **Configuração:**
  - No `env.ts`, `NODE_ENV: z.enum(['development', 'test', 'production'])`, obrigatório e sem `.default`, e `Env.nodeEnv`. O `loadEnv` é compartilhado com o seed (`scripts/seed/index.ts`), então o seed também passa a exigir a variável.
  - No `docker-compose.yml`, `NODE_ENV: ${NODE_ENV:?defina NODE_ENV no .env}` nos serviços `api` e `seed`, no padrão das credenciais do Postgres.
  - No `.env.example`, `NODE_ENV=development` descomentado, com um comentário dizendo que `production` desliga o `/docs`.
- **Teste de contrato:** usa o `Ajv2020` (`ajv/dist/2020`, `strict: false` para aceitar `example`), com o documento inteiro adicionado como schema `openapi`. Um helper `expectMatchesContract(res, path, method)` compila `{ $ref: 'openapi#/paths/<path escapado>/<method>/responses/<status>/content/application~1json/schema' }` e valida `res.body`. Em `204`, exige que a resposta exista no documento e que o corpo venha vazio. O helper fica em `tests/contract/openapi-contract.ts`.
- **Erros:** nenhum novo.
- **Dependências novas:** `@scalar/express-api-reference` e `yaml` (produção); `ajv` (dev).

## Arquivos que a mudança toca
- `openapi.yaml` — criar: documento OpenAPI 3.1 completo — dados/config, não conta
- `src/presentation/http/openapi/load-openapi-document.ts` — criar: `loadOpenApiDocument()` — ~8 linhas
- `src/presentation/http/routes/docs-route.ts` — criar: `docsRouter(document)` com `GET /docs/openapi.json` e o Scalar em `/docs` — ~12 linhas
- `src/presentation/http/app.ts` — alterar: `AppDeps.openApiDocument`, import e registro condicional — ~4 linhas
- `src/config/env.ts` — alterar: `NODE_ENV` obrigatório no schema, `Env.nodeEnv` e retorno — ~4 linhas
- `src/index.ts` — alterar: import e `openApiDocument` no `createApp` — ~2 linhas
- `src/config/env.test.ts` — alterar: `NODE_ENV` no `base`, ausente → erro, valor inválido → erro — teste, não conta
- `src/presentation/http/routes/docs-route.test.ts` — criar: critérios 1, 2, 5 e 8 — teste, não conta
- `tests/contract/openapi-contract.ts` — criar: Ajv + `expectMatchesContract` — teste, não conta
- `src/presentation/http/openapi-contract.test.ts` — criar: cenários do critério 6 (setup como em `app.test.ts` e `cache-route.test.ts`) e cobertura do catálogo (critérios 3 e 4) — teste, não conta
- `docker-compose.yml` — alterar: `NODE_ENV` obrigatório nos serviços `api` e `seed` — config, não conta
- `.env.example` — alterar: `NODE_ENV` — config, não conta
- `package.json` / `package-lock.json` — alterar: dependências novas — config/lockfile, não conta
- `README.md` — alterar: "Contrato" enxuto, apontando para `/docs` e `openapi.yaml`; `NODE_ENV` em "Variáveis de ambiente" — doc, não conta
- `docs/HISTORIAS.md` — já ajustado no /pato/spec (seção US10); entra no primeiro commit — doc, não conta

## Limite de tamanho
A US inteira sai num PR, mergeável sozinho, com **até 500 linhas de lógica** adicionadas ou modificadas. Remoção não conta.

- **Estimativa:** ~30 linhas (bc_giross: ~30). É a soma da lista acima.
- **Não contam:** testes, documentação, configuração e dados (`openapi.yaml`), lockfiles, migrations e código gerado. Nenhum gerado.
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
| Tarefas | 3 |
| Arquivos que a mudança toca | 5 de código (+ yaml, 4 de teste, config e docs) |
| Linhas de lógica estimadas | ~30 |
| Toca em tela (E2E) | Não (a UI é do Scalar, verificada por HTTP) |
| Migração de dados | Não |
| Muda contrato de API | Sim (rotas novas `/docs` e `/docs/openapi.json`, aditivas) |
| Dependência nova | Sim (`@scalar/express-api-reference`, `yaml`, `ajv`) |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven. São 3 tarefas e dependências novas, e o `openapi.yaml` é grande, embora não conte como lógica.

## Tarefas
- [x] 1. `openapi.yaml` e teste de contrato: escrever o documento, adicionar `yaml` e `ajv`, criar o helper `expectMatchesContract` e o `openapi-contract.test.ts` com todos os cenários de sucesso e erro e a cobertura do catálogo (critérios 3, 4 e 6).
- [x] 2. `/docs` com Scalar: `NODE_ENV` obrigatório no env, no compose (`api` e `seed`) e no `.env.example`, `loadOpenApiDocument`, `docsRouter`, registro no `createApp` e no `index.ts`, `@scalar/express-api-reference` e `docs-route.test.ts` (critérios 1, 2, 5, 7 e 8).
- [x] 3. README: "Contrato" enxuto apontando para `/docs` e `openapi.yaml`, e `NODE_ENV` obrigatório nas variáveis de ambiente, com o aviso de que `production` desliga o `/docs` (critério 9).

## Telas e fluxos E2E (Playwright)
Não se aplica. A UI é renderizada pelo Scalar a partir do documento. O teste confere por HTTP que `/docs` devolve o HTML apontando para `/docs/openapi.json`, e a renderização é conferida manualmente no navegador.

## Testes
- `src/presentation/http/openapi-contract.test.ts`, com Supertest sobre `createApp` e fakes como em `app.test.ts` e `cache-route.test.ts`. Cada resposta passa pelo `expectMatchesContract`:
  - `200` em `GET /ceps-proximos/{cep}`, `GET /ceps-proximos/{cep}/detalhes` (com `fonte: base` e endereço, e com `fonte: nominatim` e `endereco: null`) e `GET /saude`;
  - `204` em `DELETE /cache` e `DELETE /cache/{cep}`;
  - `400 CEP_INVALIDO`, `400 PARAMETRO_INVALIDO` (`pagina` e `limite`), `401 NAO_AUTORIZADO`, `404 CEP_NAO_ENCONTRADO`, `404 NAO_ENCONTRADO`, `422 CEP_FORA_DA_COBERTURA`, `422 CEP_SEM_GEOLOCALIZACAO`, `429 LIMITE_EXCEDIDO`, `503 PROVEDOR_INDISPONIVEL`, `503 CACHE_INDISPONIVEL` e `500 ERRO_INTERNO`;
  - cobertura: todo `codigo` de `ERROR_CATALOG` e `HTTP_ERRORS` está no `enum` do schema `Erro`, e os 5 endpoints existem no `paths`.
- `src/presentation/http/routes/docs-route.test.ts`:
  - com `openApiDocument`, `GET /docs` → `200 text/html`, com a referência a `/docs/openapi.json`;
  - `GET /docs/openapi.json` → `200`, com o mesmo objeto do `loadOpenApiDocument()` e `openapi` começando com `3.1`;
  - sem `openApiDocument`, as duas rotas → `404 NAO_ENCONTRADO`;
  - com `rateLimit.limit = 1`, a segunda chamada → `429`.
- `src/config/env.test.ts`: `NODE_ENV` ausente → erro que cita `NODE_ENV`; valor fora do enum → erro.
- Suítes: `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`.
- Manual:
  - `docker compose up --build`, abrir `localhost:3000/docs` no navegador e conferir os 5 endpoints, o Bearer e os exemplos;
  - `curl localhost:3000/docs/openapi.json`;
  - com `NODE_ENV=production` no `.env`, as duas rotas → `404`;
  - sem `NODE_ENV` no `.env`, o `docker compose up` aborta com `defina NODE_ENV no .env`, e o `npm run dev` sai com o erro de env.

## Verificação independente
Preenchido no `/pato/verify`.

## Registro de testes
Preenchido no `/pato/close-spec`.

| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |

## Riscos e pontos em aberto
- **Quebra de quem já roda o projeto:** quem tem um `.env` sem `NODE_ENV` passa a ver a API, o seed e o compose falharem até acrescentar a variável. Isso é intencional, e o README e o `.env.example` avisam. O `.env` local também precisa da variável.
- **Merge da US9:** o PR #11 precisa estar mergeado antes do `/pato/implement`, que parte da `main`.
- **CDN do Scalar:** a UI precisa de internet no navegador de quem abre `/docs`. O `/docs/openapi.json` funciona offline.
- **Caminho do yaml:** o `loadOpenApiDocument` resolve o `openapi.yaml` relativo ao arquivo-fonte. Se o arquivo faltar no container (o `.dockerignore` não o exclui), a API não sobe fora de `production`, e esse erro aparece logo na subida.
- **`.env` local sem `NODE_ENV`:** o `.env` desta máquina ainda não tem a variável; `npm run dev`, o seed e o `docker compose up` falham até acrescentar `NODE_ENV=development` (comportamento intencional).
- **Idioma do `.env.example`:** o comentário novo do `NODE_ENV` saiu em português e os antigos estão em inglês. Sugestão: padronizar numa US futura.
- **404 genérico no contrato:** o `404 NAO_ENCONTRADO` está documentado nos dois `DELETE /cache` (rota não registrada sem `CACHE_ADMIN_TOKEN`), e a `info.description` diz que qualquer rota inexistente devolve esse 404.
- **Cobertura de 429 e 500 por requisição:** o 429 é exercitado em `/saude` e nas rotas de `/docs`, e o 500 nas rotas de CEP; nos outros endpoints eles estão só no documento.
- **Ajv e OpenAPI 3.1:** palavras-chave próprias do OpenAPI (`example`, `discriminator`) não são JSON Schema. Por isso o `strict: false`. Se o Ajv rejeitar algum `$ref` entre componentes, o helper resolve o ponteiro pelo id `openapi`.
