import type { BoundingBox } from '../domain/geo/bounding-box.js';

export interface StoredCep {
  cep: string;
  uf: string;
  latitude: number;
  longitude: number;
}

export interface CepRepository {
  findByCep(cep: string): Promise<StoredCep | null>;
  findInBox(box: BoundingBox): Promise<StoredCep[]>;
}
