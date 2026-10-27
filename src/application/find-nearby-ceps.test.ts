import { describe, expect, it } from "vitest";
import type { AddressLookup, CepAddressProvider } from "./cep-address-provider.js";
import type { CepRepository, StoredCep } from "./cep-repository.js";
import {
  AddressProviderUnavailableError,
  CepNotFoundError,
  CepOutOfCoverageError,
  CepWithoutLocationError,
  InvalidCepError,
  InvalidLimitError,
  InvalidPageError,
} from "./errors.js";
import { findNearbyCeps, type NearbyCepsResult } from "./find-nearby-ceps.js";

const KM_PER_DEGREE = 111.195;
const ORIGIN = {
  cep: "04551000",
  uf: "SP",
  latitude: -23.59,
  longitude: -46.68,
};

function cepAt(cep: string, km: number): StoredCep {
  return {
    cep,
    uf: "SP",
    latitude: ORIGIN.latitude + km / KM_PER_DEGREE,
    longitude: ORIGIN.longitude,
  };
}

const ADDRESS = {
  street: "Av. Teste",
  neighborhood: "Centro",
  city: "São Paulo",
  uf: "SP",
};

function fakeProvider(result: AddressLookup = { status: "not_found" }) {
  const calls: string[] = [];
  const provider: CepAddressProvider = {
    lookup: async (cep) => {
      calls.push(cep);
      return result;
    },
  };
  return { provider, calls };
}

function inMemoryRepository(items: StoredCep[], ufs: string[] = ["SP"]): CepRepository {
  return {
    findLoadedUfs: async () => ufs,
    findByCep: async (cep) => items.find((item) => item.cep === cep) ?? null,
    findInBox: async (box) =>
      items.filter(
        (item) =>
          item.latitude >= box.minLat &&
          item.latitude <= box.maxLat &&
          item.longitude >= box.minLon &&
          item.longitude <= box.maxLon,
      ),
  };
}

function search(
  items: StoredCep[],
  page = 1,
  limit = 50,
  radiusKm = 1,
): Promise<NearbyCepsResult> {
  return findNearbyCeps(
    inMemoryRepository([ORIGIN, ...items]),
    fakeProvider().provider,
    radiusKm,
  )({ cep: ORIGIN.cep, page, limit });
}

describe("findNearbyCeps", () => {
  it("throws CepNotFoundError when the origin is not in the repository", async () => {
    await expect(
      findNearbyCeps(
        inMemoryRepository([]),
        fakeProvider().provider,
        1,
      )({ cep: "99999999", page: 1, limit: 50 }),
    ).rejects.toBeInstanceOf(CepNotFoundError);
  });

  it("returns the origin from the dataset without including it as neighbor", async () => {
    const result = await search([cepAt("04551010", 0.5)]);
    expect(result.origin).toEqual({
      cep: ORIGIN.cep,
      lat: ORIGIN.latitude,
      lon: ORIGIN.longitude,
      source: "dataset",
      address: null,
    });
    expect(result.radiusKm).toBe(1);
    expect(result.neighbors.map((n) => n.cep)).toEqual(["04551010"]);
  });

  it("excludes a cep 1.004 km away when radius is 1 km", async () => {
    const result = await search([cepAt("04551020", 1.004)]);
    expect(result.neighbors).toEqual([]);
  });

  it("includes a cep 0.999 km away when radius is 1 km", async () => {
    const result = await search([cepAt("04551020", 0.999)]);
    expect(result.neighbors).toHaveLength(1);
    expect(result.neighbors[0]?.distanceKm).toBeLessThanOrEqual(1);
  });

  it("sorts by distance and breaks ties by cep", async () => {
    const result = await search([
      cepAt("04551050", 0.8),
      cepAt("04551030", 0.3),
      cepAt("04551040", 0.3),
      cepAt("04551020", 0.1),
    ]);
    expect(result.neighbors.map((n) => n.cep)).toEqual([
      "04551020",
      "04551030",
      "04551040",
      "04551050",
    ]);
  });

  describe("pagination", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      cepAt(`0455100${i + 1}`, 0.1 * (i + 1)),
    );

    it("reports total and totalPages", async () => {
      const result = await search(items, 1, 2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
      expect(result.neighbors.map((n) => n.cep)).toEqual([
        "04551001",
        "04551002",
      ]);
    });

    it("returns the second page", async () => {
      const result = await search(items, 2, 2);
      expect(result.neighbors.map((n) => n.cep)).toEqual([
        "04551003",
        "04551004",
      ]);
    });

    it("returns an empty page beyond the last one", async () => {
      const result = await search(items, 4, 2);
      expect(result.neighbors).toEqual([]);
      expect(result.pagination.total).toBe(5);
    });

    it("returns totalPages 0 when there are no neighbors", async () => {
      const result = await search([]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
      });
    });
  });
});

