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

export type GeocodeLookup =
  { status: 'found'; candidates: GeocodeCandidate[] } | { status: 'unavailable' };

export interface Geocoder {
  search(query: GeocodeQuery): Promise<GeocodeLookup>;
}
