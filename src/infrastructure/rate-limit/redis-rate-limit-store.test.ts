import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_OPERATION_TIMEOUT_MS } from '../cache/redis-cache.js';
import { createRedisRateLimitStore } from './redis-rate-limit-store.js';

afterEach(() => vi.useRealTimers());

describe('createRedisRateLimitStore', () => {
  it('prefixes the key sent in EVALSHA', async () => {
    const sendCommand = vi.fn(async (args: string[]) => (args[0] === 'SCRIPT' ? 'sha' : [1, 1000]));
    const store = createRedisRateLimitStore({ sendCommand });
    await store.init({ windowMs: 1000 } as Parameters<typeof store.init>[0]);
    await store.increment('1.2.3.4');
    const evalsha = sendCommand.mock.calls
      .map(([args]) => args)
      .find((args) => args[0] === 'EVALSHA');
    expect(evalsha?.[3]).toBe('ratelimit:api:1.2.3.4');
  });

  it('rejects when Redis does not answer in time', async () => {
    vi.useFakeTimers();
    const store = createRedisRateLimitStore({
      sendCommand: (args) =>
        args[0] === 'SCRIPT' ? Promise.resolve('sha') : new Promise(() => {}),
    });
    await store.init({ windowMs: 1000 } as Parameters<typeof store.init>[0]);
    const result = expect(store.increment('k')).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(CACHE_OPERATION_TIMEOUT_MS + 1);
    await result;
  });
});
