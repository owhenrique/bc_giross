export interface GeocodeQuery {
  street: string;
  city: string;
}

export interface GeocodeCandidate {
  lat: number;
  lon: number;
  city: string | null;
  uf: string | null;
}

/** An empty `candidates` list means the provider found nothing. */
export type GeocodeLookup =
  { status: 'found'; candidates: GeocodeCandidate[] } | { status: 'unavailable' };

/** Never throws: unavailability is a result, so the use case decides how to degrade. */
export interface Geocoder {
  search(query: GeocodeQuery): Promise<GeocodeLookup>;
}
