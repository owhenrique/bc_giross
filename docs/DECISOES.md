# Registro de decisões

Cada decisão tem o contexto, o que foi escolhido e o porquê. Alternativas descartadas ficam registradas para justificar a escolha no README.

## Status

| # | Tema | Decisão | Status |
|---|---|---|---|
| D1 | Stack HTTP | Express + TypeScript | ✅ |
| D2 | Banco | PostgreSQL + Prisma | ✅ |
| D3 | PostGIS | Não usar (ver D3) | ✅ |
| D4 | Fonte dos CEPs no raio | CNEFE 2022 (IBGE) pré-processado | ✅ |
| D5 | Ponto que representa o CEP | Média dos pontos únicos | ✅ |
| D6 | Precisão aceita do CNEFE | Níveis 1–4 (descarta localidade e setor) | ✅ |
| D7 | CEPs "sujos" | p90 do espalhamento > 2 km → fora da base | ✅ |
| D8 | Colunas da tabela | `cep`, `uf`, `latitude`, `longitude` | ✅ |
| D9 | Abrangência entregue | CSV do Brasil inteiro no repo; o seed filtra UFs por `SEED_UFS` | ✅ |
| D10 | Artefato no git | `data/ceps.csv.gz` + relatório + script gerador (só leitura local) + seed | ✅ |
| D11 | Coordenada da origem | Base primeiro; fallback BrasilAPI (endereço) → Nominatim, validando cidade/UF | ✅ |
| D12 | Dados cadastrais do CEP | BrasilAPI v2 (sem usar a coordenada dela) | ✅ |
| D13 | CEP fora da cobertura | UF da BrasilAPI fora das UFs carregadas (tabela `loaded_uf`) → `422` | ✅ |
| D14 | Formato da resposta | Objeto com metadados; endereço só no bloco `origem`, origem fora da lista | ✅ |
| D15 | Limite do raio | Distância exata ≤ raio; arredonda só na saída | ✅ |
| D16 | Entrada | Aceita `00000-000` e normaliza | ✅ |
| D17 | Paginação | `?pagina=1&limite=50` (máx. 200), paginada sobre a lista em cache | ✅ |
| D18 | Raio | Variável de ambiente (padrão 1 km) | ✅ |
| D19 | Cache | Redis (implementação em memória para testes) | ✅ |
| D20 | TTLs | Endereço 30 d · resultado 7 d · inexistente 1 h | ✅ |
| D21 | Limpeza de cache | `DELETE /cache` e `DELETE /cache/:cep` com token via env | ✅ |
| D22 | Rate limit | Nossa API 60 req/min por IP (Redis) · BrasilAPI 5 req/s · Nominatim 1 req/s | ✅ |
| D23 | Timeout externo | 3 s, sem retry | ✅ |
| D24 | Validação | Zod | ✅ |
| D25 | Testes | Vitest + Supertest; Haversine com distâncias conhecidas | ✅ |
| D26 | Logs | Pino | ✅ |
| D27 | Idioma | Código em inglês; contrato e README em português | ✅ |
| D28 | Arquitetura | Camadas: apresentação → serviço/domínio → infraestrutura | ✅ |
| D29 | BrasilAPI fora do ar, CEP na base | Responde os vizinhos com `origem.endereco: null` | ✅ |

---

## D3 — Não usar PostGIS

**Contexto:** a busca no raio pode ser feita pelo banco (PostGIS, `ST_DWithin`) ou pela aplicação.

**Decisão:** Postgres puro com colunas `latitude`/`longitude` indexadas. O banco faz o pré-filtro por *bounding box* e a aplicação calcula a distância exata com Haversine.

**Por quê:**
- O Prisma não suporta os tipos geográficos do PostGIS, o que obrigaria a usar SQL cru.
- A corretude do cálculo de distância é critério de avaliação, e com Haversine no domínio o cálculo fica visível e testável.
- No volume de uma UF ou do Brasil (~931 mil CEPs), o *bounding box* com índice resolve em milissegundos.

**Quando revisitar:** raios grandes, buscas por polígono ou volume muito maior. Aí o PostGIS com índice GiST é o passo natural.

## D4 — CNEFE como fonte dos CEPs no raio

Nenhuma API pública responde "quais CEPs existem a X km de um ponto". Alternativas avaliadas:

| Alternativa | Resultado |
|---|---|
| Geocodificar CEPs "vizinhos" pela numeração | Descartada: a numeração de CEP não é espacial e geraria milhares de chamadas |
| Geocodificação reversa em grade | Descartada: lenta, incompleta e limitada a 1 req/s (Nominatim) |
| Overpass (OSM) `around:1000` com `addr:postcode` | Descartada: achou **58 CEPs contra 174** do CNEFE no mesmo ponto (Vila Olímpia/SP), e o servidor público recusou 2 de 3 requisições por capacidade |
| API do IBGE | Não existe busca espacial no CNEFE, só download de arquivos |
| **CNEFE 2022 pré-processado** | **Escolhida** |

