import { describe, expect, it } from 'vitest';
import { APP_ERROR_KINDS } from '../../application/errors.js';
import { ERROR_CATALOG } from './error-catalog.js';

describe('ERROR_CATALOG', () => {
  it.each(APP_ERROR_KINDS)('has an entry for %s', (kind) => {
    expect(ERROR_CATALOG[kind]).toBeDefined();
  });
});
