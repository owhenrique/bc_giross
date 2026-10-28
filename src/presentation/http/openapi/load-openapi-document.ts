import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** Reads and parses the `openapi.yaml` at the repository root, the source of truth for the contract. */
export function loadOpenApiDocument(): object {
  const yamlPath = new URL('../../../../openapi.yaml', import.meta.url);
  return parse(readFileSync(yamlPath, 'utf8')) as object;
}
