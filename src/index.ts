import { findNearbyCeps } from './application/find-nearby-ceps.js';
import { loadEnv, type Env } from './config/env.js';
import { createPrismaClient } from './infrastructure/db/prisma-client.js';
import { PrismaCepRepository } from './infrastructure/db/prisma-cep-repository.js';
import { BrasilApiCepProvider } from './infrastructure/http/brasil-api-cep-provider.js';
import { createLogger } from './infrastructure/logger.js';
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
const addressProvider = new BrasilApiCepProvider({ logger });
const app = createApp({
  findNearbyCeps: findNearbyCeps(repository, addressProvider, env.searchRadiusKm),
  logger,
});

const server = app.listen(env.port, () => logger.info({ port: env.port }, 'api listening'));

function shutdown(): void {
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
