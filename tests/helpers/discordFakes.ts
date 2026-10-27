import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { vi } from 'vitest';
import type { AppContext } from '../../src/discord/context.js';
import { TtlMap } from '../../src/discord/ttlMap.js';
import { LocalLeaseManager } from '../../src/core/lease.js';
import { MemoryRateLimiter } from '../../src/core/rateLimiter.js';
import type { GuildSettings } from '../../src/data/guildSettings.js';
import { SessionManager } from '../../src/music/sessionManager.js';
import { Metrics } from '../../src/observability/metrics.js';
import { FakeEngine, makeHooks, silentLogger } from './fakes.js';

export const GUILD = '111111111111111111';
export const OTHER_GUILD = '222222222222222222';
export const VOICE = '333333333333333333';
export const DJ_ROLE = '444444444444444444';

export function baseSettings(overrides: Partial<GuildSettings> = {}): GuildSettings {
  return {
    guildId: GUILD,
    djRoleId: DJ_ROLE,
    managerRoleId: null,
    controlMode: 'DJ',
    aloneIsDj: true,
    panelChannelId: null,
    defaultVolume: 80,
    maxVolume: 150,
    inactivityTimeoutSec: 300,
    autoplay: false,
    allowDuplicates: true,
    maxQueueSize: 500,
    maxTrackDurationSec: null,
    historyEnabled: true,
    allowHttpStreams: false,
    timezone: 'UTC',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeApp(options: { humans?: number; settings?: Partial<GuildSettings> } = {}) {
  const engine = new FakeEngine();
  const { hooks } = makeHooks();
  const sessions = new SessionManager(
    engine,
    new LocalLeaseManager(),
    hooks,
    { humansInChannel: () => options.humans ?? 3, channelExists: async () => true },
    silentLogger,
    1000,
  );
  const settings = baseSettings(options.settings);
  const app = {
    env: { MAX_QUEUE_SIZE: 1000 },
    logger: silentLogger,
    settings: { get: async () => settings, update: vi.fn() },
    sessions,
    engine,
    rateLimiter: new MemoryRateLimiter(),
    metrics: new Metrics({
      activeSessions: () => 0,
      queuedTracks: () => 0,
      guilds: () => 0,
      discordPingMs: () => 0,
      lavalinkNodes: () => [],
    }),
    brand: { name: 'Aurora', accent: 1 },
    pendingSearches: new TtlMap(60_000),
    pendingConfirmations: new TtlMap(60_000),
    panels: { schedule: vi.fn() },
  } as unknown as AppContext;
  return { app, engine, sessions, settings };
}

interface FakeUser {
  id: string;
  roles?: string[];
  admin?: boolean;
  voiceChannelId?: string | null;
}

function baseInteraction(user: FakeUser, guildId = GUILD) {
  const calls: { method: string; payload: any }[] = [];
  const state = { deferred: false, replied: false };
  const record = (method: string) =>
    vi.fn(async (payload?: any) => {
      calls.push({ method, payload });
      if (method === 'reply' || method === 'update') state.replied = true;
      if (method === 'deferUpdate' || method === 'deferReply') state.deferred = true;
    });
  const perms = new PermissionsBitField(user.admin ? [PermissionFlagsBits.Administrator] : []);
  const voiceChannelId = user.voiceChannelId === undefined ? VOICE : user.voiceChannelId;
  return {
    calls,
    interaction: {
      guildId,
      channelId: '555555555555555555',
      user: { id: user.id },
      guild: { id: guildId, ownerId: 'owner', members: { me: null } },
      member: {
        voice: {
          channelId: voiceChannelId,
          channel: voiceChannelId ? { id: voiceChannelId } : null,
        },
        roles: { cache: new Map((user.roles ?? []).map((r) => [r, { id: r }])) },
      },
      memberPermissions: perms,
      get deferred() {
        return state.deferred;
      },
      get replied() {
        return state.replied;
      },
      inGuild: () => true,
      inCachedGuild: () => true,
      isRepliable: () => true,
      isChatInputCommand: () => false,
      isAutocomplete: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isMessageComponent: () => false,
      reply: record('reply'),
      update: record('update'),
      deferUpdate: record('deferUpdate'),
      deferReply: record('deferReply'),
      editReply: record('editReply'),
      followUp: record('followUp'),
    },
  };
}

export function fakeButton(customId: string, user: FakeUser, guildId = GUILD) {
  const base = baseInteraction(user, guildId);
  Object.assign(base.interaction, {
    customId,
    isButton: () => true,
    isMessageComponent: () => true,
  });
  return base;
}

export function fakeCommand(
  commandName: string,
  user: FakeUser,
  options: Record<string, unknown> = {},
) {
  const base = baseInteraction(user);
  const get = (name: string) => (name in options ? options[name] : null);
  Object.assign(base.interaction, {
    commandName,
    isChatInputCommand: () => true,
    options: {
      getString: (n: string, required?: boolean) => {
        const v = get(n);
        if (v === null && required) throw new Error(`missing ${n}`);
        return v;
      },
      getInteger: (n: string, required?: boolean) => {
        const v = get(n);
        if (v === null && required) throw new Error(`missing ${n}`);
        return v;
      },
      getBoolean: (n: string, required?: boolean) => {
        const v = get(n);
        if (v === null && required) throw new Error(`missing ${n}`);
        return v;
      },
      getSubcommand: () => options.subcommand,
    },
  });
  return base;
}

/** Texto de todas as embeds enviadas. */
export function sentText(calls: { method: string; payload: any }[]): string {
  return calls
    .flatMap((c) => c.payload?.embeds ?? [])
    .map((e: any) => JSON.stringify(e.toJSON ? e.toJSON() : e))
    .join('\n');
}
