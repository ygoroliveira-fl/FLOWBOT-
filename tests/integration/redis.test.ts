import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisLeaseManager } from '../../src/core/lease.js';
import { RedisRateLimiter } from '../../src/core/rateLimiter.js';
import { TEST_REDIS_URL } from './db.js';

describe.skipIf(!TEST_REDIS_URL)('Redis (integração)', () => {
  let redis: Redis;
  const prefix = `test:${Date.now()}:`;

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_URL!, { lazyConnect: true });
    await redis.connect();
  });
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('lease exclusivo entre "instâncias", com fencing token crescente', async () => {
    const a = new RedisLeaseManager(redis, {
      prefix: `${prefix}lease:`,
      ttlMs: 1000,
      renewEveryMs: 200,
    });
    const b = new RedisLeaseManager(redis, {
      prefix: `${prefix}lease:`,
      ttlMs: 1000,
      renewEveryMs: 200,
    });
    const first = await a.acquire('g1');
    expect(first).not.toBeNull();
    expect(await b.acquire('g1')).toBeNull();
    await new Promise((r) => setTimeout(r, 1500)); // renovação mantém o lease além do TTL
    expect(await b.acquire('g1')).toBeNull();
    await first!.release();
    const second = await b.acquire('g1');
    expect(second!.fencingToken).toBeGreaterThan(first!.fencingToken);
    await a.close();
    await b.close();
  });

  it('lease perdido é detectado (ex.: expirou enquanto o processo travou)', async () => {
    let lost = '';
    const a = new RedisLeaseManager(redis, {
      prefix: `${prefix}lease2:`,
      ttlMs: 5000,
      renewEveryMs: 100,
      onLost: (g) => (lost = g),
    });
    const lease = await a.acquire('g2');
    await redis.set(`${prefix}lease2:g2`, 'outra-instancia');
    await new Promise((r) => setTimeout(r, 300));
    expect(lease!.isValid()).toBe(false);
    expect(lost).toBe('g2');
    await a.close();
  });

  it('rate limit compartilhado', async () => {
    const limiter = new RedisRateLimiter(redis, undefined, `${prefix}rl:`);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.consume('u1', 3, 10_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterMs).toBeGreaterThan(0);
  });
});
