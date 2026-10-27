import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Garante que uma sessão musical (por servidor) seja controlada por uma única instância.
 *
 * Observação importante: o gateway do Discord entrega os eventos de um servidor a um único
 * shard, então, com sharding correto, duas instâncias não disputam o mesmo servidor. O lease
 * protege contra má configuração (duas instâncias com o mesmo shard/token) e prepara a
 * evolução para múltiplas instâncias. O Lavalink não aceita fencing tokens; por isso o token
 * de fencing é verificado do lado do bot antes de cada comando ao motor (ver GuildSession).
 */
export interface SessionLease {
  readonly guildId: string;
  readonly fencingToken: number;
  /** true enquanto o lease ainda pertence a esta instância. */
  isValid(): boolean;
  release(): Promise<void>;
}

export interface LeaseManager {
  acquire(guildId: string): Promise<SessionLease | null>;
  close(): Promise<void>;
}

/** Instância única: sempre concede. */
export class LocalLeaseManager implements LeaseManager {
  private counter = 0;
  private readonly held = new Set<string>();

  acquire(guildId: string): Promise<SessionLease | null> {
    if (this.held.has(guildId)) return Promise.resolve(null);
    this.held.add(guildId);
    const token = ++this.counter;
    let valid = true;
    return Promise.resolve({
      guildId,
      fencingToken: token,
      isValid: () => valid,
      release: () => {
        valid = false;
        this.held.delete(guildId);
        return Promise.resolve();
      },
    });
  }

  close(): Promise<void> {
    this.held.clear();
    return Promise.resolve();
  }
}

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface RedisLeaseOptions {
  ttlMs?: number;
  renewEveryMs?: number;
  prefix?: string;
  onLost?: (guildId: string) => void;
}

/** Lease com expiração no Redis (SET NX PX + renovação com verificação de dono via Lua). */
export class RedisLeaseManager implements LeaseManager {
  private readonly ttlMs: number;
  private readonly renewEveryMs: number;
  private readonly prefix: string;
  private readonly active = new Map<string, { timer: NodeJS.Timeout; owner: string }>();

  constructor(
    private readonly redis: Redis,
    private readonly options: RedisLeaseOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.renewEveryMs = options.renewEveryMs ?? 10_000;
    this.prefix = options.prefix ?? 'aurora:lease:';
  }

  async acquire(guildId: string): Promise<SessionLease | null> {
    const key = this.prefix + guildId;
    const owner = randomUUID();
    const ok = await this.redis.set(key, owner, 'PX', this.ttlMs, 'NX');
    if (ok !== 'OK') return null;
    const fencingToken = await this.redis.incr(`${key}:fence`);
    let valid = true;

    const timer = setInterval(() => {
      this.redis
        .eval(RENEW_SCRIPT, 1, key, owner, String(this.ttlMs))
        .then((renewed) => {
          if (Number(renewed) !== 1) lose();
        })
        .catch(() => {
          // Sem Redis não há como provar a posse; após o TTL outra instância pode assumir.
        });
    }, this.renewEveryMs);
    timer.unref();

    const lose = () => {
      if (!valid) return;
      valid = false;
      clearInterval(timer);
      this.active.delete(guildId);
      this.options.onLost?.(guildId);
    };

    this.active.set(guildId, { timer, owner });

    return {
      guildId,
      fencingToken,
      isValid: () => valid,
      release: async () => {
        if (!valid) return;
        valid = false;
        clearInterval(timer);
        this.active.delete(guildId);
        await this.redis.eval(RELEASE_SCRIPT, 1, key, owner).catch(() => undefined);
      },
    };
  }

  async close(): Promise<void> {
    const entries = [...this.active.entries()];
    this.active.clear();
    await Promise.all(
      entries.map(async ([guildId, { timer, owner }]) => {
        clearInterval(timer);
        await this.redis
          .eval(RELEASE_SCRIPT, 1, this.prefix + guildId, owner)
          .catch(() => undefined);
      }),
    );
  }
}
