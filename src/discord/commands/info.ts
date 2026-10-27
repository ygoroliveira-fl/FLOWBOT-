import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { SEARCHABLE_PROVIDERS, PLAYABLE_PROVIDERS } from '../../providers/providers.js';
import { confirmButtons } from '../../ui/components.js';
import { warnEmbed } from '../../ui/embeds.js';
import { formatDuration, plural, safeText } from '../../ui/format.js';
import { COLORS, ICON } from '../../ui/theme.js';
import { newToken, requirePermission, respond } from '../context.js';
import { describeAccess } from './music.js';
import { guildOnly } from './shared.js';
import type { Command } from './types.js';

/** Lista de comandos do /help, preenchida em commands/index.ts para evitar import circular. */
export const helpRegistry: { name: string; category: Command['category']; description: string }[] =
  [];

export const help: Command = {
  name: 'help',
  category: 'Informações',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Mostra os comandos e como usar o bot'),
  ).toJSON(),
  async execute(app, interaction) {
    const access = await describeAccess(app, interaction);
    const categories = ['Música', 'Fila', 'Playlists', 'Configuração', 'Informações'] as const;
    const embed = new EmbedBuilder()
      .setColor(app.brand.accent)
      .setAuthor({ name: `${app.brand.name} ${ICON.dot} Ajuda` })
      .setDescription(
        [
          'Entre em um canal de voz e use `/play` com o nome de uma música ou um link.',
          `Fontes: ${PLAYABLE_PROVIDERS.filter((p) => p.id !== 'http')
            .map((p) => p.displayName)
            .join(', ')}.`,
          `Pesquisa por texto: ${SEARCHABLE_PROVIDERS.map((p) => p.displayName).join(', ')} (opção \`fonte\`).`,
          `Seu nível aqui: **${access}**.`,
        ].join('\n'),
      );
    for (const category of categories) {
      const items = helpRegistry.filter((c) => c.category === category);
      if (items.length)
        embed.addFields({
          name: category,
          value: items.map((c) => `\`/${c.name}\` ${c.description}`).join('\n'),
        });
    }
    embed.setFooter({
      text: 'Spotify, Apple Music e Deezer: pesquise pelo nome da música — o áudio desses serviços não é reproduzido.',
    });
    await respond(interaction, { embeds: [embed], ephemeral: true });
  },
};

export const stats: Command = {
  name: 'stats',
  category: 'Informações',
  defer: 'ephemeral',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Estatísticas de uso deste servidor e do bot'),
  ).toJSON(),
  async execute(app, interaction) {
    const settings = await requirePermission(app, interaction, 'stats');
    const nodes = app.engine.health();
    const embed = new EmbedBuilder()
      .setColor(COLORS.deep)
      .setAuthor({ name: `${app.brand.name} ${ICON.dot} Estatísticas` })
      .addFields(
        { name: 'Servidores', value: String(app.client.guilds.cache.size), inline: true },
        { name: 'Sessões ativas', value: String(app.sessions.size), inline: true },
        { name: 'Online há', value: formatDuration(process.uptime() * 1000), inline: true },
        { name: 'Ping do gateway', value: `${Math.round(app.client.ws.ping)} ms`, inline: true },
        {
          name: 'Servidores de áudio',
          value: nodes.length
            ? nodes
                .map(
                  (n) =>
                    `${n.connected ? '●' : '○'} ${safeText(n.id, 32)} ${ICON.dot} ${n.playingPlayers} tocando`,
                )
                .join('\n')
            : '—',
          inline: true,
        },
      );
    if (settings.historyEnabled) {
      const s = await app.history.stats(interaction.guildId, 30);
      embed.addFields(
        {
          name: 'Últimos 30 dias',
          value: `${plural(s.totalPlays, 'reprodução', 'reproduções')} ${ICON.dot} ${plural(s.uniqueListeners, 'ouvinte')} ${ICON.dot} ${formatDuration(s.totalListenedMs)} tocados`,
        },
        {
          name: 'Mais tocadas',
          value: s.topTracks.length
            ? s.topTracks
                .map(
                  (t, i) =>
                    `\`${i + 1}.\` ${safeText(t.title, 60)} ${ICON.dot} ${safeText(t.author, 30)} (${t.plays})`,
                )
                .join('\n')
            : 'Sem dados ainda.',
        },
      );
    } else {
      embed.addFields({
        name: 'Histórico',
        value: 'Desativado neste servidor (`/settings history`).',
      });
    }
    await respond(interaction, { embeds: [embed] });
  },
};

export const privacy: Command = {
  name: 'privacy',
  category: 'Informações',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('privacy')
      .setDescription('Seus dados guardados pelo bot')
      .addSubcommand((s) =>
        s.setName('view').setDescription('Mostra quais dados seus são guardados'),
      )
      .addSubcommand((s) =>
        s.setName('delete').setDescription('Apaga suas playlists, preferências e histórico'),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const userId = interaction.user.id;
    if (interaction.options.getSubcommand(true) === 'view') {
      const [playlists, history] = await Promise.all([
        app.db.playlist.count({ where: { ownerId: userId } }),
        app.db.playHistory.count({ where: { userId } }),
      ]);
      await respond(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.deep)
            .setTitle('Seus dados')
            .setDescription(
              [
                `Playlists: **${playlists}**`,
                `Registros de histórico: **${history}** (apagados automaticamente após ${app.env.HISTORY_RETENTION_DAYS} dias)`,
                'Guardamos apenas seu ID do Discord junto a esses registros — nunca mensagens, e-mail ou tokens.',
                'Use `/privacy delete` para apagar tudo.',
              ].join('\n'),
            ),
        ],
        ephemeral: true,
      });
      return;
    }
    const token = newToken();
    app.pendingConfirmations.set(token, {
      userId,
      run: async () => {
        const [playlists, history] = await app.db.$transaction([
          app.db.playlist.deleteMany({ where: { ownerId: userId } }),
          app.db.playHistory.deleteMany({ where: { userId } }),
          app.db.userPreference.deleteMany({ where: { userId } }),
        ]);
        return `Dados apagados: ${plural(playlists.count, 'playlist')} e ${plural(history.count, 'registro')} de histórico.`;
      },
    });
    await respond(interaction, {
      embeds: [
        warnEmbed(
          'Apagar **todas** as suas playlists, preferências e histórico em todos os servidores? Não pode ser desfeito.',
        ),
      ],
      components: confirmButtons(interaction.guildId, token, 'Apagar meus dados'),
      ephemeral: true,
    });
  },
};

export const infoCommands = [help, stats, privacy];
