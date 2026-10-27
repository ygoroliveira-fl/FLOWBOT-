import type { AudioEngine } from '../audio/engine.js';
import { ServiceUnavailableError, UserError } from '../core/errors.js';
import type { LeaseManager } from '../core/lease.js';
import type { Logger } from '../core/logger.js';
import type { GuildSettings } from '../data/guildSettings.js';
import { GuildSession, type SessionHooks } from './session.js';
import type { QueueLimits } from './queue.js';

export interface VoiceInspector {
  /** Quantidade de humanos (não bots) no canal, ou null se desconhecido. */
  humansInChannel(guildId: string, channelId: string): number | null;
  channelExists(guildId: string, channelId: string): Promise<boolean>;
}

export interface SessionManagerEvents {
  onSessionCreated?(session: GuildSession): void;
  onSessionDestroyed?(session: GuildSession, reason: string): void;
}

export function limitsFromSettings(settings: GuildSettings, globalMaxQueue: number): QueueLimits {
  return {
    maxSize: Math.min(settings.maxQueueSize, globalMaxQueue),
    allowDuplicates: settings.allowDuplicates,
    maxTrackDurationMs: settings.maxTrackDurationSec ? settings.maxTrackDurationSec * 1000 : null,
  };
}

/** Uma sessão independente por servidor + roteamento dos eventos do motor de áudio. */
export class SessionManager {
  private readonly sessions = new Map<string, GuildSession>();
  private readonly pending = new Map<string, Promise<GuildSession>>();

  constructor(
    private readonly engine: AudioEngine,
    private readonly leases: LeaseManager,
    private readonly hooks: Omit<SessionHooks, 'onDestroyed'>,
    private readonly voice: VoiceInspector,
    private readonly logger: Logger,
    private readonly globalMaxQueue: number,
    private readonly events: SessionManagerEvents = {},
  ) {
    this.bindEngine();
  }

  get(guildId: string): GuildSession | undefined {
    return this.sessions.get(guildId);
  }

  all(): GuildSession[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }

