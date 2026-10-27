import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from '../../src/config/env.js';

const valid = {
  DISCORD_TOKEN: 'x'.repeat(60),
  DISCORD_CLIENT_ID: '123456789012345678',
  DATABASE_URL: 'postgresql://aurora:pw@postgres:5432/aurora',
  LAVALINK_NODES: 'main|lavalink|2333|segredo|false',
};

describe('configuração', () => {
  it('aplica padrões e interpreta nós Lavalink', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('production');
    expect(env.BOT_NAME).toBe('Aurora');
    expect(env.LAVALINK_NODES).toEqual([
      { id: 'main', host: 'lavalink', port: 2333, password: 'segredo', secure: false },
    ]);
    expect(env.METRICS_TOKEN).toBeUndefined();
  });

  it('aceita vários nós e ignora variáveis vazias', () => {
    const env = loadEnv({
      ...valid,
      LAVALINK_NODES: 'a|h1|2333|p|false, b|h2|443|q|true',
      REDIS_URL: '',
    });
    expect(env.LAVALINK_NODES).toHaveLength(2);
    expect(env.LAVALINK_NODES[1]?.secure).toBe(true);
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('lista todos os problemas sem expor valores', () => {
    try {
      loadEnv({
        ...valid,
        DISCORD_TOKEN: 'curto-segredo',
        DATABASE_URL: 'mysql://x',
        LAVALINK_NODES: 'quebrado',
        METRICS_TOKEN: 'pequeno',
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain('DISCORD_TOKEN');
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('LAVALINK_NODES');
      expect(message).toContain('METRICS_TOKEN');
      expect(message).not.toContain('curto-segredo');
    }
  });

  it('exige variáveis obrigatórias', () => {
    expect(() => loadEnv({})).toThrow(ConfigError);
  });
});
