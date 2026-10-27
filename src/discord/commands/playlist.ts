import { EmbedBuilder, SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { UserError } from '../../core/errors.js';
import { playlistTrackToTrack, PLAYLIST_NAME_MAX } from '../../data/playlists.js';
import type { Track } from '../../music/types.js';
import { confirmButtons } from '../../ui/components.js';
import { successEmbed, warnEmbed } from '../../ui/embeds.js';
import { formatDuration, plural, safeText, trackLink, truncate } from '../../ui/format.js';
import { COLORS, ICON } from '../../ui/theme.js';
import { newToken, requirePermission, respond, type AppContext } from '../context.js';
import { enqueueAndReply, ensureSession, guildOnly } from './shared.js';
import type { Command } from './types.js';

const PAGE = 15;

const nameOption = (o: SlashCommandStringOption) =>
  o
    .setName('nome')
    .setDescription('Nome da playlist')
    .setRequired(true)
    .setAutocomplete(true)
    .setMaxLength(100);

export const playlist: Command = {
  name: 'playlist',
  category: 'Playlists',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('playlist')
      .setDescription('Gerencia suas playlists salvas')
      .addSubcommand((s) =>
        s
          .setName('create')
          .setDescription('Cria uma playlist')
          .addStringOption((o) =>
            o
              .setName('nome')
              .setDescription('Nome da playlist')
              .setRequired(true)
              .setMaxLength(PLAYLIST_NAME_MAX),
          )
          .addStringOption((o) =>
            o
              .setName('visibilidade')
              .setDescription('Quem pode ver e tocar')
              .addChoices(
                { name: 'Privada (só você)', value: 'PRIVATE' },
                { name: 'Servidor (membros podem tocar)', value: 'GUILD' },
              ),
          ),
      )
      .addSubcommand((s) =>
        s.setName('list').setDescription('Lista suas playlists e as compartilhadas neste servidor'),
      )
      .addSubcommand((s) =>
        s
          .setName('view')
          .setDescription('Mostra as faixas de uma playlist')
          .addStringOption(nameOption)
          .addIntegerOption((o) => o.setName('pagina').setDescription('Página').setMinValue(1)),
      )
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Adiciona a música atual ou uma busca/link à playlist')
          .addStringOption(nameOption)
          .addStringOption((o) =>
            o
              .setName('busca')
              .setDescription('Nome ou link (vazio = música atual)')
              .setMaxLength(500),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove uma faixa da playlist')
          .addStringOption(nameOption)
          .addIntegerOption((o) =>
            o
              .setName('posicao')
              .setDescription('Posição (veja /playlist view)')
              .setRequired(true)
              .setMinValue(1),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('play')
          .setDescription('Adiciona a playlist à fila')
          .addStringOption(nameOption)
          .addBooleanOption((o) =>
            o.setName('embaralhar').setDescription('Embaralhar antes de adicionar'),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('rename')
          .setDescription('Renomeia uma playlist')
          .addStringOption(nameOption)
          .addStringOption((o) =>
            o
              .setName('novo_nome')
              .setDescription('Novo nome')
              .setRequired(true)
              .setMaxLength(PLAYLIST_NAME_MAX),
          ),
      )
      .addSubcommand((s) =>
        s.setName('delete').setDescription('Apaga uma playlist').addStringOption(nameOption),
      )
      .addSubcommand((s) =>
        s
          .setName('share')
          .setDescription('Compartilha (ou torna privada) uma playlist neste servidor')
          .addStringOption(nameOption)
          .addStringOption((o) =>
            o
              .setName('modo')
              .setDescription('Visibilidade')
              .setRequired(true)
              .addChoices(
                { name: 'Compartilhar no servidor', value: 'GUILD' },
                { name: 'Tornar privada', value: 'PRIVATE' },
              ),
          ),
      ),
  ).toJSON(),

  async execute(app, interaction) {
    const sub = interaction.options.getSubcommand(true);
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const ref = () => interaction.options.getString('nome', true);

    switch (sub) {
      case 'create': {
        const created = await app.playlists.create({
          ownerId: userId,
          guildId,
          name: interaction.options.getString('nome', true),
          visibility:
            (interaction.options.getString('visibilidade') as 'PRIVATE' | 'GUILD' | null) ??
            'PRIVATE',
        });
        await respond(interaction, {
          embeds: [
            successEmbed(
              `Playlist **${safeText(created.name)}** criada (${created.visibility === 'GUILD' ? 'compartilhada no servidor' : 'privada'}). Adicione músicas com \`/playlist add\`.`,
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      case 'list': {
        const lists = await app.playlists.listAccessible(userId, guildId);
        const own = lists.filter((p) => p.ownerId === userId);
        const shared = lists.filter((p) => p.ownerId !== userId);
        const line = (p: (typeof lists)[number]) =>
          `${p.visibility === 'GUILD' ? '◆' : '◇'} **${safeText(p.name, 64)}** ${ICON.dot} ${plural(p.trackCount, 'faixa')}${p.ownerId !== userId ? ` ${ICON.dot} de <@${p.ownerId}>` : ''}`;
        const embed = new EmbedBuilder()
          .setColor(COLORS.deep)
          .setAuthor({ name: `${app.brand.name} ${ICON.dot} Playlists` })
          .addFields(
            {
              name: 'Suas playlists',
              value: own.length
                ? own.map(line).join('\n')
                : 'Nenhuma ainda — use `/playlist create`.',
            },
            ...(shared.length
              ? [
                  {
                    name: 'Compartilhadas neste servidor',
                    value: truncate(shared.map(line).join('\n'), 1024),
                  },
                ]
              : []),
          )
          .setFooter({ text: '◆ compartilhada · ◇ privada' });
        await respond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
      case 'view': {
        const found = await app.playlists.findAccessible(ref(), userId, guildId);
        const total = await app.playlists.countTracks(found.id);
        const pages = Math.max(1, Math.ceil(total / PAGE));
        const page = Math.min(pages, interaction.options.getInteger('pagina') ?? 1) - 1;
        const rows = await app.playlists.getTracks(found.id, { skip: page * PAGE, take: PAGE });
        const embed = new EmbedBuilder()
          .setColor(COLORS.deep)
          .setAuthor({ name: `${app.brand.name} ${ICON.dot} Playlist` })
          .setTitle(truncate(found.name, 256))
          .setDescription(
            rows.length
              ? rows
                  .map(
                    (row) =>
                      `\`${String(row.position).padStart(2, ' ')}.\` ${trackLink(row.title, row.uri, 60)} ${ICON.dot} ${safeText(row.author, 40)} \`${row.isStream ? 'ao vivo' : formatDuration(row.durationMs)}\``,
                  )
                  .join('\n')
              : 'Playlist vazia.',
          )
          .setFooter({
            text: `Página ${page + 1}/${pages} ${ICON.dot} ${plural(total, 'faixa')} ${ICON.dot} ${found.visibility === 'GUILD' ? 'compartilhada' : 'privada'}`,
          });
        await respond(interaction, { embeds: [embed], ephemeral: true });
        return;
      }
      case 'add': {
        await interaction.deferReply({ flags: 64 });
        const query = interaction.options.getString('busca');
        let tracks: Track[];
        if (!query) {
          const current = app.sessions.get(guildId)?.current;
          if (!current)
            throw new UserError('Nada tocando agora. Informe uma busca ou link em `busca`.');
          tracks = [current.track];
        } else {
          const settings = await app.settings.get(guildId);
          const { result, provider } = await app.search.resolve(query, {
            guildId,
            allowHttpStreams: settings.allowHttpStreams,
          });
          if (!result.tracks.length)
            throw new UserError(`Nada encontrado em ${provider.displayName}.`);
          tracks = result.kind === 'playlist' ? result.tracks : [result.tracks[0]!];
        }
        const outcome = await app.playlists.addTracks(ref(), userId, guildId, tracks);
        const text =
          tracks.length === 1
            ? `${trackLink(tracks[0]!.title, tracks[0]!.uri)} adicionada a **${safeText(outcome.playlist.name)}**.`
            : `${plural(outcome.added, 'faixa adicionada', 'faixas adicionadas')} a **${safeText(outcome.playlist.name)}**.`;
        await respond(interaction, {
          embeds: [
            successEmbed(text),
            ...(outcome.skipped
              ? [warnEmbed(`${outcome.skipped} faixa(s) não couberam (limite da playlist).`)]
              : []),
          ],
        });
        return;
      }
      case 'remove': {
        const removed = await app.playlists.removeTrack(
          ref(),
          userId,
          guildId,
          interaction.options.getInteger('posicao', true),
        );
        await respond(interaction, {
          embeds: [successEmbed(`Removida: ${trackLink(removed.title, removed.uri)}.`)],
          ephemeral: true,
        });
        return;
      }
      case 'play': {
        await interaction.deferReply();
        const settings = await requirePermission(app, interaction, 'play');
        const found = await app.playlists.findAccessible(ref(), userId, guildId);
        const rows = await app.playlists.getTracks(found.id);
        if (!rows.length) throw new UserError('Esta playlist está vazia.');
        const valid = rows.filter((row) => row.encoded.length > 0).map(playlistTrackToTrack);
        if (interaction.options.getBoolean('embaralhar')) {
          for (let i = valid.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [valid[i], valid[j]] = [valid[j]!, valid[i]!];
          }
        }
        const session = await ensureSession(app, interaction, settings);
        // A disponibilidade real de cada faixa é verificada ao tocar: faixas que falharem são
        // puladas com aviso no canal (ver GuildSession.handleFailure).
        await enqueueAndReply(app, interaction, session, valid, {
          playlistName: found.name,
          unavailable: rows.length - valid.length,
        });
        return;
      }
      case 'rename': {
        const renamed = await app.playlists.rename(
          ref(),
          userId,
          guildId,
          interaction.options.getString('novo_nome', true),
        );
        await respond(interaction, {
          embeds: [successEmbed(`Playlist renomeada para **${safeText(renamed.name)}**.`)],
          ephemeral: true,
        });
        return;
      }
      case 'delete': {
        const found = await app.playlists.findAccessible(ref(), userId, guildId);
        if (found.ownerId !== userId)
          throw new UserError('Só o dono pode apagar esta playlist.', 'PERMISSION_DENIED');
        const count = await app.playlists.countTracks(found.id);
        const token = newToken();
        app.pendingConfirmations.set(token, {
          userId,
          run: async () => {
            const deleted = await app.playlists.delete(found.id, userId, guildId);
            return `Playlist **${safeText(deleted.name)}** apagada.`;
          },
        });
        await respond(interaction, {
          embeds: [
            warnEmbed(
              `Apagar a playlist **${safeText(found.name)}** (${plural(count, 'faixa')})? Esta ação não pode ser desfeita.`,
            ),
          ],
          components: confirmButtons(guildId, token, 'Apagar playlist'),
          ephemeral: true,
        });
        return;
      }
      case 'share': {
        const mode = interaction.options.getString('modo', true) as 'GUILD' | 'PRIVATE';
        const updated = await app.playlists.setVisibility(ref(), userId, guildId, mode);
        await respond(interaction, {
          embeds: [
            successEmbed(
              mode === 'GUILD'
                ? `**${safeText(updated.name)}** agora pode ser vista e tocada por membros deste servidor. Só você pode editá-la.`
                : `**${safeText(updated.name)}** agora é privada.`,
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      default:
        throw new UserError('Subcomando desconhecido.');
    }
  },

  async autocomplete(app: AppContext, interaction) {
    const focused = interaction.options.getFocused();
    const sub = interaction.options.getSubcommand(false);
    const ownedOnly = sub !== null && ['add', 'remove', 'rename', 'delete', 'share'].includes(sub);
    const lists = await app.playlists.listAccessible(
      interaction.user.id,
      interaction.guildId,
      focused,
    );
    await interaction.respond(
      lists
        .filter((p) => !ownedOnly || p.ownerId === interaction.user.id)
        .slice(0, 25)
        .map((p) => ({
          name: truncate(
            `${p.name} · ${p.trackCount} faixas${p.ownerId !== interaction.user.id ? ' · compartilhada' : ''}`,
            100,
          ),
          value: p.id,
        })),
    );
  },
};

export const playlistCommands = [playlist];
