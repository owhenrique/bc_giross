/** Outbound call limiter: `tryAcquire` returns whether a call may proceed now; it never waits. */
export interface RateLimiter {
  tryAcquire(): boolean | Promise<boolean>;
}
