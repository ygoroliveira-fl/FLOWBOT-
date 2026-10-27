import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEngine, makeSession, makeTrack } from '../helpers/fakes.js';

describe('GuildSession', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('começa a tocar ao enfileirar com a sessão ociosa', async () => {
    const { session, engine } = await makeSession();
    const t = makeTrack();
    const result = await session.enqueue([t], 'u1');
    expect(result.startedPlaying).toBe(true);
    expect(engine.callsOf('play')[0]?.args[1]).toBe(t.encoded);
    expect(session.state).toBe('playing');
    expect(session.current?.track).toBe(t);
  });

  it('avança automaticamente quando a faixa termina', async () => {
    const { session, engine, started } = await makeSession();
    const [a, b] = [makeTrack(), makeTrack()];
    await session.enqueue([a, b], 'u1');
    await session.handleTrackStart(a.encoded);
    await session.handleTrackEnd(a.encoded, 'finished');
    expect(session.current?.track).toBe(b);
    expect(engine.callsOf('play').map((c) => c.args[1])).toEqual([a.encoded, b.encoded]);
    expect(started).toEqual([a.encoded]);
    await session.handleTrackEnd(b.encoded, 'finished');
    expect(session.state).toBe('idle');
    expect(session.current).toBeNull();
  });

  it('ignora TrackEnd "replaced" e eventos de faixas antigas', async () => {
    const { session, engine } = await makeSession();
    const [a, b] = [makeTrack(), makeTrack()];
    await session.enqueue([a, b], 'u1');
    await session.handleTrackEnd(a.encoded, 'replaced');
    expect(session.current?.track).toBe(a);
    await session.skip();
    await session.handleTrackEnd(a.encoded, 'replaced');
    await session.handleTrackEnd(a.encoded, 'finished'); // atrasado: não deve pular b
    expect(session.current?.track).toBe(b);
    expect(engine.callsOf('play')).toHaveLength(2);
  });

  it('stop e fim de faixa simultâneos: estado final é parado, sem tocar a próxima', async () => {
    const { session, engine } = await makeSession();
    const [a, b] = [makeTrack(), makeTrack()];
    await session.enqueue([a, b], 'u1');
    // stop chega primeiro; o TrackEnd(finished) de "a" chega logo depois.
    const stop = session.stop();
    const end = session.handleTrackEnd(a.encoded, 'finished');
    await Promise.all([stop, end]);
    expect(session.state).toBe('idle');
    expect(session.current).toBeNull();
    expect(engine.callsOf('play')).toHaveLength(1);
  });

  it('fim de faixa seguido de stop: a próxima começa e é parada em seguida', async () => {
    const { session, engine } = await makeSession();
    const [a, b] = [makeTrack(), makeTrack()];
    await session.enqueue([a, b], 'u1');
    await Promise.all([session.handleTrackEnd(a.encoded, 'finished'), session.stop()]);
    expect(engine.callsOf('play')).toHaveLength(2);
    expect(session.state).toBe('idle');
    expect(engine.calls.at(-1)?.method).toBe('stop');
  });

  it('dois skips de botão para a mesma faixa pulam apenas uma vez', async () => {
    const { session } = await makeSession();
    const [a, b, c] = [makeTrack(), makeTrack(), makeTrack()];
    await session.enqueue([a, b, c], 'u1');
    const uid = session.current!.uid;
    const [first, second] = await Promise.all([session.skip(uid), session.skip(uid)]);
    expect(first?.track).toBe(a);
    expect(second).toBeNull();
    expect(session.current?.track).toBe(b);
  });

  it('dois /skip seguidos pulam duas faixas', async () => {
    const { session } = await makeSession();
    const [a, b, c] = [makeTrack(), makeTrack(), makeTrack()];
    await session.enqueue([a, b, c], 'u1');
    await Promise.all([session.skip(), session.skip()]);
    expect(session.current?.track).toBe(c);
  });

  it('adições simultâneas são todas aplicadas, na ordem de chegada', async () => {
    const { session, engine } = await makeSession();
    const tracks = Array.from({ length: 10 }, () => makeTrack());
    await Promise.all(tracks.map((t, i) => session.enqueue([t], `u${i}`)));
    expect(engine.callsOf('play')).toHaveLength(1);
    expect(session.current?.track).toBe(tracks[0]);
    expect(session.queue.tracks.map((i) => i.track)).toEqual(tracks.slice(1));
  });

  it('pula faixas que falham e para após falhas consecutivas', async () => {
    const { session, notices } = await makeSession();
    const ts = [makeTrack(), makeTrack(), makeTrack(), makeTrack()];
    await session.enqueue(ts, 'u1');
    await session.handleTrackEnd(ts[0]!.encoded, 'loadFailed');
    expect(session.current?.track).toBe(ts[1]);
    await session.handleTrackEnd(ts[1]!.encoded, 'loadFailed');
    await session.handleTrackEnd(ts[2]!.encoded, 'loadFailed');
    expect(session.state).toBe('idle');
    expect(session.queue.size).toBe(0);
    expect(notices.at(-1)?.level).toBe('error');
  });

  it('falha no modo repetir faixa não entra em loop', async () => {
    const { session } = await makeSession();
    const [a, b] = [makeTrack(), makeTrack()];
    await session.enqueue([a, b], 'u1');
    await session.setLoop('track');
    await session.handleTrackEnd(a.encoded, 'finished');
    expect(session.current?.track).toBe(a);
    await session.handleTrackEnd(a.encoded, 'loadFailed');
    expect(session.current?.track).toBe(b);
  });

  it('trata faixa travada: espera o stop da biblioteca ou força após o prazo', async () => {
    const { session } = await makeSession();
    const [a, b, c] = [makeTrack(), makeTrack(), makeTrack()];
    await session.enqueue([a, b, c], 'u1');
    await session.handleTrackStuck(a.encoded);
    await session.handleTrackEnd(a.encoded, 'stopped');
    expect(session.current?.track).toBe(b);

    await session.handleTrackStuck(b.encoded);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.current?.track).toBe(c);
  });

  it('pausa, retoma e valida estados', async () => {
    const { session, engine } = await makeSession();
    await expect(session.setPaused(true)).rejects.toThrow('Não há nada tocando');
    await session.enqueue([makeTrack()], 'u1');
    await session.setPaused(true);
    expect(session.state).toBe('paused');
    await expect(session.setPaused(true)).rejects.toThrow('Já está pausado');
    expect(await session.togglePause()).toBe(false);
    expect(session.state).toBe('playing');
    expect(engine.callsOf('setPaused').map((c) => c.args[1])).toEqual([true, false]);
  });

  it('limita o volume ao máximo do servidor', async () => {
    const { session, engine } = await makeSession();
    expect(await session.setVolume(999)).toBe(150);
    expect(await session.setVolume(-5)).toBe(0);
    expect(engine.callsOf('setVolume').map((c) => c.args[1])).toEqual([150, 0]);
  });

  it('seek é recusado em transmissões e limitado à duração', async () => {
    const { session } = await makeSession();
    await session.enqueue([makeTrack({ isStream: true, isSeekable: false })], 'u1');
    await expect(session.seek(1000)).rejects.toThrow('ao vivo');
    await session.stop();
    await session.enqueue([makeTrack({ durationMs: 60_000 })], 'u1');
    expect(await session.seek(10_000_000)).toBe(59_000);
  });

  it('remove apenas faixas próprias quando há guarda de solicitante', async () => {
    const { session } = await makeSession();
    await session.enqueue([makeTrack(), makeTrack()], 'dono');
    await expect(session.remove(1, (item) => item.requesterId === 'outro')).rejects.toThrow(
      'você mesmo',
    );
    expect((await session.remove(1, (item) => item.requesterId === 'dono')).requesterId).toBe(
      'dono',
    );
  });

  it('previous volta para a faixa anterior', async () => {
    const { session } = await makeSession();
    const [a, b] = [makeTrack(), makeTrack()];
    await session.enqueue([a, b], 'u1');
    await session.skip();
    const item = await session.previous();
    expect(item.track).toBe(a);
    expect(session.queue.tracks[0]?.track).toBe(b);
  });

  it('autoplay adiciona sugestão quando a fila acaba', async () => {
    const suggestion = makeTrack({ title: 'Sugestão' });
    const { session } = await makeSession(new FakeEngine(), { autoplay: async () => suggestion });
    await session.setAutoplay(true);
    const a = makeTrack();
    await session.enqueue([a], 'u1');
    await session.handleTrackEnd(a.encoded, 'finished');
    expect(session.current?.track).toBe(suggestion);
    expect(session.current?.requesterId).toBe('autoplay');
  });

  it('sai por inatividade quando fica ociosa', async () => {
    const { session, h } = await makeSession();
    const a = makeTrack();
    await session.enqueue([a], 'u1');
    await session.handleTrackEnd(a.encoded, 'finished');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(session.destroyed).toBe(true);
    expect(h.destroyedReason).toBe('inactivity');
  });

  it('não sai por inatividade enquanto toca com ouvintes', async () => {
    const { session } = await makeSession();
    await session.enqueue([makeTrack()], 'u1');
    session.setAlone(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(session.destroyed).toBe(false);
  });

  it('sai quando fica sozinho no canal pelo tempo configurado', async () => {
    const { session } = await makeSession();
    await session.enqueue([makeTrack()], 'u1');
    session.setAlone(true);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(session.destroyed).toBe(true);
  });

  it('reconecta a voz com backoff e retoma a faixa na última posição', async () => {
    const { session, engine } = await makeSession();
    const a = makeTrack();
    await session.enqueue([a], 'u1');
    engine.position = 42_000;
    const done = session.handleVoiceDisconnected(async () => true);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(engine.callsOf('connect')).toHaveLength(1);
    const replay = engine.callsOf('play').at(-1)!;
    expect(replay.args[1]).toBe(a.encoded);
    expect((replay.args[2] as { startMs: number }).startMs).toBe(42_000);
    expect(session.destroyed).toBe(false);
  });

  it('encerra a sessão se o canal não existe mais', async () => {
    const { session, h } = await makeSession();
    await session.enqueue([makeTrack()], 'u1');
    await session.handleVoiceDisconnected(async () => false);
    expect(session.destroyed).toBe(true);
    expect(h.destroyedReason).toBe('voice_disconnected');
  });

  it('recupera o áudio após queda do nó', async () => {
    const { session, engine } = await makeSession();
    const a = makeTrack();
    await session.enqueue([a], 'u1');
    engine.position = 5_000;
    session.markAudioLost();
    await session.recoverAudio();
    expect(engine.callsOf('destroy')).toHaveLength(1);
    expect(engine.callsOf('connect')).toHaveLength(1);
    expect((engine.callsOf('play').at(-1)!.args[2] as { startMs: number }).startMs).toBe(5_000);
  });

  it('rejeita comandos após o lease ser perdido (fencing)', async () => {
    const { session, lease } = await makeSession();
    await lease.release();
    await expect(session.enqueue([makeTrack()], 'u1')).rejects.toThrow('outra instância');
  });

  it('rejeita comandos após destruída', async () => {
    const { session } = await makeSession();
    await session.destroy('leave');
    await expect(session.skip()).rejects.toThrow('encerrada');
  });
});
