import { describe, expect, it } from 'vitest';
import { LocalLeaseManager } from '../../src/core/lease.js';
import type { GuildSettings } from '../../src/data/guildSettings.js';
import { SessionManager } from '../../src/music/sessionManager.js';
import { FakeEngine, makeHooks, makeTrack, silentLogger } from '../helpers/fakes.js';

const settings = (overrides: Partial<GuildSettings> = {}): GuildSettings => ({
  guildId: 'g',
  djRoleId: null,
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
});

function setup(humans: number | null = 1) {
  const engine = new FakeEngine();
  const { hooks } = makeHooks();
  const voice = { humansInChannel: () => humans, channelExists: async () => true };
  const manager = new SessionManager(
    engine,
    new LocalLeaseManager(),
    hooks,
    voice,
    silentLogger,
    1000,
  );
  return { engine, manager };
}

describe('SessionManager', () => {
  it('sessões independentes por servidor', async () => {
    const { engine, manager } = setup();
    const a = await manager.getOrCreate({
      guildId: 'A',
      voiceChannelId: 'va',
      textChannelId: 'ta',
      settings: settings(),
    });
    const b = await manager.getOrCreate({
      guildId: 'B',
      voiceChannelId: 'vb',
      textChannelId: 'tb',
      settings: settings({ defaultVolume: 30 }),
    });
    const [ta, tb] = [makeTrack(), makeTrack()];
    await a.enqueue([ta], 'u');
    await b.enqueue([tb], 'u');
    expect(a.current?.track).toBe(ta);
    expect(b.current?.track).toBe(tb);
    expect(b.volume).toBe(30);
    engine.emit('trackEnd', 'A', ta.encoded, 'finished');
    await new Promise((r) => setTimeout(r, 5));
    expect(a.current).toBeNull();
    expect(b.current?.track).toBe(tb);
  });

  it('criações simultâneas compartilham uma única conexão', async () => {
    const { engine, manager } = setup();
    const input = { guildId: 'A', voiceChannelId: 'va', textChannelId: 'ta', settings: settings() };
    const [s1, s2, s3] = await Promise.all([
      manager.getOrCreate(input),
      manager.getOrCreate(input),
      manager.getOrCreate(input),
    ]);
    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
    expect(engine.callsOf('connect')).toHaveLength(1);
  });

  it('falha clara quando o Lavalink está indisponível', async () => {
    const { engine, manager } = setup();
    engine.available = false;
    await expect(
      manager.getOrCreate({
        guildId: 'A',
        voiceChannelId: 'v',
        textChannelId: 't',
        settings: settings(),
      }),
    ).rejects.toThrow('indisponível');
    expect(manager.size).toBe(0);
  });

  it('remove a sessão ao destruir e permite recriar', async () => {
    const { manager } = setup();
    const input = { guildId: 'A', voiceChannelId: 'v', textChannelId: 't', settings: settings() };
    const s = await manager.getOrCreate(input);
    await manager.destroy('A', 'leave');
    expect(manager.get('A')).toBeUndefined();
    const again = await manager.getOrCreate(input);
    expect(again).not.toBe(s);
  });

  it('queda total do Lavalink marca sessões e recupera ao voltar', async () => {
    const { engine, manager } = setup();
    const s = await manager.getOrCreate({
      guildId: 'A',
      voiceChannelId: 'v',
      textChannelId: 't',
      settings: settings(),
    });
    await s.enqueue([makeTrack()], 'u');
    engine.available = false;
    engine.emit('nodeDisconnected', 'main', 'closed');
    expect(s.audioLost).toBe(true);
    engine.available = true;
    engine.emit('nodeConnected', 'main');
    await new Promise((r) => setTimeout(r, 5));
    expect(s.audioLost).toBe(false);
    expect(engine.callsOf('play')).toHaveLength(2);
  });

  it('aplica presença: sozinho no canal agenda saída', async () => {
    const { manager } = setup(0);
    const s = await manager.getOrCreate({
      guildId: 'A',
      voiceChannelId: 'v',
      textChannelId: 't',
      settings: settings(),
    });
    expect(s.isAlone()).toBe(true);
    expect(manager.humansWithBot('A')).toBe(0);
  });

  it('respeita o limite global da fila', async () => {
    const { manager } = setup();
    const s = await manager.getOrCreate({
      guildId: 'A',
      voiceChannelId: 'v',
      textChannelId: 't',
      settings: settings({ maxQueueSize: 5000 }),
    });
    const result = await s.enqueue(
      Array.from({ length: 1005 }, () => makeTrack()),
      'u',
    );
    expect(result.added.length).toBe(1000);
  });

  it('falha do coordenador de leases (Redis fora) vira erro amigável, sem sessão órfã', async () => {
    const engine = new FakeEngine();
    const { hooks } = makeHooks();
    const brokenLeases = {
      acquire: () => Promise.reject(new Error('ECONNREFUSED')),
      close: async () => undefined,
    };
    const manager = new SessionManager(
      engine,
      brokenLeases,
      hooks,
      { humansInChannel: () => 1, channelExists: async () => true },
      silentLogger,
      1000,
    );
    await expect(
      manager.getOrCreate({
        guildId: 'G',
        voiceChannelId: 'v',
        textChannelId: 't',
        settings: settings(),
      }),
    ).rejects.toMatchObject({ code: 'LEASE_UNAVAILABLE' });
    expect(manager.get('G')).toBeUndefined();
    expect(engine.players.size).toBe(0);
  });
});
