import { describe, expect, it } from 'vitest';
import { ALL_UFS, matchesUf, parseSeedUfs } from './index.js';

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
