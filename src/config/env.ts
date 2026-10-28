import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  SEARCH_RADIUS_KM: z.coerce.number().positive().default(1),
  SEED_UFS: z.string().default(''),
  REDIS_URL: z.string().min(1),
  CACHE_TTL_ADDRESS_SECONDS: z.coerce.number().int().positive().default(2592000),
  CACHE_TTL_RESULT_SECONDS: z.coerce.number().int().positive().default(86400),
  CACHE_TTL_NOT_FOUND_SECONDS: z.coerce.number().int().positive().default(3600),
  NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_USER_AGENT: z
    .string()
    .min(1)
    .default('bc_giross/1.0 (+https://github.com/owhenrique/bc_giross)'),
  CACHE_ADMIN_TOKEN: z
    .string()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.string().min(12).optional()),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value): boolean | number | string => {
      const text = value?.trim() ?? '';
      if (text === '' || text === 'false') return false;
      if (text === 'true') return true;
      return /^\d+$/.test(text) ? Number(text) : text;
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Env {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  port: number;
  searchRadiusKm: number;
  seedUfs: string;
  logLevel: string;
  redisUrl: string;
  cacheTtl: { addressSeconds: number; resultSeconds: number; notFoundSeconds: number };
  nominatim: { url: string; userAgent: string };
  cacheAdminToken?: string;
  rateLimit: { max: number; windowSeconds: number };
  trustProxy: boolean | number | string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    searchRadiusKm: parsed.SEARCH_RADIUS_KM,
    seedUfs: parsed.SEED_UFS,
    logLevel: parsed.LOG_LEVEL,
    redisUrl: parsed.REDIS_URL,
    cacheTtl: {
      addressSeconds: parsed.CACHE_TTL_ADDRESS_SECONDS,
      resultSeconds: parsed.CACHE_TTL_RESULT_SECONDS,
      notFoundSeconds: parsed.CACHE_TTL_NOT_FOUND_SECONDS,
    },
    nominatim: { url: parsed.NOMINATIM_URL, userAgent: parsed.NOMINATIM_USER_AGENT },
    cacheAdminToken: parsed.CACHE_ADMIN_TOKEN,
    rateLimit: { max: parsed.RATE_LIMIT_MAX, windowSeconds: parsed.RATE_LIMIT_WINDOW_SECONDS },
    trustProxy: parsed.TRUST_PROXY,
  };
}
