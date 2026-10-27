import type { Logger } from 'pino';
import { z } from 'zod';
import type {
  GeocodeCandidate,
  GeocodeLookup,
  GeocodeQuery,
  Geocoder,
} from '../../application/geocoder.js';
import { WindowRateLimiter } from './window-rate-limiter.js';

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
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly limiter: WindowRateLimiter;
  private readonly logger: Pick<Logger, 'warn'>;

  constructor(options: NominatimGeocoderOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl;
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.limiter = options.limiter ?? new WindowRateLimiter(1, 1000);
    this.logger = options.logger;
  }

  async search(query: GeocodeQuery): Promise<GeocodeLookup> {
    if (!this.limiter.tryAcquire()) {
      this.logger.warn(query, 'Nominatim rate limit reached, skipping search');
      return { status: 'unavailable' };
    }
    // The UF is not sent: `state` expects the state name, so the UF is checked on the result instead.
    const params = new URLSearchParams({
      street: query.street,
      city: query.city,
      countrycodes: 'br',
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
    });
    try {
      const response = await this.fetchFn(`${this.baseUrl}/search?${params}`, {
        headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'pt-BR' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status !== 200) {
        this.logger.warn({ ...query, status: response.status }, 'Nominatim unexpected status');
        return { status: 'unavailable' };
      }
      const body: unknown = await response.json().catch(() => undefined);
      return this.parse(query, body);
    } catch (error) {
      this.logger.warn({ ...query, err: error }, 'Nominatim request failed');
      return { status: 'unavailable' };
    }
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
