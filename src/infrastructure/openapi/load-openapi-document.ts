import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export function loadOpenApiDocument(): object {
  const yamlPath = new URL('../../../openapi.yaml', import.meta.url);
  return parse(readFileSync(yamlPath, 'utf8')) as object;
}
