import { describe, expect, it, vi } from 'vitest';
import { BrasilApiCepProvider } from './brasil-api-cep-provider.js';
import { WindowRateLimiter } from '../rate-limit/window-rate-limiter.js';

const NOT_FOUND_BODY = {
  name: 'CepPromiseError',
  message: 'Todos os serviços de CEP retornaram erro.',
  type: 'service_error',
  errors: [
    {
      name: 'ServiceError',
      message: 'Erro ao se conectar com o serviço ViaCEP.',
      service: 'viacep',
    },
    {
      name: 'ServiceError',
      message: 'Erro ao se conectar com o serviço WideNet.',
      service: 'widenet',
    },
    {
      name: 'ServiceError',
      message: 'Erro ao analisar a resposta do serviço Correios.',
      service: 'correios',
    },
    {
      name: 'ServiceError',
      message: 'CEP não encontrado na base dos Correios.',
      service: 'correios-alt',
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(fetchImpl: typeof fetch, extra: { limiter?: WindowRateLimiter } = {}) {
  const logger = { warn: vi.fn() };
  const fetchMock = vi.fn(fetchImpl);
  const provider = new BrasilApiCepProvider({
    fetch: fetchMock as typeof fetch,
    logger,
    ...extra,
  });
  return { provider, logger, fetchMock };
}

describe('BrasilApiCepProvider', () => {
  it('returns the address on 200, mapping empty strings to null and ignoring location', async () => {
    const { provider, fetchMock } = setup(async () =>
      json({
        cep: '04551000',
        state: 'SP',
        city: 'São Paulo',
        neighborhood: '',
        street: 'Rua X',
        location: {},
      }),
    );
    expect(await provider.lookup('04551000')).toEqual({
      status: 'found',
      address: {
        street: 'Rua X',
        neighborhood: null,
        city: 'São Paulo',
        uf: 'SP',
      },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://brasilapi.com.br/api/cep/v2/04551000');
  });

  it('returns not_found on 404 when some service says not found', async () => {
    const { provider, logger } = setup(async () => json(NOT_FOUND_BODY, 404));
    expect(await provider.lookup('00000001')).toEqual({ status: 'not_found' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns unavailable on 404 with only connection failures', async () => {
    const errors = NOT_FOUND_BODY.errors
      .slice(0, 3)
      .map(({ message, service }) => ({ message, service }));
    const { provider, logger } = setup(async () => json({ errors }, 404));
    expect(await provider.lookup('00000001')).toEqual({
      status: 'unavailable',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ cep: '00000001', errors }),
      expect.any(String),
    );
  });

  it('returns unavailable on 404 without errors[]', async () => {
    const { provider, logger } = setup(async () => json({ message: 'x' }, 404));
    expect(await provider.lookup('00000001')).toEqual({
      status: 'unavailable',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns unavailable on 500', async () => {
    const { provider, logger } = setup(async () => json({}, 500));
    expect(await provider.lookup('04551000')).toEqual({
      status: 'unavailable',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns unavailable on invalid body', async () => {
    const { provider, logger } = setup(async () => json({ street: 123 }));
    expect(await provider.lookup('04551000')).toEqual({
      status: 'unavailable',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns unavailable without calling fetch when the limiter denies', async () => {
    const limiter = new WindowRateLimiter(0, 1000);
    const { provider, fetchMock } = setup(async () => json({}), { limiter });
    expect(await provider.lookup('04551000')).toEqual({
      status: 'unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
