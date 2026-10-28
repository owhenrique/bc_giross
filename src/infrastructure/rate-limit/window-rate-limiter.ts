/** In-memory sliding-window limiter: allows up to `max` acquisitions per `windowMs`, never waits. */
export class WindowRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryAcquire(): boolean {
    const current = this.now();
    while (this.timestamps.length > 0 && current - this.timestamps[0]! >= this.windowMs) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.max) return false;
    this.timestamps.push(current);
    return true;
  }
}
