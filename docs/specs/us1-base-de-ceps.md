# US1 — Base de CEPs com coordenadas

Status: implementada (aguardando verificação)
Origem: `docs/HISTORIAS.md` (US1) · Decisões: D4, D5, D6, D7, D8, D9, D10, D25, D27, D28
Estimativa: ~200 linhas de lógica (limite: 500)

## História
Como **mantenedor da API**, quero uma base unificada de CEPs do Brasil com coordenadas e qualidade controlada, gerada de forma auditável a partir do CNEFE, para que a busca por proximidade cubra o país sem depender de download na hora de rodar.

## Critérios de aceite
1. Dado os ZIPs do CNEFE numa pasta local, quando rodo `npm run build-dataset -- --pasta <dir>`, então é gerado `data/ceps.csv.gz` com cabeçalho `cep;uf;latitude;longitude` e uma linha por CEP.
2. Dado um CEP com endereços de precisão 1–4 (`NV_GEO_COORD`), então a coordenada dele é a média dos pontos únicos (lat/lon distintos). Endereços de precisão 5 e 6 (localidade e setor) são ignorados.
3. Dado um CEP com espalhamento p90 > 2 km, então ele fica fora de `ceps.csv.gz` e entra em `data/ceps-removidos.csv`.
4. Dado o processamento concluído, então `data/relatorio.md` traz total de CEPs por UF, total removido (por UF) e tempo de execução.
5. Dado uma pasta sem ZIPs, ou sem `--pasta`, então o script sai com código ≠ 0 e mensagem clara.
6. A função Haversine existe no domínio, com testes contra distâncias conhecidas.

## Fora desta US
Carga no Postgres, endpoint, docker compose, Prisma (US2). Sem lógica de download.

## Decisões de implementação (assumidas, ajustáveis)
- **Formato do CNEFE** (verificado em `12_AC.zip`): CSV `;`, um arquivo por ZIP. Colunas usadas: `CEP` (9), `LATITUDE` (26), `LONGITUDE` (27), `NV_GEO_COORD` (28). Coordenadas em ponto decimal.
- **UF** vem do nome do ZIP (`35_SP.zip` → `SP`), sem tabela de código IBGE.
- **Leitura em streaming** (`unzip -p`/`yauzl` + `readline`): o CSV de SP tem 3,8 GB descompactado. Processa um ZIP por vez, agrupando por CEP só dentro da UF, guardando apenas lat/lon em `Float64Array`/arrays numéricos. Rodar com `NODE_OPTIONS=--max-old-space-size` ajustado no script npm.
- **p90**: distância de cada endereço (preci­são 1–4, repetidos incluídos) ao centróide dos pontos únicos; p90 por *nearest-rank*. Usar os endereços repetidos é o que o D7 mediu (a Praça da Sé tem ~7 mil endereços espalhados). Distância via Haversine do domínio.
- **Limiar**: `p90 > 2 km` remove; exatamente 2 km permanece. Constante nomeada, não variável de ambiente.
- **CEP em mais de uma UF** (não esperado): mantém a UF com mais pontos e registra aviso no relatório.
- **CEP malformado** (≠ 8 dígitos) ou sem coordenada válida: descartado e contado no relatório como "inválidos".
- **Saída determinística**: ordenada por `cep`; latitude/longitude com 6 casas decimais. Rodar duas vezes gera o mesmo conteúdo (sem timestamp dentro do `.csv.gz`; o tempo fica só no relatório).
- **CEP sem nenhum ponto de precisão 1–4**: não entra na base (sem contar como removido por espalhamento; conta como "sem precisão").

## Estrutura (D28: domínio puro, infraestrutura separada)
```
package.json, tsconfig.json, vitest.config.ts, eslint.config.js, .gitignore, .nvmrc (24)
src/domain/geo/haversine.ts            # haversineKm(a, b)
src/domain/cep/cep-centroid.ts         # centróide + p90 (funções puras)
scripts/build-dataset/
  index.ts                             # CLI: args, orquestra, escreve saídas
  read-cnefe.ts                        # stream ZIP → registros {cep, lat, lon, nv}
  report.ts                            # monta relatorio.md
data/ceps.csv.gz  data/ceps-removidos.csv  data/relatorio.md   # commitados (D10)
```
Scripts npm: `build-dataset`, `test`, `lint`, `typecheck`.

## Tarefas (um commit cada)
1. Esqueleto: Node 24, TypeScript, Vitest, ESLint, scripts npm, `.gitignore` (ignora `node_modules`, mantém `data/`).
2. Domínio: `haversineKm` + testes com distâncias conhecidas (ex.: Praça da Sé→Av. Paulista ≈ 2,6 km; São Paulo→Rio ≈ 358 km; pontos iguais = 0; antípodas ≈ 20.015 km).
3. Domínio: centróide dos pontos únicos e p90 + testes (únicos vs. repetidos, limiar 2 km, 1 ponto só).
4. Leitura em streaming do ZIP do CNEFE + testes com ZIP pequeno gerado em fixture.
5. CLI `build-dataset` (agregação por UF, filtros, escrita do gz/removidos/relatório) + teste ponta a ponta com fixture de 2 UFs.
6. Execução real com os 27 ZIPs de `cnefe-raw`, commit de `data/*` e registro do tamanho real no D9 (hoje "~15 MB, a confirmar").

## Testes
- Unit: Haversine, centróide, p90, parsing de linha.
- Integração: fixture com ZIPs mínimos cobrindo: precisão 5/6 ignorada, ponto duplicado, CEP sujo removido, CEP sem precisão válida, ordenação e idempotência da saída.
- Manual: rodar nos 27 ZIPs; conferir que `01001000` está em `ceps-removidos.csv` e que o total fica próximo de 931 mil CEPs menos os removidos.

## Riscos
- **Memória/tempo em SP e MG**: mitigado pelo processamento por UF e arrays numéricos; se estourar, particionar por prefixo de CEP.
- **Tamanho do `ceps.csv.gz`**: se passar de ~50 MB, reavaliar (D9 estima ~15 MB).
- **Teto de 500 linhas**: leitura de ZIP em streaming é o ponto que mais pode crescer; usar dependência (`yauzl`) em vez de código próprio.
