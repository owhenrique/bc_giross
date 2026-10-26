export interface UfStats {
  total: number;
  removed: number;
  invalid: number;
  noPrecision: number;
}

export interface ReportData {
  byUf: Map<string, UfStats>;
  warnings: string[];
  seconds: number;
}

export function buildReport({ byUf, warnings, seconds }: ReportData): string {
  const ufs = [...byUf.keys()].sort();
  const sum = (field: keyof UfStats) => ufs.reduce((s, uf) => s + (byUf.get(uf)?.[field] ?? 0), 0);
  const rows = ufs.map((uf) => {
    const e = byUf.get(uf) as UfStats;
    return `| ${uf} | ${e.total} | ${e.removed} | ${e.invalid} | ${e.noPrecision} |`;
  });
  return [
    '# Relatório da base de CEPs',
    '',
    `- CEPs na base: ${sum('total')}`,
    `- CEPs removidos por espalhamento (p90 > 2 km): ${sum('removed')}`,
    `- Linhas inválidas (CEP malformado ou sem coordenada): ${sum('invalid')}`,
    `- CEPs sem endereço de precisão 1–4: ${sum('noPrecision')}`,
    `- Tempo de execução: ${seconds.toFixed(1)} s`,
    '',
    '| UF | CEPs | Removidos | Inválidos | Sem precisão |',
    '|----|-----:|----------:|----------:|-------------:|',
    ...rows,
    ...(warnings.length ? ['', '## Avisos', '', ...warnings.map((w) => `- ${w}`)] : []),
    '',
  ].join('\n');
}
