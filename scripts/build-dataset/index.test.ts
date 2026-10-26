import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { criarZipCnefe } from './fixtures.js';
import { construirDataset } from './index.js';

const base = mkdtempSync(join(tmpdir(), 'build-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

async function montarEntrada(dir: string) {
  await criarZipCnefe(dir, '12_AC.zip', [
    ['69900126', '-9.0', '-67.0', '1'],
    ['69900126', '-9.0', '-67.0', '2'], // ponto duplicado
    ['69900126', '-9.0', '-67.0004', '3'],
    ['69900126', '-1.0', '-1.0', '5'], // precisão 5 ignorada
    ['69900127', '-9.5', '-67.5', '6'], // só precisão 6
    ['6990-128', '-9.5', '-67.5', '1'], // CEP sujo
    ['69900129', '', '', '1'], // sem coordenada
  ]);
  await criarZipCnefe(dir, '35_SP.zip', [
    ['01001000', '-23.55', '-46.63', '1'],
    ['01001000', '-23.55', '-46.57', '1'], // ~6 km entre pontos: p90 > 2 km
    ['01310100', '-23.5614', '-46.6559', '4'],
  ]);
}

describe('construirDataset', () => {
  it('gera base, removidos e relatório; saída ordenada e idempotente', async () => {
    const entrada = join(base, 'in');
    const s1 = join(base, 'out1');
    const s2 = join(base, 'out2');
    mkdirSync(entrada, { recursive: true });
    await montarEntrada(entrada);

    await construirDataset(entrada, s1);
    await construirDataset(entrada, s2);

    const gz = gunzipSync(readFileSync(join(s1, 'ceps.csv.gz'))).toString();
    expect(gz).toBe(
      ['cep;uf;latitude;longitude', '01310100;SP;-23.561400;-46.655900', '69900126;AC;-9.000000;-67.000200', ''].join('\n'),
    );
    const removidos = readFileSync(join(s1, 'ceps-removidos.csv'), 'utf8');
    expect(removidos).toMatch(/^cep;uf;latitude;longitude;p90_km\n01001000;SP;/);

    const rel = readFileSync(join(s1, 'relatorio.md'), 'utf8');
    expect(rel).toContain('| AC | 1 | 0 | 2 | 1 |');
    expect(rel).toContain('| SP | 1 | 1 | 0 | 0 |');
    expect(rel).toContain('Tempo de execução');

    expect(readFileSync(join(s2, 'ceps.csv.gz')).equals(readFileSync(join(s1, 'ceps.csv.gz')))).toBe(true);
    expect(readFileSync(join(s2, 'ceps-removidos.csv'), 'utf8')).toBe(removidos);
  });

  it('pasta sem ZIPs lança erro', async () => {
    const vazia = join(base, 'vazia');
    mkdirSync(vazia);
    await expect(construirDataset(vazia, join(base, 'x'))).rejects.toThrow(/Nenhum ZIP/);
  });
});

describe('CLI', () => {
  const rodar = (...args: string[]) =>
    spawnSync('npx', ['tsx', 'scripts/build-dataset/index.ts', ...args], { encoding: 'utf8' });

  it('sem --pasta sai com código ≠ 0', () => {
    const r = rodar();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--pasta');
  });

  it('pasta sem ZIPs sai com código ≠ 0', () => {
    const vazia = mkdtempSync(join(base, 'v-'));
    writeFileSync(join(vazia, 'leia.txt'), 'x');
    const r = rodar('--pasta', vazia);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Nenhum ZIP');
  });
});
