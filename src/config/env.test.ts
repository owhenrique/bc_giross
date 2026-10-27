import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      port: 3000,
      searchRadiusKm: 1,
      seedUfs: '',
      logLevel: 'info',
    });
  });

  it('reads provided values', () => {
    const env = loadEnv({
      ...base,
      PORT: '8080',
      SEARCH_RADIUS_KM: '2.5',
      SEED_UFS: 'SP,RJ',
      LOG_LEVEL: 'debug',
    });
    expect(env).toMatchObject({ port: 8080, searchRadiusKm: 2.5, seedUfs: 'SP,RJ', logLevel: 'debug' });
  });

  it('rejects SEARCH_RADIUS_KM=0', () => {
    expect(() => loadEnv({ ...base, SEARCH_RADIUS_KM: '0' })).toThrow();
  });

  it('rejects non-numeric SEARCH_RADIUS_KM', () => {
    expect(() => loadEnv({ ...base, SEARCH_RADIUS_KM: 'abc' })).toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
