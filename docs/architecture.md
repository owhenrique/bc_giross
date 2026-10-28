# Arquitetura

Este documento descreve as camadas da API, como as portas isolam as dependências externas, a organização das pastas e os princípios que guiam o código.

---

## 1. Visão Geral e Camadas

A aplicação é dividida em quatro camadas, e cada uma só conhece as de baixo:

```
                          REQUISIÇÃO HTTP
                                 │
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │              CAMADA DE APRESENTAÇÃO              │
       │  • rateLimitMiddleware (60 req/min por IP)       │
       │  • nearbyCepsRouter, cacheRouter, healthRouter,  │
       │    docsRouter (só HTTP)                          │
       │  • nearby-ceps-mapper (contrato em português)    │
       │  • errorHandler + ERROR_CATALOG / HTTP_ERRORS    │
       └─────────────────────────┬────────────────────────┘
                                 │
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │               CAMADA DE APLICAÇÃO                │
       │  • findNearbyCeps, clearCache (casos de uso)     │
       │  • CachingCepAddressProvider, OriginGeocoder     │
       │  • Portas: CepRepository, Cache,                 │
       │    CepAddressProvider, Geocoder                  │
       │  • AppError e subclasses                         │
       └─────────────────────────┬────────────────────────┘
                                 │
                                 ▼
       ┌──────────────────────────────────────────────────┐
       │                 CAMADA DE DOMÍNIO                │
       │  • haversineKm, boundingBox (geo.ts)             │
       │  • normalizeCep, assessCep, nearestCeps (cep.ts) │
       └──────────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────────┐
       │              CAMADA DE INFRAESTRUTURA            │
       │  • PrismaCepRepository (Postgres)                │
       │  • RedisCache                                    │
       │  • BrasilApiCepProvider, NominatimGeocoder       │
       │  • limitedFetch + WindowRateLimiter              │
       │  • logger (Pino), loadOpenApiDocument            │
       └──────────────────────────────────────────────────┘
```

- **Apresentação:** traduz HTTP em chamada de caso de uso e o resultado em JSON do contrato. A rota não tem regra de negócio: lê a requisição, chama o caso de uso e devolve o mapper.
- **Aplicação:** orquestra o fluxo (base, cache, BrasilAPI, Nominatim, paginação) e declara as portas de que precisa. Não importa Express, Prisma nem Redis.
- **Domínio:** funções puras de geometria e de CEP, testadas com distâncias conhecidas. Não importa nada das outras camadas.
- **Infraestrutura:** implementa as portas com bibliotecas e serviços externos.

A tradução entre o código em inglês e o contrato em português acontece só na borda: o domínio devolve `distanceKm`, e o mapper o expõe como `distancia_km`.

---

## 2. Ports and Adapters

A aplicação depende de interfaces (portas) que ela mesma declara. A infraestrutura fornece os adaptadores, e a composição em `src/index.ts` liga um ao outro:

```
  application (porta)            infrastructure (adaptador)
  ───────────────────            ──────────────────────────
  CepRepository        ◀──────── PrismaCepRepository
  Cache                ◀──────── RedisCache     (InMemoryCache nos testes)
  CepAddressProvider   ◀──────── BrasilApiCepProvider
  Geocoder             ◀──────── NominatimGeocoder
```

- **As portas nunca lançam por indisponibilidade:** os providers devolvem um resultado neutro (`found`, `not_found`, `unavailable`), e o caso de uso decide entre `endereco: null`, `404`, `422` ou `503`. Formato de erro, status HTTP e textos da BrasilAPI ficam dentro do adaptador.
- **Decorators sobre as portas:** `CachingCepAddressProvider` envolve qualquer `CepAddressProvider` com cache, e `OriginGeocoder` envolve o `Geocoder` com validação de cidade/UF e cache. O caso de uso não sabe que há cache.
- **Testes sem infraestrutura:** os casos de uso e as rotas são testados com fakes das portas (repositório em memória, `InMemoryCache`, providers que contam chamadas), sem Postgres, Redis nem rede.

**Como adicionar um terceiro provider de CEP (ex.: ViaCEP):**
1. Crie uma classe que implementa `CepAddressProvider`, usando o `limitedFetch` para limite, timeout e log de falha.
2. Troque a instância em `src/index.ts`.

O caso de uso, o catálogo de erros e as rotas não mudam.

---

## 3. Estrutura de Diretórios

