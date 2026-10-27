import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  SEARCH_RADIUS_KM: z.coerce.number().positive().default(1),
  SEED_UFS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Env {
  databaseUrl: string;
  port: number;
  searchRadiusKm: number;
  /** Raw comma-separated UF list; validated by the seed. */
  seedUfs: string;
  logLevel: string;
}

/** Parses and validates the environment. Throws the Zod error when invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    searchRadiusKm: parsed.SEARCH_RADIUS_KM,
    seedUfs: parsed.SEED_UFS,
    logLevel: parsed.LOG_LEVEL,
  };
}
