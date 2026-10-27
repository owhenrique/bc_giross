import { describe, expect, it } from 'vitest';
import { WindowRateLimiter } from './window-rate-limiter.js';

describe('WindowRateLimiter', () => {
  it('rejects when the window is full', () => {
    let time = 0;
    const limiter = new WindowRateLimiter(2, 1000, () => time);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    time = 999;
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('accepts again once the window has passed', () => {
    let time = 0;
    const limiter = new WindowRateLimiter(1, 1000, () => time);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    time = 1000;
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('slides the window instead of resetting it', () => {
    let time = 0;
    const limiter = new WindowRateLimiter(2, 1000, () => time);
    limiter.tryAcquire();
    time = 600;
    limiter.tryAcquire();
    time = 1000;
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });
});