```text
bc_giross/
├── .github/workflows/        # CI: lint, typecheck, format e testes em todo PR
├── data/                     # base de CEPs (ceps.csv.gz), removidos e relatório
├── docs/                     # guias técnicos e registro de decisões
├── prisma/                   # schema e migrations
├── scripts/
│   ├── build-dataset/        # gera a base a partir dos ZIPs do CNEFE
│   └── seed/                 # carrega a base no Postgres (COPY)
├── src/
│   ├── domain/
│   │   ├── cep/              # normalização, centróide, p90 e vizinhos
│   │   └── geo/              # Haversine e bounding box
│   ├── application/
│   │   ├── use-cases/        # findNearbyCeps e a porta CepRepository
│   │   ├── cache/            # porta Cache, chaves e clearCache
│   │   ├── errors/           # AppError e subclasses
│   │   └── providers/        # portas de CEP e geocoding e seus decorators
│   ├── infrastructure/
│   │   ├── cache/            # RedisCache
│   │   ├── db/               # Prisma
│   │   ├── http/             # BrasilAPI, Nominatim e limitedFetch
│   │   ├── openapi/          # leitura do openapi.yaml
│   │   └── rate-limit/       # WindowRateLimiter
│   ├── presentation/http/
│   │   ├── routes/           # só os Routers
│   │   ├── middlewares/      # rate limit, Bearer e error handler
│   │   ├── errors/           # catálogo, HTTP_ERRORS e sendError
│   │   └── mappers/          # tradução para o contrato em português
│   ├── config/               # validação do env com Zod
│   └── index.ts              # composição (composition root)
├── tests/
│   ├── contract/             # respostas validadas contra o openapi.yaml
│   └── fakes/                # InMemoryCache
└── openapi.yaml              # fonte da verdade do contrato
```

---

## 4. Princípios

- **Dependências só para baixo:** `domain` ← `application` ← `infrastructure` e `presentation`. A regra não é só convenção: o ESLint (`no-restricted-imports` por pasta) falha o `npm run lint` quando uma camada importa outra que não pode, inclusive o client do Prisma fora da infraestrutura.
- **DRY:** cada regra existe num lugar só. Limite, timeout e log das chamadas externas ficam no `limitedFetch`; o `toRad` é um só para o Haversine e o bounding box; a deduplicação dos pontos de um CEP acontece só no `assessCep`; o header do CSV (`DATASET_HEADER`) é compartilhado entre o gerador e o seed; os status HTTP dos erros existem só no catálogo.
- **KISS:** a solução usa a peça mais simples que resolve. Postgres puro com bounding box e Haversine, sem PostGIS (D3); rate limits em memória, por processo, sem coordenação distribuída (D22); uma tabela `HTTP_ERRORS` em vez de uma classe por erro da borda; sem helper genérico de cache quando ele pioraria a leitura.
- **Responsabilidade única:** a rota só faz HTTP, o mapper só traduz o contrato, o caso de uso só orquestra, e o domínio só calcula.
- **Aberto para extensão:** um provider novo é um adaptador novo da mesma porta (seção 2).
- **Composição interna em processo:** um fluxo que precise de outro chama o caso de uso direto, nunca HTTP para a própria API, para não contar o rate limit duas vezes nem gastar a vaga dos providers (D30).

---

## 5. Tratamento de Erros

- **Erros de negócio** são subclasses de `AppError` com um `kind` estável em inglês (`cep_not_found`, `cep_out_of_coverage`...). O `ERROR_CATALOG` traduz cada `kind` em `{ status, codigo, mensagem }`, e um teste garante que todo `kind` tem entrada.
- **Erros da borda HTTP** (`401`, `404` de rota, `400` genérico, `429`, `500`) ficam na tabela `HTTP_ERRORS`, porque nenhum caso de uso os lança.
- **Um único error middleware** monta `{ erro: { codigo, mensagem } }`. Erro desconhecido vira `500 ERRO_INTERNO`, com log e sem stack na resposta.

| Status | `codigo` | Quando |
| --- | --- | --- |
| 400 | `CEP_INVALIDO` | `:cep` fora do formato `00000000`/`00000-000` |
| 400 | `PARAMETRO_INVALIDO` | `pagina` ou `limite` inválidos, ou requisição malformada |
| 401 | `NAO_AUTORIZADO` | token ausente ou inválido nos endpoints de limpeza de cache |
| 404 | `CEP_NAO_ENCONTRADO` | nem a base nem a BrasilAPI encontram o CEP |
| 404 | `NAO_ENCONTRADO` | rota ou método inexistente (inclui a limpeza de cache desligada) |
| 422 | `CEP_FORA_DA_COBERTURA` | o CEP existe, mas a UF dele não foi carregada na base |
| 422 | `CEP_SEM_GEOLOCALIZACAO` | o CEP existe e a UF está carregada, mas nem a base nem o Nominatim dão a coordenada |
| 429 | `LIMITE_EXCEDIDO` | mais de `RATE_LIMIT_MAX` requisições do mesmo IP na janela |
| 503 | `CACHE_INDISPONIVEL` | Redis fora do ar durante a limpeza de cache |
| 503 | `PROVEDOR_INDISPONIVEL` | CEP fora da base e a BrasilAPI ou o Nominatim fora do ar, com timeout ou sem vaga no limite |
| 500 | `ERRO_INTERNO` | erro inesperado (sem detalhes na resposta) |

O mesmo contrato, com exemplos, está em `/docs` e no [`openapi.yaml`](../openapi.yaml).

---

## 6. Observabilidade

- **Logs estruturados com Pino:** o `pino-http` registra cada requisição (método, rota, status, tempo). Falhas de Redis, BrasilAPI e Nominatim viram `warn` com o contexto (CEP, URL), e erros inesperados viram `error` com o stack.
- **Segredos fora do log:** o `redact` do logger oculta o header `Authorization`.
- **Healthcheck:** `GET /saude` responde `{ "status": "ok" }` sem checar banco, cache nem providers; diz só que o processo atende HTTP.
