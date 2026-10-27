import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { createCnefeZip } from './fixtures.js';
import { buildDataset } from './index.js';

const base = mkdtempSync(join(tmpdir(), 'build-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

async function buildInput(dir: string) {
  await createCnefeZip(dir, '12_AC.zip', [
    ['69900126', '-9.0', '-67.0', '1'],
    ['69900126', '-9.0', '-67.0', '2'], // duplicated point
    ['69900126', '-9.0', '-67.0004', '3'],
    ['69900126', '-1.0', '-1.0', '5'], // precision 5 is ignored
    ['69900127', '-9.5', '-67.5', '6'], // precision 6 only
    ['6990-128', '-9.5', '-67.5', '1'], // malformed CEP
    ['69900129', '', '', '1'], // no coordinate
  ]);
  await createCnefeZip(dir, '35_SP.zip', [
    ['01001000', '-23.55', '-46.63', '1'],
    ['01001000', '-23.55', '-46.57', '1'], // ~6 km apart: p90 > 2 km
    ['01310100', '-23.5614', '-46.6559', '4'],
  ]);
}

describe('buildDataset', () => {
  it('writes dataset, removed list and report; output is sorted and idempotent', async () => {
    const input = join(base, 'in');
    const s1 = join(base, 'out1');
    const s2 = join(base, 'out2');
    mkdirSync(input, { recursive: true });
    await buildInput(input);

    await buildDataset(input, s1);
    await buildDataset(input, s2);

    const gz = gunzipSync(readFileSync(join(s1, 'ceps.csv.gz'))).toString();
    expect(gz).toBe(
      [
        'cep;uf;latitude;longitude',
        '01310100;SP;-23.561400;-46.655900',
        '69900126;AC;-9.000000;-67.000200',
        '',
      ].join('\n'),
    );
    const removidos = readFileSync(join(s1, 'ceps-removidos.csv'), 'utf8');
    expect(removidos).toMatch(/^cep;uf;latitude;longitude;p90_km\n01001000;SP;/);

    const rel = readFileSync(join(s1, 'relatorio.md'), 'utf8');
    expect(rel).toContain('| AC | 1 | 0 | 2 | 1 |');
    expect(rel).toContain('| SP | 1 | 1 | 0 | 0 |');
    expect(rel).toContain('Tempo de execução');

    expect(
      readFileSync(join(s2, 'ceps.csv.gz')).equals(readFileSync(join(s1, 'ceps.csv.gz'))),
    ).toBe(true);
    expect(readFileSync(join(s2, 'ceps-removidos.csv'), 'utf8')).toBe(removidos);
  });

  it('CEP in two UFs keeps the one with more points and warns', async () => {
    const input = join(base, 'dup');
    mkdirSync(input, { recursive: true });
    await createCnefeZip(input, '12_AC.zip', [['69900126', '-9.0', '-67.0', '1']]);
    await createCnefeZip(input, '35_SP.zip', [
      ['69900126', '-23.55', '-46.63', '1'],
      ['69900126', '-23.55', '-46.6301', '1'],
    ]);
    const out = join(base, 'dup-out');
    await buildDataset(input, out);
    const gz = gunzipSync(readFileSync(join(out, 'ceps.csv.gz'))).toString();
    expect(gz).toBe(
      ['cep;uf;latitude;longitude', '69900126;SP;-23.550000;-46.630050', ''].join('\n'),
    );
    expect(readFileSync(join(out, 'relatorio.md'), 'utf8')).toContain(
      'CEP 69900126 presente em AC e SP; mantida SP',
    );
  });

  it('folder without ZIPs throws', async () => {
    const empty = join(base, 'empty');
    mkdirSync(empty);
    await expect(buildDataset(empty, join(base, 'x'))).rejects.toThrow(/Nenhum ZIP/);
  });
});

describe('CLI', () => {
  const run = (...args: string[]) =>
    spawnSync('npx', ['tsx', 'scripts/build-dataset/index.ts', ...args], { encoding: 'utf8' });

  it('without --pasta exits with non-zero code', () => {
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--pasta');
  });

  it('folder without ZIPs exits with non-zero code', () => {
    const empty = mkdtempSync(join(base, 'v-'));
    writeFileSync(join(empty, 'leia.txt'), 'x');
    const r = run('--pasta', empty);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Nenhum ZIP');
  });
});
