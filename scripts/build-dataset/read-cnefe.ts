import { createInterface } from 'node:readline';
import yauzl from 'yauzl';

export interface CnefeRecord {
  cep: string;
  lat: number;
  lon: number;
  nv: number;
}

const COLUMNS = ['CEP', 'LATITUDE', 'LONGITUDE', 'NV_GEO_COORD'] as const;

export function ufFromZip(path: string): string {
  const m = /(?:^|[\\/])\d+_([A-Z]{2})\.zip$/i.exec(path);
  if (!m) throw new Error(`Nome de ZIP fora do padrão <codigo>_<UF>.zip: ${path}`);
  return (m[1] as string).toUpperCase();
}

export function parseLine(fields: string[], indexes: number[]): CnefeRecord | null {
  const [iCep, iLat, iLon, iNv] = indexes as [number, number, number, number];
  const lat = Number.parseFloat(fields[iLat] ?? '');
  const lon = Number.parseFloat(fields[iLon] ?? '');
  const nv = Number.parseInt(fields[iNv] ?? '', 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(nv)) return null;
  return { cep: (fields[iCep] ?? '').trim(), lat, lon, nv };
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

export async function* readCnefe(zipPath: string): AsyncGenerator<CnefeRecord | null> {
  const zip = await openZip(zipPath);
  try {
    const entry = await new Promise<yauzl.Entry>((resolve, reject) => {
      zip.once('entry', resolve);
      zip.once('end', () => reject(new Error(`ZIP sem arquivo CSV: ${zipPath}`)));
      zip.once('error', reject);
      zip.readEntry();
    });
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s)));
    });
    let indexes: number[] | null = null;
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      const fields = line.split(';');
      if (!indexes) {
        indexes = COLUMNS.map((c) => fields.indexOf(c));
        if (indexes.includes(-1))
          throw new Error(`Cabeçalho do CNEFE sem colunas ${COLUMNS.join(', ')}: ${zipPath}`);
        continue;
      }
      yield parseLine(fields, indexes);
    }
  } finally {
    zip.close();
  }
}
