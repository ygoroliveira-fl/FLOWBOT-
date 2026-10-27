import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../core/errors.js';
import { queueEmbed, successEmbed, warnEmbed } from '../../ui/embeds.js';
import { confirmButtons, queuePager } from '../../ui/components.js';
import { trackLink } from '../../ui/format.js';
import {
  can,
  newToken,
  requirePermission,
  requireSession,
  requireVoice,
  respond,
} from '../context.js';
import { guildOnly } from './shared.js';
import type { Command } from './types.js';

export const queue: Command = {
  name: 'queue',
  category: 'Fila',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Mostra a fila')
      .addIntegerOption((o) => o.setName('pagina').setDescription('Página da fila').setMinValue(1)),
  ).toJSON(),
  async execute(app, interaction) {
    await requirePermission(app, interaction, 'view');
    const session = requireSession(app, interaction);
    const page = (interaction.options.getInteger('pagina') ?? 1) - 1;
    const view = queueEmbed(session, page, app.brand);
    await respond(interaction, {
      embeds: [view.embed],
      components: queuePager(interaction.guildId, view.page, view.pages),
      ephemeral: true,
    });
  },
};

export const remove: Command = {
  name: 'remove',
  category: 'Fila',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove uma faixa da fila')
      .addIntegerOption((o) =>
        o
          .setName('posicao')
          .setDescription('Posição na fila (veja /queue)')
          .setRequired(true)
          .setMinValue(1),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    const position = interaction.options.getInteger('posicao', true);
    // DJ remove qualquer faixa; usuário comum só as próprias (checado de novo dentro da sessão).
    const isDj = await can(app, interaction, 'remove');
    if (!isDj) await requirePermission(app, interaction, 'remove.own');
    const removed = await session.remove(
      position,
      isDj ? undefined : (item) => item.requesterId === interaction.user.id,
    );
    await respond(interaction, {
      embeds: [successEmbed(`Removida: ${trackLink(removed.track.title, removed.track.uri)}.`)],
    });
  },
};

export const move: Command = {
  name: 'move',
  category: 'Fila',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('move')
      .setDescription('Move uma faixa para outra posição')
      .addIntegerOption((o) =>
        o.setName('de').setDescription('Posição atual').setRequired(true).setMinValue(1),
      )
      .addIntegerOption((o) =>
        o.setName('para').setDescription('Nova posição').setRequired(true).setMinValue(1),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'move');
    const from = interaction.options.getInteger('de', true);
    const to = interaction.options.getInteger('para', true);
    const moved = await session.move(from, to);
    await respond(interaction, {
      embeds: [
        successEmbed(
          `${trackLink(moved.track.title, moved.track.uri)} movida para a posição **${to}**.`,
        ),
      ],
    });
  },
};

export const clear: Command = {
  name: 'clear',
  category: 'Fila',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Limpa a fila (mantém a música atual)'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'clear');
    const size = session.queue.size;
    if (size === 0) throw new UserError('A fila já está vazia.');
    if (size <= 5) {
      await session.clear();
      await respond(interaction, {
        embeds: [successEmbed(`Fila limpa (${size} faixas removidas).`)],
      });
      return;
    }
    // Operação destrutiva maior: pede confirmação (uso único, expira em 60 s).
    const token = newToken();
    app.pendingConfirmations.set(token, {
      userId: interaction.user.id,
      run: async () => {
        const live = app.sessions.get(interaction.guildId);
        if (!live || live.destroyed) throw new UserError('A sessão já foi encerrada.');
        const removed = await live.clear();
        return `Fila limpa (${removed} faixas removidas).`;
      },
    });
    await respond(interaction, {
      embeds: [warnEmbed(`Remover **${size} faixas** da fila? Esta ação não pode ser desfeita.`)],
      components: confirmButtons(interaction.guildId, token, 'Limpar fila'),
      ephemeral: true,
    });
  },
};

export const queueCommands = [queue, remove, move, clear];
