import type { AudioEngine } from '../audio/engine.js';
import type { FilterPreset } from '../audio/filters.js';
import { backoffDelay, sleep } from '../core/async.js';
import { UserError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import type { SessionLease } from '../core/lease.js';
import { MusicQueue, trackKey, type AddResult, type QueueLimits } from './queue.js';
import type { LoopMode, PlaybackState, QueueItem, Track, TrackEndReason } from './types.js';

export interface SessionHooks {
  /** Estado mudou (painel deve ser atualizado). */
  onChange(session: GuildSession): void;
  onTrackStart(session: GuildSession, item: QueueItem): void;
  /** Mensagem curta para o canal de texto (erros de reprodução, desconexões). */
  onNotice(session: GuildSession, message: string, level: 'info' | 'warn' | 'error'): void;
  /** A sessão terminou e deve ser removida do gerenciador. */
  onDestroyed(session: GuildSession, reason: string): void;
  /** Sugere a próxima faixa quando a fila acaba e o autoplay está ativo. */
  autoplay?(session: GuildSession, last: QueueItem): Promise<Track | null>;
}

export interface SessionConfig {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  volume: number;
  maxVolume: number;
  autoplay: boolean;
  inactivityTimeoutMs: number;
  limits: QueueLimits;
}

const MAX_CONSECUTIVE_FAILURES = 3;
const STUCK_FALLBACK_MS = 4_000;
const VOICE_RECONNECT_ATTEMPTS = 3;
export const AUTOPLAY_REQUESTER = 'autoplay';

/**
 * Sessão musical de um servidor. Todas as operações e todos os eventos do motor passam por
 * `exclusive()`, uma fila de promessas por sessão: nenhum comando, clique ou evento roda em
 * paralelo com outro do mesmo servidor. Isso resolve, por construção:
 * - duas pessoas adicionando músicas ao mesmo tempo (as adições são aplicadas em ordem);
 * - dois skips seguidos (o segundo vê a fila já avançada; skips de botão carregam o uid da
 *   faixa e são ignorados se ela já mudou);
 * - faixa terminando no mesmo instante de um stop (quem chega primeiro vence; o evento
 *   atrasado é descartado porque o estado/encoded não corresponde mais).
 */
export class GuildSession {
  readonly guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  readonly queue: MusicQueue;
  state: PlaybackState = 'idle';
  volume: number;
  maxVolume: number;
  autoplay: boolean;
  filter: FilterPreset = 'off';
  inactivityTimeoutMs: number;
  createdAt = Date.now();
  lastActivityAt = Date.now();
  destroyed = false;
  /** Áudio perdido por queda do nó; recuperado em recoverAudio(). */
  audioLost = false;

  private chain: Promise<unknown> = Promise.resolve();
  private consecutiveFailures = 0;
  private stuckEncoded: string | null = null;
  private stuckTimer: NodeJS.Timeout | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private aloneInChannel = false;
  private lastKnownPositionMs = 0;

  constructor(
    config: SessionConfig,
    private readonly engine: AudioEngine,
    private readonly hooks: SessionHooks,
    private readonly logger: Logger,
    private readonly lease: SessionLease,
  ) {
    this.guildId = config.guildId;
    this.voiceChannelId = config.voiceChannelId;
    this.textChannelId = config.textChannelId;
    this.volume = config.volume;
    this.maxVolume = config.maxVolume;
    this.autoplay = config.autoplay;
    this.inactivityTimeoutMs = config.inactivityTimeoutMs;
    this.queue = new MusicQueue(config.limits);
  }

  get current(): QueueItem | null {
    return this.queue.current;
  }

  get loop(): LoopMode {
    return this.queue.loop;
  }

  get fencingToken(): number {
    return this.lease.fencingToken;
  }

  positionMs(): number | null {
    if (!this.current) return null;
    const pos = this.engine.getPositionMs(this.guildId);
    if (pos !== null) this.lastKnownPositionMs = pos;
    return pos;
  }

  /** Executa `task` com exclusão mútua na sessão. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      if (this.destroyed) throw new UserError('A sessão de música foi encerrada.', 'SESSION_ENDED');
      if (!this.lease.isValid()) {
        throw new UserError(
          'Esta sessão está sendo controlada por outra instância do bot.',
          'LEASE_LOST',
        );
      }
      return task();
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  // ───────────── comandos ─────────────

  enqueue(
    tracks: Track[],
    requesterId: string,
    options: { next?: boolean } = {},
  ): Promise<AddResult & { startedPlaying: boolean }> {
    return this.exclusive(async () => {
      this.touch();
      const result = this.queue.add(tracks, requesterId, options);
      let startedPlaying = false;
      if (result.added.length && !this.queue.current && this.state === 'idle') {
        startedPlaying = await this.playNext(false);
      }
      this.changed();
      return { ...result, startedPlaying };
    });
  }

  /**
   * Pula a faixa atual. `expectedUid` (vindo de botões) evita que cliques atrasados pulem a
   * faixa seguinte. Retorna o item pulado, ou null se nada foi feito.
   */
  skip(expectedUid?: string): Promise<QueueItem | null> {
    return this.exclusive(async () => {
      const skipped = this.queue.current;
      if (!skipped) throw new UserError('Não há nada tocando.');
      if (expectedUid && skipped.uid !== expectedUid) return null;
      this.touch();
      await this.playNext(false);
      this.changed();
      return skipped;
    });
  }

  previous(): Promise<QueueItem> {
    return this.exclusive(async () => {
      const item = this.queue.back();
      if (!item) throw new UserError('Não há faixa anterior no histórico.');
      this.touch();
      await this.startItem(item);
      this.changed();
      return item;
    });
  }

  stop(): Promise<void> {
    return this.exclusive(async () => {
      this.touch();
      // O estado muda ANTES de parar o motor: o TrackEnd("stopped") que chega depois é descartado.
      this.queue.reset();
      this.state = 'idle';
      this.clearStuck();
      await this.engine.stop(this.guildId);
      this.scheduleInactivity();
      this.changed();
    });
  }

  setPaused(paused: boolean): Promise<void> {
    return this.exclusive(async () => {
      if (!this.queue.current) throw new UserError('Não há nada tocando.');
      if (paused && this.state === 'paused') throw new UserError('Já está pausado.');
      if (!paused && this.state === 'playing') throw new UserError('Já está tocando.');
      this.touch();
      await this.engine.setPaused(this.guildId, paused);
      this.state = paused ? 'paused' : 'playing';
      this.changed();
    });
  }

  togglePause(): Promise<boolean> {
    return this.exclusive(async () => {
      if (!this.queue.current) throw new UserError('Não há nada tocando.');
      const paused = this.state !== 'paused';
      this.touch();
      await this.engine.setPaused(this.guildId, paused);
      this.state = paused ? 'paused' : 'playing';
      this.changed();
      return paused;
    });
  }

  setVolume(volume: number): Promise<number> {
    return this.exclusive(async () => {
      const clamped = Math.max(0, Math.min(this.maxVolume, Math.round(volume)));
      this.touch();
      if (this.engine.hasPlayer(this.guildId)) await this.engine.setVolume(this.guildId, clamped);
      this.volume = clamped;
      this.changed();
      return clamped;
    });
  }

  setLoop(mode: LoopMode): Promise<void> {
    return this.exclusive(() => {
      this.queue.loop = mode;
      this.touch();
      this.changed();
      return Promise.resolve();
    });
  }

  cycleLoop(): Promise<LoopMode> {
    return this.exclusive(() => {
      const order: LoopMode[] = ['off', 'queue', 'track'];
      this.queue.loop = order[(order.indexOf(this.queue.loop) + 1) % order.length]!;
      this.touch();
      this.changed();
      return Promise.resolve(this.queue.loop);
    });
  }

  setAutoplay(enabled: boolean): Promise<void> {
    return this.exclusive(() => {
      this.autoplay = enabled;
      this.changed();
      return Promise.resolve();
    });
  }

  shuffle(): Promise<number> {
    return this.exclusive(() => {
      if (this.queue.size < 2)
        throw new UserError('A fila precisa de pelo menos 2 faixas para embaralhar.');
      this.queue.shuffle();
      this.touch();
      this.changed();
      return Promise.resolve(this.queue.size);
    });
  }

  remove(position: number, requesterGuard?: (item: QueueItem) => boolean): Promise<QueueItem> {
    return this.exclusive(() => {
      const target = this.queue.tracks[position - 1];
      if (!target) throw new UserError(`Posição inválida. A fila tem ${this.queue.size} faixa(s).`);
      if (requesterGuard && !requesterGuard(target)) {
        throw new UserError(
          'Você só pode remover faixas que você mesmo adicionou.',
          'PERMISSION_DENIED',
        );
      }
      const removed = this.queue.removeByUid(target.uid)!;
      this.touch();
      this.changed();
      return Promise.resolve(removed);
    });
  }

  move(from: number, to: number): Promise<QueueItem> {
    return this.exclusive(() => {
      const moved = this.queue.move(from, to);
      if (!moved)
        throw new UserError(`Posições inválidas. A fila tem ${this.queue.size} faixa(s).`);
      this.touch();
      this.changed();
      return Promise.resolve(moved);
    });
  }

  clear(): Promise<number> {
    return this.exclusive(() => {
      const count = this.queue.clear();
      this.touch();
      this.changed();
      return Promise.resolve(count);
    });
  }

  seek(positionMs: number): Promise<number> {
    return this.exclusive(async () => {
      const current = this.queue.current;
      if (!current) throw new UserError('Não há nada tocando.');
      if (!current.track.isSeekable)
        throw new UserError(
          'Esta faixa não permite avançar/retroceder (ex.: transmissões ao vivo).',
        );
      const target = Math.max(0, Math.min(current.track.durationMs - 1000, Math.round(positionMs)));
      this.touch();
      await this.engine.seek(this.guildId, target);
      this.lastKnownPositionMs = target;
      this.changed();
      return target;
    });
  }

  setFilter(preset: FilterPreset): Promise<void> {
    return this.exclusive(async () => {
      this.touch();
      if (this.engine.hasPlayer(this.guildId)) await this.engine.setFilter(this.guildId, preset);
      this.filter = preset;
      this.changed();
    });
  }

  updateLimits(limits: QueueLimits, maxVolume: number, inactivityTimeoutMs: number): void {
    this.queue.setLimits(limits);
    this.maxVolume = maxVolume;
    this.inactivityTimeoutMs = inactivityTimeoutMs;
  }

  // ───────────── eventos do motor ─────────────

  handleTrackStart(encoded: string): Promise<void> {
    return this.exclusive(() => {
      const current = this.queue.current;
      if (!current || current.track.encoded !== encoded) return Promise.resolve();
      if (this.state === 'idle') this.state = 'playing';
      this.consecutiveFailures = 0;
      this.hooks.onTrackStart(this, current);
      this.changed();
      return Promise.resolve();
    }).catch((error: unknown) => this.logIgnored('trackStart', error));
  }

  handleTrackEnd(encoded: string, reason: TrackEndReason): Promise<void> {
    return this.exclusive(async () => {
      const current = this.queue.current;
      // Eventos de faixas substituídas ou de estados já abandonados são descartados.
      if (reason === 'replaced') return;
      if (!current || this.state === 'idle' || current.track.encoded !== encoded) return;

      if (reason === 'cleanup') {
        this.state = 'idle';
        this.changed();
        return;
      }
      const wasStuck = this.stuckEncoded === encoded;
      this.clearStuck();
      if (reason === 'loadFailed' || wasStuck) {
        await this.handleFailure(
          current,
          wasStuck ? 'travou durante a reprodução' : 'não pôde ser carregada',
        );
        return;
      }
      // finished ou stopped externo (ex.: nó parou a faixa): avança normalmente.
      await this.playNext(reason === 'finished');
      this.changed();
    }).catch((error: unknown) => this.logIgnored('trackEnd', error));
  }

  handleTrackException(encoded: string, message: string): void {
    // O Lavalink envia TrackEnd(loadFailed) em seguida; aqui só registramos o motivo.
    if (this.queue.current?.track.encoded === encoded) {
      this.logger.warn({ guildId: this.guildId, message }, 'Exceção de reprodução');
    }
  }

  handleTrackStuck(encoded: string): Promise<void> {
    return this.exclusive(() => {
      if (this.queue.current?.track.encoded !== encoded) return Promise.resolve();
      // A biblioteca envia stop após o stuck; esperamos o TrackEnd. Se não vier, forçamos.
      this.stuckEncoded = encoded;
      this.clearStuckTimer();
      this.stuckTimer = setTimeout(() => {
        void this.handleTrackEnd(encoded, 'loadFailed');
      }, STUCK_FALLBACK_MS);
      this.stuckTimer.unref();
      return Promise.resolve();
    }).catch((error: unknown) => this.logIgnored('trackStuck', error));
  }

  /** O bot saiu do canal sem que tenhamos pedido. Tenta reconectar com backoff. */
  handleVoiceDisconnected(channelStillExists: () => Promise<boolean>): Promise<void> {
    return this.exclusive(async () => {
      const position = this.positionMs() ?? this.lastKnownPositionMs;
      for (let attempt = 0; attempt < VOICE_RECONNECT_ATTEMPTS; attempt++) {
        if (!(await channelStillExists())) break;
        await sleep(backoffDelay(attempt, { baseMs: 1000, maxMs: 8000 }) + 500);
        try {
          await this.engine.destroy(this.guildId);
          await this.engine.connect(this.connectOptions());
          if (this.queue.current)
            await this.startItem(this.queue.current, position, this.state === 'paused');
          this.hooks.onNotice(this, 'Reconectei ao canal de voz.', 'info');
          this.changed();
          return;
        } catch (error) {
          this.logger.warn(
            { guildId: this.guildId, attempt, err: error },
            'Falha ao reconectar voz',
          );
        }
      }
      await this.destroyInternal('voice_disconnected');
    }).catch((error: unknown) => this.logIgnored('voiceDisconnected', error));
  }

  markAudioLost(): void {
    if (this.queue.current) {
      this.lastKnownPositionMs = this.positionMs() ?? this.lastKnownPositionMs;
      this.audioLost = true;
      this.changed();
    }
  }

  /** Após o nó voltar: recria o player e retoma a faixa da última posição conhecida. */
  recoverAudio(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.audioLost) return;
      this.audioLost = false;
      try {
        await this.engine.destroy(this.guildId);
        await this.engine.connect(this.connectOptions());
        if (this.queue.current) {
          await this.startItem(
            this.queue.current,
            this.lastKnownPositionMs,
            this.state === 'paused',
          );
          if (this.filter !== 'off') await this.engine.setFilter(this.guildId, this.filter);
        }
        this.hooks.onNotice(this, 'Servidor de áudio restabelecido — reprodução retomada.', 'info');
      } catch (error) {
        this.logger.error({ guildId: this.guildId, err: error }, 'Falha ao recuperar áudio');
        await this.destroyInternal('audio_recovery_failed');
        return;
      }
      this.changed();
    }).catch((error: unknown) => this.logIgnored('recoverAudio', error));
  }

  // ───────────── presença / inatividade ─────────────

  /** Chamado pelo gerenciador quando muda a ocupação humana do canal. */
  setAlone(alone: boolean): void {
    this.aloneInChannel = alone;
    if (alone) this.scheduleInactivity();
    else if (this.state !== 'idle') this.cancelInactivity();
  }

  isAlone(): boolean {
    return this.aloneInChannel;
  }

  destroy(reason: string): Promise<void> {
    return this.exclusive(() => this.destroyInternal(reason)).catch(() => undefined);
  }

  // ───────────── internos ─────────────

  private connectOptions() {
    return {
      guildId: this.guildId,
      voiceChannelId: this.voiceChannelId,
      textChannelId: this.textChannelId,
      volume: this.volume,
    };
  }

  /** Avança e toca. Retorna true se algo começou a tocar. Deve rodar dentro de exclusive(). */
  private async playNext(finishedNaturally: boolean): Promise<boolean> {
    const last = this.queue.current;
    let next = this.queue.advance(finishedNaturally);
    if (!next && last && this.autoplay && this.hooks.autoplay) {
      try {
        const suggestion = await this.hooks.autoplay(this, last);
        if (suggestion) {
          this.queue.add([suggestion], AUTOPLAY_REQUESTER);
          next = this.queue.advance(false);
        }
      } catch (error) {
        this.logger.warn({ guildId: this.guildId, err: error }, 'Autoplay falhou');
      }
    }
    if (!next) {
      this.state = 'idle';
      await this.engine.stop(this.guildId).catch(() => undefined);
      this.scheduleInactivity();
      return false;
    }
    await this.startItem(next);
    return true;
  }

  private async startItem(item: QueueItem, startMs?: number, paused = false): Promise<void> {
    this.clearStuck();
    this.queue.current = item;
    this.cancelInactivity();
    try {
      await this.engine.play(this.guildId, item.track.encoded, {
        volume: this.volume,
        ...(startMs ? { startMs } : {}),
        paused,
      });
      this.state = paused ? 'paused' : 'playing';
      this.lastKnownPositionMs = startMs ?? 0;
    } catch (error) {
      this.logger.warn({ guildId: this.guildId, err: error }, 'Falha ao iniciar faixa');
      await this.handleFailure(item, 'não pôde ser iniciada');
    }
  }

  private async handleFailure(item: QueueItem, why: string): Promise<void> {
    this.consecutiveFailures++;
    this.hooks.onNotice(this, `**${escapeInline(item.track.title)}** ${why} e foi pulada.`, 'warn');
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.consecutiveFailures = 0;
      this.queue.reset();
      this.state = 'idle';
      await this.engine.stop(this.guildId).catch(() => undefined);
      this.hooks.onNotice(
        this,
        'Várias faixas falharam seguidas, então parei a reprodução. A fonte pode estar indisponível — tente outra (ex.: `/play fonte: SoundCloud`).',
        'error',
      );
      this.scheduleInactivity();
      this.changed();
      return;
    }
    // Falha nunca repete a mesma faixa, mesmo no modo de repetição de faixa.
    await this.playNext(false);
    this.changed();
  }

  private scheduleInactivity(): void {
    if (this.destroyed) return;
    const idle = this.state === 'idle' && !this.queue.current;
    if (!idle && !this.aloneInChannel) return;
    this.cancelInactivity();
    this.inactivityTimer = setTimeout(() => {
      void this.exclusive(async () => {
        const stillIdle = this.state === 'idle' && !this.queue.current;
        if (!stillIdle && !this.aloneInChannel) return;
        this.hooks.onNotice(this, 'Saí do canal de voz por inatividade.', 'info');
        await this.destroyInternal('inactivity');
      }).catch(() => undefined);
    }, this.inactivityTimeoutMs);
    this.inactivityTimer.unref();
  }

  private cancelInactivity(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
  }

  private clearStuckTimer(): void {
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    this.stuckTimer = null;
  }

  private clearStuck(): void {
    this.stuckEncoded = null;
    this.clearStuckTimer();
  }

  private async destroyInternal(reason: string): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelInactivity();
    this.clearStuck();
    this.state = 'idle';
    this.queue.reset();
    await this.engine.destroy(this.guildId).catch(() => undefined);
    await this.lease.release().catch(() => undefined);
    this.hooks.onDestroyed(this, reason);
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  private changed(): void {
    if (!this.destroyed) this.hooks.onChange(this);
  }

  private logIgnored(event: string, error: unknown): void {
    if (error instanceof UserError) return; // sessão encerrada / lease perdido
    this.logger.error(
      { guildId: this.guildId, event, err: error },
      'Erro ao processar evento do motor',
    );
  }

  /** Chaves das últimas faixas (para autoplay evitar repetições). */
  recentKeys(): Set<string> {
    return new Set(
      [this.queue.current, ...this.queue.previous, ...this.queue.tracks]
        .filter((item): item is QueueItem => Boolean(item))
        .map((item) => trackKey(item.track)),
    );
  }
}

/** Escapa markdown para inserir títulos com segurança em mensagens. */
export function escapeInline(text: string): string {
  return text.replace(/([\\*_`~|>[\]()])/g, '\\$1').replace(/@/g, '@\u200b');
}
