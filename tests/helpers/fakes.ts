import { EventEmitter } from 'node:events';
import { pino } from 'pino';
import type {
  AudioEngine,
  AudioEngineEvents,
  ConnectOptions,
  NodeHealth,
  PlayOptions,
  SearchRequest,
} from '../../src/audio/engine.js';
import type { FilterPreset } from '../../src/audio/filters.js';
import { LocalLeaseManager } from '../../src/core/lease.js';
import type { SearchResult, Track } from '../../src/music/types.js';
import { GuildSession, type SessionHooks } from '../../src/music/session.js';

export const silentLogger = pino({ level: 'silent' });

let counter = 0;
export function makeTrack(overrides: Partial<Track> = {}): Track {
  counter++;
  return {
    encoded: `enc-${counter}`,
    identifier: `id-${counter}`,
    title: `Faixa ${counter}`,
    author: 'Artista',
    uri: `https://youtube.com/watch?v=${counter}`,
    sourceName: 'youtube',
    durationMs: 180_000,
    isStream: false,
    isSeekable: true,
    artworkUrl: null,
    isrc: null,
    ...overrides,
  };
}

export type EngineCall = { method: string; args: unknown[] };

export class FakeEngine extends EventEmitter implements AudioEngine {
  calls: EngineCall[] = [];
  available = true;
  players = new Set<string>();
  playing = new Map<string, string>();
  failPlay = false;
  searchResult: SearchResult = { kind: 'empty', tracks: [] };
  sources: Set<string> | null = null;
  position = 0;

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }
  callsOf(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
  isAvailable() {
    return this.available;
  }
  async connect(options: ConnectOptions) {
    this.record('connect', options);
    this.players.add(options.guildId);
  }
  async destroy(guildId: string) {
    this.record('destroy', guildId);
    this.players.delete(guildId);
    this.playing.delete(guildId);
  }
  hasPlayer(guildId: string) {
    return this.players.has(guildId);
  }
  async play(guildId: string, encoded: string, options?: PlayOptions) {
    this.record('play', guildId, encoded, options);
    if (this.failPlay) throw new Error('play failed');
    this.playing.set(guildId, encoded);
  }
  async stop(guildId: string) {
    this.record('stop', guildId);
    this.playing.delete(guildId);
  }
  async setPaused(guildId: string, paused: boolean) {
    this.record('setPaused', guildId, paused);
  }
  async seek(guildId: string, ms: number) {
    this.record('seek', guildId, ms);
  }
  async setVolume(guildId: string, v: number) {
    this.record('setVolume', guildId, v);
  }
  async setFilter(guildId: string, p: FilterPreset) {
    this.record('setFilter', guildId, p);
  }
  getPositionMs() {
    return this.position;
  }
  async search(request: SearchRequest) {
    this.record('search', request.identifier);
    return this.searchResult;
  }
  health(): NodeHealth[] {
    return [];
  }
  availableSources() {
    return this.sources;
  }
  override on<E extends keyof AudioEngineEvents>(event: E, listener: AudioEngineEvents[E]): this {
    return super.on(event, listener as never);
  }
  override off<E extends keyof AudioEngineEvents>(event: E, listener: AudioEngineEvents[E]): this {
    return super.off(event, listener as never);
  }
}

export function makeHooks(overrides: Partial<SessionHooks> = {}) {
  const notices: { message: string; level: string }[] = [];
  const started: string[] = [];
  let changes = 0;
  let destroyedReason: string | null = null;
  const hooks: SessionHooks = {
    onChange: () => {
      changes++;
    },
    onTrackStart: (_s, item) => {
      started.push(item.track.encoded);
    },
    onNotice: (_s, message, level) => {
      notices.push({ message, level });
    },
    onDestroyed: (_s, reason) => {
      destroyedReason = reason;
    },
    ...overrides,
  };
  return {
    hooks,
    notices,
    started,
    get changes() {
      return changes;
    },
    get destroyedReason() {
      return destroyedReason;
    },
  };
}

export async function makeSession(
  engine = new FakeEngine(),
  hookOverrides: Partial<SessionHooks> = {},
) {
  const h = makeHooks(hookOverrides);
  const lease = (await new LocalLeaseManager().acquire('g1'))!;
  engine.players.add('g1');
  const session = new GuildSession(
    {
      guildId: 'g1',
      voiceChannelId: 'v1',
      textChannelId: 't1',
      volume: 80,
      maxVolume: 150,
      autoplay: false,
      inactivityTimeoutMs: 60_000,
      limits: { maxSize: 100, allowDuplicates: true, maxTrackDurationMs: null },
    },
    engine,
    h.hooks,
    silentLogger,
    lease,
  );
  return { session, engine, h, lease, notices: h.notices, started: h.started };
}
