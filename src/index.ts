import { CachingCepAddressProvider } from './application/providers/caching-cep-address-provider.js';
import { clearCache } from './application/cache/clear-cache.js';
import { findNearbyCeps } from './application/use-cases/find-nearby-ceps.js';
import { OriginGeocoder } from './application/providers/origin-geocoder.js';
import { loadEnv, type Env } from './config/env.js';
import { createRedisClient, RedisCache } from './infrastructure/cache/redis-cache.js';
import { createPrismaClient } from './infrastructure/db/prisma-client.js';
import { PrismaCepRepository } from './infrastructure/db/prisma-cep-repository.js';
import { BrasilApiCepProvider } from './infrastructure/http/brasil-api-cep-provider.js';
import { NominatimGeocoder } from './infrastructure/http/nominatim-geocoder.js';
import { createLogger } from './infrastructure/logger.js';
import { createApp } from './presentation/http/app.js';
import { loadOpenApiDocument } from './infrastructure/openapi/load-openapi-document.js';

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
void redis.connect().catch(() => undefined);
const cache = new RedisCache(redis, logger);
const addressProvider = new CachingCepAddressProvider(new BrasilApiCepProvider({ logger }), cache, {
  foundTtlSeconds: env.cacheTtl.addressSeconds,
  notFoundTtlSeconds: env.cacheTtl.notFoundSeconds,
});
const originGeocoder = new OriginGeocoder(
  new NominatimGeocoder({
    baseUrl: env.nominatim.url,
    userAgent: env.nominatim.userAgent,
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
  openApiDocument: env.nodeEnv === 'production' ? undefined : loadOpenApiDocument(),
  rateLimit: {
    limit: env.rateLimit.max,
    windowMs: env.rateLimit.windowSeconds * 1000,
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
