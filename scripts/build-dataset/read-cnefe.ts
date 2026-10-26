import { createInterface } from 'node:readline';
import yauzl from 'yauzl';

export interface RegistroCnefe {
  cep: string;
  lat: number;
  lon: number;
  nv: number;
}

const COLUNAS = ['CEP', 'LATITUDE', 'LONGITUDE', 'NV_GEO_COORD'] as const;

export function ufDoZip(caminho: string): string {
  const m = /(?:^|[\\/])\d+_([A-Z]{2})\.zip$/i.exec(caminho);
  if (!m) throw new Error(`Nome de ZIP fora do padrão <codigo>_<UF>.zip: ${caminho}`);
  return (m[1] as string).toUpperCase();
}

/** Converte uma linha do CSV; devolve null se faltar coordenada ou precisão numérica. */
export function parseLinha(campos: string[], idx: number[]): RegistroCnefe | null {
  const [iCep, iLat, iLon, iNv] = idx as [number, number, number, number];
  const lat = Number.parseFloat(campos[iLat] ?? '');
  const lon = Number.parseFloat(campos[iLon] ?? '');
  const nv = Number.parseInt(campos[iNv] ?? '', 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(nv)) return null;
  return { cep: (campos[iCep] ?? '').trim(), lat, lon, nv };
}

function abrirZip(caminho: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(caminho, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

/** Lê o CSV do ZIP em streaming. Linha sem coordenada ou precisão numérica vira `null`. */
export async function* lerCnefe(caminhoZip: string): AsyncGenerator<RegistroCnefe | null> {
  const zip = await abrirZip(caminhoZip);
  try {
    const entrada = await new Promise<yauzl.Entry>((resolve, reject) => {
      zip.once('entry', resolve);
      zip.once('end', () => reject(new Error(`ZIP sem arquivo CSV: ${caminhoZip}`)));
      zip.once('error', reject);
      zip.readEntry();
    });
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      zip.openReadStream(entrada, (err, s) => (err ? reject(err) : resolve(s)));
    });
    let idx: number[] | null = null;
    for await (const linha of createInterface({ input: stream, crlfDelay: Infinity })) {
      const campos = linha.split(';');
      if (!idx) {
        idx = COLUNAS.map((c) => campos.indexOf(c));
        if (idx.includes(-1)) throw new Error(`Cabeçalho do CNEFE sem colunas ${COLUNAS.join(', ')}: ${caminhoZip}`);
        continue;
      }
      yield parseLinha(campos, idx);
    }
  } finally {
    zip.close();
  }
}
