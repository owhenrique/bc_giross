import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { criarZipCnefe } from './fixtures.js';
import { lerCnefe, ufDoZip } from './read-cnefe.js';

const pasta = mkdtempSync(join(tmpdir(), 'cnefe-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('ufDoZip', () => {
  it('extrai a UF do nome', () => {
    expect(ufDoZip('/x/35_SP.zip')).toBe('SP');
    expect(ufDoZip('12_AC.zip')).toBe('AC');
  });

  it('rejeita nome fora do padrão', () => {
    expect(() => ufDoZip('qualquer.zip')).toThrow(/padrão/);
  });
});

describe('lerCnefe', () => {
  it('lê registros em streaming e marca linhas sem coordenada como null', async () => {
    const zip = await criarZipCnefe(pasta, '12_AC.zip', [
      ['69900126', '-9.972736', '-67.819202', '1'],
      ['69900127', '', '', '6'],
      ['69900128', '-9.5', '-67.5', '5'],
    ]);
    const lidos = [];
    for await (const r of lerCnefe(zip)) lidos.push(r);
    expect(lidos).toEqual([
      { cep: '69900126', lat: -9.972736, lon: -67.819202, nv: 1 },
      null,
      { cep: '69900128', lat: -9.5, lon: -67.5, nv: 5 },
    ]);
  });
});
