import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '../../../tests/fakes/in-memory-cache.js';
import type { CepAddress } from './cep-address-provider.js';
import type { GeocodeCandidate, GeocodeLookup, Geocoder } from './geocoder.js';
import { OriginGeocoder } from './origin-geocoder.js';

const options = { foundTtlSeconds: 1000, noMatchTtlSeconds: 100 };
const address: CepAddress = {
  street: 'Praça da Sé',
  neighborhood: 'Sé',
  city: 'São Paulo',
  uf: 'SP',
};
const candidate = (overrides: Partial<GeocodeCandidate> = {}): GeocodeCandidate => ({
  lat: -23.55,
  lon: -46.63,
  city: 'São Paulo',
  uf: 'SP',
  ...overrides,
});
const found = (...candidates: GeocodeCandidate[]): GeocodeLookup => ({
  status: 'found',
  candidates,
});

function setup(result: GeocodeLookup) {
  let now = 0;
  const calls: unknown[] = [];
  const geocoder: Geocoder = {
    async search(query) {
      calls.push(query);
      return result;
    },
  };
  const cache = new InMemoryCache(() => now);
  const origin = new OriginGeocoder(geocoder, cache, options);
  return { origin, calls, advance: (seconds: number) => (now += seconds * 1000) };
}

describe('OriginGeocoder', () => {
  it.each([
    ['street', { ...address, street: null }],
    ['city', { ...address, city: null }],
    ['uf', { ...address, uf: null }],
    ['empty street', { ...address, street: '' }],
  ])('returns no_match without calling the geocoder when %s is missing', async (_name, input) => {
    const { origin, calls } = setup(found(candidate()));
    expect(await origin.locate('01001000', input)).toEqual({ status: 'no_match' });
    expect(calls).toHaveLength(0);
  });

  it('searches by street and city', async () => {
    const { origin, calls } = setup(found(candidate()));
    await origin.locate('01001000', address);
    expect(calls).toEqual([{ street: 'Praça da Sé', city: 'São Paulo' }]);
  });

  it('matches the city ignoring accents, case and extra spaces', async () => {
    const { origin } = setup(found(candidate({ city: '  SAO   paulo ' })));
    expect(await origin.locate('01001000', address)).toEqual({
      status: 'found',
      lat: -23.55,
      lon: -46.63,
    });
  });

  it('rejects a candidate from another city', async () => {
    const { origin } = setup(found(candidate({ city: 'Campinas' })));
    expect(await origin.locate('01001000', address)).toEqual({ status: 'no_match' });
  });

  it('rejects a candidate from another UF or without UF or city', async () => {
    const { origin } = setup(
      found(candidate({ uf: 'RJ' }), candidate({ uf: null }), candidate({ city: null })),
    );
    expect(await origin.locate('01001000', address)).toEqual({ status: 'no_match' });
  });

  it('returns no_match when there are no candidates', async () => {
    const { origin } = setup(found());
    expect(await origin.locate('01001000', address)).toEqual({ status: 'no_match' });
  });

  it('skips a homonym first candidate and takes the right one', async () => {
    const { origin } = setup(
      found(candidate({ city: 'Campinas', lat: 1, lon: 2 }), candidate({ lat: 3, lon: 4 })),
    );
    expect(await origin.locate('01001000', address)).toEqual({
      status: 'found',
      lat: 3,
      lon: 4,
    });
  });

  it('keeps found for the found TTL', async () => {
    const { origin, calls, advance } = setup(found(candidate()));
    await origin.locate('01001000', address);
    advance(999);
    await origin.locate('01001000', address);
    expect(calls).toHaveLength(1);
    advance(1);
    await origin.locate('01001000', address);
    expect(calls).toHaveLength(2);
  });

  it('keeps no_match for the no_match TTL', async () => {
    const { origin, calls, advance } = setup(found());
    await origin.locate('01001000', address);
    advance(99);
    await origin.locate('01001000', address);
    expect(calls).toHaveLength(1);
    advance(1);
    await origin.locate('01001000', address);
    expect(calls).toHaveLength(2);
  });

  it('does not cache unavailable', async () => {
    const { origin, calls } = setup({ status: 'unavailable' });
    expect(await origin.locate('01001000', address)).toEqual({ status: 'unavailable' });
    await origin.locate('01001000', address);
    expect(calls).toHaveLength(2);
  });

  it('caches per CEP', async () => {
    const { origin, calls } = setup(found(candidate()));
    await origin.locate('01001000', address);
    await origin.locate('01002000', address);
    expect(calls).toHaveLength(2);
  });
});
