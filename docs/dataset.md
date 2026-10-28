# Base de CEPs e Busca no Raio

Este documento descreve de onde vêm as coordenadas dos CEPs, como a base é gerada e carregada, e a estratégia para encontrar os CEPs num raio, com o trade-off entre precisão e performance.

---

## 1. Por que uma Base Própria

Nenhuma API pública responde "quais CEPs existem a X km de um ponto". As alternativas avaliadas (D4):

| Alternativa | Resultado |
| --- | --- |
| Geocodificar CEPs "vizinhos" pela numeração | Descartada: a numeração de CEP não é espacial e geraria milhares de chamadas |
| Geocodificação reversa em grade | Descartada: lenta, incompleta e limitada a 1 req/s (Nominatim) |
| Overpass (OSM) `around:1000` com `addr:postcode` | Descartada: achou **58 CEPs contra 174** do CNEFE no mesmo ponto (Vila Olímpia/SP), e o servidor público recusou 2 de 3 requisições |
| API do IBGE | Não existe busca espacial no CNEFE, só download de arquivos |
| **CNEFE 2022 pré-processado** | **Escolhida** |

O **CNEFE 2022** (Cadastro Nacional de Endereços para Fins Estatísticos, do IBGE) traz a coordenada de cada endereço do Censo, com o CEP. Agregado por CEP, ele dá a posição do CEP com mais precisão do que as APIs de CEP: a BrasilAPI, por exemplo, devolve a coordenada do **município** na maioria dos casos (todos os CEPs de SP testados voltaram em -23.5475, -46.63611), e por isso a coordenada dela não é usada (D12).

**Validação (25 CEPs de São Paulo e São Carlos, centróide do CNEFE contra a AwesomeAPI):** 16 ficaram a até 50 m, 5 entre 50 e 250 m, 1 a 700 m (rua longa) e 3 a 2 km ou mais. Dos 3 maiores desvios, 2 eram erro da AwesomeAPI e 1 era CEP sujo no CNEFE.

---

## 2. Geração da Base (`build-dataset`)

```
27 ZIPs do CNEFE (~3,7 GB, ~19 GB em CSV)
        │  npm run build-dataset -- --pasta <dir>   (streaming, uma UF por vez)
        ▼
  agrupa por CEP ──▶ só precisão 1–4 ──▶ pontos únicos ──▶ centróide + p90
        │
        ├──▶ data/ceps.csv.gz        898.455 CEPs, 8,2 MB  (cep;uf;latitude;longitude)
        ├──▶ data/ceps-removidos.csv 33.022 CEPs "sujos"
        └──▶ data/relatorio.md       totais por UF, removidos e tempo
```

- **Ponto do CEP:** a média dos **pontos únicos** dos endereços com precisão de 1 a 4 (`NV_GEO_COORD`). Endereços com a mesma coordenada (os apartamentos de um prédio) contam uma vez; precisão de localidade ou setor (5 e 6) é descartada.
- **CEPs sujos:** no CNEFE de SP, o CEP `01001000` (Praça da Sé) aparece em ~7 mil endereços espalhados pela cidade, porque foi usado como valor padrão. Um CEP cujo p90 (a distância ao centróide dentro da qual ficam 90% dos pontos únicos) passa de 2 km fica fora da base e vai para `ceps-removidos.csv`. Como origem, ele cai no fallback externo (ver [Origem e Fallback](./geocoding.md)).
- **Brasil inteiro no git:** o CSV compactado tem 8,2 MB, então cabe no repositório sem LFS. O script é rodado uma vez pelo mantenedor, a partir dos ZIPs numa pasta local; quem avalia só sobe o compose.

---

## 3. Carga no Postgres (`seed`)

- Lê o `ceps.csv.gz` em streaming, filtra pelas UFs de `SEED_UFS` e carrega via `COPY` (`pg` + `pg-copy-streams`; o Prisma não tem `COPY`).
- Tudo numa transação: `TRUNCATE cep, loaded_uf`, `COPY`, as UFs carregadas em `loaded_uf` e `COMMIT`. A API nunca vê a base pela metade, e o seed pode rodar várias vezes.
- Ao terminar, apaga o cache de resultados (`result:*`). Sem o Redis, ele carrega a base e avisa que não limpou o cache.

```prisma
model Cep {
  cep       String @id @db.Char(8)
  uf        String @db.Char(2)
  latitude  Float  @db.DoublePrecision
  longitude Float  @db.DoublePrecision
  @@index([latitude, longitude])
}
```

Latitude e longitude são `double precision`, nunca `numeric`: comparação nativa da CPU, 8 bytes fixos e `number` no JS, com ~15 dígitos para as 6 casas do CSV (~0,11 m).

---

## 4. Estratégia da Busca no Raio

```
origem (lat, lon)
   │
   ├─▶ 1. bounding box: caixa que contém o círculo de 1 km
   │      (dLat = raio / 111,195 km; dLon = dLat / cos(lat))
   │
   ├─▶ 2. Postgres: latitude BETWEEN … AND longitude BETWEEN …  (índice composto)
   │
   ├─▶ 3. domínio: Haversine exato de cada candidato, mantém ≤ raio
   │
   └─▶ 4. ordena por distância (desempate por CEP), arredonda só na saída
```

1. **Pré-filtro no banco:** a caixa é calculada com margem só para fora, então nenhum CEP do círculo fica de fora. O índice `(latitude, longitude)` restringe pela faixa de latitude, estreita num raio de 1 km.
2. **Distância exata na aplicação:** o Haversine (R = 6371,0088 km) roda no domínio, testado contra distâncias conhecidas. O filtro usa a distância exata: um CEP a 1,004 km fica fora, mesmo que a saída arredondada fosse `1.00`.
3. **Saída:** a lista inteira é ordenada e vai para o cache; `pagina` e `limite` só cortam essa lista.

**Por que não PostGIS (D3):** o Prisma não suporta os tipos geográficos do PostGIS, o que obrigaria a usar SQL cru, e a corretude da distância é critério de avaliação: com Haversine no domínio, o cálculo fica visível e testável. Com ~900 mil CEPs, a bounding box com índice resolve em milissegundos. O PostGIS (`ST_DWithin` com GiST) é o passo natural para raios grandes, buscas por polígono ou volumes muito maiores.

---

## 5. Trade-off entre Precisão e Performance

| Escolha | Ganho | Custo |
| --- | --- | --- |
| Um ponto por CEP (centróide) | busca rápida, base de 8,2 MB | um CEP é uma área: a distância é entre centróides, não entre endereços |
| Precisão 1–4 e pontos únicos | o centróide não é puxado por prédios grandes | CEP só com coordenada de setor fica fora da base |
| Corte de p90 > 2 km | tira CEPs "sujos" que poluiriam o raio | ~2% dos CEPs de SP ficam fora da base (como origem, vão ao fallback) |
| Base do Censo 2022 | cobertura nacional, sem API externa no caminho quente | CEP criado depois de 2022 não aparece como vizinho |
| Bounding box + Haversine | consulta indexada e cálculo exato | depende de um raio pequeno; raios grandes pediriam PostGIS |
| Resultado em cache por 24 h | repetição sem tocar o banco | ocupa memória do Redis (ver [Cache](./cache.md)) |
