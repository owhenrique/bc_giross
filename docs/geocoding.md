# Origem, Endereço e Fallback (BrasilAPI e Nominatim)

Este documento descreve como a API chega à coordenada e ao endereço do CEP de origem, e o que acontece quando o CEP não está na base ou os serviços externos falham.

---

## 1. Fluxo da Origem

```
CEP de origem
   │
   ├─ está na base? ──sim──▶ coordenada do CNEFE (fonte "base")
   │                          └─ /detalhes busca o endereço na BrasilAPI
   │
   └─ não ──▶ BrasilAPI v2 (rua, bairro, cidade, UF)
                 ├─ não encontrado ────────────────▶ 404 CEP_NAO_ENCONTRADO
                 ├─ fora do ar / timeout / limite ─▶ 503 PROVEDOR_INDISPONIVEL
                 └─ encontrado
                       ├─ UF não carregada ────────▶ 422 CEP_FORA_DA_COBERTURA
                       ├─ sem rua, cidade ou UF ───▶ 422 CEP_SEM_GEOLOCALIZACAO
                       └─ Nominatim (rua + cidade)
                             ├─ candidato com cidade e UF iguais ─▶ coordenada (fonte "nominatim")
                             ├─ nenhum candidato válido ──────────▶ 422 CEP_SEM_GEOLOCALIZACAO
                             └─ fora do ar / limite ──────────────▶ 503 PROVEDOR_INDISPONIVEL
```

- **Base primeiro (D11):** os vizinhos saem do CNEFE, e usar a mesma fonte para a origem evita deslocar o centro do raio por diferença de metodologia.
- **A rota simples não chama a BrasilAPI** quando o CEP está na base. O `/detalhes` chama, para trazer o endereço.
- **BrasilAPI fora do ar com o CEP na base (D29):** o `/detalhes` responde os vizinhos com `origem.endereco: null`, porque a base é a fonte da coordenada.

---

## 2. BrasilAPI v2: Dados Cadastrais

- Usada só para rua, bairro, cidade e UF (D12). A coordenada dela é a do município na maioria dos casos e é ignorada.
- **ViaCEP descartado:** responde `400` em HTML para formato inválido e `200` com `{"erro": "true"}` para CEP inexistente. A BrasilAPI v2 responde `404` em JSON tipado.
- **`404` ambíguo:** o `404` da BrasilAPI lista o erro de cada serviço interno dela, que pode estar só fora do ar. Por isso o `404` vale como "não encontrado" apenas se algum item de `errors[]` disser "não encontrado"; senão, é indisponibilidade (`503`). O cache de "não encontrado" dura só 1 h pelo mesmo motivo.
- Timeout de 3 s, sem retry (D23), e limite de 5 req/s.

---

## 3. Nominatim: Fallback de Coordenada

Entra só para CEP fora da base, de UF carregada: um CEP novo ou um "sujo" removido pelo `build-dataset`.

- **Busca estruturada** por `street` e `city`, com `countrycodes=br`, `addressdetails=1` e `limit=5`. O parâmetro `state` do Nominatim espera o nome do estado, não a UF, então a UF é validada depois.
- **Validação:** o candidato só vale se a cidade (`city`/`town`/`village`/`municipality`) e a UF (`ISO3166-2-lvl4`, `BR-SP` → `SP`) baterem com as da BrasilAPI, sem acento, sem diferença de maiúsculas e sem espaços extras. Vale o primeiro que bater, o que resolve o caso de uma rua homônima em outra cidade.
- **Sem rua na BrasilAPI** (CEP geral de cidade pequena): `422` sem consultar o Nominatim, porque o centro da cidade deixaria o raio de ~1 km sem sentido.
- **Política de uso do Nominatim público:** no máximo **1 req/s**, `User-Agent` identificado (`NOMINATIM_USER_AGENT`) e cache dos resultados. Uso pesado pode levar a bloqueio; `NOMINATIM_URL` permite apontar para uma instância própria.

**Validação com os mesmos 25 CEPs (endereço da BrasilAPI → Nominatim, comparado ao centróide do CNEFE):**

| Distância do CNEFE | CEPs |
| --- | --- |
| ≤ 50 m | 13 |
| 50 – 250 m | 4 |
| 250 m – 1 km | 3 (ruas longas) |
| 1 – 5 km | 2 (Av. Paulista, com 2,8 km; e `01001000`, em que o Nominatim acertou a Praça da Sé) |
| > 30 km | 2 (homônimo em outra cidade, barrado pela validação de cidade/UF) |
| sem resultado | 1 |

A busca direta por CEP no Nominatim (`postalcode`) achou só 7 de 25, porque a cobertura de CEP no OSM é baixa.

---

## 4. AwesomeAPI: Descartada

A AwesomeAPI foi a referência de coordenada na validação do CNEFE, mas bloqueou o IP com `429 QuotaExceeded` depois de ~30 chamadas, com um limite que não está documentado. Isso a inviabiliza como fallback confiável.

---

## 5. Isolamento dos Providers

Cada provider é um adaptador de uma porta da aplicação (`CepAddressProvider` e `Geocoder`) e só monta a URL e interpreta a resposta. O `limitedFetch` concentra o resto:

- **limite:** sem vaga no `WindowRateLimiter`, a chamada não sai e conta como indisponível;
- **timeout:** `AbortSignal.timeout` de 3 s;
- **log de falha:** `warn` com o serviço e a URL.

O caso de uso recebe só `found`, `not_found` ou `unavailable` e nunca vê status HTTP nem formato de erro dos serviços. Ver [Arquitetura](./architecture.md#2-ports-and-adapters).
