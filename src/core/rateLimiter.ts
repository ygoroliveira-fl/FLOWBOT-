import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

/** Janela fixa em memória. Adequada para uma única instância. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    this.sweep(now);
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count++;
    const allowed = window.count <= limit;
    return Promise.resolve({
      allowed,
      remaining: Math.max(0, limit - window.count),
      retryAfterMs: allowed ? 0 : window.resetAt - now,
    });
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

/** Janela fixa no Redis (compartilhada entre instâncias). Em caso de falha do Redis, permite (fail-open) — limite é proteção anti-spam, não autorização. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly fallback: RateLimiter = new MemoryRateLimiter(),
    private readonly prefix = 'aurora:rl:',
  ) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    try {
      const [count, ttl] = (await this.redis.eval(
        CONSUME_SCRIPT,
        1,
        this.prefix + key,
        String(windowMs),
      )) as [number, number];
      const allowed = count <= limit;
      return {
        allowed,
        remaining: Math.max(0, limit - count),
        retryAfterMs: allowed ? 0 : Math.max(0, ttl),
      };
    } catch {
      return this.fallback.consume(key, limit, windowMs);
    }
  }
}
