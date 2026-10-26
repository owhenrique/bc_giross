import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { assessCep } from '../../src/domain/cep/cep-centroid.js';
import { readCnefe, ufFromZip } from './read-cnefe.js';
import { buildReport, type UfStats } from './report.js';

const MAX_PRECISION = 4;
const VALID_CEP = /^\d{8}$/;

interface FinalCep {
  cep: string;
  uf: string;
  lat: number;
  lon: number;
  p90Km: number;
  removed: boolean;
  points: number;
}

const fmt = (n: number) => n.toFixed(6);

async function processUf(zip: string, uf: string, stats: UfStats): Promise<FinalCep[]> {
  const byCep = new Map<string, number[]>();
  const noPrecision = new Set<string>();
  for await (const r of readCnefe(zip)) {
    if (!r || !VALID_CEP.test(r.cep)) {
      stats.invalid++;
      continue;
    }
    if (r.nv > MAX_PRECISION) {
      noPrecision.add(r.cep);
      continue;
    }
    const points = byCep.get(r.cep);
    if (points) points.push(r.lat, r.lon);
    else byCep.set(r.cep, [r.lat, r.lon]);
  }
  for (const cep of byCep.keys()) noPrecision.delete(cep);
  stats.noPrecision = noPrecision.size;

  const finals: FinalCep[] = [];
  for (const [cep, flat] of byCep) {
    const points = [];
    for (let i = 0; i < flat.length; i += 2) points.push({ lat: flat[i] as number, lon: flat[i + 1] as number });
    const a = assessCep(points);
    finals.push({ cep, uf, lat: a.center.lat, lon: a.center.lon, p90Km: a.p90Km, removed: a.removed, points: points.length });
  }
  return finals;
}

export async function buildDataset(folder: string, output: string): Promise<void> {
  const start = performance.now();
  const zips = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.zip')).sort();
  if (zips.length === 0) throw new Error(`Nenhum ZIP encontrado em ${folder}`);

  const byUf = new Map<string, UfStats>();
  const ceps = new Map<string, FinalCep>();
  const warnings: string[] = [];

  for (const name of zips) {
    const uf = ufFromZip(name);
    const stats: UfStats = { total: 0, removed: 0, invalid: 0, noPrecision: 0 };
    byUf.set(uf, stats);
    for (const c of await processUf(join(folder, name), uf, stats)) {
      const existing = ceps.get(c.cep);
      if (existing) {
        const kept = existing.points >= c.points ? existing : c;
        warnings.push(`CEP ${c.cep} presente em ${existing.uf} e ${c.uf}; mantida ${kept.uf}`);
        ceps.set(c.cep, kept);
      } else {
        ceps.set(c.cep, c);
      }
    }
  }

  const sorted = [...ceps.values()].sort((a, b) => (a.cep < b.cep ? -1 : 1));
  const keptCeps = sorted.filter((c) => !c.removed);
  const removedCeps = sorted.filter((c) => c.removed);
  for (const c of sorted) {
    const e = byUf.get(c.uf) as UfStats;
    if (c.removed) e.removed++;
    else e.total++;
  }

  mkdirSync(output, { recursive: true });
  const csv = ['cep;uf;latitude;longitude', ...keptCeps.map((c) => `${c.cep};${c.uf};${fmt(c.lat)};${fmt(c.lon)}`)];
  writeFileSync(join(output, 'ceps.csv.gz'), gzipSync(csv.join('\n') + '\n'));
  const removedCsv = ['cep;uf;latitude;longitude;p90_km', ...removedCeps.map((c) => `${c.cep};${c.uf};${fmt(c.lat)};${fmt(c.lon)};${c.p90Km.toFixed(3)}`)];
  writeFileSync(join(output, 'ceps-removidos.csv'), removedCsv.join('\n') + '\n');
  const seconds = (performance.now() - start) / 1000;
  writeFileSync(join(output, 'relatorio.md'), buildReport({ byUf, warnings, seconds }));
}

function readFolderArg(args: string[]): string | undefined {
  const i = args.indexOf('--pasta');
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const folder = readFolderArg(process.argv.slice(2));
  if (!folder) {
    console.error('Uso: npm run build-dataset -- --pasta <diretorio com os ZIPs do CNEFE>');
    process.exit(1);
  }
  try {
    await buildDataset(resolve(folder), resolve('data'));
  } catch (e) {
    console.error(`Erro: ${(e as Error).message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
