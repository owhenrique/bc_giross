import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

export const CABECALHO = 'COD_UNICO_ENDERECO;CEP;LATITUDE;LONGITUDE;NV_GEO_COORD';

/** Linha do CSV: [cep, lat, lon, nv]. */
export type LinhaFixture = [string, string, string, string];

export async function criarZipCnefe(pasta: string, nome: string, linhas: LinhaFixture[]): Promise<string> {
  const caminho = join(pasta, nome);
  const zip = new yazl.ZipFile();
  const csv = [CABECALHO, ...linhas.map((l, i) => `${i + 1};${l.join(';')}`)].join('\n') + '\n';
  zip.addBuffer(Buffer.from(csv), nome.replace('.zip', '.csv'));
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(caminho));
  return caminho;
}
