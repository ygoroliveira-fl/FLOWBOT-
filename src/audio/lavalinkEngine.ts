import { EventEmitter } from 'node:events';
import {
  LavalinkManager,
  type LavalinkNode,
  type Player,
  type GuildShardPayload,
  type Track as LavalinkTrack,
} from 'lavalink-client';
import type { Logger } from '../core/logger.js';
import { scrubSecrets } from '../core/logger.js';
import { ServiceUnavailableError } from '../core/errors.js';
import type { SearchResult, Track, TrackEndReason } from '../music/types.js';
import type {
  AudioEngine,
  AudioEngineEvents,
  ConnectOptions,
  NodeHealth,
  PlayOptions,
  SearchRequest,
} from './engine.js';
import { buildFilters, type FilterPreset } from './filters.js';

export interface LavalinkNodeConfig {
  id: string;
  host: string;
  port: number;
  password: string;
  secure: boolean;
}

export interface LavalinkEngineOptions {
  nodes: LavalinkNodeConfig[];
  /** Envia payloads do gateway (op 4) para o shard do servidor. */
  sendToShard: (guildId: string, payload: GuildShardPayload) => void;
  logger: Logger;
  searchTimeoutMs?: number;
}

const TRACK_END_REASONS = new Set<TrackEndReason>([
  'finished',
  'loadFailed',
  'stopped',
  'replaced',
  'cleanup',
]);

interface RawEvent {
  op?: string;
  type?: string;
  guildId?: string;
  track?: { encoded?: string };
  reason?: string;
  exception?: { message?: string | null; severity?: string };
  thresholdMs?: number;
  code?: number;
  byRemote?: boolean;
}

/**
 * Motor de áudio sobre o lavalink-client.
 *
 * Decisão: a fila do lavalink-client NÃO é usada. Configuramos autoSkip=false e mantemos a
 * fila em MusicQueue; os eventos chegam pelo evento "raw" do NodeManager (emitido antes do
 * processamento interno da biblioteca) e são traduzidos para AudioEngineEvents. Assim o
 * estado da fila tem uma única fonte de verdade e é testável sem Lavalink.
 */
export class LavalinkEngine extends EventEmitter implements AudioEngine {
  readonly manager: LavalinkManager;
  private readonly logger: Logger;
  private readonly searchTimeoutMs: number;

  constructor(private readonly options: LavalinkEngineOptions) {
    super();
    this.logger = options.logger.child({ module: 'lavalink' });
    this.searchTimeoutMs = options.searchTimeoutMs ?? 15_000;
    this.manager = new LavalinkManager({
      nodes: options.nodes.map((node) => ({
        id: node.id,
        host: node.host,
        port: node.port,
        authorization: node.password,
        secure: node.secure,
        retryAmount: Number.MAX_SAFE_INTEGER,
        retryDelay: 5_000,
        requestSignalTimeoutMS: this.searchTimeoutMs,
        heartBeatInterval: 30_000,
        enablePingOnStatsCheck: true,
      })),
      sendToShard: (guildId, payload) => options.sendToShard(guildId, payload),
      autoSkip: false,
      autoSkipOnResolveError: false,
      autoMove: true,
      emitNewSongsOnly: false,
      playerOptions: {
        defaultSearchPlatform: 'ytsearch',
        applyVolumeAsFilter: false,
        onDisconnect: { autoReconnect: false, destroyPlayer: false },
        // threshold 0 desativa a destruição automática por erros repetidos: tratamos na sessão.
        maxErrorsPerTime: { threshold: 0, maxAmount: 0 },
        minAutoPlayMs: 0,
        enforceSponsorBlockRequestForEventEnablement: false,
      },
      queueOptions: { maxPreviousTracks: 1 },
      advancedOptions: {
        enableDebugEvents: false,
        debugOptions: { playerDestroy: { dontThrowError: true, debugLog: false } },
      },
    });
    this.bindManagerEvents();
  }

  /** Deve ser chamado quando o cliente Discord estiver pronto. */
  async init(client: { id: string; username: string }): Promise<void> {
    await this.manager.init({ id: client.id, username: client.username });
  }

  /** Repassa eventos brutos do gateway (VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE / CHANNEL_DELETE). */
  async handleRawGatewayEvent(packet: unknown): Promise<void> {
    await this.manager.sendRawData(packet as Parameters<LavalinkManager['sendRawData']>[0]);
  }

