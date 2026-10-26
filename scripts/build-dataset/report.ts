export interface EstatisticaUf {
  total: number;
  removidos: number;
  invalidos: number;
  semPrecisao: number;
}

export interface DadosRelatorio {
  porUf: Map<string, EstatisticaUf>;
  avisos: string[];
  segundos: number;
}

export function montarRelatorio({ porUf, avisos, segundos }: DadosRelatorio): string {
  const ufs = [...porUf.keys()].sort();
  const soma = (campo: keyof EstatisticaUf) => ufs.reduce((s, uf) => s + (porUf.get(uf)?.[campo] ?? 0), 0);
  const linhas = ufs.map((uf) => {
    const e = porUf.get(uf) as EstatisticaUf;
    return `| ${uf} | ${e.total} | ${e.removidos} | ${e.invalidos} | ${e.semPrecisao} |`;
  });
  return [
    '# Relatório da base de CEPs',
    '',
    `- CEPs na base: ${soma('total')}`,
    `- CEPs removidos por espalhamento (p90 > 2 km): ${soma('removidos')}`,
    `- Linhas inválidas (CEP malformado ou sem coordenada): ${soma('invalidos')}`,
    `- CEPs sem endereço de precisão 1–4: ${soma('semPrecisao')}`,
    `- Tempo de execução: ${segundos.toFixed(1)} s`,
    '',
    '| UF | CEPs | Removidos | Inválidos | Sem precisão |',
    '|----|-----:|----------:|----------:|-------------:|',
    ...linhas,
    ...(avisos.length ? ['', '## Avisos', '', ...avisos.map((a) => `- ${a}`)] : []),
    '',
  ].join('\n');
}
