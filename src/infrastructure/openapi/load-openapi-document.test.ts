import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadOpenApiDocument } from './load-openapi-document.js';

describe('loadOpenApiDocument', () => {
  it('returns the content of the root openapi.yaml', () => {
    const yaml = readFileSync(new URL('../../../openapi.yaml', import.meta.url), 'utf8');
    expect(loadOpenApiDocument()).toEqual(parse(yaml));
  });

  it('returns an OpenAPI 3.1 document', () => {
    expect(loadOpenApiDocument()).toMatchObject({ openapi: expect.stringMatching(/^3\.1\./) });
  });
});
