import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Metrics } from '../../src/observability/metrics.js';
import { startHttpServer, tokenMatches } from '../../src/observability/httpServer.js';
import { silentLogger } from '../helpers/fakes.js';
import type { Server } from 'node:http';

describe('servidor de health e métricas', () => {
  let server: Server;
  let base: string;
  const lavalinkUp = true;
  const token = 'a'.repeat(32);

  beforeAll(async () => {
    const metrics = new Metrics({
      activeSessions: () => 2,
      queuedTracks: () => 7,
      guilds: () => 3,
      discordPingMs: () => 42,
      lavalinkNodes: () => [
        { id: 'main', connected: lavalinkUp, playingPlayers: 1, restLatencyMs: 5 },
      ],
    });
    metrics.commands.inc({ command: 'play', outcome: 'ok' });
    server = await startHttpServer({
      host: '127.0.0.1',
      port: 0,
      metricsToken: token,
      metrics,
      logger: silentLogger,
      checks: {
        database: async () => ({ ok: true, latencyMs: 1 }),
        lavalink: async () => ({ ok: lavalinkUp }),
        lento: async () => new Promise(() => undefined),
      },
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('/healthz responde 200', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
  });

  it('/readyz reporta 503 se alguma dependência falha (inclui timeout)', async () => {
    const res = await fetch(`${base}/readyz`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { checks: Record<string, { ok: boolean; detail?: string }> };
    expect(body.checks.database?.ok).toBe(true);
    expect(body.checks.lento).toEqual({ ok: false, detail: 'timeout' });
  }, 10_000);

  it('/metrics exige token e não expõe dados de usuários', async () => {
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    expect(
      (await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer errado' } })).status,
    ).toBe(401);
    const res = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('aurora_active_sessions 2');
    expect(text).toContain('aurora_queued_tracks 7');
    expect(text).toContain('aurora_lavalink_node_up{node="main"} 1');
    expect(text).toContain('aurora_commands_total{command="play",outcome="ok"} 1');
    expect(text).toContain('aurora_process_resident_memory_bytes');
    // Dependências são verificadas a cada coleta (sem depender de alguém chamar /readyz).
    expect(text).toContain('aurora_dependency_up{dependency="database"} 1');
    expect(text).toContain('aurora_dependency_up{dependency="lento"} 0');
  }, 10_000);

  it('métodos e rotas desconhecidos', async () => {
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/admin`)).status).toBe(404);
  });

  it('comparação de token em tempo constante', () => {
    expect(tokenMatches(undefined, 'x')).toBe(false);
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
  });
});
