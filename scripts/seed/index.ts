import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { pino } from 'pino';
import { RESULT_KEY_PREFIX, type Cache } from '../../src/application/cache/cache.js';
import { loadEnv } from '../../src/config/env.js';
import { RedisCache, createRedisClient } from '../../src/infrastructure/cache/redis-cache.js';
import { DATASET_HEADER } from '../build-dataset/index.js';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** UF of a data line (not the header) when it is in the allowed set; null otherwise. */
export function allowedUf(line: string, ufs: ReadonlySet<string>): string | null {
  if (line === '' || line === DATASET_HEADER) return null;
  const uf = line.split(';')[1] ?? '';
  return ufs.has(uf) ? uf : null;
}

/** UFs that got at least one CEP loaded. */
export function ufsWithCeps(totals: ReadonlyMap<string, number>): string[] {
  return [...totals].filter(([, count]) => count > 0).map(([uf]) => uf);
}

/** Drops every cached result (address lookups stay); the error says the base was already loaded. */
export async function clearResultCache(cache: Pick<Cache, 'deleteByPrefix'>): Promise<void> {
  try {
    await cache.deleteByPrefix(RESULT_KEY_PREFIX);
  } catch (error) {
    throw new Error(
      `Seed carregou a base, mas não limpou o cache de resultados: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  let ufs: string[];
  let databaseUrl: string;
  let redisUrl: string;
  try {
    const env = loadEnv();
    redisUrl = env.redisUrl;
    databaseUrl = env.databaseUrl;
    ufs = parseSeedUfs(env.seedUfs);
  } catch (error) {
    console.error(`Seed abortado: ${errorMessage(error)}`);
    process.exit(1);
  }

  const logger = pino({ level: 'warn' });
  const redis = createRedisClient(redisUrl, logger, false);
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    console.error(`Seed abortado: ${errorMessage(error)}`);
    await redis.destroy();
    process.exit(1);
  }

  try {
    await load(ufs, databaseUrl, new RedisCache(redis, logger), startedAt);
  } finally {
    await redis.close().catch(() => undefined);
  }
}

async function load(
  ufs: string[],
  databaseUrl: string,
  cache: Cache,
  startedAt: number,
): Promise<void> {
  const allowed = new Set(ufs);
  const totals = new Map<string, number>();
  async function* filteredLines(): AsyncGenerator<string> {
    const lines = createInterface({
      input: createReadStream(DATASET_PATH).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      const uf = allowedUf(line, allowed);
      if (uf === null) continue;
      totals.set(uf, (totals.get(uf) ?? 0) + 1);
      yield `${line}\n`;
    }
  }

  console.log(`Carregando CEPs das UFs: ${ufs.join(', ')}`);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE cep, loaded_uf');
    const copy = client.query(
      copyFrom("COPY cep (cep, uf, latitude, longitude) FROM STDIN (FORMAT csv, DELIMITER ';')"),
    );
    await pipeline(Readable.from(filteredLines()), copy);
    await client.query('INSERT INTO loaded_uf (uf) SELECT unnest($1::text[])', [
      ufsWithCeps(totals),
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(`Seed falhou: ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  } finally {
    await client.end();
  }

  try {
    await clearResultCache(cache);
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
    return;
  }

  let total = 0;
  for (const [uf, count] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${uf}: ${count}`);
    total += count;
  }
  console.log(`Seed concluído: ${total} CEPs em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
