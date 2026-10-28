import type { Logger } from 'pino';
import { z } from 'zod';
import type { AddressLookup, CepAddressProvider } from '../../application/cep-address-provider.js';
import { WindowRateLimiter } from './window-rate-limiter.js';
import type { RateLimiter } from './rate-limiter.js';

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
  limiter?: RateLimiter;
  logger: Pick<Logger, 'warn'>;
}

export class BrasilApiCepProvider implements CepAddressProvider {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly limiter: RateLimiter;
  private readonly logger: Pick<Logger, 'warn'>;

  constructor(options: BrasilApiCepProviderOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? 'https://brasilapi.com.br/api/cep/v2';
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.limiter = options.limiter ?? new WindowRateLimiter(5, 1000);
    this.logger = options.logger;
  }

  async lookup(cep: string): Promise<AddressLookup> {
    if (!(await this.limiter.tryAcquire())) {
      this.logger.warn({ cep }, 'BrasilAPI rate limit reached, skipping lookup');
      return { status: 'unavailable' };
    }
    try {
      const response = await this.fetchFn(`${this.baseUrl}/${cep}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (response.status === 200) return this.parseFound(cep, body);
      if (response.status === 404) return this.parseNotFound(cep, body);
      this.logger.warn({ cep, status: response.status }, 'BrasilAPI unexpected status');
      return { status: 'unavailable' };
    } catch (error) {
      this.logger.warn({ cep, err: error }, 'BrasilAPI request failed');
      return { status: 'unavailable' };
    }
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
