---
id: us3
card: —
mapa: docs/HISTORIAS.md
depende_de: US2 (PR #2, mergeada) e US8 (PR #3, mergeada)
titulo: Endereço da origem e erros claros
status: implementado
modo:
criada_em: 2026-10-27
implementada_em: 2026-10-27
verificada_em: 2026-10-27
branch: us3-endereco-e-erros
merge_request: https://github.com/owhenrique/bc_giross/pull/4
---

# US3 — Endereço da origem e erros claros

## História
Como **Giross**, quero ver o endereço do CEP consultado e receber erros claros para CEP não encontrado ou fora da cobertura, para confiar na resposta e entender por que ela falhou.

## Contexto
Esta US integra a BrasilAPI v2 (D12) para preencher `origem.endereco` e para explicar o motivo quando o CEP não está na base: nenhum serviço de CEP o encontra (o que não prova que ele não existe, já que essas bases são atualizadas de tempos em tempos), a UF dele não foi carregada (D13) ou ele existe mas a base não tem a coordenada (CEP sujo ou novo, D7). Os erros novos já nascem como `AppError` mais uma linha no catálogo (US8).

Como o enunciado pede só a lista de CEPs, a consulta tem duas rotas. A principal, `GET /ceps-proximos/:cep`, é enxuta: origem, paginação e vizinhos, sem chamar a BrasilAPI quando o CEP está na base. A completa, `GET /ceps-proximos/:cep/detalhes`, traz a coordenada, a fonte e o endereço da origem, além do raio.

Onde entra no mapa: o cache (US4) vai guardar o endereço e o resultado, e o fallback Nominatim (US5) busca a coordenada de um CEP fora da base, de UF carregada.

Decisões que valem aqui: D11, D12, D13, D14, D22, D23, D24, D26, D27, D28, D29.

## Critérios de aceite
- [x] 1. Dado um CEP na base, quando chamo `GET /ceps-proximos/04551000?pagina=1&limite=50`, então recebo `200` com `{ origem: "04551000", paginacao: { pagina, limite, total, total_paginas }, ceps: [{ cep, distancia_km }] }`. Ordenação, arredondamento, raio, paginação e validações são os da US2, e a BrasilAPI **não** é chamada.
- [x] 2. Dado um CEP na base e a BrasilAPI respondendo `200`, quando chamo `GET /ceps-proximos/04551000/detalhes`, então recebo `origem: { cep, latitude, longitude, fonte, endereco }`, `raio_km`, `paginacao` e `ceps`, com `endereco: { rua, bairro, cidade, uf }` (de `street`, `neighborhood`, `city` e `state` da BrasilAPI v2). Campo vazio ou ausente na BrasilAPI (ex.: `street` num CEP geral de cidade) sai como `null`. `04551-000` funciona nas duas rotas.
- [x] 2a. Dado um CEP na base e a BrasilAPI fora do ar (erro de rede ou status ≥ 500), estourando o timeout de 3 s ou respondendo `404` (de qualquer tipo), quando chamo `/detalhes`, então a resposta é `200` com a lista de vizinhos e `origem.endereco: null` (D29). A falha fica num log `warn`.
- [x] 3. Os critérios 3 a 6 valem para **as duas rotas** (com o CEP fora da base, a rota simples também consulta a BrasilAPI para explicar o erro). Dado um CEP fora da base e a BrasilAPI respondendo `404` em que pelo menos um item de `errors[]` tem `message` casando `/n[aã]o encontrado|not found/i` (ex.: `correios-alt`: "CEP não encontrado na base dos Correios."), então `404` `{ erro: { codigo: "CEP_NAO_ENCONTRADO", mensagem: "CEP não encontrado" } }`.
- [x] 3a. Dado um CEP fora da base e a BrasilAPI respondendo `404` em que nenhum item de `errors[]` diz "não encontrado" (só falhas como "Erro ao se conectar com o serviço ViaCEP."), ou sem `errors[]` legível, então o `404` é tratado como **indisponível** → `503 PROVEDOR_INDISPONIVEL` (critério 6), com log `warn` trazendo o corpo.
- [x] 4. Dado um CEP fora da base que a BrasilAPI encontra, com uma UF que não está entre as carregadas, então `422` `{ erro: { codigo: "CEP_FORA_DA_COBERTURA", mensagem: "CEP fora da cobertura da base" } }`.
- [x] 5. Dado um CEP fora da base que a BrasilAPI encontra, com uma UF carregada, mas sem coordenada (nem o fallback da US5 a encontra), então `422` `{ erro: { codigo: "CEP_SEM_GEOLOCALIZACAO", mensagem: "Não foi possível obter a coordenada do CEP" } }`.
- [x] 6. Dado um CEP fora da base e a BrasilAPI fora do ar, estourando o timeout ou sem vaga no limite de 5 req/s, então `503` `{ erro: { codigo: "PROVEDOR_INDISPONIVEL", mensagem: "Serviço de consulta de CEP indisponível" } }`.
- [x] 7. Dado mais de 5 chamadas à BrasilAPI na mesma janela de 1 s, quando chega a 6ª, então ela **não** é feita e é tratada como indisponível na hora (critério 2a ou 6, conforme o CEP esteja na base). Na janela seguinte as chamadas voltam a ser feitas.
- [x] 8. Dado a chamada à BrasilAPI, então ela usa um timeout de 3 s, sem retry (D23), e não usa a coordenada da BrasilAPI (D12).
- [x] 9. Dado o catálogo, então `cep_not_found` / `404 CEP_NAO_ENCONTRADO` / "CEP não encontrado" fica como está, e `cep_out_of_coverage`, `cep_without_location` e `address_provider_unavailable` entram, com o teste da US8 cobrindo todo `kind`.
- [x] 10. Dado o README, então ele documenta as duas rotas, cada uma com um exemplo de resposta (a detalhada com `origem.endereco`), e a tabela de erros traz o `404 CEP_NAO_ENCONTRADO` com o novo significado (nem a base nem os serviços de CEP o encontram) e os três erros novos.

## Escopo
**Dentro:**
- Porta `CepAddressProvider` em `application` e o client da BrasilAPI v2 em `infrastructure` (fetch nativo, timeout de 3 s, limite de 5 req/s com falha imediata).
- `findLoadedUfs()` no `CepRepository`.
- `findNearbyCeps` com a opção `withAddress`, o endereço, o `cep_not_found` vindo da BrasilAPI e os três erros novos.
- A rota detalhada `/ceps-proximos/:cep/detalhes` (`toDetailedResponse`, com `origem.endereco`), ao lado da simples `/ceps-proximos/:cep` (`toSummaryResponse`).
- Atualizar o README e o mapa (`docs/HISTORIAS.md`) com as decisões abaixo: a US3 e a lista de endpoints da US10.

**Fora** (fica para outra US do mapa ou fora do card):
- Cache de endereço, resultado e não encontrado → US4.
- Coordenada do Nominatim para CEP fora da base → US5.
- Variável de ambiente para URL, timeout ou limite da BrasilAPI → fora do card (ficam como constantes com padrão no construtor, injetáveis nos testes).

## Decisões e respostas do usuário
- P: CEP fora da base e BrasilAPI fora do ar/timeout: o que responder? → R: `503 PROVEDOR_INDISPONIVEL`.
- P: CEP na base, mas a BrasilAPI responde `404`? → R: lista com `endereco: null`, porque a base é a fonte da coordenada e o `404` da BrasilAPI pode mascarar uma falha interna dela (D12).
- P: Chamada que passa de 5 req/s? → R: falha imediata, sem chamar a BrasilAPI. Ela é tratada como indisponível.
- P: Códigos e mensagens dos erros novos → R: aprovados: `422 CEP_FORA_DA_COBERTURA` "CEP fora da cobertura da base", `422 CEP_SEM_GEOLOCALIZACAO` "Não foi possível obter a coordenada do CEP", `503 PROVEDOR_INDISPONIVEL` "Serviço de consulta de CEP indisponível". Campos vazios da BrasilAPI saem como `null`.
- P: Onde entram a coordenada, a fonte e o endereço, se o enunciado pede só a lista de CEPs? → R: Numa segunda rota, a detalhada. `/ceps-proximos/:cep` é a principal e enxuta.
- P: Caminho da rota detalhada? → R: `/ceps-proximos/:cep/detalhes`.
- P: O que a rota simples devolve? → R: `{ origem: "<cep>", paginacao, ceps }`, mantendo `?pagina=&limite=`.
- P: A rota simples chama a BrasilAPI? → R: só com o CEP fora da base, para dar os mesmos erros claros. Com o CEP na base, não chama (mais rápida e não gasta as 5 req/s).
- P: Qual erro sai quando nenhum serviço de CEP acha o CEP? → R: `cep_not_found`, com `404 CEP_NAO_ENCONTRADO` "CEP não encontrado", a entrada que já existe no catálogo. Não achar o CEP não prova que ele não existe, porque as bases de CEP são atualizadas de tempos em tempos.
- P (revisão): o `404` da BrasilAPI pode ser serviço indisponível → R: na chamada real de `00000001` (2026-10-27), o `404` (`type: "service_error"`) trouxe em `errors[]` uma mistura de falhas de conexão (ViaCEP, WideNet), de parse (Correios) e um "CEP não encontrado na base dos Correios." (correios-alt). Regra: o `404` só vale como não encontrado se pelo menos um item de `errors[]` disser "não encontrado"; senão, indisponível.
- P: Quem trata os erros do provider? Trocar de provedor obriga a mudar o domínio? → R: não. O adapter traduz os erros da BrasilAPI para o resultado neutro da porta (`found`/`not_found`/`unavailable`). O caso de uso só aplica a regra de negócio sobre esse resultado, e `src/domain` não é tocado. A fronteira está no design técnico.

## Premissas
Nenhuma.

## Design técnico
- **Porta (`src/application/cep-address-provider.ts`):**
  ```ts
  interface CepAddress { street: string | null; neighborhood: string | null; city: string | null; uf: string | null }
  type AddressLookup = { status: 'found'; address: CepAddress } | { status: 'not_found' } | { status: 'unavailable' };
  interface CepAddressProvider { lookup(cep: string): Promise<AddressLookup> }
  ```
  A porta nunca lança: indisponibilidade é um resultado, porque o caso de uso decide entre `endereco: null` e `503`.
  **Fronteira:** tudo o que é específico da BrasilAPI fica no adapter: URL, timeout, limiter, status HTTP, formato de `errors[]`, `NOT_FOUND_PATTERN` e os nomes `street`/`state`. Nada disso aparece em `application`, `domain` ou `presentation`, e os nomes fora do adapter são neutros (`address_provider_unavailable`, `PROVEDOR_INDISPONIVEL`). Trocar de provedor é criar outro `CepAddressProvider` e mudar uma linha em `src/index.ts`, sem tocar no caso de uso, no catálogo nem nas rotas.
- **`findNearbyCeps(repository, addressProvider, radiusKm)`:** `FindNearbyCepsInput` ganha `withAddress?: boolean` (padrão `false`). O caso de uso valida a entrada como hoje. Com `withAddress`, inicia o `lookup` junto com o `findByCep` (em paralelo); sem ele, só chama o `lookup` se o CEP não estiver na base.
  - Com o CEP na base: `address` = o endereço se `withAddress` e `found`, senão `null`. Segue o cálculo atual.
  - Sem o CEP na base (as duas rotas): `not_found` → `CepNotFoundError` (a que já existe); `unavailable` → `AddressProviderUnavailableError`; `found` → `findLoadedUfs()`, e a UF fora da lista → `CepOutOfCoverageError`, senão `CepWithoutLocationError`.
  - `NearbyCepsResult.origin` ganha `address: CepAddress | null`.
- **Client (`src/infrastructure/http/brasil-api-cep-provider.ts`):** `BrasilApiCepProvider implements CepAddressProvider`, com `{ fetch = globalThis.fetch, baseUrl = 'https://brasilapi.com.br/api/cep/v2', timeoutMs = 3000, limiter = new WindowRateLimiter(5, 1000), logger }`.
  - Sem vaga no limiter → `unavailable`, sem chamar.
  - Usa `fetch(\`${baseUrl}/${cep}\`, { signal: AbortSignal.timeout(timeoutMs) })`. `200` → corpo validado com Zod (`street`, `neighborhood`, `city`, `state`, strings opcionais; `''` → `null`).
  - `404`: o corpo é validado com Zod (`errors: { message: string; service?: string }[]`). Se algum `message` casar `NOT_FOUND_PATTERN = /n[aã]o encontrado|not found/i`, o resultado é `not_found`. Senão, ou com corpo inválido, é `unavailable` com `logger.warn({ cep, errors })`.
  - Qualquer outro status, corpo inválido, erro de rede ou timeout → `unavailable`, com `logger.warn`.
  - Ignora `location`.
- **Limiter (`src/infrastructure/http/window-rate-limiter.ts`):** `WindowRateLimiter(max, windowMs, now = Date.now)` com `tryAcquire(): boolean`. É uma janela deslizante em memória, por processo, e não espera: sem vaga, devolve `false`.
- **Repositório:** `findLoadedUfs(): Promise<string[]>`, com as UFs carregadas na base (D13). Só roda no caminho de erro (CEP fora da base).
- **Catálogo:** entram `cep_out_of_coverage`, `cep_without_location` e `address_provider_unavailable`; `cep_not_found` fica sem mudança.

  | kind | status | codigo | mensagem |
  | --- | --- | --- | --- |
  | `cep_not_found` (já existe) | 404 | `CEP_NAO_ENCONTRADO` | `CEP não encontrado` |
  | `cep_out_of_coverage` | 422 | `CEP_FORA_DA_COBERTURA` | `CEP fora da cobertura da base` |
  | `cep_without_location` | 422 | `CEP_SEM_GEOLOCALIZACAO` | `Não foi possível obter a coordenada do CEP` |
  | `address_provider_unavailable` | 503 | `PROVEDOR_INDISPONIVEL` | `Serviço de consulta de CEP indisponível` |

- **Apresentação (`nearby-ceps-route.ts`):** a rota continua só mapeando HTTP.
  - `GET /ceps-proximos/:cep` chama `find({ ..., withAddress: false })` e devolve `toSummaryResponse(result)`: `{ origem: origin.cep, paginacao, ceps }`.
  - `GET /ceps-proximos/:cep/detalhes` chama `find({ ..., withAddress: true })` e devolve `toDetailedResponse(result)`: `origem` com `cep`, `latitude`, `longitude`, `fonte` e `endereco: { rua, bairro, cidade, uf } | null`, mais `raio_km`, `paginacao` e `ceps`.
  - `paginacao` e `ceps` saem de helpers comuns às duas. Como `:cep` não casa com `/`, as rotas não conflitam.
- **Composição (`src/index.ts`):** cria o `BrasilApiCepProvider` com o logger e o passa a `findNearbyCeps`.
- Sem migration, sem dependência nova. O contrato ganha a rota `/detalhes`, com `origem.endereco`, e os erros de CEP fora da base, com o motivo (o `404 CEP_NAO_ENCONTRADO` só quando a BrasilAPI também não acha o CEP).

## Arquivos que a mudança toca
- `src/application/cep-address-provider.ts` — criar: `CepAddress`, `AddressLookup`, `CepAddressProvider` — ~12 linhas
- `src/application/errors.ts` — alterar: `APP_ERROR_KINDS`, cria `CepOutOfCoverageError`, `CepWithoutLocationError` e `AddressProviderUnavailableError` (`CepNotFoundError` fica) — ~15 linhas
- `src/application/cep-repository.ts` — alterar: `findLoadedUfs` — ~1 linha
- `src/application/find-nearby-ceps.ts` — alterar: novo parâmetro, `withAddress`, `lookup` em paralelo ou sob demanda, ramos de erro, `origin.address` — ~35 linhas
- `src/infrastructure/http/window-rate-limiter.ts` — criar: `WindowRateLimiter` — ~20 linhas
- `src/infrastructure/http/brasil-api-cep-provider.ts` — criar: `BrasilApiCepProvider`, schemas Zod (200 e 404), `NOT_FOUND_PATTERN` — ~65 linhas
- `src/infrastructure/db/prisma-cep-repository.ts` — alterar: `findLoadedUfs` — ~6 linhas
- `src/presentation/http/errors.ts` — alterar: os três códigos novos — ~5 linhas
- `src/presentation/http/error-catalog.ts` — alterar: três entradas novas — ~15 linhas
- `src/presentation/http/nearby-ceps-route.ts` — alterar: `toDetailedResponse` com `endereco`, `toSummaryResponse` e as duas rotas — ~30 linhas
- `src/index.ts` — alterar: composição do provider — ~4 linhas
- `src/application/find-nearby-ceps.test.ts` — alterar: provider fake, cada ramo (teste, não conta)
- `src/application/errors.test.ts` — alterar: `kind` das subclasses novas (teste, não conta)
- `src/infrastructure/http/window-rate-limiter.test.ts` — criar: janela com `now` injetado (teste, não conta)
- `src/infrastructure/http/brasil-api-cep-provider.test.ts` — criar: `fetch` injetado (200; 404 com "não encontrado" em algum serviço; 404 só com falhas de conexão; 404 sem `errors[]`; 500; rede; timeout; corpo inválido; limiter cheio), com o corpo real de `00000001` como fixture (teste, não conta)
- `src/presentation/http/app.test.ts` — alterar: provider fake com contador de chamadas; contrato da rota simples (sem chamar o provider) e de `/detalhes` com `endereco`; o `404 CEP_NAO_ENCONTRADO` vindo do provider e os três erros novos, nas duas rotas (teste, não conta)
- `README.md` — alterar: as duas rotas, os exemplos e a tabela de erros (doc, não conta)
- `docs/HISTORIAS.md` — alterar: a US3 com as decisões e as duas rotas; a US10 lista `GET /ceps-proximos/:cep/detalhes` (doc, não conta)

## Limite de tamanho
- **Estimativa:** ~210 linhas de lógica (`bc_giross`), soma da lista acima.
- **Não contam:** testes, docs, config e lockfile; nenhum arquivo gerado.
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
| Tarefas | 5 |
| Arquivos que a mudança toca | 11 de lógica + 5 de teste + 2 de doc |
| Linhas de lógica estimadas | ~210 (ver "Limite de tamanho") |
| Toca em tela (E2E) | Não |
| Migração de dados | Não |
| Muda contrato de API | Sim (rota `/detalhes` com `endereco` e erros de CEP fora da base) |
| Dependência nova | Não |
| Repos envolvidos | 1 |

**Modo sugerido:** agent-driven, porque são 5 tarefas, 11 arquivos de lógica e muda o contrato.

## Tarefas
- [x] 1. `WindowRateLimiter` com testes (janela cheia → `false`; janela seguinte → `true`).
- [x] 2. Porta `CepAddressProvider` e `BrasilApiCepProvider` (fetch injetável, timeout de 3 s, Zod, `''` → `null`, limiter, `warn` na falha), com testes de cada desfecho.
- [x] 3. Erros novos em `errors.ts` e no catálogo, `findLoadedUfs` no repositório e `findNearbyCeps` com `withAddress`, os ramos novos e `origin.address`, com testes do caso de uso (inclusive: sem `withAddress` e com o CEP na base, o provider não é chamado).
- [x] 4. Duas rotas (`toSummaryResponse` e `toDetailedResponse`), composição em `index.ts` e `app.test.ts` cobrindo os critérios 1 a 6 nas duas rotas.
- [x] 5. README e `docs/HISTORIAS.md` (US3 e US10). Conferir `npm test`, `npm run lint`, `npm run typecheck` e a medição de linhas.

## Telas e fluxos E2E (Playwright)
Não se aplica.

## Testes
- `npm test`, `npm run lint` e `npm run typecheck`.
- **Unitários:** limiter com relógio injetado; provider com `fetch` falso em cada desfecho (o timeout com um `fetch` que respeita o `signal` e `timeoutMs` baixo); caso de uso com um provider fake em `found`/`not_found`/`unavailable`, com e sem o CEP na base, com e sem `withAddress`, e UF carregada ou não.
- **HTTP (supertest):** rota simples sem chamar o provider com o CEP na base; `/detalhes` com `endereco` preenchido e `null`; `404 CEP_NAO_ENCONTRADO`, `422 CEP_FORA_DA_COBERTURA`, `422 CEP_SEM_GEOLOCALIZACAO` e `503 PROVEDOR_INDISPONIVEL` nas duas rotas.
- **Manual com `docker compose` e `SEED_UFS=SP`:** `curl` em `04551000` (rota simples) e `04551000/detalhes` (endereço preenchido); `00000001` (não encontrado; `99999999` **não** serve, porque o `open-cep` o resolve para Sarandi/PR); um CEP do RJ, ex.: `20040020` (fora da cobertura); e um CEP da base com a rede da API cortada (endereço `null`).

## Verificação independente
Verificada em 2026-10-27 por subagente independente (contexto limpo), contra `main`.

- **Suítes:** `npm test` 15 arquivos, 133 testes, 0 falhas; `npm run lint` e `npm run typecheck` limpos. Sem E2E (a US não tem telas).
- **Critérios:** 1, 2, 2a, 3, 3a, 4, 5, 6, 7, 8, 9 e 10 atendidos.
- **Entregável:** sim. A história funciona de ponta a ponta só com esta branch, que tem apenas commits da US a partir de `main`.
- **Linhas medidas:** 304/500 na primeira medição; 260/500 depois de corrigir a formatação.
- **Achados:**
  1. (Média) `find-nearby-ceps.ts` reformatado com aspas duplas e quebras fora do padrão, o que inflava o diff. Corrigido. O `find-nearby-ceps.test.ts` já usava aspas duplas em `main`, então não precisou mudar.
  2. (Baixa) `parseQueryNumber` reformatado em `nearby-ceps-route.ts`. Corrigido.
  3. (Baixa) `lookupPromise` sem `await` se `findByCep` lançar com `withAddress`. Sem efeito prático hoje, porque a porta nunca lança, mas corrigido a pedido do usuário com um `.catch(() => {})` na promessa.
- **Decisão do usuário:** corrigir os achados 1 e 2; o 3 também foi corrigido depois. Suítes rodadas de novo depois da correção, todas verdes.
- **Não verificado:** teste manual com `docker compose` e `SEED_UFS=SP` contra a BrasilAPI real; `/docs` (Scalar).

## Registro de testes
| Data | Tipo | Quem testou | Ambiente | O que foi testado | Resultado | Evidência |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-27 | Automatizado | local | local | `npm test` (15 arquivos, 133 testes), `npm run lint` e `npm run typecheck` | Aprovado | — |
| 2026-10-27 | Verificação independente | subagente (contexto limpo) | local | diff contra a spec + suítes rodadas | Aprovado | seção "Verificação independente" |
| 2026-10-27 | Manual | Henrique | local (docker compose, `SEED_UFS=SP`) | roteiro da spec: `04551000` (simples e `/detalhes`), `00000001`, `20040020`, `01001000` e BrasilAPI cortada | Aprovado | — |

## Riscos e pontos em aberto
- **Latência de `/detalhes`:** espera a BrasilAPI, até 3 s, mesmo com o CEP na base. Até a US4 (cache), cada chamada gasta 1 das 5 vagas por segundo, e uma 6ª consulta no mesmo segundo sai sem endereço. A rota simples não tem esse custo com o CEP na base.
- **Limiter por processo:** com mais de uma réplica da API, o limite real é 5 × réplicas. Hoje o compose sobe uma réplica.
- **Classificação do `404` da BrasilAPI depende de texto livre:** se ela mudar as mensagens de `errors[]`, um "não encontrado" verdadeiro passa a sair como `503` (o lado seguro). O risco inverso continua: um serviço desatualizado que diz "não encontrado" enquanto os outros caem gera um `404` falso. A US4 limita o estrago com o TTL de 1 h.
