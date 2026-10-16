/** Fixed-window in-memory rate limiter (single-instance deployments). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** Records a hit; returns seconds to wait if the limit is exceeded, else 0. */
  hit(key: string): number {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    if (this.hits.size > 10000) this.sweep(now);
    return e.count > this.limit ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  clear() {
    this.hits.clear();
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
