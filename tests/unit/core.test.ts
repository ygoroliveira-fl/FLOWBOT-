import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, KeyedSerialQueue, retry, withTimeout } from '../../src/core/async.js';
import { LocalLeaseManager } from '../../src/core/lease.js';
import { scrubSecrets } from '../../src/core/logger.js';
import { MemoryRateLimiter } from '../../src/core/rateLimiter.js';
import { TtlMap } from '../../src/discord/ttlMap.js';

describe('utilitários centrais', () => {
  it('backoff exponencial com jitter fica dentro do teto', () => {
    expect(backoffDelay(0, { baseMs: 1000, random: () => 0.999 })).toBeLessThan(1000);
    expect(backoffDelay(3, { baseMs: 1000, random: () => 0.999 })).toBeLessThan(8000);
    expect(backoffDelay(30, { baseMs: 1000, maxMs: 5000, random: () => 0.999 })).toBeLessThan(5000);
    expect(backoffDelay(5, { random: () => 0 })).toBe(0);
  });

  it('retry tenta novamente e respeita shouldRetry', async () => {
    let calls = 0;
    const value = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('falha');
        return 'ok';
      },
      { attempts: 5, sleep: async () => undefined },
    );
    expect(value).toBe('ok');
    expect(calls).toBe(3);
    await expect(
      retry(
        async () => {
          throw new Error('fatal');
        },
        { attempts: 5, shouldRetry: () => false, sleep: async () => undefined },
      ),
    ).rejects.toThrow('fatal');
  });

  it('withTimeout rejeita operações lentas', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, 'op')).rejects.toThrow(
      'op excedeu 10ms',
    );
    await expect(withTimeout(Promise.resolve(1), 100, 'op')).resolves.toBe(1);
  });

  it('KeyedSerialQueue serializa por chave e paraleliza chaves diferentes', async () => {
    const q = new KeyedSerialQueue();
    const order: string[] = [];
    const task = (label: string, ms: number) => () =>
      new Promise<void>((r) =>
        setTimeout(() => {
          order.push(label);
          r();
        }, ms),
      );
    await Promise.all([
      q.run('a', task('a1', 30)),
      q.run('a', task('a2', 1)),
      q.run('b', task('b1', 5)),
    ]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
    await expect(
      q.run('a', async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    await expect(q.run('a', async () => 7)).resolves.toBe(7); // falha anterior não trava a fila
  });

  it('rate limiter em memória por janela', async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect((await rl.consume('k', 3, 1000)).allowed).toBe(true);
    const blocked = await rl.consume('k', 3, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
    now = 1001;
    expect((await rl.consume('k', 3, 1000)).allowed).toBe(true);
  });

  it('lease local impede duas sessões para o mesmo servidor', async () => {
    const leases = new LocalLeaseManager();
    const first = await leases.acquire('g');
    expect(first).not.toBeNull();
    expect(await leases.acquire('g')).toBeNull();
    await first!.release();
    expect(first!.isValid()).toBe(false);
    const second = await leases.acquire('g');
    expect(second!.fencingToken).toBeGreaterThan(first!.fencingToken);
  });

  it('TtlMap expira e limita tamanho', () => {
    let now = 0;
    const map = new TtlMap<number>(100, 2, () => now);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    expect(map.get('a')).toBeUndefined();
    expect(map.take('b')).toBe(2);
    expect(map.get('b')).toBeUndefined();
    now = 200;
    expect(map.get('c')).toBeUndefined();
  });

  it('remove segredos de mensagens livres', () => {
    const fakeToken = ['MTA' + 'x'.repeat(21), 'abcdef', 'y'.repeat(30)].join('.');
    const text = scrubSecrets(
      `erro ${fakeToken} postgresql://user:senha@db:5432/x authorization: abc123`,
    );
    expect(text).not.toContain('senha');
    expect(text).not.toContain('abc123');
    expect(text).toContain('[DISCORD_TOKEN]');
  });

  it('sleep respeita AbortSignal', async () => {
    vi.useFakeTimers();
    const { sleep } = await import('../../src/core/async.js');
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort(new Error('cancelado'));
    await expect(promise).rejects.toThrow('cancelado');
    vi.useRealTimers();
  });
});
