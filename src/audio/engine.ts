import type { SearchResult, TrackEndReason } from '../music/types.js';
import type { FilterPreset } from './filters.js';

/** Eventos emitidos pelo motor de áudio, já normalizados por servidor. */
export interface AudioEngineEvents {
  trackStart: (guildId: string, encoded: string) => void;
  trackEnd: (guildId: string, encoded: string, reason: TrackEndReason) => void;
  trackException: (guildId: string, encoded: string, message: string) => void;
  trackStuck: (guildId: string, encoded: string, thresholdMs: number) => void;
  /** WebSocket de voz do Discord fechado (ex.: 4014 desconectado, 4006 sessão inválida). */
  voiceClosed: (guildId: string, code: number, byRemote: boolean) => void;
  /** O bot saiu do canal de voz (expulso, canal apagado ou desconexão). */
  voiceDisconnected: (guildId: string) => void;
  voiceMoved: (guildId: string, channelId: string) => void;
  nodeConnected: (nodeId: string) => void;
  nodeDisconnected: (nodeId: string, reason: string) => void;
}

export interface ConnectOptions {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  volume: number;
}

export interface PlayOptions {
  volume?: number;
  startMs?: number;
  paused?: boolean;
}

export interface NodeHealth {
  id: string;
  connected: boolean;
  players: number;
  playingPlayers: number;
  uptimeMs: number;
  cpuLavalinkLoad: number | null;
  memoryUsedBytes: number | null;
  restLatencyMs: number | null;
}

export interface SearchRequest {
  /** Identificador completo enviado ao Lavalink: "ytsearch:termo" ou uma URL. */
  identifier: string;
  signal?: AbortSignal;
}

/**
 * Contrato entre o domínio musical e o motor de áudio. A implementação real é LavalinkEngine;
 * os testes usam um motor falso. Nada aqui conhece filas ou permissões.
 */
export interface AudioEngine {
  on<E extends keyof AudioEngineEvents>(event: E, listener: AudioEngineEvents[E]): this;
  off<E extends keyof AudioEngineEvents>(event: E, listener: AudioEngineEvents[E]): this;

  /** Há ao menos um nó conectado e pronto. */
  isAvailable(): boolean;
  connect(options: ConnectOptions): Promise<void>;
  /** Sai do canal e destrói o player. Idempotente. */
  destroy(guildId: string): Promise<void>;
  hasPlayer(guildId: string): boolean;
  play(guildId: string, encoded: string, options?: PlayOptions): Promise<void>;
  stop(guildId: string): Promise<void>;
  setPaused(guildId: string, paused: boolean): Promise<void>;
  seek(guildId: string, positionMs: number): Promise<void>;
  setVolume(guildId: string, volume: number): Promise<void>;
  setFilter(guildId: string, preset: FilterPreset): Promise<void>;
  /** Posição estimada em ms, ou null se desconhecida. */
  getPositionMs(guildId: string): number | null;
  search(request: SearchRequest): Promise<SearchResult>;
  health(): NodeHealth[];
  /** Source managers ativos nos nós conectados (null se ainda desconhecido). */
  availableSources(): Set<string> | null;
}
