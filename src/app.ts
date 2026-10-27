import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import type { GuildShardPayload } from 'lavalink-client';
import { Redis } from 'ioredis';
import type { Server } from 'node:http';
import { LavalinkEngine } from './audio/lavalinkEngine.js';
import type { Env } from './config/env.js';
import { LocalLeaseManager, RedisLeaseManager, type LeaseManager } from './core/lease.js';
import type { Logger } from './core/logger.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './core/rateLimiter.js';
import { AuditService } from './data/audit.js';
import { createDatabase, pingDatabase, type Database } from './data/db.js';
import { GuildSettingsService } from './data/guildSettings.js';
import { applyRetention, HistoryService } from './data/history.js';
import { PlaylistService } from './data/playlists.js';
import {
  DiscordPanelTransport,
  DiscordVoiceInspector,
  PrismaPanelStore,
} from './discord/adapters.js';
import { canPostIn, type AppContext } from './discord/context.js';
import { handleInteraction } from './discord/interactions.js';
import { TtlMap } from './discord/ttlMap.js';
import { createAutoplay } from './music/autoplay.js';
import { SessionManager } from './music/sessionManager.js';
import { AUTOPLAY_REQUESTER } from './music/session.js';
import { startHttpServer } from './observability/httpServer.js';
import { Metrics } from './observability/metrics.js';
import { SearchService } from './providers/searchService.js';
import { errorEmbed, infoEmbed, warnEmbed } from './ui/embeds.js';
import { PanelManager } from './ui/panelManager.js';
import { parseAccent } from './ui/theme.js';

export interface RunningApp {
  context: AppContext;
  stop(reason: string): Promise<void>;
}

