import { randomUUID } from 'node:crypto';
import type { LoopMode, QueueItem, Track } from './types.js';

export interface QueueLimits {
  maxSize: number;
  allowDuplicates: boolean;
  maxTrackDurationMs: number | null;
}

export interface AddResult {
  added: QueueItem[];
  rejected: { track: Track; reason: 'full' | 'duplicate' | 'too_long' }[];
}

/**
 * Fila de um servidor. Estrutura pura, sem I/O: toda a sincronização com o motor de áudio
 * acontece em GuildSession, que serializa o acesso.
 */
export class MusicQueue {
  current: QueueItem | null = null;
  private upcoming: QueueItem[] = [];
  private history: QueueItem[] = [];
  loop: LoopMode = 'off';

  constructor(
    private limits: QueueLimits,
    private readonly maxHistory = 50,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  setLimits(limits: QueueLimits): void {
    this.limits = limits;
  }

  get tracks(): readonly QueueItem[] {
    return this.upcoming;
  }

  get previous(): readonly QueueItem[] {
    return this.history;
  }

  get size(): number {
    return this.upcoming.length;
  }

  get totalDurationMs(): number {
    return this.upcoming.reduce(
      (sum, item) => sum + (item.track.isStream ? 0 : item.track.durationMs),
      0,
    );
  }

  add(tracks: Track[], requesterId: string, options: { next?: boolean } = {}): AddResult {
    const result: AddResult = { added: [], rejected: [] };
    const seen = new Set(
      [this.current, ...this.upcoming].filter(Boolean).map((item) => trackKey(item!.track)),
    );
    for (const track of tracks) {
      if (this.upcoming.length + result.added.length >= this.limits.maxSize) {
        result.rejected.push({ track, reason: 'full' });
        continue;
      }
      if (
        this.limits.maxTrackDurationMs !== null &&
        !track.isStream &&
        track.durationMs > this.limits.maxTrackDurationMs
      ) {
        result.rejected.push({ track, reason: 'too_long' });
        continue;
      }
      const key = trackKey(track);
      if (!this.limits.allowDuplicates && seen.has(key)) {
        result.rejected.push({ track, reason: 'duplicate' });
        continue;
      }
      seen.add(key);
      result.added.push({ uid: randomUUID(), track, requesterId, addedAt: this.now() });
    }
    if (options.next) this.upcoming.unshift(...result.added);
    else this.upcoming.push(...result.added);
    return result;
  }

  /**
   * Avança para a próxima faixa conforme o modo de repetição.
   * @param finishedNaturally false em pulo/erro: no modo "track" um pulo deve avançar.
   */
  advance(finishedNaturally: boolean): QueueItem | null {
    const finished = this.current;
    if (finished && this.loop === 'track' && finishedNaturally) return finished;
    if (finished) {
      this.pushHistory(finished);
      if (this.loop === 'queue') this.upcoming.push({ ...finished, uid: randomUUID() });
    }
    this.current = this.upcoming.shift() ?? null;
    return this.current;
  }

  /** Volta para a faixa anterior; a atual retorna ao início da fila. */
  back(): QueueItem | null {
    const previous = this.history.shift();
    if (!previous) return null;
    if (this.current) this.upcoming.unshift(this.current);
    this.current = previous;
    return previous;
  }

  remove(position: number): QueueItem | null {
    if (!Number.isInteger(position) || position < 1 || position > this.upcoming.length) return null;
    const [removed] = this.upcoming.splice(position - 1, 1);
    return removed ?? null;
  }

  removeByUid(uid: string): QueueItem | null {
    const index = this.upcoming.findIndex((item) => item.uid === uid);
    if (index === -1) return null;
    const [removed] = this.upcoming.splice(index, 1);
    return removed ?? null;
  }

  move(from: number, to: number): QueueItem | null {
    const n = this.upcoming.length;
    if (![from, to].every((p) => Number.isInteger(p) && p >= 1 && p <= n)) return null;
    const [item] = this.upcoming.splice(from - 1, 1);
    if (!item) return null;
    this.upcoming.splice(to - 1, 0, item);
    return item;
  }

  /** Fisher–Yates. */
  shuffle(): void {
    for (let i = this.upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.upcoming[i], this.upcoming[j]] = [this.upcoming[j]!, this.upcoming[i]!];
    }
  }

  clear(): number {
    const count = this.upcoming.length;
    this.upcoming = [];
    return count;
  }

  /** Para tudo: limpa fila e faixa atual, mantendo o histórico. */
  reset(): void {
    if (this.current) this.pushHistory(this.current);
    this.current = null;
    this.upcoming = [];
  }

  private pushHistory(item: QueueItem): void {
    this.history.unshift(item);
    if (this.history.length > this.maxHistory) this.history.length = this.maxHistory;
  }
}

/** Chave para detecção de duplicatas: fonte + identificador. */
export function trackKey(track: Track): string {
  return `${track.sourceName}:${track.identifier}`;
}
