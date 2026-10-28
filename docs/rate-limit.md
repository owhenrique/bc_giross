# Rate Limit

Este documento descreve os dois limites da API, o de entrada (clientes da nossa API) e o de saída (BrasilAPI e Nominatim), como cada um guarda os dados e os trade-offs (D22).

---

## 1. Visão Geral

```
cliente ──▶ [entrada: 60 req/min por IP] ──▶ caso de uso ──▶ [saída: 5 req/s] ──▶ BrasilAPI
                     │                                    └─▶ [saída: 1 req/s] ──▶ Nominatim
                  429 LIMITE_EXCEDIDO                              │
                                                       sem vaga = provider indisponível
```

Os dois limites contam em memória, por processo, e não dependem do Redis.

---

## 2. Entrada

- **60 req/min por IP** (`RATE_LIMIT_MAX` e `RATE_LIMIT_WINDOW_SECONDS`), em todas as rotas, com `express-rate-limit`. Passou do limite: `429 LIMITE_EXCEDIDO` com `Retry-After`.
- **Headers:** toda resposta traz `RateLimit` e `RateLimit-Policy` (IETF draft-8); os legados `X-RateLimit-*` não são enviados. Requisições que recebem `429` também contam na janela.
- **Memória:** o store padrão da lib guarda um contador por IP, em janela fixa, com ~205 bytes por IP (medido com 100 mil IPs). A cada janela, os IPs que não voltaram são descartados, então a memória fica nos IPs distintos das últimas ~2 janelas: 10 mil IPs ≈ 2–4 MB. IPv6 conta por sub-rede /56.
- **Atrás de proxy:** `TRUST_PROXY` é repassada ao `trust proxy` do Express e vem desligada. Sem ela, todos os clientes atrás do mesmo proxy dividem um contador. Prefira o número de saltos (`TRUST_PROXY=1`); `true` confia em qualquer `X-Forwarded-For`.
- **Uma contagem por requisição:** o middleware pula quando `req.rateLimit` já existe, e a composição interna chama o caso de uso em processo, nunca HTTP para a própria API (D30).

---

## 3. Saída

- **BrasilAPI 5 req/s e Nominatim 1 req/s**, com o `WindowRateLimiter`, em janela deslizante. Cada provider tem o seu, que guarda só os timestamps das chamadas da janela (no máximo 5 e 1).
- **Sem vaga, a chamada não sai** e o provider conta como indisponível: `503 PROVEDOR_INDISPONIVEL` para CEP fora da base e `origem.endereco: null` no `/detalhes` de CEP na base. A cota é com o terceiro, então o erro é de indisponibilidade, e não `429`.
- O limite de cada provider está só no default dele: `new WindowRateLimiter(5, 1000)` e `new WindowRateLimiter(1, 1000)`.

---

## 4. Trade-offs

- **Limite por processo:** com N réplicas, a entrada vira N × 60/min por IP, e o Nominatim, cuja política pede 1 req/s no total, receberia até N req/s. O compose sobe uma réplica.
- **Janela fixa na entrada:** um cliente consegue até 2 vezes o limite em poucos segundos, na virada da janela. A janela deslizante custaria até 4 vezes mais memória por IP (medido).
- **Por que o `WindowRateLimiter` não serve para a entrada:** ele guarda um timestamp por chamada (até ~830 bytes por IP a 60 req/min) e não descarta IPs parados.
- **Volume de ataque:** precisa ser barrado antes da API, num proxy ou WAF.
