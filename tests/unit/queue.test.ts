import { describe, expect, it } from 'vitest';
import { MusicQueue } from '../../src/music/queue.js';
import { makeTrack } from '../helpers/fakes.js';

const limits = { maxSize: 5, allowDuplicates: true, maxTrackDurationMs: null };

describe('MusicQueue', () => {
  it('adiciona faixas em ordem e respeita o limite', () => {
    const q = new MusicQueue(limits);
    const tracks = Array.from({ length: 7 }, () => makeTrack());
    const result = q.add(tracks, 'u1');
    expect(result.added).toHaveLength(5);
    expect(result.rejected.map((r) => r.reason)).toEqual(['full', 'full']);
    expect(q.tracks.map((i) => i.track.encoded)).toEqual(tracks.slice(0, 5).map((t) => t.encoded));
  });

  it('bloqueia duplicatas quando configurado, incluindo a faixa atual', () => {
    const q = new MusicQueue({ ...limits, allowDuplicates: false });
    const t = makeTrack();
    q.add([t], 'u1');
    q.advance(false);
    const result = q.add([{ ...t }, makeTrack()], 'u2');
    expect(result.rejected).toEqual([{ track: { ...t }, reason: 'duplicate' }]);
    expect(q.size).toBe(1);
  });

  it('rejeita faixas acima da duração máxima, mas aceita transmissões', () => {
    const q = new MusicQueue({ ...limits, maxTrackDurationMs: 60_000 });
    const result = q.add(
      [makeTrack({ durationMs: 120_000 }), makeTrack({ isStream: true, durationMs: 0 })],
      'u1',
    );
    expect(result.rejected[0]?.reason).toBe('too_long');
    expect(result.added).toHaveLength(1);
  });

  it('adiciona como próxima com next=true', () => {
    const q = new MusicQueue(limits);
    q.add([makeTrack(), makeTrack()], 'u1');
    const urgent = makeTrack();
    q.add([urgent], 'u1', { next: true });
    expect(q.tracks[0]?.track).toBe(urgent);
  });

  it('avança respeitando loop off/track/queue', () => {
    const q = new MusicQueue(limits);
    const [a, b] = [makeTrack(), makeTrack()];
    q.add([a, b], 'u1');
    expect(q.advance(true)?.track).toBe(a);

    q.loop = 'track';
    expect(q.advance(true)?.track).toBe(a); // terminou naturalmente: repete
    expect(q.advance(false)?.track).toBe(b); // pulo: avança

    q.loop = 'queue';
    expect(q.advance(true)?.track).toBe(b); // fila vazia: no modo queue, b volta ao fim e toca de novo
    q.add([a], 'u1');
    expect(q.advance(true)?.track).toBe(a);
    expect(q.tracks[0]?.track).toBe(b);
    expect(q.previous.length).toBeGreaterThan(0);

    q.loop = 'off';
    q.clear();
    expect(q.advance(true)).toBeNull();
  });

  it('volta para a anterior colocando a atual no início da fila', () => {
    const q = new MusicQueue(limits);
    const [a, b] = [makeTrack(), makeTrack()];
    q.add([a, b], 'u1');
    q.advance(false);
    q.advance(false);
    expect(q.current?.track).toBe(b);
    expect(q.back()?.track).toBe(a);
    expect(q.tracks[0]?.track).toBe(b);
    expect(new MusicQueue(limits).back()).toBeNull();
  });

  it('remove e move com validação de posição', () => {
    const q = new MusicQueue(limits);
    const ts = [makeTrack(), makeTrack(), makeTrack()];
    q.add(ts, 'u1');
    expect(q.remove(0)).toBeNull();
    expect(q.remove(4)).toBeNull();
    expect(q.move(1, 3)?.track).toBe(ts[0]);
    expect(q.tracks.map((i) => i.track)).toEqual([ts[1], ts[2], ts[0]]);
    expect(q.move(1, 9)).toBeNull();
    expect(q.remove(2)?.track).toBe(ts[2]);
  });

  it('embaralha de forma determinística com gerador injetado', () => {
    const q = new MusicQueue(limits, 50, () => 0);
    const ts = [makeTrack(), makeTrack(), makeTrack()];
    q.add(ts, 'u1');
    q.shuffle();
    expect(q.tracks.map((i) => i.track)).toEqual([ts[1], ts[2], ts[0]]);
    expect(new Set(q.tracks.map((i) => i.track))).toEqual(new Set(ts));
  });

  it('reset limpa atual e fila mantendo histórico limitado', () => {
    const q = new MusicQueue(limits, 2);
    q.add([makeTrack(), makeTrack(), makeTrack()], 'u1');
    q.advance(false);
    q.advance(false);
    q.advance(false);
    q.reset();
    expect(q.current).toBeNull();
    expect(q.size).toBe(0);
    expect(q.previous).toHaveLength(2);
  });

  it('soma a duração ignorando transmissões', () => {
    const q = new MusicQueue(limits);
    q.add(
      [
        makeTrack({ durationMs: 1000 }),
        makeTrack({ durationMs: 2000 }),
        makeTrack({ isStream: true, durationMs: 99 }),
      ],
      'u',
    );
    expect(q.totalDurationMs).toBe(3000);
  });
});
