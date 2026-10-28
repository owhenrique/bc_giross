import { CachingCepAddressProvider } from './application/caching-cep-address-provider.js';
import { clearCache } from './application/clear-cache.js';
import { findNearbyCeps } from './application/find-nearby-ceps.js';
import { OriginGeocoder } from './application/origin-geocoder.js';
import { loadEnv, type Env } from './config/env.js';
import {
  createRedisClient,
  RedisCache,
  REDIS_CONNECT_TIMEOUT_MS,
  withTimeout,
} from './infrastructure/cache/redis-cache.js';
import { createPrismaClient } from './infrastructure/db/prisma-client.js';
import { PrismaCepRepository } from './infrastructure/db/prisma-cep-repository.js';
import { BrasilApiCepProvider } from './infrastructure/http/brasil-api-cep-provider.js';
import { NominatimGeocoder } from './infrastructure/http/nominatim-geocoder.js';
import { WindowRateLimiter } from './infrastructure/http/window-rate-limiter.js';
import { createLogger } from './infrastructure/logger.js';
import { createRedisRateLimitStore } from './infrastructure/rate-limit/redis-rate-limit-store.js';
import { RedisWindowRateLimiter } from './infrastructure/rate-limit/redis-window-rate-limiter.js';
import { createApp } from './presentation/http/app.js';

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error('Invalid environment:', error);
  process.exit(1);
}

const logger = createLogger(env.logLevel);
const prisma = createPrismaClient(env.databaseUrl);
const repository = new PrismaCepRepository(prisma);
const redis = createRedisClient(env.redisUrl, logger);
// Awaited (bounded) so the rate limit store loads its scripts on a connected client;
// with Redis down, `connect()` never settles, so the API starts after the timeout and degrades.
await withTimeout(redis.connect(), REDIS_CONNECT_TIMEOUT_MS).catch((error: unknown) =>
  logger.warn({ err: error }, 'redis connect failed'),
);
const cache = new RedisCache(redis, logger);
const addressProvider = new CachingCepAddressProvider(
  new BrasilApiCepProvider({
    limiter: new RedisWindowRateLimiter(redis, {
      key: 'ratelimit:brasilapi',
      max: 5,
      windowMs: 1000,
      fallback: new WindowRateLimiter(5, 1000),
      logger,
    }),
    logger,
  }),
  cache,
  {
    foundTtlSeconds: env.cacheTtl.addressSeconds,
    notFoundTtlSeconds: env.cacheTtl.notFoundSeconds,
  },
);
const originGeocoder = new OriginGeocoder(
  new NominatimGeocoder({
    baseUrl: env.nominatim.url,
    userAgent: env.nominatim.userAgent,
    limiter: new RedisWindowRateLimiter(redis, {
      key: 'ratelimit:nominatim',
      max: 1,
      windowMs: 1000,
      fallback: new WindowRateLimiter(1, 1000),
      logger,
    }),
    logger,
  }),
  cache,
  { foundTtlSeconds: env.cacheTtl.addressSeconds, noMatchTtlSeconds: env.cacheTtl.notFoundSeconds },
);
const app = createApp({
  findNearbyCeps: findNearbyCeps(repository, addressProvider, originGeocoder, cache, {
    radiusKm: env.searchRadiusKm,
    resultTtlSeconds: env.cacheTtl.resultSeconds,
  }),
  logger,
  trustProxy: env.trustProxy,
  rateLimit: {
    limit: env.rateLimit.max,
    windowMs: env.rateLimit.windowSeconds * 1000,
    store: createRedisRateLimitStore(redis),
  },
  cacheAdmin: env.cacheAdminToken
    ? {
        clearCache: clearCache(cache, { radiusKm: env.searchRadiusKm }),
        token: env.cacheAdminToken,
      }
    : undefined,
});

const server = app.listen(env.port, () => logger.info({ port: env.port }, 'api listening'));

function shutdown(): void {
  server.close(() => {
    void Promise.allSettled([redis.close(), prisma.$disconnect()]).finally(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
