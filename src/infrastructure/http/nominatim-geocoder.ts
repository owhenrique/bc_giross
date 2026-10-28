import type { Logger } from 'pino';
import { z } from 'zod';
import type {
  GeocodeCandidate,
  GeocodeLookup,
  GeocodeQuery,
  Geocoder,
} from '../../application/geocoder.js';
import { WindowRateLimiter } from '../rate-limit/window-rate-limiter.js';
import { limitedFetch, type LimitedFetchOptions } from './limited-fetch.js';

const UF_PATTERN = /^BR-([A-Z]{2})$/;

const resultsSchema = z.array(
  z.object({
    lat: z.string(),
    lon: z.string(),
    address: z.object({
      city: z.string().optional(),
      town: z.string().optional(),
      village: z.string().optional(),
      municipality: z.string().optional(),
      'ISO3166-2-lvl4': z.string().optional(),
    }),
  }),
);

export interface NominatimGeocoderOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl: string;
  userAgent: string;
  timeoutMs?: number;
  limiter?: WindowRateLimiter;
  logger: Pick<Logger, 'warn'>;
}

export class NominatimGeocoder implements Geocoder {
  private readonly baseUrl: string;
  private readonly logger: Pick<Logger, 'warn'>;
  private readonly http: LimitedFetchOptions;

  constructor(options: NominatimGeocoderOptions) {
    this.baseUrl = options.baseUrl;
    this.logger = options.logger;
    this.http = {
      service: 'Nominatim',
      limiter: options.limiter ?? new WindowRateLimiter(1, 1000),
      timeoutMs: options.timeoutMs ?? 3000,
      logger: options.logger,
      headers: { 'User-Agent': options.userAgent, 'Accept-Language': 'pt-BR' },
      fetch: options.fetch,
    };
  }

  async search(query: GeocodeQuery): Promise<GeocodeLookup> {
    // The UF is not sent: `state` expects the state name, so the UF is checked on the result instead.
    const params = new URLSearchParams({
      street: query.street,
      city: query.city,
      countrycodes: 'br',
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
    });
    const response = await limitedFetch(`${this.baseUrl}/search?${params}`, this.http);
    if (!response.ok) return { status: 'unavailable' };
    if (response.status !== 200) {
      this.logger.warn({ ...query, status: response.status }, 'Nominatim unexpected status');
      return { status: 'unavailable' };
    }
    return this.parse(query, response.body);
  }

  private parse(query: GeocodeQuery, body: unknown): GeocodeLookup {
    const parsed = resultsSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn({ ...query, issues: parsed.error.issues }, 'Nominatim invalid body');
      return { status: 'unavailable' };
    }
    const candidates: GeocodeCandidate[] = [];
    for (const { lat, lon, address } of parsed.data) {
      const latitude = Number(lat);
      const longitude = Number(lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      candidates.push({
        lat: latitude,
        lon: longitude,
        city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
        uf: UF_PATTERN.exec(address['ISO3166-2-lvl4'] ?? '')?.[1] ?? null,
      });
    }
    return { status: 'found', candidates };
  }
}
