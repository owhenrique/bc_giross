# Histórias de usuário — API de CEPs próximos

Quebra do business case da Giross em histórias entregáveis. Cada uma vira uma spec, uma branch e um PR, com até 500 linhas de lógica. As decisões que valem para todas estão em [`DECISOES.md`](./DECISOES.md). O enunciado está em `../../docs/BC - Dev Fullstack.pdf`.

## Personas
- **Giross** (time de operações/logística, consumindo a API): consulta CEPs próximos a um CEP de referência.
- **Operador da API**: mantém o serviço no ar (cache, proteção contra abuso).
- **Mantenedor da API**: gera e audita a base de CEPs.

## Visão geral

| US | Título | Estimativa | Depende de |
| --- | --- | --- | --- |
| US1 | Base de CEPs com coordenadas | ~200 | — |
| US2 | Consultar CEPs próximos | ~370 | US1 |
| US3 | Endereço da origem e erros claros | ~200 | US2 |
| US4 | Cache | ~200 | US3 |
| US5 | Fallback de coordenada (Nominatim) | ~150 | US4 |
| US6 | Limpeza de cache protegida | ~80 | US4 |
| US7 | Rate limit da API | ~50 | US2 |

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

- Dado um CEP válido, então `origem.endereco` traz rua, bairro, cidade e UF da BrasilAPI v2.
- Dado que a BrasilAPI responde `404`, então `404 CEP inexistente`.
- Dado um CEP de UF não carregada, então `422 fora da cobertura`.
- Dado um CEP existente fora da base, então `422 sem geolocalização` (refinado na US5).
- Dado que a BrasilAPI está fora do ar ou estoura o timeout (3 s), com o CEP na base, então a lista vem com `origem.endereco: null`.
- As chamadas à BrasilAPI ficam limitadas a 5 req/s.

Fica para outra US: cache (US4), fallback Nominatim (US5).

## US4 — Cache
Como **Giross**, quero respostas rápidas para CEPs já consultados, para não esperar nem depender das APIs externas a cada chamada.

- Dado um CEP já consultado, então a segunda chamada não acessa o banco nem a BrasilAPI.
- TTLs: endereço 30 d, resultado 7 d, inexistente 1 h, configuráveis. O seed limpa o cache de resultados.
- Trocar de página usa a lista em cache.
- Redis no compose com `maxmemory` + `allkeys-lru`. Implementação em memória para os testes.

Fica para outra US: limpeza manual (US6).

## US5 — Fallback de coordenada (Nominatim)
Como **Giross**, quero resultados mesmo quando o CEP de referência não está na base, para não perder a consulta em CEPs novos ou mal cadastrados no Censo.

- Dado um CEP existente fora da base (ex.: `01001000`), então a coordenada vem do Nominatim, com `origem.fonte = "nominatim"`.
- Dado que o Nominatim devolve uma cidade ou UF diferente da BrasilAPI, então o resultado é rejeitado e a resposta é `422 sem geolocalização`.
- Limite de 1 req/s, `User-Agent` identificado e cache de 30 d.

## US6 — Limpeza de cache protegida
Como **operador da API**, quero limpar o cache manualmente, de forma protegida, para forçar dados atualizados sem reiniciar o serviço.

- `DELETE /cache` e `DELETE /cache/:cep`, com `Authorization: Bearer <CACHE_ADMIN_TOKEN>`. Token errado → `401`.
- Sem `CACHE_ADMIN_TOKEN`, os endpoints respondem `404`.

## US7 — Rate limit da API
Como **operador da API**, quero limitar as requisições por cliente, para proteger o serviço e as APIs externas de abuso.

- Mais de 60 req/min do mesmo IP → `429` em JSON com `Retry-After`. O contador fica no Redis e o limite é configurável.

---

## Fora do escopo
- Front-end.
- PostGIS e buscas por polígono (registrado como evolução no README).
- Download automático dos ZIPs do IBGE.
- Raio por query string (o raio é só por variável de ambiente).
