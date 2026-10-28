import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { expect } from 'vitest';

type HttpMethod = 'get' | 'delete';

interface ResponseObject {
  $ref?: string;
  content?: Record<string, { schema?: unknown }>;
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Partial<Record<HttpMethod, { responses: Record<string, ResponseObject> }>>>;
  components: {
    schemas: Record<string, { properties?: Record<string, unknown> }> & {
      Erro: {
        properties: { erro: { properties: { codigo: { enum: string[] } } } };
      };
    };
    responses: Record<string, ResponseObject>;
  };
}

export const openApiDocument = parse(
  readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8'),
) as OpenApiDocument;

// `strict: false` lets OpenAPI-only keywords (`example`, `examples`) pass as annotations.
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(openApiDocument, 'openapi');

const escapePointer = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * JSON pointer to the response object, following a `$ref` to `components/responses`:
 * Ajv resolves `$ref` only inside schemas, not inside OpenAPI response objects.
 */
function responsePointer(path: string, method: HttpMethod, status: number) {
  const response = openApiDocument.paths[path]?.[method]?.responses[String(status)];
  if (!response) return undefined;
  if (response.$ref) {
    const name = response.$ref.replace('#/components/responses/', '');
    return {
      pointer: `/components/responses/${escapePointer(name)}`,
      response: openApiDocument.components.responses[name],
    };
  }
  return {
    pointer: `/paths/${escapePointer(path)}/${method}/responses/${status}`,
    response,
  };
}

interface ContractResponse {
  status: number;
  body: unknown;
  text: string;
}

/** Fails unless the document declares this path, method and status and `res.body` matches its schema. */
export function expectMatchesContract(res: ContractResponse, path: string, method: HttpMethod) {
  const found = responsePointer(path, method, res.status);
  expect(
    found,
    `${method.toUpperCase()} ${path} ${res.status} is not in openapi.yaml`,
  ).toBeDefined();
  if (res.status === 204) {
    expect(res.text ?? '', 'a 204 response must have an empty body').toBe('');
    return;
  }
  expect(
    found?.response?.content?.['application/json']?.schema,
    `${method.toUpperCase()} ${path} ${res.status} has no application/json schema`,
  ).toBeDefined();
  const validate = ajv.compile({
    $ref: `openapi#${found?.pointer}/content/application~1json/schema`,
  });
  const valid = validate(res.body);
  expect(validate.errors ?? [], JSON.stringify(res.body)).toEqual([]);
  expect(valid).toBe(true);
}
