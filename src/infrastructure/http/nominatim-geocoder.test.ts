import { describe, expect, it, vi } from 'vitest';
import { NominatimGeocoder } from './nominatim-geocoder.js';
import { WindowRateLimiter } from '../rate-limit/window-rate-limiter.js';

const QUERY = { street: 'Praça da Sé', city: 'São Paulo' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(
  fetchImpl: typeof fetch,
  extra: { timeoutMs?: number; limiter?: WindowRateLimiter } = {},
) {
  const logger = { warn: vi.fn() };
  const fetchMock = vi.fn(fetchImpl);
  const geocoder = new NominatimGeocoder({
    fetch: fetchMock as typeof fetch,
    baseUrl: 'https://nominatim.test',
    userAgent: 'test-agent/1.0',
    logger,
    ...extra,
  });
  return { geocoder, logger, fetchMock };
}

describe('NominatimGeocoder', () => {
  it('sends the search URL, parameters and headers', async () => {
    const { geocoder, fetchMock } = setup(async () => json([]));
    await geocoder.search(QUERY);
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe('https://nominatim.test/search');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      street: 'Praça da Sé',
      city: 'São Paulo',
      countrycodes: 'br',
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
    });
    expect(init!.headers).toEqual({ 'User-Agent': 'test-agent/1.0', 'Accept-Language': 'pt-BR' });
  });

  it('maps candidates, parsing coordinates and the UF from ISO3166-2-lvl4', async () => {
    const { geocoder } = setup(async () =>
      json([
        {
          lat: '-23.55',
          lon: '-46.63',
          address: { city: 'São Paulo', 'ISO3166-2-lvl4': 'BR-SP' },
        },
      ]),
    );
    expect(await geocoder.search(QUERY)).toEqual({
      status: 'found',
      candidates: [{ lat: -23.55, lon: -46.63, city: 'São Paulo', uf: 'SP' }],
    });
  });

  it('falls back from city to town, village and municipality', async () => {
    const entry = (address: object) => ({ lat: '1', lon: '2', address });
    const { geocoder } = setup(async () =>
      json([
        entry({ town: 'T', village: 'V', municipality: 'M' }),
        entry({ village: 'V', municipality: 'M' }),
        entry({ municipality: 'M' }),
        entry({}),
      ]),
    );
    const result = await geocoder.search(QUERY);
    expect(result.status === 'found' && result.candidates.map((c) => c.city)).toEqual([
      'T',
      'V',
      'M',
      null,
    ]);
  });

  it('sets uf to null when the ISO code is missing or not Brazilian', async () => {
    const { geocoder } = setup(async () =>
      json([
        { lat: '1', lon: '2', address: {} },
        { lat: '1', lon: '2', address: { 'ISO3166-2-lvl4': 'US-CA' } },
      ]),
    );
    const result = await geocoder.search(QUERY);
    expect(result.status === 'found' && result.candidates.map((c) => c.uf)).toEqual([null, null]);
  });

  it('discards candidates with non-finite coordinates', async () => {
    const { geocoder } = setup(async () =>
      json([
        { lat: 'abc', lon: '2', address: {} },
        { lat: '3', lon: '4', address: {} },
      ]),
    );
    expect(await geocoder.search(QUERY)).toEqual({
      status: 'found',
      candidates: [{ lat: 3, lon: 4, city: null, uf: null }],
    });
  });

  it('returns an empty candidate list when nothing is found', async () => {
    const { geocoder, logger } = setup(async () => json([]));
    expect(await geocoder.search(QUERY)).toEqual({ status: 'found', candidates: [] });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns unavailable on a non-200 status', async () => {
    const { geocoder, logger } = setup(async () => json([], 429));
    expect(await geocoder.search(QUERY)).toEqual({ status: 'unavailable' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns unavailable on network error', async () => {
    const { geocoder, logger } = setup(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await geocoder.search(QUERY)).toEqual({ status: 'unavailable' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns unavailable on timeout', async () => {
    const { geocoder, logger } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
        }),
      { timeoutMs: 20 },
    );
    expect(await geocoder.search(QUERY)).toEqual({ status: 'unavailable' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns unavailable on invalid body', async () => {
    const { geocoder, logger } = setup(async () => json({ not: 'an array' }));
    expect(await geocoder.search(QUERY)).toEqual({ status: 'unavailable' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns unavailable without calling fetch when the limiter denies', async () => {
    const limiter = new WindowRateLimiter(0, 1000);
    const { geocoder, fetchMock } = setup(async () => json([]), { limiter });
    expect(await geocoder.search(QUERY)).toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
