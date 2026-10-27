import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LavalinkEngine } from '../../src/audio/lavalinkEngine.js';
import { silentLogger } from '../helpers/fakes.js';
import { lavalinkTrack, MockLavalink } from '../helpers/mockLavalink.js';

const GUILD = '123456789012345678';
const BOT = '876543210987654321';
const CHANNEL = '111111111111111111';

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('LavalinkEngine contra servidor Lavalink v4 simulado', () => {
  const mock = new MockLavalink();
  let engine: LavalinkEngine;
  const shardPayloads: unknown[] = [];

  beforeAll(async () => {
    await mock.start();
    engine = new LavalinkEngine({
      nodes: [
        { id: 'mock', host: '127.0.0.1', port: mock.port, password: 'senha-teste', secure: false },
      ],
      logger: silentLogger,
      sendToShard: (_guildId, payload) => shardPayloads.push(payload),
    });
    await engine.init({ id: BOT, username: 'Aurora' });
    await waitFor(() => engine.isAvailable());
  });

  afterAll(async () => {
    await engine.close();
    await mock.stop();
  });

  it('conecta com os cabeçalhos do protocolo v4', () => {
    const headers = mock.wsHeaders[0]!;
    expect(headers['user-id']).toBe(BOT);
    expect(headers['client-name']).toBeTruthy();
    expect(engine.health()[0]).toMatchObject({ id: 'mock', connected: true });
  });

  it('lê as fontes ativas do nó', async () => {
    await waitFor(() => engine.availableSources() !== null);
    expect(engine.availableSources()!.has('youtube')).toBe(true);
  });

  it('pesquisa e normaliza resultados', async () => {
    mock.loadResult = {
      loadType: 'search',
      data: [lavalinkTrack('abc'), lavalinkTrack('def', { isStream: true, isSeekable: true })],
    };
    const result = await engine.search({ identifier: 'ytsearch:teste' });
    expect(mock.requests.at(-1)?.path).toContain('identifier=ytsearch%3Ateste');
    expect(result.kind).toBe('search');
    expect(result.tracks[0]).toMatchObject({
      identifier: 'abc',
      title: 'Faixa abc',
      durationMs: 200_000,
      sourceName: 'youtube',
      encoded: 'QAAAabc',
    });
    expect(result.tracks[1]?.isSeekable).toBe(false); // transmissões nunca são "seekable"
  });

  it('erros de carregamento viram mensagem segura', async () => {
    mock.loadResult = {
      loadType: 'error',
      data: { message: 'This video is unavailable', severity: 'COMMON', cause: 'x' },
    };
    const common = await engine.search({ identifier: 'https://youtu.be/x' });
    expect(common).toMatchObject({ kind: 'error', errorMessage: 'This video is unavailable' });
    mock.loadResult = {
      loadType: 'error',
      data: { message: 'java.lang.NullPointerException at ...', severity: 'FAULT', cause: 'x' },
    };
    const fault = await engine.search({ identifier: 'https://youtu.be/y' });
    expect(fault.errorMessage).not.toContain('java');
  });

  it('conecta à voz e envia voice state com channelId (requisito do DAVE)', async () => {
    await engine.connect({
      guildId: GUILD,
      voiceChannelId: CHANNEL,
      textChannelId: '222222222222222222',
      volume: 80,
    });
    expect(shardPayloads.at(-1)).toMatchObject({
      op: 4,
      d: { guild_id: GUILD, channel_id: CHANNEL, self_deaf: true },
    });
    await engine.handleRawGatewayEvent({
      t: 'VOICE_STATE_UPDATE',
      d: { guild_id: GUILD, user_id: BOT, channel_id: CHANNEL, session_id: 'sess-1' },
    });
    await engine.handleRawGatewayEvent({
      t: 'VOICE_SERVER_UPDATE',
      d: { guild_id: GUILD, token: 'voice-token', endpoint: 'us-east.discord.media' },
    });
    await waitFor(() => mock.playerUpdates(GUILD).some((b) => b?.voice));
    const voice = mock.playerUpdates(GUILD).find((b) => b?.voice)!.voice;
    expect(voice).toEqual({
      token: 'voice-token',
      endpoint: 'us-east.discord.media',
      sessionId: 'sess-1',
      channelId: CHANNEL,
    });
  });

  it('play, pausa, volume, seek, filtros e stop geram as requisições corretas', async () => {
    await engine.play(GUILD, 'QAAAabc', { volume: 70 });
    await engine.setPaused(GUILD, true);
    await engine.setVolume(GUILD, 55);
    await engine.seek(GUILD, 30_000);
    await engine.setFilter(GUILD, 'nightcore');
    await engine.setFilter(GUILD, 'off');
    await engine.stop(GUILD);
    const bodies = mock.playerUpdates(GUILD).filter((b) => !b?.voice);
    expect(bodies.some((b) => b.track?.encoded === 'QAAAabc' && b.volume === 70)).toBe(true);
    expect(bodies.some((b) => b.paused === true)).toBe(true);
    expect(bodies.some((b) => b.volume === 55)).toBe(true);
    expect(bodies.some((b) => b.position === 30_000)).toBe(true);
    expect(bodies.some((b) => b.filters?.timescale?.speed === 1.2)).toBe(true);
    expect(bodies.some((b) => b.filters && Object.keys(b.filters).length === 0)).toBe(true);
    expect(bodies.at(-1)).toEqual({ track: { encoded: null } });
  });

  it('traduz eventos do Lavalink para eventos do motor', async () => {
    const start = vi.fn();
    const end = vi.fn();
    const stuck = vi.fn();
    const closed = vi.fn();
    engine
      .on('trackStart', start)
      .on('trackEnd', end)
      .on('trackStuck', stuck)
      .on('voiceClosed', closed);
    const track = lavalinkTrack('abc');
    mock.emit({ op: 'event', type: 'TrackStartEvent', guildId: GUILD, track });
    mock.emit({ op: 'event', type: 'TrackEndEvent', guildId: GUILD, track, reason: 'finished' });
    mock.emit({ op: 'event', type: 'TrackStuckEvent', guildId: GUILD, track, thresholdMs: 10000 });
    mock.emit({
      op: 'event',
      type: 'WebSocketClosedEvent',
      guildId: GUILD,
      code: 4006,
      reason: 'x',
      byRemote: true,
    });
    await waitFor(() => closed.mock.calls.length > 0);
    expect(start).toHaveBeenCalledWith(GUILD, 'QAAAabc');
    expect(end).toHaveBeenCalledWith(GUILD, 'QAAAabc', 'finished');
    expect(stuck).toHaveBeenCalledWith(GUILD, 'QAAAabc', 10000);
    expect(closed).toHaveBeenCalledWith(GUILD, 4006, true);
  });

  it('detecta queda do nó e reconecta', async () => {
    const down = vi.fn();
    const up = vi.fn();
    engine.on('nodeDisconnected', down).on('nodeConnected', up);
    mock.dropConnections();
    await waitFor(() => down.mock.calls.length > 0);
    await waitFor(() => up.mock.calls.length > 0, 15_000);
    expect(engine.isAvailable()).toBe(true);
  }, 20_000);

  it('destroy remove o player e sai do canal', async () => {
    await engine.destroy(GUILD);
    expect(engine.hasPlayer(GUILD)).toBe(false);
    expect(shardPayloads.at(-1)).toMatchObject({ op: 4, d: { guild_id: GUILD, channel_id: null } });
    expect(mock.requests.some((r) => r.method === 'DELETE' && r.path.includes(GUILD))).toBe(true);
  });
});
