import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      port: 3000,
      searchRadiusKm: 1,
      seedUfs: '',
      logLevel: 'info',
      redisUrl: base.REDIS_URL,
      cacheTtl: { addressSeconds: 2592000, resultSeconds: 86400, notFoundSeconds: 3600 },
      nominatim: {
        url: 'https://nominatim.openstreetmap.org',
        userAgent: 'bc_giross/1.0 (+https://github.com/owhenrique/bc_giross)',
      },
      rateLimit: { max: 60, windowSeconds: 60 },
      trustProxy: false,
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
    expect(env).toMatchObject({
      port: 8080,
      searchRadiusKm: 2.5,
      seedUfs: 'SP,RJ',
      logLevel: 'debug',
    });
  });

  it('rejects SEARCH_RADIUS_KM=0', () => {
    expect(() => loadEnv({ ...base, SEARCH_RADIUS_KM: '0' })).toThrow();
  });

  it('rejects non-numeric SEARCH_RADIUS_KM', () => {
    expect(() => loadEnv({ ...base, SEARCH_RADIUS_KM: 'abc' })).toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({ REDIS_URL: base.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('rejects missing REDIS_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/REDIS_URL/);
  });

  it('reads cache TTLs and rejects non-positive ones', () => {
    expect(loadEnv({ ...base, CACHE_TTL_RESULT_SECONDS: '60' }).cacheTtl.resultSeconds).toBe(60);
    expect(() => loadEnv({ ...base, CACHE_TTL_ADDRESS_SECONDS: '0' })).toThrow();
  });

  it('treats a missing or empty CACHE_ADMIN_TOKEN as disabled', () => {
    expect(loadEnv(base).cacheAdminToken).toBeUndefined();
    expect(loadEnv({ ...base, CACHE_ADMIN_TOKEN: '' }).cacheAdminToken).toBeUndefined();
  });

  it('requires CACHE_ADMIN_TOKEN to have at least 12 characters', () => {
    expect(() => loadEnv({ ...base, CACHE_ADMIN_TOKEN: 'x'.repeat(11) })).toThrow();
    expect(loadEnv({ ...base, CACHE_ADMIN_TOKEN: 'x'.repeat(12) }).cacheAdminToken).toBe(
      'x'.repeat(12),
    );
  });

  it('reads the Nominatim overrides and rejects an invalid URL', () => {
    const env = loadEnv({
      ...base,
      NOMINATIM_URL: 'http://localhost:8080',
      NOMINATIM_USER_AGENT: 'custom/2.0',
    });
    expect(env.nominatim).toEqual({ url: 'http://localhost:8080', userAgent: 'custom/2.0' });
    expect(() => loadEnv({ ...base, NOMINATIM_URL: 'not a url' })).toThrow();
    expect(() => loadEnv({ ...base, NOMINATIM_USER_AGENT: '' })).toThrow();
  });

  it('reads the rate limit values', () => {
    expect(
      loadEnv({ ...base, RATE_LIMIT_MAX: '10', RATE_LIMIT_WINDOW_SECONDS: '30' }).rateLimit,
    ).toEqual({ max: 10, windowSeconds: 30 });
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects RATE_LIMIT_MAX=%s', (value) => {
    expect(() => loadEnv({ ...base, RATE_LIMIT_MAX: value })).toThrow();
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects RATE_LIMIT_WINDOW_SECONDS=%s', (value) => {
    expect(() => loadEnv({ ...base, RATE_LIMIT_WINDOW_SECONDS: value })).toThrow();
  });

  it.each([
    ['', false],
    ['false', false],
    ['true', true],
    ['2', 2],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('parses TRUST_PROXY=%j', (value, expected) => {
    expect(loadEnv({ ...base, TRUST_PROXY: value }).trustProxy).toBe(expected);
  });
});
