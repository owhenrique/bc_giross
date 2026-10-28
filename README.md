# bc-giross — CEPs Próximos

API que recebe um CEP e devolve os CEPs num raio de 1 km, cada um com a distância até a origem. A base (`data/ceps.csv.gz`, 898.455 CEPs do Brasil com latitude e longitude) vem do CNEFE 2022 do IBGE e é carregada no Postgres por um seed.

```bash
cp .env.example .env
docker compose up --build
curl localhost:3000/ceps-proximos/04551-000
```

## 📚 Documentação Técnica

- **[Guia Rápido (Getting Started)](./docs/getting-started.md)**: como rodar com Docker ou localmente, variáveis de ambiente, endpoints e testes.
- **[Arquitetura](./docs/architecture.md)**: camadas, ports and adapters, estrutura de pastas, princípios, erros e observabilidade.
- **[Base de CEPs e Busca no Raio](./docs/dataset.md)**: por que uma base própria, como ela é gerada e a estratégia do raio, com o trade-off entre precisão e performance.
- **[Origem e Fallback](./docs/geocoding.md)**: BrasilAPI para o endereço, Nominatim como fallback de coordenada e o tratamento de cada falha.
- **[Cache](./docs/cache.md)**: chaves no Redis, TTLs e a justificativa de cada um, Redis fora do ar e limpeza manual.
- **[Rate Limit](./docs/rate-limit.md)**: limite de entrada por IP e limites de saída para a BrasilAPI e o Nominatim.
- **[CI e Docker](./docs/ci.md)**: pipeline do GitHub Actions, testes e containers.
- **[Registro de Decisões](./docs/DECISOES.md)**: todas as decisões, com contexto, alternativas e o porquê.

---

## O problema

> **Business Case – Desenvolvedor Fullstack Jr.**
>
> A Giross precisa localizar regiões de entrega próximas a um CEP de referência (ex.: para agrupar entregas de uma mesma área ou avaliar a cobertura de uma nova praça).

**Desafio:** construir uma API REST em Node.js (sem front-end) que receba um CEP e devolva todos os CEPs num raio de 1 km, cada um com a distância calculada até o CEP de origem.

### Requisitos funcionais

1. Endpoint `GET /ceps-proximos/:cep`.
2. Buscar a geolocalização (lat/lng) do CEP informado usando uma API pública ou uma base própria, com a decisão justificada no README.
3. A partir da lat/lng do CEP de origem, encontrar os demais CEPs num raio de 1 km.
4. Calcular a distância entre o CEP de origem e cada CEP encontrado.
5. Retornar uma lista ordenada pela distância, com `cep` e `distancia_km` (2 casas decimais) de cada um.

### Cache

- Cache do geocoding de um CEP já consultado e do resultado da busca no raio para uma origem já processada.
- Cache em memória é aceitável; Redis é diferencial.
- Definir e justificar um TTL razoável no README.

### Requisitos técnicos

- Node.js (Express, Fastify ou similar).
- Tratamento de erros: CEP inválido, CEP inexistente e indisponibilidade da API externa.
- README explicando a estratégia para "buscar CEPs num raio" e o trade-off entre precisão e performance.

### Diferenciais

Redis para o cache, rate limiting para a API externa de geocoding, endpoint para limpar o cache manualmente e Dockerfile.

### Critérios de avaliação

Corretude do cálculo de distância, estratégia para localizar CEPs próximos, eficácia do cache, qualidade e legibilidade do código e tratamento de casos de borda.

### Como a solução atende

