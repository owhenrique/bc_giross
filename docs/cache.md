# Cache (Redis)

Este documento descreve o que entra no cache, os TTLs e a justificativa de cada um, o comportamento com o Redis fora do ar e a limpeza manual.

---

## 1. Visão Geral

O cache fica no Redis, com `maxmemory` de 256 MB, política `allkeys-lru` e sem persistência. A aplicação usa a porta `Cache` (`RedisCache` em produção, `InMemoryCache` só nos testes).

```
GET /ceps-proximos/:cep
   │
   ├─▶ result:<raio>:<cep> ── hit ──▶ pagina a lista em cache (sem banco, sem APIs)
   │        │
   │       miss
   │        ▼
   │   base (Postgres) ──▶ grava result:<raio>:<cep>
   │        │
   │   CEP fora da base
   │        ▼
   ├─▶ address:<cep> ── miss ──▶ BrasilAPI
   └─▶ geocode:<cep> ── miss ──▶ Nominatim
```

| Chave | Conteúdo | TTL |
| --- | --- | --- |
| `result:<raio>:<cep>` | origem + lista inteira de vizinhos, ordenada | 24 h |
| `address:<cep>` | lookup da BrasilAPI: encontrado / não encontrado | 30 d / 1 h |
| `geocode:<cep>` | coordenada do Nominatim / "sem match" | 30 d / 1 h |

- **Paginação sobre o cache:** `pagina` e `limite` não entram na chave; saem da lista inteira. O raio entra, porque pode mudar por env.
- **Indisponibilidade nunca entra no cache:** BrasilAPI ou Nominatim fora do ar não grava nada, e a chamada seguinte tenta de novo.
- **O desfecho de erro (`404`/`422`) não é guardado:** só o lookup da BrasilAPI. A repetição ainda consulta o banco.
- **O endereço não faz parte do resultado:** a rota simples e o `/detalhes` usam a mesma chave `result:`, e o endereço vem de `address:`.

---

## 2. TTLs

Longos o bastante para poupar o banco e as APIs externas, curtos o bastante para não servir dado velho nem ocupar o Redis com CEP que ninguém consulta mais (D20).

- **Endereço e coordenada encontrados (30 d):** rua, bairro e coordenada de um CEP quase nunca mudam. Cada miss custa uma chamada externa com limite (BrasilAPI a 5 req/s; Nominatim a 1 req/s, cuja política exige cache), e cada chave ocupa ~200 bytes. Para corrigir antes do prazo: `DELETE /cache/:cep`.
- **Resultado (24 h):** a lista de vizinhos sai da base (CNEFE 2022), que só muda num seed novo, e o seed já apaga essas chaves. Aqui o TTL não evita dado velho, só controla a memória. Os CEPs que voltam todo dia ficam em cache e são recalculados no máximo uma vez por dia, só com consultas indexadas ao banco; os consultados uma vez saem no dia seguinte.
- **Não encontrado e sem match (1 h):** segura as repetições de um mesmo CEP sem prender por muito tempo um CEP ou uma rua que acabaram de surgir, nem um falso `404`, que a BrasilAPI pode devolver quando um serviço interno dela cai.

**Conta do resultado** (raio de 1 km, sobre os 898.455 CEPs da base):

| | Brasil | Capital paulista |
| --- | --- | --- |
| Vizinhos por CEP (média · máximo) | 115 · 971 | 171 · 437 |
| Resultado no Redis (média) | ~6,5 KB | ~9,6 KB |
| Todos os resultados | ~5,5 GB | ~430 MB |
| Cabem nos 256 MB do Redis | ~40 mil | ~27 mil |

Com 10 mil origens novas por dia na capital, os resultados ocupam ~90 MB com 24 h e passariam dos 256 MB com um TTL de 3 d ou mais. Acima dos 256 MB, o `allkeys-lru`, que despeja pela ordem de uso sem saber o custo, tiraria também endereços e coordenadas, que custam uma chamada externa, para guardar resultados que o banco recalcula.

---

## 3. Redis Fora do Ar

- **API:** sobe sem esperar o Redis e segue respondendo, só sem cache. Cada falha ou timeout (500 ms) vira log `warn` e miss. Quando o Redis volta, o cliente reconecta sozinho, sem reiniciar a API.
- **Seed:** carrega a base, avisa que não limpou o cache de resultados e termina com sucesso. Resultados da base anterior que sobrarem saem pelo TTL (24 h) ou por um `DELETE /cache`; o Redis do compose não tem persistência e volta vazio depois de cair.
- **Compose:** a `api` não depende do Redis, e o `seed` o tem como dependência opcional.
- **Rate limits:** não dependem do Redis (ver [Rate Limit](./rate-limit.md)).

---

## 4. Limpeza Manual

Dois endpoints protegidos por token, para forçar dados atualizados sem reiniciar a API (D21). Ficam ligados só quando `CACHE_ADMIN_TOKEN` está definido (mínimo de 12 caracteres; menos que isso faz a API falhar ao subir). Vazio ou ausente, eles respondem `404 NAO_ENCONTRADO`, como qualquer rota inexistente.

```bash
export TOKEN=troque-por-um-token-longo
curl -X DELETE -H "Authorization: Bearer $TOKEN" localhost:3000/cache
curl -X DELETE -H "Authorization: Bearer $TOKEN" localhost:3000/cache/04551000
```

- **`DELETE /cache`:** apaga todas as chaves `result:*`, `address:*` e `geocode:*`. Outras chaves do Redis ficam (`FLUSHDB` foi descartado por isso).
- **`DELETE /cache/:cep`:** apaga `address:<cep>`, `geocode:<cep>` e `result:<raio atual>:<cep>`.
- **Autenticação:** `Authorization: Bearer <token>`, comparado em tempo constante (`timingSafeEqual` sobre o `sha256` dos dois lados). Sem header, com outro esquema ou com token errado: `401 NAO_AUTORIZADO` com `WWW-Authenticate: Bearer`, antes da validação do CEP.
- **Respostas:** `204` sem corpo (idempotente), `400 CEP_INVALIDO`, `401 NAO_AUTORIZADO`, `404 NAO_ENCONTRADO` (desligados) e `503 CACHE_INDISPONIVEL` (Redis fora; a limpeza pode ter sido parcial, e repetir é seguro).
- **Limitação:** o `DELETE /cache/:cep` não tira o CEP das listas de vizinhos de outros CEPs. Essas listas saem por TTL (24 h) ou por um `DELETE /cache`.
