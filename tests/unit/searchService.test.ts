import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from '../../src/core/rateLimiter.js';
import { SearchService } from '../../src/providers/searchService.js';
import { providerForHost } from '../../src/providers/providers.js';
import { FakeEngine, makeTrack } from '../helpers/fakes.js';

function setup(options: { timeoutMs?: number } = {}) {
  const engine = new FakeEngine();
  const observed: string[] = [];
  const service = new SearchService(
    engine,
    new MemoryRateLimiter(),
    { observe: (p, o) => observed.push(`${p}:${o}`) },
    {
      resolver: async () => ['93.184.216.34'],
      ...options,
    },
  );
  return { engine, service, observed };
}
const base = { guildId: 'g', allowHttpStreams: false };

describe('SearchService', () => {
  it('usa o prefixo do provedor escolhido para texto', async () => {
    const { engine, service } = setup();
    engine.searchResult = { kind: 'search', tracks: [makeTrack()] };
    await service.resolve('  daft punk ', base);
    await service.resolve('daft punk', { ...base, source: 'soundcloud' });
    await service.resolve('daft punk', { ...base, source: 'youtubemusic' });
    expect(engine.callsOf('search').map((c) => c.args[0])).toEqual([
      'ytsearch:daft punk',
      'scsearch:daft punk',
      'ytmsearch:daft punk',
    ]);
  });

  it('envia links conhecidos diretamente e identifica o provedor', async () => {
    const { engine, service } = setup();
    engine.searchResult = { kind: 'track', tracks: [makeTrack()] };
    const out = await service.resolve('https://music.youtube.com/watch?v=abc', base);
    expect(out.provider.id).toBe('youtubemusic');
    expect(out.isUrl).toBe(true);
    expect(engine.callsOf('search')[0]?.args[0]).toBe('https://music.youtube.com/watch?v=abc');
    expect(providerForHost('artista.bandcamp.com')?.id).toBe('bandcamp');
    expect(providerForHost('www.twitch.tv')?.id).toBe('twitch');
  });

  it('recusa Spotify/Apple Music/Deezer com orientação clara', async () => {
    const { engine, service } = setup();
    await expect(service.resolve('https://open.spotify.com/track/123', base)).rejects.toThrow(
      'Pesquise pelo nome',
    );
    await expect(service.resolve('https://music.apple.com/br/album/x/1', base)).rejects.toThrow(
      'DRM',
    );
    await expect(service.resolve('https://www.deezer.com/track/1', base)).rejects.toThrow('Deezer');
    expect(engine.callsOf('search')).toHaveLength(0);
  });

  it('streams HTTP genéricos exigem permissão e passam pela checagem de SSRF', async () => {
    const { engine, service } = setup();
    await expect(service.resolve('https://radio.example.com/live.mp3', base)).rejects.toThrow(
      'não são suportados',
    );
    engine.searchResult = { kind: 'track', tracks: [makeTrack({ sourceName: 'http' })] };
    const out = await service.resolve('https://radio.example.com/live.mp3', {
      ...base,
      allowHttpStreams: true,
    });
    expect(out.provider.id).toBe('http');
    await expect(
      service.resolve('http://10.0.0.1/a.mp3', { ...base, allowHttpStreams: true }),
    ).rejects.toThrow('não é permitido');
  });

  it('valida entrada vazia e longa demais', async () => {
    const { service } = setup();
    await expect(service.resolve('   ', base)).rejects.toThrow('Digite');
    await expect(service.resolve('a'.repeat(501), base)).rejects.toThrow('longa');
  });

  it('informa fonte desativada no Lavalink e sugere alternativa', async () => {
    const { engine, service } = setup();
    engine.sources = new Set(['soundcloud', 'http']);
    await expect(service.resolve('musica', base)).rejects.toThrow('SoundCloud');
    engine.searchResult = { kind: 'search', tracks: [makeTrack()] };
    await expect(
      service.resolve('musica', { ...base, source: 'soundcloud' }),
    ).resolves.toBeTruthy();
  });

  it('aplica timeout e registra métrica', async () => {
    const { engine, service, observed } = setup({ timeoutMs: 20 });
    engine.search = () => new Promise(() => undefined);
    await expect(service.resolve('lento', base)).rejects.toThrow('demorou demais');
    expect(observed).toContain('youtube:timeout');
  });

  it('limita pesquisas por servidor', async () => {
    const { engine, service } = setup();
    engine.searchResult = { kind: 'search', tracks: [makeTrack()] };
    for (let i = 0; i < 20; i++) await service.resolve(`q${i}`, base);
    await expect(service.resolve('q21', base)).rejects.toThrow('Calma');
    await expect(
      service.resolve('outro servidor', { ...base, guildId: 'g2' }),
    ).resolves.toBeTruthy();
  });
});