**Validação do método (25 CEPs de São Paulo e São Carlos, centróide CNEFE contra AwesomeAPI):** 16 CEPs ficaram a até 50 m, 5 entre 50 e 250 m, 1 a 700 m (rua longa) e 3 a 2 km ou mais. Nos 3 maiores desvios, 2 eram erro da AwesomeAPI e 1 era CEP sujo no CNEFE (ver D7).

## D7 — CEPs sujos

No CNEFE de São Paulo, o CEP `01001000` (Praça da Sé) aparece em ~7 mil endereços espalhados pela cidade inteira, porque foi usado como valor padrão. Medição em 46.906 CEPs de SP, considerando a distância ao centróide dentro da qual ficam 90% dos **pontos únicos** (endereços com a mesma coordenada, como os apartamentos de um prédio, contam uma vez; p90 no índice `floor(0,9 × (n − 1))` da lista ordenada):

| Espalhamento p90 | % dos CEPs |
|---|---|
| ≤ 500 m | 94,7% |
| 500 m – 1 km | 2,7% |
| 1 – 2 km | 1,0% |
| > 2 km | 1,6% |

A tabela vem da amostra inicial de 46.906 CEPs. Na base completa de SP, com pontos únicos, 5.413 de cerca de 275,6 mil CEPs (~2,0%) passam de 2 km.

**Decisão:** CEPs com p90 > 2 km ficam fora do arquivo gerado, e o `build-dataset` registra quais foram removidos. Como origem, eles caem no fallback externo (D11).

## D8 — Só `cep`, `uf`, `latitude`, `longitude`

A `uf` permite filtrar o seed e responder a regra de cobertura (D13) com um `DISTINCT uf`. Os demais dados cadastrais (rua, bairro, cidade, UF) vêm da API externa (D12). Guardar esses dados na base duplicaria a responsabilidade da API.

## D9 — Brasil inteiro no repositório

O CNEFE do Brasil tem ~3,7 GB compactado (~19 GB em CSV) e 931.499 CEPs. Depois de processado, uma linha por CEP, o arquivo fica com dezenas de MB (medido na US1: `ceps.csv.gz` com 8,2 MB para 898.455 CEPs; `ceps-removidos.csv` com 1,3 MB e 33.022 CEPs). Esse tamanho cabe no git sem LFS, então o repositório entrega a base do **Brasil inteiro**.

O CSV unificado é gerado **uma vez, pelo mantenedor**, com o `build-dataset` lendo os ZIPs do IBGE de uma pasta local (sem lógica de download). O avaliador só sobe o `docker compose`: o seed carrega o CSV e aceita `SEED_UFS=SP,RJ` para limitar as UFs. A regra de cobertura (D13) consulta as UFs carregadas na tabela, então uma carga parcial continua coerente.

## D10 — CSV compactado no git

O script gerador fica no repositório como receita auditável, junto com um relatório (totais por UF e CEPs removidos). O avaliador não precisa rodá-lo.

Formatos descartados:
- `.sql` com INSERTs: 2 a 3 vezes maior, carga lenta e acoplado ao schema.
- `pg_dump`: binário, não auditável e dependente da versão do Postgres.
- Só o script: obrigaria o avaliador a baixar GBs do IBGE.

O `seed.ts` carrega via `COPY` (lib `pg`, já que o Prisma não tem `COPY`), pode rodar várias vezes e limpa o cache de resultados ao recarregar.

## D11 — Origem: base primeiro

Os vizinhos saem do CNEFE. Usar a mesma fonte para a origem evita deslocar o centro do raio por diferença de metodologia. A API externa só entra quando o CEP não está na base (fora da cobertura ou removido como sujo).

**Fallback escolhido:** BrasilAPI (rua, cidade, UF) → Nominatim, com `addressdetails=1`, rejeitando o resultado se a cidade ou a UF não baterem. A AwesomeAPI foi descartada pela observação abaixo.

**Observação:** a AwesomeAPI bloqueou o IP com `429 QuotaExceeded` depois de ~30 chamadas. O limite não está documentado. Isso inviabiliza a AwesomeAPI como fallback confiável (pendente).

## D12 — BrasilAPI v2 para dados cadastrais (em análise)

Comportamento de erro observado:

| Caso | BrasilAPI v2 | ViaCEP |
|---|---|---|
| Formato inválido | `400` JSON tipado (`validation_error`) | `400` em **HTML** |
| CEP inexistente | `404` JSON com o erro de cada serviço interno | `200` com `{"erro": "true"}` |
| Coordenada | Precisão de **município** na maioria dos casos (todos os CEPs de SP voltaram -23.5475, -46.63611) | Não tem |

A coordenada da BrasilAPI **não é usada**, porque é a da cidade.

## D21 — Token da limpeza de cache

O token vem da variável `CACHE_ADMIN_TOKEN` e vai no header `Authorization: Bearer <token>`, comparado em tempo constante. Sem a variável definida, os endpoints ficam desabilitados.

## D11 (cont.) — Nominatim como fallback de coordenada

