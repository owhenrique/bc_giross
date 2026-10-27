import { describe, expect, it } from 'vitest';
import { normalizeCep } from './cep-code.js';

describe('normalizeCep', () => {
  it('keeps an 8-digit cep', () => {
    expect(normalizeCep('04551000')).toBe('04551000');
  });

  it('strips the hyphen', () => {
    expect(normalizeCep('04551-000')).toBe('04551000');
  });

  it.each(['123', '0455100a', '04551-0000', ''])('rejects %j', (input) => {
    expect(normalizeCep(input)).toBeNull();
  });
});
