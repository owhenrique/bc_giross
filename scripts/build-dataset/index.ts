import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { avaliarCep } from '../../src/domain/cep/cep-centroid.js';
import { lerCnefe, ufDoZip } from './read-cnefe.js';
import { montarRelatorio, type EstatisticaUf } from './report.js';

const PRECISAO_MAXIMA = 4;
const CEP_VALIDO = /^\d{8}$/;

interface CepFinal {
  cep: string;
  uf: string;
  lat: number;
  lon: number;
  p90Km: number;
  removido: boolean;
  pontos: number;
}

const fmt = (n: number) => n.toFixed(6);

async function processarUf(zip: string, uf: string, stats: EstatisticaUf): Promise<CepFinal[]> {
  const porCep = new Map<string, number[]>();
  const semPrecisao = new Set<string>();
  for await (const r of lerCnefe(zip)) {
    if (!r || !CEP_VALIDO.test(r.cep)) {
      stats.invalidos++;
      continue;
    }
    if (r.nv > PRECISAO_MAXIMA) {
      semPrecisao.add(r.cep);
      continue;
    }
    const pontos = porCep.get(r.cep);
    if (pontos) pontos.push(r.lat, r.lon);
    else porCep.set(r.cep, [r.lat, r.lon]);
  }
  for (const cep of porCep.keys()) semPrecisao.delete(cep);
  stats.semPrecisao = semPrecisao.size;

  const finais: CepFinal[] = [];
  for (const [cep, flat] of porCep) {
    const pontos = [];
    for (let i = 0; i < flat.length; i += 2) pontos.push({ lat: flat[i] as number, lon: flat[i + 1] as number });
    const a = avaliarCep(pontos);
    finais.push({ cep, uf, lat: a.centro.lat, lon: a.centro.lon, p90Km: a.p90Km, removido: a.removido, pontos: pontos.length });
  }
  return finais;
}

export async function construirDataset(pasta: string, saida: string): Promise<void> {
  const inicio = performance.now();
  const zips = readdirSync(pasta).filter((f) => f.toLowerCase().endsWith('.zip')).sort();
  if (zips.length === 0) throw new Error(`Nenhum ZIP encontrado em ${pasta}`);

  const porUf = new Map<string, EstatisticaUf>();
  const ceps = new Map<string, CepFinal>();
  const avisos: string[] = [];

  for (const nome of zips) {
    const uf = ufDoZip(nome);
    const stats: EstatisticaUf = { total: 0, removidos: 0, invalidos: 0, semPrecisao: 0 };
    porUf.set(uf, stats);
    for (const c of await processarUf(join(pasta, nome), uf, stats)) {
      const existente = ceps.get(c.cep);
      if (existente) {
        const mantido = existente.pontos >= c.pontos ? existente : c;
        avisos.push(`CEP ${c.cep} presente em ${existente.uf} e ${c.uf}; mantida ${mantido.uf}`);
        ceps.set(c.cep, mantido);
      } else {
        ceps.set(c.cep, c);
      }
    }
  }

  const ordenados = [...ceps.values()].sort((a, b) => (a.cep < b.cep ? -1 : 1));
  const mantidos = ordenados.filter((c) => !c.removido);
  const removidos = ordenados.filter((c) => c.removido);
  for (const c of ordenados) {
    const e = porUf.get(c.uf) as EstatisticaUf;
    if (c.removido) e.removidos++;
    else e.total++;
  }

  mkdirSync(saida, { recursive: true });
  const csv = ['cep;uf;latitude;longitude', ...mantidos.map((c) => `${c.cep};${c.uf};${fmt(c.lat)};${fmt(c.lon)}`)];
  writeFileSync(join(saida, 'ceps.csv.gz'), gzipSync(csv.join('\n') + '\n'));
  const csvRemovidos = ['cep;uf;latitude;longitude;p90_km', ...removidos.map((c) => `${c.cep};${c.uf};${fmt(c.lat)};${fmt(c.lon)};${c.p90Km.toFixed(3)}`)];
  writeFileSync(join(saida, 'ceps-removidos.csv'), csvRemovidos.join('\n') + '\n');
  const segundos = (performance.now() - inicio) / 1000;
  writeFileSync(join(saida, 'relatorio.md'), montarRelatorio({ porUf, avisos, segundos }));
}

function lerPasta(args: string[]): string | undefined {
  const i = args.indexOf('--pasta');
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const pasta = lerPasta(process.argv.slice(2));
  if (!pasta) {
    console.error('Uso: npm run build-dataset -- --pasta <diretorio com os ZIPs do CNEFE>');
    process.exit(1);
  }
  try {
    await construirDataset(resolve(pasta), resolve('data'));
  } catch (e) {
    console.error(`Erro: ${(e as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
