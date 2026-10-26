import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCnefeZip } from './fixtures.js';
import { readCnefe, ufFromZip } from './read-cnefe.js';

const folder = mkdtempSync(join(tmpdir(), 'cnefe-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('ufFromZip', () => {
  it('extracts the UF from the name', () => {
    expect(ufFromZip('/x/35_SP.zip')).toBe('SP');
    expect(ufFromZip('12_AC.zip')).toBe('AC');
  });

  it('rejects a name outside the pattern', () => {
    expect(() => ufFromZip('qualquer.zip')).toThrow(/padrão/);
  });
});

describe('readCnefe', () => {
  it('streams records and marks lines without coordinate as null', async () => {
    const zip = await createCnefeZip(folder, '12_AC.zip', [
      ['69900126', '-9.972736', '-67.819202', '1'],
      ['69900127', '', '', '6'],
      ['69900128', '-9.5', '-67.5', '5'],
    ]);
    const records = [];
    for await (const r of readCnefe(zip)) records.push(r);
    expect(records).toEqual([
      { cep: '69900126', lat: -9.972736, lon: -67.819202, nv: 1 },
      null,
      { cep: '69900128', lat: -9.5, lon: -67.5, nv: 5 },
    ]);
  });
});
