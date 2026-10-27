import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { SearchMetrics } from '../providers/searchService.js';

export interface MetricsSources {
  activeSessions(): number;
  queuedTracks(): number;
  guilds(): number;
  discordPingMs(): number;
  lavalinkNodes(): {
    id: string;
    connected: boolean;
    playingPlayers: number;
    restLatencyMs: number | null;
  }[];
}

/** Métricas Prometheus. Nenhum rótulo contém dados de usuários (sem IDs, sem consultas). */
export class Metrics implements SearchMetrics {
  readonly registry = new Registry();

  readonly commands = new Counter({
    name: 'aurora_commands_total',
    help: 'Comandos e interações executados',
    labelNames: ['command', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly commandDuration = new Histogram({
    name: 'aurora_command_duration_seconds',
    help: 'Latência de comandos (até a resposta final)',
    labelNames: ['command'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
    registers: [this.registry],
  });

  readonly playback = new Counter({
    name: 'aurora_playback_events_total',
    help: 'Eventos de reprodução (start, finished, failed, stuck)',
    labelNames: ['event'] as const,
    registers: [this.registry],
  });

  readonly providerRequests = new Counter({
    name: 'aurora_provider_requests_total',
    help: 'Pesquisas/resoluções por provedor e resultado',
    labelNames: ['provider', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly providerDuration = new Histogram({
    name: 'aurora_provider_request_duration_seconds',
    help: 'Latência das pesquisas no Lavalink por provedor',
    labelNames: ['provider'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8, 15],
    registers: [this.registry],
  });

  readonly reconnects = new Counter({
    name: 'aurora_reconnects_total',
    help: 'Reconexões (lavalink_node, voice, discord_gateway)',
    labelNames: ['target'] as const,
    registers: [this.registry],
  });

  readonly dependencyUp = new Gauge({
    name: 'aurora_dependency_up',
    help: '1 se a dependência respondeu ao último health check',
    labelNames: ['dependency'] as const,
    registers: [this.registry],
  });

  readonly errors = new Counter({
    name: 'aurora_errors_total',
    help: 'Erros inesperados por origem',
    labelNames: ['source'] as const,
    registers: [this.registry],
  });

  constructor(sources: MetricsSources) {
    collectDefaultMetrics({ register: this.registry, prefix: 'aurora_' });
    new Gauge({
      name: 'aurora_active_sessions',
      help: 'Sessões de voz ativas',
      registers: [this.registry],
      collect() {
        this.set(sources.activeSessions());
      },
    });
    new Gauge({
      name: 'aurora_queued_tracks',
      help: 'Total de faixas em todas as filas',
      registers: [this.registry],
      collect() {
        this.set(sources.queuedTracks());
      },
    });
    new Gauge({
      name: 'aurora_guilds',
      help: 'Servidores em que o bot está',
      registers: [this.registry],
      collect() {
        this.set(sources.guilds());
      },
    });
    new Gauge({
      name: 'aurora_discord_ws_ping_ms',
      help: 'Latência do gateway do Discord',
      registers: [this.registry],
      collect() {
        this.set(sources.discordPingMs());
      },
    });
    new Gauge({
      name: 'aurora_lavalink_node_up',
      help: '1 se o nó Lavalink está conectado',
      labelNames: ['node'] as const,
      registers: [this.registry],
      collect() {
        for (const node of sources.lavalinkNodes())
          this.set({ node: node.id }, node.connected ? 1 : 0);
      },
    });
    new Gauge({
      name: 'aurora_lavalink_playing_players',
      help: 'Players tocando por nó (reportado pelo Lavalink)',
      labelNames: ['node'] as const,
      registers: [this.registry],
      collect() {
        for (const node of sources.lavalinkNodes())
          this.set({ node: node.id }, node.playingPlayers);
      },
    });
    new Gauge({
      name: 'aurora_lavalink_latency_ms',
      help: 'Latência do heartbeat com o nó Lavalink',
      labelNames: ['node'] as const,
      registers: [this.registry],
      collect() {
        for (const node of sources.lavalinkNodes())
          if (node.restLatencyMs !== null) this.set({ node: node.id }, node.restLatencyMs);
      },
    });
  }

  observe(
    providerId: string,
    outcome: 'success' | 'empty' | 'error' | 'timeout',
    ms: number,
  ): void {
    this.providerRequests.inc({ provider: providerId, outcome });
    this.providerDuration.observe({ provider: providerId }, ms / 1000);
  }
}
