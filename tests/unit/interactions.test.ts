import { describe, expect, it } from 'vitest';
import { handleInteraction } from '../../src/discord/interactions.js';
import { customId } from '../../src/ui/components.js';
import { makeTrack } from '../helpers/fakes.js';
import {
  DJ_ROLE,
  fakeButton,
  fakeCommand,
  GUILD,
  makeApp,
  OTHER_GUILD,
  sentText,
  VOICE,
} from '../helpers/discordFakes.js';

async function playingSession(app: ReturnType<typeof makeApp>, requester = 'requester') {
  const session = await app.sessions.getOrCreate({
    guildId: GUILD,
    voiceChannelId: VOICE,
    textChannelId: 't',
    settings: app.settings,
  });
  await session.enqueue([makeTrack(), makeTrack(), makeTrack()], requester);
  return session;
}

describe('roteador de interações', () => {
  it('recusa controle de outro servidor', async () => {
    const ctx = makeApp();
    const session = await playingSession(ctx);
    const { interaction, calls } = fakeButton(
      customId('pnl', 'stop', GUILD),
      { id: 'dj', roles: [DJ_ROLE] },
      OTHER_GUILD,
    );
    await handleInteraction(ctx.app, interaction as never);
    expect(sentText(calls)).toContain('outro servidor');
    expect(session.state).toBe('playing');
  });

  it('usuário comum não pode parar pelo painel (autorização no clique)', async () => {
    const ctx = makeApp();
    const session = await playingSession(ctx);
    const { interaction, calls } = fakeButton(customId('pnl', 'stop', GUILD), { id: 'comum' });
    await handleInteraction(ctx.app, interaction as never);
    expect(sentText(calls)).toContain('Somente DJs');
    expect(session.state).toBe('playing');
    expect(ctx.engine.callsOf('stop')).toHaveLength(0);
  });

  it('DJ para pelo painel e o painel é atualizado', async () => {
    const ctx = makeApp();
    const session = await playingSession(ctx);
    const { interaction, calls } = fakeButton(customId('pnl', 'stop', GUILD), {
      id: 'dj',
      roles: [DJ_ROLE],
    });
    await handleInteraction(ctx.app, interaction as never);
    expect(session.state).toBe('idle');
    expect(calls.map((c) => c.method)).toEqual(['deferUpdate', 'editReply']);
  });

  it('quem pediu a faixa pode pulá-la mesmo sem ser DJ', async () => {
    const ctx = makeApp();
    const session = await playingSession(ctx, 'dono');
    const first = session.current!;
    const { interaction } = fakeButton(customId('pnl', 'skip', GUILD, first.uid), { id: 'dono' });
    await handleInteraction(ctx.app, interaction as never);
    expect(session.current?.uid).not.toBe(first.uid);
  });

  it('clique atrasado em "pular" não pula a faixa seguinte', async () => {
    const ctx = makeApp();
    const session = await playingSession(ctx);
    const staleUid = session.current!.uid;
    await session.skip();
    const now = session.current!.uid;
    const { interaction, calls } = fakeButton(customId('pnl', 'skip', GUILD, staleUid), {
      id: 'dj',
      roles: [DJ_ROLE],
    });
    await handleInteraction(ctx.app, interaction as never);
    expect(session.current!.uid).toBe(now);
    expect(sentText(calls)).toContain('já tinha mudado');
  });

  it('exige estar no mesmo canal de voz', async () => {
    const ctx = makeApp();
    await playingSession(ctx);
    const { interaction, calls } = fakeButton(customId('pnl', 'toggle', GUILD), {
      id: 'dj',
      roles: [DJ_ROLE],
      voiceChannelId: '999999999999999999',
    });
    await handleInteraction(ctx.app, interaction as never);
    expect(sentText(calls)).toContain('Entre nesse canal');
  });

  it('botão de sessão encerrada desativa o painel', async () => {
    const ctx = makeApp();
    const { interaction, calls } = fakeButton(customId('pnl', 'skip', GUILD), {
      id: 'dj',
      roles: [DJ_ROLE],
    });
    await handleInteraction(ctx.app, interaction as never);
    expect(calls[0]?.method).toBe('update');
    expect(calls[0]?.payload.components).toEqual([]);
  });

  it('sozinho no canal ganha controle de DJ', async () => {
    const ctx = makeApp({ humans: 1 });
    const session = await playingSession(ctx);
    const { interaction } = fakeButton(customId('pnl', 'toggle', GUILD), { id: 'comum' });
    await handleInteraction(ctx.app, interaction as never);
    expect(session.state).toBe('paused');
  });

  it('confirmação só vale para quem iniciou e é de uso único', async () => {
    const ctx = makeApp();
    let runs = 0;
    ctx.app.pendingConfirmations.set('tok', {
      userId: 'autor',
      run: async () => {
        runs++;
        return 'feito';
      },
    });
    const intruder = fakeButton(customId('cfm', 'yes', GUILD, 'tok'), { id: 'outro' });
    await handleInteraction(ctx.app, intruder.interaction as never);
    expect(sentText(intruder.calls)).toContain('Só quem iniciou');
    const author = fakeButton(customId('cfm', 'yes', GUILD, 'tok'), { id: 'autor' });
    await handleInteraction(ctx.app, author.interaction as never);
    const again = fakeButton(customId('cfm', 'yes', GUILD, 'tok'), { id: 'autor' });
    await handleInteraction(ctx.app, again.interaction as never);
    expect(runs).toBe(1);
    expect(sentText(again.calls)).toContain('expirou');
  });

  it('limita cliques em excesso', async () => {
    const ctx = makeApp();
    await playingSession(ctx);
    const clicks = Array.from({ length: 7 }, () =>
      fakeButton(customId('pnl', 'queue', GUILD), { id: 'spammer' }),
    );
    for (const click of clicks) await handleInteraction(ctx.app, click.interaction as never);
    expect(sentText(clicks.at(-1)!.calls)).toContain('Calma');
  });

  it('/volume: usuário comum vê, mas não altera; DJ altera dentro do máximo', async () => {
    const ctx = makeApp();
    const session = await playingSession(ctx);
    const view = fakeCommand('volume', { id: 'comum' });
    await handleInteraction(ctx.app, view.interaction as never);
    expect(sentText(view.calls)).toContain('Volume atual');
    const denied = fakeCommand('volume', { id: 'comum' }, { nivel: 10 });
    await handleInteraction(ctx.app, denied.interaction as never);
    expect(sentText(denied.calls)).toContain('Somente DJs');
    const dj = fakeCommand('volume', { id: 'dj', roles: [DJ_ROLE] }, { nivel: 200 });
    await handleInteraction(ctx.app, dj.interaction as never);
    expect(session.volume).toBe(150);
  });

  it('/skip sem sessão responde com orientação', async () => {
    const ctx = makeApp();
    const { interaction, calls } = fakeCommand('skip', { id: 'dj', roles: [DJ_ROLE] });
    await handleInteraction(ctx.app, interaction as never);
    expect(sentText(calls)).toContain('/play');
  });

  it('erro inesperado vira mensagem genérica com código, sem stack', async () => {
    const ctx = makeApp();
    await playingSession(ctx);
    ctx.engine.setPaused = async () => {
      throw new Error('segredo interno: postgres://u:p@h');
    };
    const { interaction, calls } = fakeCommand('pause', { id: 'dj', roles: [DJ_ROLE] });
    await handleInteraction(ctx.app, interaction as never);
    const text = sentText(calls);
    expect(text).toContain('Algo deu errado');
    expect(text).toContain('Código');
    expect(text).not.toContain('segredo');
  });

  it('comando de administrador negado para DJ', async () => {
    const ctx = makeApp();
    const { interaction, calls } = fakeCommand(
      'djrole',
      { id: 'dj', roles: [DJ_ROLE] },
      { subcommand: 'remove' },
    );
    await handleInteraction(ctx.app, interaction as never);
    expect(sentText(calls)).toContain('Administrador');
    expect(ctx.app.settings.update).not.toHaveBeenCalled();
  });
});
