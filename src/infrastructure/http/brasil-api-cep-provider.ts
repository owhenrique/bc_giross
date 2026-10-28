import type { Logger } from 'pino';
import { z } from 'zod';
import type { AddressLookup, CepAddressProvider } from '../../application/cep-address-provider.js';
import { WindowRateLimiter } from '../rate-limit/window-rate-limiter.js';
import { limitedFetch, type LimitedFetchOptions } from './limited-fetch.js';

const NOT_FOUND_PATTERN = /n[aã]o encontrado|not found/i;

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value ? value : null));

const foundSchema = z.object({
  street: optionalText,
  neighborhood: optionalText,
  city: optionalText,
  state: optionalText,
});

const notFoundSchema = z.object({
  errors: z.array(z.object({ message: z.string(), service: z.string().optional() })),
});

export interface BrasilApiCepProviderOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
  limiter?: WindowRateLimiter;
  logger: Pick<Logger, 'warn'>;
}

export class BrasilApiCepProvider implements CepAddressProvider {
  private readonly baseUrl: string;
  private readonly logger: Pick<Logger, 'warn'>;
  private readonly http: LimitedFetchOptions;

  constructor(options: BrasilApiCepProviderOptions) {
    this.baseUrl = options.baseUrl ?? 'https://brasilapi.com.br/api/cep/v2';
    this.logger = options.logger;
    this.http = {
      service: 'BrasilAPI',
      limiter: options.limiter ?? new WindowRateLimiter(5, 1000),
      timeoutMs: options.timeoutMs ?? 3000,
      logger: options.logger,
      fetch: options.fetch,
    };
  }

  async lookup(cep: string): Promise<AddressLookup> {
    const response = await limitedFetch(`${this.baseUrl}/${cep}`, this.http);
    if (!response.ok) return { status: 'unavailable' };
    if (response.status === 200) return this.parseFound(cep, response.body);
    if (response.status === 404) return this.parseNotFound(cep, response.body);
    this.logger.warn({ cep, status: response.status }, 'BrasilAPI unexpected status');
    return { status: 'unavailable' };
  }

  private parseFound(cep: string, body: unknown): AddressLookup {
    const parsed = foundSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn({ cep, issues: parsed.error.issues }, 'BrasilAPI invalid body');
      return { status: 'unavailable' };
    }
    const { street, neighborhood, city, state } = parsed.data;
    return {
      status: 'found',
      address: { street, neighborhood, city, uf: state },
    };
  }

  private parseNotFound(cep: string, body: unknown): AddressLookup {
    const parsed = notFoundSchema.safeParse(body);
    if (parsed.success && parsed.data.errors.some((e) => NOT_FOUND_PATTERN.test(e.message))) {
      return { status: 'not_found' };
    }
    this.logger.warn(
      { cep, errors: parsed.success ? parsed.data.errors : body },
      'BrasilAPI 404 without not-found message',
    );
    return { status: 'unavailable' };
  }
}
