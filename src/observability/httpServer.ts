import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { Logger } from '../core/logger.js';
import type { Metrics } from './metrics.js';

export type CheckResult = { ok: boolean; latencyMs?: number; detail?: string };
export type HealthChecks = Record<string, () => Promise<CheckResult>>;

export interface HttpServerOptions {
  host: string;
  port: number;
  metricsToken?: string;
  metrics: Metrics;
  checks: HealthChecks;
  logger: Logger;
}

/** Compara tokens em tempo constante (hash antes para igualar tamanhos). */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function runChecks(
  checks: HealthChecks,
): Promise<{ ok: boolean; checks: Record<string, CheckResult> }> {
  const entries: (readonly [string, CheckResult])[] = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<readonly [string, CheckResult]> => {
      try {
        const result = await Promise.race([
          check(),
          new Promise<CheckResult>((resolve) =>
            setTimeout(() => resolve({ ok: false, detail: 'timeout' }), 3000).unref(),
          ),
        ]);
        return [name, result];
      } catch {
        return [name, { ok: false, detail: 'error' }];
      }
    }),
  );
  const results: Record<string, CheckResult> = Object.fromEntries(entries);
  return { ok: entries.every(([, r]) => r.ok), checks: results };
}

/**
 * Servidor HTTP interno: /healthz (vivo), /readyz (dependências) e /metrics (Prometheus,
 * exige Bearer token). Não deve ser exposto à internet — ver docs/SECURITY.md.
 */
export function startHttpServer(options: HttpServerOptions): Promise<Server> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((error: unknown) => {
      options.logger.error({ err: error }, 'Erro no servidor HTTP');
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  async function checkAndRecord() {
    const result = await runChecks(options.checks);
    for (const [name, check] of Object.entries(result.checks)) {
      options.metrics.dependencyUp.set({ dependency: name }, check.ok ? 1 : 0);
    }
    return result;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
    const path = (req.url ?? '/').split('?')[0];
    switch (path) {
      case '/healthz':
        return json(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) });
      case '/readyz': {
        const result = await checkAndRecord();
        return json(res, result.ok ? 200 : 503, result);
      }
      case '/metrics': {
        if (!options.metricsToken) return json(res, 404, { error: 'metrics_disabled' });
        const header = req.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
        if (!tokenMatches(token, options.metricsToken)) {
          res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
          return;
        }
        // Atualiza aurora_dependency_up a cada coleta para os alertas não usarem valor antigo.
        await checkAndRecord();
        const body = await options.metrics.registry.metrics();
        res.writeHead(200, { 'content-type': options.metrics.registry.contentType });
        res.end(body);
        return;
      }
      default:
        return json(res, 404, { error: 'not_found' });
    }
  }

  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