| Requisito | Onde |
| --- | --- |
| `GET /ceps-proximos/:cep`, ordenado, com `distancia_km` | rota enxuta e `/detalhes` com origem e endereço ([Guia Rápido](./docs/getting-started.md#5-endpoints)) |
| Geolocalização justificada | base própria do CNEFE, com fallback BrasilAPI → Nominatim ([Origem e Fallback](./docs/geocoding.md)) |
| Raio e distância | bounding box no Postgres + Haversine no domínio, testado contra distâncias conhecidas ([Base de CEPs](./docs/dataset.md#4-estratégia-da-busca-no-raio)) |
| Cache e TTL justificado | Redis: endereço e coordenada 30 d, resultado 24 h, não encontrado 1 h ([Cache](./docs/cache.md#2-ttls)) |
| Erros | `400`, `404`, `422`, `503` e `500` com `{ erro: { codigo, mensagem } }` ([Arquitetura](./docs/architecture.md#5-tratamento-de-erros)) |
| Diferenciais | Redis, rate limit de entrada e de saída, `DELETE /cache` com token e Docker Compose |

---

## Estratégia: CEPs num raio

1. **Origem:** a coordenada do CEP sai da base. Fora dela, a API busca o endereço na BrasilAPI e a coordenada no Nominatim.
2. **Pré-filtro no banco:** uma *bounding box* que contém o círculo de 1 km, consultada com índice em `(latitude, longitude)`.
3. **Distância exata:** Haversine sobre cada candidato da caixa, mantendo só os que ficam a ≤ 1 km. O arredondamento a 2 casas acontece só na saída.
4. **Cache:** a lista inteira, ordenada, fica no Redis por 24 h, e a paginação sai dela.

**Precisão × performance:** cada CEP é representado por um ponto, a média dos endereços dele no CNEFE. Isso deixa a busca em milissegundos e a base em 8,2 MB, mas um CEP é uma área, e a distância é entre centróides. CEPs com endereços espalhados por mais de 2 km (p90) ficam fora da base, para não poluir o raio. O PostGIS seria o passo para raios maiores ou buscas por polígono. Detalhes em [Base de CEPs e Busca no Raio](./docs/dataset.md#5-trade-off-entre-precisão-e-performance).

---

## Principais decisões

- **Base própria do CNEFE 2022 (D4):** nenhuma API pública responde "quais CEPs existem a X km". O CNEFE traz a coordenada de cada endereço do Censo, e o centróide por CEP ficou a até 50 m da referência em 16 de 25 CEPs testados. No mesmo ponto em que o CNEFE achou 174 CEPs no raio, o Overpass (OSM) achou 58.
- **A coordenada da BrasilAPI não é usada (D12):** na maioria dos casos ela é o centro do município (todos os CEPs de SP testados voltaram na mesma coordenada). A BrasilAPI fica só com rua, bairro, cidade e UF.
- **AwesomeAPI descartada (D11):** bloqueou o IP com `429` depois de ~30 chamadas, com um limite não documentado.
- **Nominatim como fallback, com limite (D11):** só para CEP fora da base. A política do Nominatim público exige no máximo 1 req/s, `User-Agent` identificado e cache, e o resultado só vale se a cidade e a UF baterem com as da BrasilAPI.
- **TTLs pela memória (D20):** endereço e coordenada mudam pouco e custam chamadas externas limitadas (30 d); o resultado só muda num seed novo, e o TTL de 24 h controla a memória do Redis de 256 MB.

O registro completo, com contexto e alternativas descartadas, está em [`docs/DECISOES.md`](./docs/DECISOES.md).

---

## Arquitetura

```
presentation  ──▶  application  ──▶  domain
(Express, rotas,   (casos de uso,    (Haversine, bounding box,
 mappers, erros)    portas)           centróide, vizinhos)
                        ▲
infrastructure ─────────┘
(Prisma, Redis, BrasilAPI, Nominatim)
```

- **Camadas:** apresentação → aplicação → domínio, com a infraestrutura implementando as portas da aplicação. Cada camada só importa as de baixo, e o ESLint barra o import proibido.
- **Ports and adapters:** o caso de uso depende de `CepRepository`, `Cache`, `CepAddressProvider` e `Geocoder`. Postgres, Redis, BrasilAPI e Nominatim são adaptadores trocáveis, e os testes usam fakes. Um terceiro provider de CEP é uma classe nova e uma linha na composição.
- **DRY:** cada regra num lugar só: limite, timeout e log das chamadas externas no `limitedFetch`, status HTTP dos erros só no catálogo, deduplicação dos pontos só no `assessCep`.
- **KISS:** a peça mais simples que resolve: Postgres puro em vez de PostGIS, rate limit em memória em vez de coordenação distribuída, uma tabela para os erros da borda HTTP.

Detalhes em [Arquitetura](./docs/architecture.md).

---

## Documentação live (Scalar)

Com a API no ar e `NODE_ENV` diferente de `production`:

- **`http://localhost:3000/docs`**: UI do Scalar, com todas as rotas, parâmetros, exemplos de resposta, erros e o esquema Bearer da limpeza de cache. Dá para testar as chamadas direto pelo navegador.
- **`http://localhost:3000/docs/openapi.json`**: o documento OpenAPI 3.1.

A fonte da verdade é o [`openapi.yaml`](./openapi.yaml), escrito à mão. Um teste de contrato valida as respostas da API contra ele, então o código e a documentação não divergem. Com `NODE_ENV=production`, as duas rotas respondem `404`.