describe("findNearbyCeps input validation", () => {
  const run = (input: { cep: string; page?: number; limit?: number }) =>
    findNearbyCeps(inMemoryRepository([ORIGIN]), fakeProvider().provider, 1)(input);

  it("normalizes a cep with hyphen", async () => {
    expect((await run({ cep: "04551-000" })).origin.cep).toBe("04551000");
  });

  it("throws InvalidCepError for a malformed cep", async () => {
    await expect(run({ cep: "123" })).rejects.toBeInstanceOf(InvalidCepError);
  });

  it("applies default page and limit", async () => {
    expect((await run({ cep: ORIGIN.cep })).pagination).toMatchObject({
      page: 1,
      limit: 50,
    });
  });

  it.each([
    [{ page: 0 }, "page"],
    [{ page: 1.5 }, "page"],
    [{ page: NaN }, "page"],
    [{ limit: 0 }, "limit"],
    [{ limit: 201 }, "limit"],
    [{ limit: NaN }, "limit"],
  ] as const)("throws the matching error for %j", async (params, field) => {
    await expect(run({ cep: ORIGIN.cep, ...params })).rejects.toBeInstanceOf(
      field === "page" ? InvalidPageError : InvalidLimitError,
    );
  });
});

describe("findNearbyCeps address", () => {
  const found: AddressLookup = { status: "found", address: ADDRESS };
  const run = (
    lookup: AddressLookup,
    options: { withAddress?: boolean; items?: StoredCep[]; ufs?: string[] } = {},
  ) => {
    const { provider, calls } = fakeProvider(lookup);
    const result = findNearbyCeps(
      inMemoryRepository(options.items ?? [ORIGIN], options.ufs),
      provider,
      1,
    )({ cep: "04551000", withAddress: options.withAddress });
    return { result, calls };
  };
  const missing = (lookup: AddressLookup, ufs?: string[]) =>
    run(lookup, { items: [], ufs }).result;

  it("does not call the provider when the cep is stored and withAddress is off", async () => {
    const { result, calls } = run(found);
    expect((await result).origin.address).toBeNull();
    expect(calls).toEqual([]);
  });

  it("returns the address when stored, withAddress is on and lookup is found", async () => {
    const { result, calls } = run(found, { withAddress: true });
    expect((await result).origin.address).toEqual(ADDRESS);
    expect(calls).toEqual(["04551000"]);
  });

  it.each(["not_found", "unavailable"] as const)(
    "returns a null address when stored, withAddress is on and lookup is %s",
    async (status) => {
      const { result } = run({ status }, { withAddress: true });
      const value = await result;
      expect(value.origin.address).toBeNull();
      expect(value.neighbors).toEqual([]);
    },
  );

  it.each([false, true])(
    "throws CepNotFoundError when missing and lookup is not_found (withAddress=%s)",
    async (withAddress) => {
      await expect(
        run({ status: "not_found" }, { items: [], withAddress }).result,
      ).rejects.toBeInstanceOf(CepNotFoundError);
    },
  );

  it.each([false, true])(
    "throws AddressProviderUnavailableError when missing and lookup is unavailable (withAddress=%s)",
    async (withAddress) => {
      await expect(
        run({ status: "unavailable" }, { items: [], withAddress }).result,
      ).rejects.toBeInstanceOf(AddressProviderUnavailableError);
    },
  );

  it("throws CepWithoutLocationError when missing and the uf is loaded", async () => {
    await expect(missing(found, ["SP", "RJ"])).rejects.toBeInstanceOf(CepWithoutLocationError);
  });

  it("throws CepOutOfCoverageError when missing and the uf is not loaded", async () => {
    await expect(missing(found, ["RJ"])).rejects.toBeInstanceOf(CepOutOfCoverageError);
  });

  it("throws CepOutOfCoverageError when the provider returns no uf", async () => {
    const noUf: AddressLookup = { status: "found", address: { ...ADDRESS, uf: null } };
    await expect(missing(noUf)).rejects.toBeInstanceOf(CepOutOfCoverageError);
  });
});
