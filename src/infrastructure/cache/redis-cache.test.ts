import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_OPERATION_TIMEOUT_MS, RedisCache, type RedisClientLike } from './redis-cache.js';

function setup(overrides: Partial<RedisClientLike> = {}) {
  const client: RedisClientLike = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    scanIterator: vi.fn(async function* () {}),
    unlink: vi.fn(async () => 0),
    ...overrides,
  };
  const logger = { warn: vi.fn() };
  return { client, logger, cache: new RedisCache(client, logger) };
}

afterEach(() => vi.useRealTimers());

describe('RedisCache', () => {
  it('returns the parsed value on a hit and null on a miss', async () => {
    const hit = setup({ get: vi.fn(async () => '{"x":1}') });
    expect(await hit.cache.get('k')).toEqual({ x: 1 });
    expect(await setup().cache.get('k')).toBeNull();
  });

  it('turns a client error into a miss and logs a warning', async () => {
    const { cache, logger } = setup({ get: vi.fn().mockRejectedValue(new Error('down')) });
    expect(await cache.get('k')).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('turns invalid JSON into a miss and logs a warning', async () => {
    const { cache, logger } = setup({ get: vi.fn(async () => '{oops') });
    expect(await cache.get('k')).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('turns a hanging get into a miss after the timeout', async () => {
    vi.useFakeTimers();
    const { cache, logger } = setup({ get: vi.fn(() => new Promise<string | null>(() => {})) });
    const result = cache.get('k');
    await vi.advanceTimersByTimeAsync(CACHE_OPERATION_TIMEOUT_MS);
    expect(await result).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('sets the JSON value with EX and does not throw on error or timeout', async () => {
    const ok = setup();
    await ok.cache.set('k', { a: 1 }, 60);
    expect(ok.client.set).toHaveBeenCalledWith('k', '{"a":1}', { EX: 60 });

    const failing = setup({ set: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(failing.cache.set('k', 1, 60)).resolves.toBeUndefined();
    expect(failing.logger.warn).toHaveBeenCalledOnce();

    vi.useFakeTimers();
    const hanging = setup({ set: vi.fn(() => new Promise(() => {})) });
    const pending = hanging.cache.set('k', 1, 60);
    await vi.advanceTimersByTimeAsync(CACHE_OPERATION_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(hanging.logger.warn).toHaveBeenCalledOnce();
  });

  it('deletes by prefix in batches using SCAN + UNLINK', async () => {
    const { cache, client } = setup({
      scanIterator: vi.fn(async function* () {
        yield ['result:1:a', 'result:1:b'];
        yield [];
        yield ['result:1:c'];
      }),
    });
    await cache.deleteByPrefix('result:');
    expect(client.scanIterator).toHaveBeenCalledWith({ MATCH: 'result:*', COUNT: 500 });
    expect(client.unlink).toHaveBeenCalledTimes(2);
    expect(client.unlink).toHaveBeenNthCalledWith(1, ['result:1:a', 'result:1:b']);
    expect(client.unlink).toHaveBeenNthCalledWith(2, ['result:1:c']);
  });

  it('propagates errors from deleteByPrefix', async () => {
    const { cache } = setup({
      scanIterator: vi.fn(async function* () {
        yield ['k'];
      }),
      unlink: vi.fn().mockRejectedValue(new Error('down')),
    });
    await expect(cache.deleteByPrefix('result:')).rejects.toThrow('down');
  });

  it('times out deleteByPrefix when a step hangs', async () => {
    vi.useFakeTimers();
    const { cache } = setup({
      scanIterator: vi.fn(async function* () {
        yield ['k'];
      }),
      unlink: vi.fn(() => new Promise<never>(() => {})),
    });
    const result = expect(cache.deleteByPrefix('result:')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(CACHE_OPERATION_TIMEOUT_MS);
    await result;
  });
});
