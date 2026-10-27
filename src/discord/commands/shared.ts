import { InteractionContextType } from 'discord.js';
import type { GuildSettings } from '../../data/guildSettings.js';
import { UserError } from '../../core/errors.js';
import type { GuildSession } from '../../music/session.js';
import type { Track } from '../../music/types.js';
import { addedEmbed, warnEmbed } from '../../ui/embeds.js';
import {
  assertBotCanJoin,
  requireVoice,
  respond,
  type AppContext,
  type GuildInteraction,
} from '../context.js';

/** Cria/obtém a sessão do servidor após validar canal de voz e permissões do bot. */
export async function ensureSession(
  app: AppContext,
  interaction: GuildInteraction,
  settings: GuildSettings,
): Promise<GuildSession> {
  const existing = app.sessions.get(interaction.guildId);
  const channel = requireVoice(interaction, existing);
  if (existing && !existing.destroyed) return existing;
  assertBotCanJoin(channel, interaction.guild);
  return app.sessions.getOrCreate({
    guildId: interaction.guildId,
    voiceChannelId: channel.id,
    textChannelId: interaction.channelId,
    settings,
  });
}

/** Buscas em andamento por usuário+servidor: uma nova busca cancela a anterior (obsoleta). */
const inflight = new Map<string, AbortController>();

export function beginSearch(
  guildId: string,
  userId: string,
): { signal: AbortSignal; done: () => void } {
  const key = `${guildId}:${userId}`;
  inflight
    .get(key)
    ?.abort(new UserError('Pesquisa substituída por uma mais recente.', 'SUPERSEDED'));
  const controller = new AbortController();
  inflight.set(key, controller);
  return {
    signal: controller.signal,
    done: () => {
      if (inflight.get(key) === controller) inflight.delete(key);
    },
  };
}

export async function enqueueAndReply(
  app: AppContext,
  interaction: GuildInteraction,
  session: GuildSession,
  tracks: Track[],
  options: { next?: boolean; playlistName?: string; unavailable?: number } = {},
): Promise<void> {
  const before = session.queue.size;
  const result = await session.enqueue(tracks, interaction.user.id, {
    next: options.next ?? false,
  });
  if (!result.added.length) {
    const reason = result.rejected[0]?.reason;
    throw new UserError(
      reason === 'full'
        ? 'A fila está cheia.'
        : reason === 'duplicate'
          ? 'Essa faixa já está na fila (duplicatas desativadas neste servidor).'
          : reason === 'too_long'
            ? 'A faixa ultrapassa a duração máxima permitida neste servidor.'
            : 'Nenhuma faixa foi adicionada.',
    );
  }
  const embeds = [
    addedEmbed({
      added: result.added,
      rejected: result.rejected.length,
      ...(options.playlistName ? { playlistName: options.playlistName } : {}),
      startedPlaying: result.startedPlaying,
      queuePositionStart: options.next ? 1 : before + 1,
    }),
  ];
  if (options.unavailable)
    embeds.push(
      warnEmbed(
        `${options.unavailable} faixa(s) da playlist não puderam ser adicionadas (dados inválidos).`,
      ),
    );
  await respond(interaction, { embeds });
}

/** Comandos só funcionam dentro de servidores. */
export const guildOnly = <
  T extends { setContexts(...contexts: InteractionContextType[]): unknown },
>(
  builder: T,
): T => {
  builder.setContexts(InteractionContextType.Guild);
  return builder;
};