  /**
   * Obtém a sessão ou cria uma conectando ao canal. Criações simultâneas para o mesmo
   * servidor compartilham a mesma promessa (sem duas conexões de voz).
   */
  async getOrCreate(input: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    settings: GuildSettings;
  }): Promise<GuildSession> {
    const existing = this.sessions.get(input.guildId);
    if (existing && !existing.destroyed) return existing;
    const inFlight = this.pending.get(input.guildId);
    if (inFlight) return inFlight;
    const creation = this.create(input).finally(() => this.pending.delete(input.guildId));
    this.pending.set(input.guildId, creation);
    return creation;
  }

  private async create(input: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    settings: GuildSettings;
  }): Promise<GuildSession> {
    if (!this.engine.isAvailable()) {
      throw new ServiceUnavailableError(
        'O servidor de áudio está indisponível no momento. Tente novamente em instantes.',
        'AUDIO_UNAVAILABLE',
      );
    }
    const lease = await this.leases.acquire(input.guildId).catch((error: unknown) => {
      this.logger.error({ guildId: input.guildId, err: error }, 'Falha ao obter lease da sessão');
      throw new ServiceUnavailableError(
        'Não consegui iniciar a sessão agora (coordenação indisponível). Tente novamente em instantes.',
        'LEASE_UNAVAILABLE',
      );
    });
    if (!lease) {
      throw new UserError(
        'Outra instância do bot já controla a música deste servidor.',
        'LEASE_BUSY',
      );
    }
    const { settings } = input;
    const session = new GuildSession(
      {
        guildId: input.guildId,
        voiceChannelId: input.voiceChannelId,
        textChannelId: input.textChannelId,
        volume: Math.min(settings.defaultVolume, settings.maxVolume),
        maxVolume: settings.maxVolume,
        autoplay: settings.autoplay,
        inactivityTimeoutMs: settings.inactivityTimeoutSec * 1000,
        limits: limitsFromSettings(settings, this.globalMaxQueue),
      },
      this.engine,
      {
        ...this.hooks,
        onDestroyed: (destroyed, reason) => {
          if (this.sessions.get(destroyed.guildId) === destroyed)
            this.sessions.delete(destroyed.guildId);
          this.logger.info({ guildId: destroyed.guildId, reason }, 'Sessão encerrada');
          this.events.onSessionDestroyed?.(destroyed, reason);
        },
      },
      this.logger.child({ guildId: input.guildId }),
      lease,
    );
    try {
      await this.engine.connect({
        guildId: input.guildId,
        voiceChannelId: input.voiceChannelId,
        textChannelId: input.textChannelId,
        volume: session.volume,
      });
    } catch (error) {
      await lease.release();
      throw error;
    }
    this.sessions.set(input.guildId, session);
    this.refreshPresence(input.guildId);
    this.logger.info({ guildId: input.guildId }, 'Sessão criada');
    this.events.onSessionCreated?.(session);
    return session;
  }

  /** Recalcula se o bot está sozinho (ou com uma única pessoa) no canal. */
  refreshPresence(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) return;
    const humans = this.voice.humansInChannel(guildId, session.voiceChannelId);
    if (humans === null) return;
    session.setAlone(humans === 0);
  }

  /** Número de humanos no canal da sessão (para a regra "sozinho com o bot é DJ"). */
  humansWithBot(guildId: string): number | null {
    const session = this.sessions.get(guildId);
    if (!session) return null;
    return this.voice.humansInChannel(guildId, session.voiceChannelId);
  }

  async destroy(guildId: string, reason: string): Promise<void> {
    await this.sessions.get(guildId)?.destroy(reason);
  }

  async destroyAll(reason: string): Promise<void> {
    await Promise.allSettled(this.all().map((session) => session.destroy(reason)));
  }

  private bindEngine(): void {
    this.engine.on(
      'trackStart',
      (guildId, encoded) => void this.sessions.get(guildId)?.handleTrackStart(encoded),
    );
    this.engine.on(
      'trackEnd',
      (guildId, encoded, reason) =>
        void this.sessions.get(guildId)?.handleTrackEnd(encoded, reason),
    );
    this.engine.on('trackException', (guildId, encoded, message) =>
      this.sessions.get(guildId)?.handleTrackException(encoded, message),
    );
    this.engine.on(
      'trackStuck',
      (guildId, encoded) => void this.sessions.get(guildId)?.handleTrackStuck(encoded),
    );
    this.engine.on('voiceDisconnected', (guildId) => {
      const session = this.sessions.get(guildId);
      if (!session || session.destroyed) return;
      void session.handleVoiceDisconnected(() =>
        this.voice.channelExists(guildId, session.voiceChannelId),
      );
    });
    this.engine.on('voiceClosed', (guildId, code) => {
      // 4014: desconectado à força (expulso/canal apagado) — tratado pelo voiceDisconnected.
      // 4006 (sessão inválida) e 4009 (timeout) exigem nova sessão de voz.
      const session = this.sessions.get(guildId);
      if (!session || session.destroyed) return;
      if (code === 4006 || code === 4009) {
        session.audioLost = true;
        void session.recoverAudio();
      }
    });
    this.engine.on('voiceMoved', (guildId, channelId) => {
      const session = this.sessions.get(guildId);
      if (!session) return;
      session.voiceChannelId = channelId;
      this.refreshPresence(guildId);
      this.hooks.onChange(session);
    });
    this.engine.on('nodeDisconnected', () => {
      if (this.engine.isAvailable()) return; // ainda há outro nó
      for (const session of this.sessions.values()) session.markAudioLost();
    });
    this.engine.on('nodeConnected', () => {
      for (const session of this.sessions.values())
        if (session.audioLost) void session.recoverAudio();
    });
  }
}
