import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_OPERATION_TIMEOUT_MS } from '../cache/redis-cache.js';
import { RedisWindowRateLimiter } from './redis-window-rate-limiter.js';

function setup(sendCommand: (args: string[]) => Promise<unknown>) {
  const client = { sendCommand: vi.fn(sendCommand) };
  const fallback = { tryAcquire: vi.fn(() => true) };
  const logger = { warn: vi.fn() };
  const limiter = new RedisWindowRateLimiter(client, {
    key: 'ratelimit:test',
    max: 5,
    windowMs: 1000,
    fallback,
    logger,
  });
  return { client, fallback, logger, limiter };
}

afterEach(() => vi.useRealTimers());

describe('RedisWindowRateLimiter', () => {
  it('sends EVAL with the key, window, max and a unique member', async () => {
    const { client, limiter } = setup(async () => 1);
    await limiter.tryAcquire();
    await limiter.tryAcquire();
    const [first, second] = client.sendCommand.mock.calls.map(([args]) => args);
    expect(first!.slice(0, 1)).toEqual(['EVAL']);
    expect(first!.slice(2, 6)).toEqual(['1', 'ratelimit:test', '1000', '5']);
    expect(first![6]).toMatch(/^\d+-[0-9a-f-]{36}$/);
    expect(second![6]).not.toBe(first![6]);
  });

  it('returns true for 1 and false for 0 without using the fallback', async () => {
    const allowed = setup(async () => 1);
    const denied = setup(async () => 0);
    expect(await allowed.limiter.tryAcquire()).toBe(true);
    expect(await denied.limiter.tryAcquire()).toBe(false);
    expect(allowed.fallback.tryAcquire).not.toHaveBeenCalled();
    expect(denied.fallback.tryAcquire).not.toHaveBeenCalled();
  });

  it('uses the fallback and warns when Redis fails', async () => {
    const { fallback, logger, limiter } = setup(async () => {
      throw new Error('down');
    });
    fallback.tryAcquire.mockReturnValue(false);
    expect(await limiter.tryAcquire()).toBe(false);
    expect(fallback.tryAcquire).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'ratelimit:test' }),
      'redis rate limiter failed, using in-memory fallback',
    );
  });

  it('uses the fallback and warns when Redis times out', async () => {
    vi.useFakeTimers();
    const { fallback, logger, limiter } = setup(() => new Promise(() => {}));
    const result = limiter.tryAcquire();
    await vi.advanceTimersByTimeAsync(CACHE_OPERATION_TIMEOUT_MS);
    expect(await result).toBe(true);
    expect(fallback.tryAcquire).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('goes back to Redis on the call after a failure', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(0);
    const { fallback, limiter } = setup(send);
    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expect(fallback.tryAcquire).toHaveBeenCalledOnce();
  });
});
