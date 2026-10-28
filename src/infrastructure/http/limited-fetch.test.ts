import { describe, expect, it, vi } from 'vitest';
import { limitedFetch } from './limited-fetch.js';
import { WindowRateLimiter } from '../rate-limit/window-rate-limiter.js';

const TARGET_URL = 'https://service.test/resource';

function setup(
  fetchImpl: typeof fetch,
  extra: { limiter?: WindowRateLimiter; timeoutMs?: number; headers?: Record<string, string> } = {},
) {
  const logger = { warn: vi.fn() };
  const fetchMock = vi.fn(fetchImpl);
  const options = {
    service: 'Service',
    limiter: extra.limiter ?? new WindowRateLimiter(10, 1000),
    timeoutMs: extra.timeoutMs ?? 1000,
    logger,
    headers: extra.headers,
    fetch: fetchMock as typeof fetch,
  };
  return { options, logger, fetchMock };
}

describe('limitedFetch', () => {
  it('returns ok: false without calling fetch when the limiter denies', async () => {
    const { options, logger, fetchMock } = setup(async () => Response.json({}), {
      limiter: new WindowRateLimiter(0, 1000),
    });
    expect(await limitedFetch(TARGET_URL, options)).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { url: TARGET_URL },
      'Service rate limit reached, skipping call',
    );
  });

  it('returns ok: false and logs on network error', async () => {
    const error = new TypeError('fetch failed');
    const { options, logger } = setup(async () => {
      throw error;
    });
    expect(await limitedFetch(TARGET_URL, options)).toEqual({ ok: false });
    expect(logger.warn).toHaveBeenCalledWith(
      { url: TARGET_URL, err: error },
      'Service request failed',
    );
  });

  it('returns ok: false and logs on timeout', async () => {
    const { options, logger } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
        }),
      { timeoutMs: 20 },
    );
    expect(await limitedFetch(TARGET_URL, options)).toEqual({ ok: false });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: TARGET_URL, err: expect.any(Error) }),
      'Service request failed',
    );
  });

  it('returns the status and the JSON body on a response', async () => {
    const { options, logger, fetchMock } = setup(async () =>
      Response.json({ a: 1 }, { status: 404 }),
    );
    expect(await limitedFetch(TARGET_URL, options)).toEqual({
      ok: true,
      status: 404,
      body: { a: 1 },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(TARGET_URL);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns an undefined body when the response is not JSON', async () => {
    const { options } = setup(async () => new Response('<html>', { status: 502 }));
    expect(await limitedFetch(TARGET_URL, options)).toEqual({
      ok: true,
      status: 502,
      body: undefined,
    });
  });

  it('passes the headers to fetch', async () => {
    const headers = { 'User-Agent': 'test-agent/1.0' };
    const { options, fetchMock } = setup(async () => Response.json([]), { headers });
    await limitedFetch(TARGET_URL, options);
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual(headers);
  });
});