/** Monta todas as dependências (injeção manual, explícita) e inicia o bot. */
export async function startApp(env: Env, logger: Logger): Promise<RunningApp> {
  const db: Database = createDatabase({ url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX });
  await pingDatabase(db); // falha cedo se o banco estiver inacessível

  let redis: Redis | null = null;
  if (env.REDIS_URL) {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(30_000, 500 * 2 ** Math.min(times, 6)),
    });
    redis.on('error', (error) =>
      logger.warn({ err: { message: error.message } }, 'Redis indisponível'),
    );
    await redis.connect();
  }

  const leases: LeaseManager = redis
    ? new RedisLeaseManager(redis, {
        onLost: (guildId) => logger.error({ guildId }, 'Lease da sessão perdido'),
      })
    : new LocalLeaseManager();
  const rateLimiter: RateLimiter = redis ? new RedisRateLimiter(redis) : new MemoryRateLimiter();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    allowedMentions: { parse: [] },
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      ReactionManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      PresenceManager: 0,
    }),
  });

  const engine = new LavalinkEngine({
    nodes: env.LAVALINK_NODES,
    logger,
    sendToShard: (guildId: string, payload: GuildShardPayload) =>
      client.guilds.cache.get(guildId)?.shard.send(payload),
  });

  const audit = new AuditService(db);
  const settings = new GuildSettingsService(db, audit, env.MAX_QUEUE_SIZE);
  const playlists = new PlaylistService(db, {
    maxPlaylistsPerUser: env.MAX_PLAYLISTS_PER_USER,
    maxTracksPerPlaylist: env.MAX_PLAYLIST_TRACKS,
  });
  const history = new HistoryService(db);
  const brand = { name: env.BOT_NAME, accent: parseAccent(env.BOT_ACCENT_COLOR) };

  // `sessions` é criado abaixo; as fontes de métricas são lidas tardiamente.
  let sessionsRef: SessionManager | null = null;
  const metrics = new Metrics({
    activeSessions: () => sessionsRef?.size ?? 0,
    queuedTracks: () => sessionsRef?.all().reduce((sum, s) => sum + s.queue.size, 0) ?? 0,
    guilds: () => client.guilds.cache.size,
    discordPingMs: () => Math.max(0, client.ws.ping),
    lavalinkNodes: () => engine.health(),
  });
  const search = new SearchService(engine, rateLimiter, metrics);

  const panels = new PanelManager(
    new DiscordPanelTransport(client),
    new PrismaPanelStore(db),
    brand,
    logger.child({ module: 'panel' }),
    {
      tickMs: env.PANEL_UPDATE_INTERVAL_MS,
      resolveChannel: async (session) => {
        const guildSettings = await settings.get(session.guildId);
        const guild = client.guilds.cache.get(session.guildId);
        if (
          guild &&
          guildSettings.panelChannelId &&
          canPostIn(client, guild, guildSettings.panelChannelId)
        ) {
          return guildSettings.panelChannelId;
        }
        return session.textChannelId;
      },
    },
  );

  const sessions = new SessionManager(
    engine,
    leases,
    {
      onChange: (session) => panels.schedule(session),
      onTrackStart: (session, item) => {
        metrics.playback.inc({ event: 'start' });
        if (item.requesterId === AUTOPLAY_REQUESTER) return;
        void settings
          .get(session.guildId)
          .then((s) =>
            s.historyEnabled
              ? history.record(session.guildId, item.requesterId, item.track)
              : undefined,
          )
          .catch((error: unknown) => logger.warn({ err: error }, 'Falha ao gravar histórico'));
      },
      onNotice: (session, message, level) => {
        if (level !== 'info') metrics.playback.inc({ event: 'failed' });
        const embed =
          level === 'error'
            ? errorEmbed(message)
            : level === 'warn'
              ? warnEmbed(message)
              : infoEmbed(message);
        void panels.notice(session, embed);
      },
      autoplay: createAutoplay(engine, logger.child({ module: 'autoplay' })),
    },
    new DiscordVoiceInspector(client),
    logger.child({ module: 'sessions' }),
    env.MAX_QUEUE_SIZE,
    {
      onSessionDestroyed: (session, reason) => {
        const text: Record<string, string> = {
          inactivity: 'Saí do canal por inatividade.',
          leave: 'Sessão encerrada.',
          shutdown: 'O bot está reiniciando. Volto em instantes — use `/play` de novo.',
          voice_disconnected: 'Fui desconectado do canal de voz.',
          audio_recovery_failed:
            'Não consegui retomar o áudio após uma falha do servidor de áudio.',
        };
        void panels.close(session.guildId, text[reason] ?? 'Sessão encerrada.');
      },
    },
  );
  sessionsRef = sessions;
  engine.on('nodeDisconnected', () => metrics.reconnects.inc({ target: 'lavalink_node' }));

  const context: AppContext = {
    env,
    logger,
    client,
    db,
    settings,
    playlists,
    history,
    audit,
    sessions,
    search,
    panels,
    engine,
    rateLimiter,
    metrics,
    brand,
    pendingSearches: new TtlMap(5 * 60_000),
    pendingConfirmations: new TtlMap(60_000),
  };

  // ── eventos do Discord ──
  client.on(Events.Raw, (packet: { t?: string }) => {
    if (
      packet.t === 'VOICE_STATE_UPDATE' ||
      packet.t === 'VOICE_SERVER_UPDATE' ||
      packet.t === 'CHANNEL_DELETE'
    ) {
      engine
        .handleRawGatewayEvent(packet)
        .catch((error: unknown) => logger.warn({ err: error }, 'Falha ao repassar evento de voz'));
    }
  });
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(context, interaction).catch((error: unknown) => {
      metrics.errors.inc({ source: 'interaction_router' });
      logger.error({ err: error }, 'Falha não tratada em interação');
    });
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guildId = newState.guild.id;
    const session = sessions.get(guildId);
    if (
      session &&
      (oldState.channelId === session.voiceChannelId ||
        newState.channelId === session.voiceChannelId)
    ) {
      sessions.refreshPresence(guildId);
    }
  });
  client.on(Events.GuildDelete, (guild) => void sessions.destroy(guild.id, 'leave'));
  client.on(Events.ShardReconnecting, () => metrics.reconnects.inc({ target: 'discord_gateway' }));
  client.on(Events.ShardError, (error) =>
    logger.warn({ err: { message: error.message } }, 'Erro no gateway do Discord'),
  );
  client.on(Events.Warn, (message) => logger.warn({ message }, 'Aviso do discord.js'));

  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, (readyClient) => {
      logger.info(
        { user: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
        'Conectado ao Discord',
      );
      engine
        .init({ id: readyClient.user.id, username: readyClient.user.username })
        .then(() => logger.info('Gerenciador Lavalink iniciado'))
        .catch((error: unknown) => logger.error({ err: error }, 'Falha ao iniciar Lavalink'));
      // Painéis de sessões anteriores ao reinício ficam marcados como encerrados.
      db.panelState
        .findMany({ take: 500 })
        .then((stale) => panels.closeStale(stale))
        .catch((error: unknown) => logger.warn({ err: error }, 'Falha ao limpar painéis antigos'));
      resolve();
    });
  });

  // ── HTTP (health + métricas) ──
  const server: Server = await startHttpServer({
    host: env.HTTP_HOST,
    port: env.HTTP_PORT,
    ...(env.METRICS_TOKEN ? { metricsToken: env.METRICS_TOKEN } : {}),
    metrics,
    logger,
    checks: {
      discord: () =>
        Promise.resolve({ ok: client.isReady(), latencyMs: Math.max(0, client.ws.ping) }),
      database: async () => ({ ok: true, latencyMs: Math.round(await pingDatabase(db)) }),
      lavalink: () =>
        Promise.resolve({
          ok: engine.isAvailable(),
          detail: `${engine.health().filter((n) => n.connected).length}/${engine.health().length} nós`,
        }),
      ...(redis
        ? {
            redis: async () => {
              const started = performance.now();
              await redis.ping();
              return { ok: true, latencyMs: Math.round(performance.now() - started) };
            },
          }
        : {}),
    },
  });
  logger.info({ port: env.HTTP_PORT }, 'Servidor de health/métricas ativo');

  // ── manutenção: retenção diária ──
  const runRetention = () =>
    applyRetention(db, {
      historyDays: env.HISTORY_RETENTION_DAYS,
      auditDays: env.AUDIT_RETENTION_DAYS,
    })
      .then((removed) => logger.info(removed, 'Retenção aplicada'))
      .catch((error: unknown) => logger.warn({ err: error }, 'Falha na retenção'));
  const retentionStart = setTimeout(() => void runRetention(), 60_000);
  const retentionTimer = setInterval(() => void runRetention(), 24 * 60 * 60_000);
  retentionStart.unref();
  retentionTimer.unref();

  await client.login(env.DISCORD_TOKEN);
  await ready;

  let stopping: Promise<void> | null = null;
  const stop = (reason: string) => {
    stopping ??= (async () => {
      logger.info({ reason }, 'Encerrando…');
      clearTimeout(retentionStart);
      clearInterval(retentionTimer);
      client.removeAllListeners(Events.InteractionCreate);
      await sessions.destroyAll('shutdown');
      panels.shutdown();
      await engine.close().catch(() => undefined);
      await leases.close().catch(() => undefined);
      await client.destroy().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.$disconnect().catch(() => undefined);
      if (redis) await redis.quit().catch(() => undefined);
      logger.info('Encerrado.');
    })();
    return stopping;
  };

  return { context, stop };
}
