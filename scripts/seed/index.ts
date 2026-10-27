import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { loadEnv } from '../../src/config/env.js';

export const ALL_UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
];

const DATASET_PATH = fileURLToPath(new URL('../../data/ceps.csv.gz', import.meta.url));
const HEADER = 'cep;uf;latitude;longitude';

/** Parses the SEED_UFS value. Empty means every UF; an unknown UF throws. */
export function parseSeedUfs(raw: string): string[] {
  const ufs = raw
    .split(',')
    .map((uf) => uf.trim().toUpperCase())
    .filter((uf) => uf !== '');
  if (ufs.length === 0) return [...ALL_UFS];
  const invalid = ufs.filter((uf) => !ALL_UFS.includes(uf));
  if (invalid.length > 0) {
    throw new Error(
      `UF inválida em SEED_UFS: ${invalid.join(', ')}. UFs aceitas: ${ALL_UFS.join(', ')}`,
    );
  }
  return [...new Set(ufs)];
}

/** True for a data line (not the header) whose UF is in the allowed set. */
export function matchesUf(line: string, ufs: ReadonlySet<string>): boolean {
  if (line === '' || line === HEADER) return false;
  return ufs.has(line.split(';')[1] ?? '');
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  let ufs: string[];
  let databaseUrl: string;
  try {
    const env = loadEnv();
    databaseUrl = env.databaseUrl;
    ufs = parseSeedUfs(env.seedUfs);
  } catch (error) {
    console.error(`Seed abortado: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const allowed = new Set(ufs);
  const totals = new Map<string, number>();
  async function* filteredLines(): AsyncGenerator<string> {
    const lines = createInterface({
      input: createReadStream(DATASET_PATH).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!matchesUf(line, allowed)) continue;
      const uf = line.split(';')[1] as string;
      totals.set(uf, (totals.get(uf) ?? 0) + 1);
      yield `${line}\n`;
    }
  }

  console.log(`Carregando CEPs das UFs: ${ufs.join(', ')}`);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE cep');
    const copy = client.query(
      copyFrom("COPY cep (cep, uf, latitude, longitude) FROM STDIN (FORMAT csv, DELIMITER ';')"),
    );
    await pipeline(Readable.from(filteredLines()), copy);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(`Seed falhou: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  } finally {
    await client.end();
  }

  let total = 0;
  for (const [uf, count] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${uf}: ${count}`);
    total += count;
  }
  console.log(`Seed concluído: ${total} CEPs em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
