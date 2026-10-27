import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('redacts the Authorization request header', () => {
    const lines: string[] = [];
    const logger = createLogger('info', { write: (line: string) => void lines.push(line) });
    logger.info({ req: { headers: { authorization: 'Bearer secret-token' } } }, 'request');
    expect(lines.join('')).not.toContain('secret-token');
    expect(lines.join('')).toContain('[Redacted]');
  });
});