  private bindManagerEvents(): void {
    const nodes = this.manager.nodeManager;
    nodes.on('connect', (node) => {
      this.logger.info({ node: node.id }, 'Nó Lavalink conectado');
      this.emit('nodeConnected', node.id);
    });
    nodes.on('disconnect', (node, reason) => {
      this.logger.warn({ node: node.id, code: reason?.code }, 'Nó Lavalink desconectado');
      this.emit('nodeDisconnected', node.id, reason?.reason ?? `code ${reason?.code ?? '?'}`);
    });
    nodes.on('reconnecting', (node) =>
      this.logger.info({ node: node.id }, 'Reconectando ao Lavalink'),
    );
    nodes.on('error', (node, error) =>
      this.logger.error({ node: node.id, err: sanitizeError(error) }, 'Erro no nó Lavalink'),
    );
    nodes.on('raw', (_node, payload) => this.handleRawNodePayload(payload as RawEvent));

    this.manager.on('playerDisconnect', (player) => this.emit('voiceDisconnected', player.guildId));
    this.manager.on('playerMove', (player, _old, newChannel) => {
      if (newChannel) this.emit('voiceMoved', player.guildId, newChannel);
    });
    this.manager.on('playerDestroy', (player, reason) => {
      // "ChannelDeleted" é disparado pela própria biblioteca ao apagarem o canal de voz.
      if (reason === 'ChannelDeleted') this.emit('voiceDisconnected', player.guildId);
    });
  }

  private handleRawNodePayload(payload: RawEvent): void {
    if (payload.op !== 'event' || !payload.guildId) return;
    const guildId = payload.guildId;
    const encoded = payload.track?.encoded ?? '';
    switch (payload.type) {
      case 'TrackStartEvent':
        this.emit('trackStart', guildId, encoded);
        break;
      case 'TrackEndEvent': {
        const reason = payload.reason as TrackEndReason;
        if (TRACK_END_REASONS.has(reason)) this.emit('trackEnd', guildId, encoded, reason);
        break;
      }
      case 'TrackExceptionEvent':
        this.emit(
          'trackException',
          guildId,
          encoded,
          scrubSecrets(payload.exception?.message ?? 'erro desconhecido'),
        );
        break;
      case 'TrackStuckEvent':
        this.emit('trackStuck', guildId, encoded, payload.thresholdMs ?? 0);
        break;
      case 'WebSocketClosedEvent':
        this.emit('voiceClosed', guildId, payload.code ?? 0, payload.byRemote ?? false);
        break;
      default:
        break;
    }
  }

  isAvailable(): boolean {
    return this.connectedNodes().length > 0;
  }

  private connectedNodes(): LavalinkNode[] {
    return [...this.manager.nodeManager.nodes.values()].filter((node) => node.connected);
  }

  private requirePlayer(guildId: string): Player {
    const player = this.manager.getPlayer(guildId);
    if (!player)
      throw new ServiceUnavailableError('Não estou conectado a um canal de voz.', 'NO_PLAYER');
    return player;
  }

  hasPlayer(guildId: string): boolean {
    return Boolean(this.manager.getPlayer(guildId));
  }

