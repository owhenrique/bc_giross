import type { BoundingBox } from '../../domain/geo/bounding-box.js';
import type { CepRepository, StoredCep } from '../../application/cep-repository.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

const select = { cep: true, uf: true, latitude: true, longitude: true } as const;

export class PrismaCepRepository implements CepRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByCep(cep: string): Promise<StoredCep | null> {
    return this.prisma.cep.findUnique({ where: { cep }, select });
  }

  findInBox(box: BoundingBox): Promise<StoredCep[]> {
    return this.prisma.cep.findMany({
      where: {
        latitude: { gte: box.minLat, lte: box.maxLat },
        longitude: { gte: box.minLon, lte: box.maxLon },
      },
      select,
    });
  }

  async findLoadedUfs(): Promise<string[]> {
    const rows = await this.prisma.loadedUf.findMany({ select: { uf: true } });
    return rows.map((row) => row.uf);
  }
}