Teste com os mesmos 25 CEPs: endereço da BrasilAPI → Nominatim (busca estruturada por rua, cidade e UF), comparado com o centróide do CNEFE.

| Distância do CNEFE | CEPs |
|---|---|
| ≤ 50 m | 13 |
| 50 – 250 m | 4 |
| 250 m – 1 km | 3 (ruas longas) |
| 1 – 5 km | 2 (Av. Paulista, que tem 2,8 km; e `01001000`, o CEP sujo, em que o Nominatim acertou a Praça da Sé) |
| > 30 km | 2 (homônimo em outro lugar: 32 km e 303 km) |
| sem resultado | 1 |

A busca direta por CEP no Nominatim (`postalcode`) só retornou 7 de 25, porque a cobertura de CEP no OSM é baixa.

**Riscos e mitigações:**
- O Nominatim às vezes devolve uma rua homônima em outra cidade. Mitigação: pedir `addressdetails=1` e rejeitar o resultado se o município ou a UF não baterem com a BrasilAPI.
- Em ruas longas, o ponto devolvido é algum trecho da rua, não o centro do CEP.
- A política de uso exige no máximo 1 req/s, `User-Agent` identificado e cache dos resultados.

## D12 (cont.)

O `404` da BrasilAPI lista erros dos serviços internos dela, então pode mascarar uma indisponibilidade desses serviços. TTL curto (1 h) para o cache de "não existe" por esse motivo.

## D20 — TTLs

O critério é a frequência de mudança do dado contra o custo de servir um dado desatualizado:
- **Endereço (30 d):** rua e bairro de um CEP raramente mudam.
- **Resultado (7 d):** só muda quando a base é recarregada, e o seed já limpa esse cache. O TTL serve para liberar memória.
- **Inexistente (1 h):** protege a API externa de repetições, sem prender por muito tempo um CEP novo ou um falso `404`.

O Redis roda com `maxmemory` e a política `allkeys-lru`.

## D19 (cont.) — Cache na US4

- **Cliente:** `redis` (node-redis v5), atrás da porta `Cache` (`RedisCache` em produção, `InMemoryCache` nos testes).
- **`REDIS_URL` obrigatória:** o `loadEnv` falha sem ela, na API e no seed. O `InMemoryCache` só existe nos testes, para não haver um cache "silencioso" por processo em produção.
- **Redis fora do ar, na API:** degrada. Erro ou timeout (500 ms) vira log `warn` e miss, e a consulta segue no banco e na BrasilAPI. O cliente reconecta sozinho, sem reiniciar a API. Isso bate com o `/saude`, que mostra o Redis fora como "degradado".
- **Redis fora do ar, no seed:** o seed falha. Ele conecta e dá `PING` antes do `BEGIN`, então aborta com código ≠ 0 sem mexer no banco. Se a limpeza dos resultados falhar depois do `COMMIT`, ele também sai com código ≠ 0 e avisa que a base foi carregada mas o cache não foi limpo, porque o cache antigo poderia servir resultado velho até o TTL.
- **O que entra no cache de um CEP fora da base:** só o lookup da BrasilAPI (`found` 30 d, `not_found` 1 h). `unavailable` nunca entra. O desfecho (`404`/`422`) não é guardado, e a repetição ainda consulta o banco.
- **Formato do resultado em cache:** a lista inteira de vizinhos, já filtrada e ordenada, mais a origem. A paginação sai dessa lista (por isso `pagina` e `limite` não entram na chave, como na D17), e o raio entra na chave (`result:<raio>:<cep>`) porque pode mudar por env. O endereço não faz parte do valor: vem do cache de endereço (`address:<cep>`).
- **Limpeza no seed:** apaga `result:*` e mantém `address:*`, porque o endereço não depende da base carregada.

## D13 (cont.) — Tabela `loaded_uf`

O caminho `422` fazia `DISTINCT uf` sobre ~898 mil linhas de `cep`, sem índice em `uf`. Agora o seed grava as UFs que carregou na tabela `loaded_uf` (no máximo 27 linhas), na mesma transação da carga dos CEPs, e o `findLoadedUfs` lê dela. Descartadas: só pôr as UFs no cache (ainda lê a tabela inteira no miss e em todo erro com o Redis fora) e índice + CTE recursiva em SQL à mão.

Consequência: numa base migrada sem rodar o seed, a tabela fica vazia e todo CEP fora da base com UF existente cai em `CEP_FORA_DA_COBERTURA`. O compose sempre roda o seed antes da API, e o README avisa para rodar o seed depois do `migrate deploy`.

## D19 (cont.) — Credenciais do Postgres no `.env` do compose

O `docker-compose.yml` lê `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` do `.env` e monta a `DATABASE_URL` dos serviços `api` e `seed`, em vez de ter credenciais fixas no arquivo. `POSTGRES_PORT` e `API_PORT` definem as portas publicadas no host.

Consequência: o `docker compose up` falha sem um `.env`, então o README manda copiar o `.env.example` antes. Fora do docker (`npm start`, `npm run seed`), a `DATABASE_URL` continua vindo do `.env`.