  async connect(options: ConnectOptions): Promise<void> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableError(
        'O servidor de áudio está indisponível no momento. Tente novamente em instantes.',
        'AUDIO_UNAVAILABLE',
      );
    }
    let player = this.manager.getPlayer(options.guildId);
    if (player && player.voiceChannelId === options.voiceChannelId && player.connected !== false)
      return;
    if (!player) {
      player = this.manager.createPlayer({
        guildId: options.guildId,
        voiceChannelId: options.voiceChannelId,
        textChannelId: options.textChannelId,
        selfDeaf: true,
        selfMute: false,
        volume: options.volume,
      });
      await player.connect();
      return;
    }
    if (player.voiceChannelId && player.voiceChannelId !== options.voiceChannelId) {
      await player.changeVoiceState({ voiceChannelId: options.voiceChannelId, selfDeaf: true });
      return;
    }
    await player.connect();
  }

  async destroy(guildId: string): Promise<void> {
    const player = this.manager.getPlayer(guildId);
    if (!player) return;
    try {
      await player.destroy('SessionEnded', true);
    } catch (error) {
      this.logger.warn({ guildId, err: sanitizeError(error) }, 'Falha ao destruir player');
      this.manager.deletePlayer(guildId);
    }
  }

  async play(guildId: string, encoded: string, options: PlayOptions = {}): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.play({
      track: { encoded },
      ...(options.startMs ? { position: options.startMs } : {}),
      ...(options.paused !== undefined ? { paused: options.paused } : { paused: false }),
      ...(options.volume !== undefined ? { volume: options.volume } : {}),
    });
    player.paused = options.paused ?? false;
  }

  async stop(guildId: string): Promise<void> {
    const player = this.manager.getPlayer(guildId);
    if (!player) return;
    await player.node.updatePlayer({ guildId, playerOptions: { track: { encoded: null } } });
    player.paused = false;
  }

  async setPaused(guildId: string, paused: boolean): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.node.updatePlayer({ guildId, playerOptions: { paused } });
    player.paused = paused;
    // Mantém a estimativa de posição do lavalink-client coerente após pausar.
    if (paused) player.lastPositionChange = null;
  }

  async seek(guildId: string, positionMs: number): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.node.updatePlayer({
      guildId,
      playerOptions: { position: Math.max(0, positionMs) },
    });
    player.lastPosition = positionMs;
    player.lastPositionChange = Date.now();
  }

  async setVolume(guildId: string, volume: number): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.setVolume(volume, true);
  }

  async setFilter(guildId: string, preset: FilterPreset): Promise<void> {
    const player = this.requirePlayer(guildId);
    await player.node.updatePlayer({
      guildId,
      playerOptions: { filters: buildFilters(preset) },
    });
  }

  getPositionMs(guildId: string): number | null {
    const player = this.manager.getPlayer(guildId);
    if (!player) return null;
    if (player.lastPositionChange === null) return player.lastPosition ?? null;
    return player.position;
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const node = this.manager.nodeManager.leastUsedNodes('playingPlayers').find((n) => n.connected);
    if (!node) {
      throw new ServiceUnavailableError(
        'O servidor de áudio está indisponível no momento. Tente novamente em instantes.',
        'AUDIO_UNAVAILABLE',
      );
    }
    request.signal?.throwIfAborted();
    const response = await node.search({ query: request.identifier }, undefined, false);
    request.signal?.throwIfAborted();
    switch (response.loadType) {
      case 'track':
      case 'search':
        return { kind: response.loadType, tracks: response.tracks.map(normalizeTrack) };
      case 'playlist':
        return {
          kind: 'playlist',
          tracks: response.tracks.map(normalizeTrack),
          ...(response.playlist?.name ? { playlistName: response.playlist.name } : {}),
        };
      case 'empty':
        return { kind: 'empty', tracks: [] };
      case 'error':
      default:
        this.logger.warn(
          {
            identifier: describeIdentifier(request.identifier),
            severity: response.exception?.severity,
          },
          'Lavalink retornou erro ao carregar faixa',
        );
        return {
          kind: 'error',
          tracks: [],
          errorMessage:
            response.exception?.severity === 'COMMON' && response.exception.message
              ? truncate(scrubSecrets(response.exception.message), 200)
              : 'A fonte não conseguiu carregar este conteúdo.',
        };
    }
  }

  health(): NodeHealth[] {
    return [...this.manager.nodeManager.nodes.values()].map((node) => ({
      id: node.id,
      connected: node.connected,
      players: node.stats?.players ?? 0,
      playingPlayers: node.stats?.playingPlayers ?? 0,
      uptimeMs: node.stats?.uptime ?? 0,
      cpuLavalinkLoad: node.stats?.cpu?.lavalinkLoad ?? null,
      memoryUsedBytes: node.stats?.memory?.used ?? null,
      restLatencyMs: node.heartBeatPing ?? null,
    }));
  }

  availableSources(): Set<string> | null {
    const infos = this.connectedNodes()
      .map((node) => node.info?.sourceManagers)
      .filter((list): list is string[] => Array.isArray(list));
    if (infos.length === 0) return null;
    return new Set(infos.flat());
  }

  async close(): Promise<void> {
    for (const player of [...this.manager.players.values()]) {
      await player.destroy('Shutdown', true).catch(() => undefined);
    }
    for (const node of [...this.manager.nodeManager.nodes.values()]) {
      try {
        node.destroy('Shutdown', false);
      } catch {
        // nó já desconectado
      }
    }
  }

  override on<E extends keyof AudioEngineEvents>(event: E, listener: AudioEngineEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<E extends keyof AudioEngineEvents>(event: E, listener: AudioEngineEvents[E]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export function normalizeTrack(track: LavalinkTrack): Track {
  const info = track.info;
  return {
    encoded: track.encoded ?? '',
    identifier: info.identifier,
    title: truncate(info.title || 'Sem título', 256),
    author: truncate(info.author || 'Desconhecido', 256),
    uri: info.uri || null,
    sourceName: String(info.sourceName ?? 'unknown'),
    durationMs: Number.isFinite(info.duration) ? info.duration : 0,
    isStream: Boolean(info.isStream),
    isSeekable: Boolean(info.isSeekable) && !info.isStream,
    artworkUrl: info.artworkUrl ?? track.pluginInfo?.artworkUrl ?? null,
    isrc: info.isrc ?? null,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Evita logar consultas completas de usuários; registra só o prefixo/host. */
function describeIdentifier(identifier: string): string {
  try {
    const url = new URL(identifier);
    return `${url.protocol}//${url.host}`;
  } catch {
    return identifier.split(':')[0] ?? 'search';
  }
}

function sanitizeError(error: unknown): { message: string; name?: string } {
  if (error instanceof Error) return { name: error.name, message: scrubSecrets(error.message) };
  return { message: scrubSecrets(String(error)) };
}
