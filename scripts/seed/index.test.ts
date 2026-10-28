import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '../../tests/fakes/in-memory-cache.js';
import { ALL_UFS, clearResultCache, matchesUf, parseSeedUfs, ufsWithCeps } from './index.js';

describe('parseSeedUfs', () => {
  it('returns all 27 UFs when empty', () => {
    expect(parseSeedUfs('')).toEqual(ALL_UFS);
    expect(parseSeedUfs('  ')).toHaveLength(27);
  });

  it('trims and uppercases the list', () => {
    expect(parseSeedUfs(' sp,RJ ')).toEqual(['SP', 'RJ']);
  });

  it('drops duplicates', () => {
    expect(parseSeedUfs('SP,sp')).toEqual(['SP']);
  });

  it('throws a clear error for an invalid UF', () => {
    expect(() => parseSeedUfs('SP,XX')).toThrow(/XX/);
  });
});

describe('matchesUf', () => {
  const sp = new Set(['SP']);

  it('keeps lines of a requested UF', () => {
    expect(matchesUf('01002001;SP;-23.548462;-46.634938', sp)).toBe(true);
  });

  it('drops lines of other UFs', () => {
    expect(matchesUf('20010000;RJ;-22.9;-43.1', sp)).toBe(false);
  });

  it('ignores the header and blank lines', () => {
    expect(matchesUf('cep;uf;latitude;longitude', sp)).toBe(false);
    expect(matchesUf('', sp)).toBe(false);
  });
});

describe('ufsWithCeps', () => {
  it('returns only the UFs with at least one CEP', () => {
    const totals = new Map([
      ['SP', 3],
      ['RJ', 0],
      ['MG', 1],
    ]);
    expect(ufsWithCeps(totals)).toEqual(['SP', 'MG']);
  });

  it('returns an empty list when nothing was loaded', () => {
    expect(ufsWithCeps(new Map())).toEqual([]);
  });
});

describe('clearResultCache', () => {
  it('drops result keys and keeps address keys', async () => {
    const cache = new InMemoryCache();
    await cache.set('result:10:01001000', { a: 1 }, 60);
    await cache.set('address:01001000', { b: 2 }, 60);
    await clearResultCache(cache);
    expect(await cache.get('result:10:01001000')).toBeNull();
    expect(await cache.get('address:01001000')).toEqual({ b: 2 });
  });

  it('propagates the failure saying the base was loaded but the cache was not cleared', async () => {
    const cache = {
      deleteByPrefix: async () => {
        throw new Error('connection lost');
      },
    };
    await expect(clearResultCache(cache)).rejects.toThrow(
      'Seed carregou a base, mas não limpou o cache de resultados: connection lost',
    );
  });
});
