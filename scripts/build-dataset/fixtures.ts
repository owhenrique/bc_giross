import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

export const HEADER = 'COD_UNICO_ENDERECO;CEP;LATITUDE;LONGITUDE;NV_GEO_COORD';

/** CSV line: [cep, lat, lon, nv]. */
export type FixtureLine = [string, string, string, string];

export async function createCnefeZip(folder: string, name: string, lines: FixtureLine[]): Promise<string> {
  const path = join(folder, name);
  const zip = new yazl.ZipFile();
  const csv = [HEADER, ...lines.map((l, i) => `${i + 1};${l.join(';')}`)].join('\n') + '\n';
  zip.addBuffer(Buffer.from(csv), name.replace('.zip', '.csv'));
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
  return path;
}
