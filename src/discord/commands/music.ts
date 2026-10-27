import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../core/errors.js';
import { FILTER_PRESET_IDS, FILTER_PRESETS, type FilterPreset } from '../../audio/filters.js';
import { SEARCHABLE_PROVIDERS } from '../../providers/providers.js';
import { formatDuration, parseTimestamp, trackLink } from '../../ui/format.js';
import {
  idlePanelEmbed,
  infoEmbed,
  panelEmbed,
  searchResultsEmbed,
  successEmbed,
} from '../../ui/embeds.js';
import { panelComponents, searchMenu } from '../../ui/components.js';
import { LOOP_LABEL } from '../../ui/embeds.js';
import type { LoopMode } from '../../music/types.js';
import {
  can,
  newToken,
  requirePermission,
  requireSession,
  requireVoice,
  respond,
} from '../context.js';
import { beginSearch, enqueueAndReply, ensureSession, guildOnly } from './shared.js';
import type { Command } from './types.js';

const sourceChoices = SEARCHABLE_PROVIDERS.map((p) => ({ name: p.displayName, value: p.id }));

export const play: Command = {
  name: 'play',
  category: 'Música',
  defer: 'public',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Toca uma música ou playlist por nome ou link')
      .addStringOption((o) =>
        o
          .setName('busca')
          .setDescription('Nome, artista, álbum ou link')
          .setRequired(true)
          .setMaxLength(500),
      )
      .addStringOption((o) =>
        o
          .setName('fonte')
          .setDescription('Onde pesquisar (padrão: YouTube)')
          .addChoices(...sourceChoices),
      )
      .addBooleanOption((o) =>
        o.setName('proxima').setDescription('Colocar no início da fila (DJ)'),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const settings = await requirePermission(app, interaction, 'play');
    const next = interaction.options.getBoolean('proxima') ?? false;
    if (next) await requirePermission(app, interaction, 'move');
    requireVoice(interaction, app.sessions.get(interaction.guildId));

    const search = beginSearch(interaction.guildId, interaction.user.id);
    try {
      const outcome = await app.search.resolve(interaction.options.getString('busca', true), {
        guildId: interaction.guildId,
        ...(interaction.options.getString('fonte')
          ? { source: interaction.options.getString('fonte')! }
          : {}),
        allowHttpStreams: settings.allowHttpStreams,
        signal: search.signal,
      });
      const { result, provider } = outcome;
      if (result.kind === 'error')
        throw new UserError(`Não consegui carregar: ${result.errorMessage ?? 'erro na fonte'}.`);
      if (!result.tracks.length) {
        throw new UserError(
          `Nada encontrado em ${provider.displayName}.${provider.id === 'youtube' ? ' Tente `fonte: SoundCloud` ou outra grafia.' : ''}`,
        );
      }
      const tracks = result.kind === 'playlist' ? result.tracks : [result.tracks[0]!];
      search.signal.throwIfAborted();
      const session = await ensureSession(app, interaction, settings);
      await enqueueAndReply(app, interaction, session, tracks, {
        next,
        ...(result.kind === 'playlist' && result.playlistName
          ? { playlistName: result.playlistName }
          : {}),
      });
    } finally {
      search.done();
    }
  },
};

export const search: Command = {
  name: 'search',
  category: 'Música',
  defer: 'ephemeral',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('search')
      .setDescription('Pesquisa e mostra resultados para escolher')
      .addStringOption((o) =>
        o
          .setName('busca')
          .setDescription('Nome, artista ou álbum')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName('fonte')
          .setDescription('Onde pesquisar (padrão: YouTube)')
          .addChoices(...sourceChoices),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const settings = await requirePermission(app, interaction, 'play');
    const query = interaction.options.getString('busca', true);
    if (/^https?:\/\//i.test(query.trim())) throw new UserError('Para links, use `/play`.');
    const handle = beginSearch(interaction.guildId, interaction.user.id);
    try {
      const { result, provider } = await app.search.resolve(query, {
        guildId: interaction.guildId,
        ...(interaction.options.getString('fonte')
          ? { source: interaction.options.getString('fonte')! }
          : {}),
        allowHttpStreams: settings.allowHttpStreams,
        signal: handle.signal,
      });
      const tracks = result.tracks.slice(0, 10);
      if (!tracks.length) throw new UserError(`Nada encontrado em ${provider.displayName}.`);
      const token = newToken();
      app.pendingSearches.set(token, {
        userId: interaction.user.id,
        tracks,
        providerName: provider.displayName,
      });
      await respond(interaction, {
        embeds: [searchResultsEmbed(query, tracks, provider.displayName)],
        components: searchMenu(interaction.guildId, token, tracks),
      });
    } finally {
      handle.done();
    }
  },
};

export const pause: Command = {
  name: 'pause',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder().setName('pause').setDescription('Pausa a música'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'pause');
    await session.setPaused(true);
    await respond(interaction, { embeds: [successEmbed('Música pausada.')] });
  },
};

export const resume: Command = {
  name: 'resume',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder().setName('resume').setDescription('Retoma a música pausada'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'pause');
    await session.setPaused(false);
    await respond(interaction, { embeds: [successEmbed('Música retomada.')] });
  },
};

export const skip: Command = {
  name: 'skip',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder().setName('skip').setDescription('Pula a música atual'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    const own = session.current?.requesterId === interaction.user.id;
    await requirePermission(app, interaction, own ? 'skip.own' : 'skip');
    const skipped = await session.skip();
    await respond(interaction, {
      embeds: [
        successEmbed(
          skipped
            ? `Pulei ${trackLink(skipped.track.title, skipped.track.uri)}.`
            : 'Nada para pular.',
        ),
      ],
    });
  },
};

export const stop: Command = {
  name: 'stop',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder().setName('stop').setDescription('Para a música e limpa a fila'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'stop');
    await session.stop();
    await respond(interaction, { embeds: [successEmbed('Reprodução parada e fila limpa.')] });
  },
};

export const nowplaying: Command = {
  name: 'nowplaying',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder().setName('nowplaying').setDescription('Mostra a música atual'),
  ).toJSON(),
  async execute(app, interaction) {
    await requirePermission(app, interaction, 'view');
    const session = app.sessions.get(interaction.guildId);
    await respond(interaction, {
      embeds: [
        session?.current
          ? panelEmbed(session, app.brand)
          : idlePanelEmbed(session ?? null, app.brand),
      ],
      components: session?.current ? panelComponents(session, interaction.guildId) : [],
      ephemeral: true,
    });
  },
};

export const volume: Command = {
  name: 'volume',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Mostra ou ajusta o volume')
      .addIntegerOption((o) =>
        o
          .setName('nivel')
          .setDescription('0 a 200 (limitado pelo máximo do servidor)')
          .setMinValue(0)
          .setMaxValue(200),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    const level = interaction.options.getInteger('nivel');
    if (level === null) {
      await respond(interaction, {
        embeds: [infoEmbed(`Volume atual: **${session.volume}%** (máximo ${session.maxVolume}%).`)],
        ephemeral: true,
      });
      return;
    }
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'volume');
    const applied = await session.setVolume(level);
    await respond(interaction, {
      embeds: [
        successEmbed(
          `Volume ajustado para **${applied}%**${applied < level ? ` (máximo do servidor: ${session.maxVolume}%)` : ''}.`,
        ),
      ],
    });
  },
};

export const shuffle: Command = {
  name: 'shuffle',
  category: 'Fila',
  data: guildOnly(
    new SlashCommandBuilder().setName('shuffle').setDescription('Embaralha a fila'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'shuffle');
    const count = await session.shuffle();
    await respond(interaction, { embeds: [successEmbed(`Fila embaralhada (${count} faixas).`)] });
  },
};

export const loop: Command = {
  name: 'loop',
  category: 'Fila',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Define o modo de repetição')
      .addStringOption((o) =>
        o
          .setName('modo')
          .setDescription('Modo de repetição')
          .setRequired(true)
          .addChoices(
            { name: 'Desligado', value: 'off' },
            { name: 'Faixa atual', value: 'track' },
            { name: 'Fila inteira', value: 'queue' },
          ),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'loop');
    const mode = interaction.options.getString('modo', true) as LoopMode;
    await session.setLoop(mode);
    await respond(interaction, { embeds: [successEmbed(`Repetição: **${LOOP_LABEL[mode]}**.`)] });
  },
};

export const seek: Command = {
  name: 'seek',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('seek')
      .setDescription('Vai para um ponto da música')
      .addStringOption((o) =>
        o
          .setName('tempo')
          .setDescription('Ex.: 90, 1:30 ou 1:02:03')
          .setRequired(true)
          .setMaxLength(9),
      )
      .addStringOption((o) =>
        o
          .setName('modo')
          .setDescription('Posição absoluta ou relativa')
          .addChoices(
            { name: 'Ir para', value: 'abs' },
            { name: 'Avançar', value: 'fwd' },
            { name: 'Voltar', value: 'back' },
          ),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'seek');
    const ms = parseTimestamp(interaction.options.getString('tempo', true));
    if (ms === null) throw new UserError('Tempo inválido. Use segundos (90) ou mm:ss (1:30).');
    const mode = interaction.options.getString('modo') ?? 'abs';
    const current = session.positionMs() ?? 0;
    const target = mode === 'fwd' ? current + ms : mode === 'back' ? current - ms : ms;
    const applied = await session.seek(target);
    await respond(interaction, {
      embeds: [successEmbed(`Posição: \`${formatDuration(applied)}\`.`)],
    });
  },
};

export const join: Command = {
  name: 'join',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder().setName('join').setDescription('Entra no seu canal de voz'),
  ).toJSON(),
  async execute(app, interaction) {
    const settings = await requirePermission(app, interaction, 'join');
    const existing = app.sessions.get(interaction.guildId);
    if (existing && !existing.destroyed) {
      requireVoice(interaction, existing);
      await respond(interaction, {
        embeds: [infoEmbed(`Já estou em <#${existing.voiceChannelId}>.`)],
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply();
    const session = await ensureSession(app, interaction, settings);
    await respond(interaction, {
      embeds: [successEmbed(`Conectado a <#${session.voiceChannelId}>. Use \`/play\` para tocar.`)],
    });
  },
};

export const leave: Command = {
  name: 'leave',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Sai do canal de voz e encerra a sessão'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'leave');
    await app.sessions.destroy(interaction.guildId, 'leave');
    await respond(interaction, { embeds: [successEmbed('Saí do canal de voz. Até a próxima!')] });
  },
};

export const previous: Command = {
  name: 'previous',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder().setName('previous').setDescription('Volta para a música anterior'),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'previous');
    const item = await session.previous();
    await respond(interaction, {
      embeds: [successEmbed(`Voltando para ${trackLink(item.track.title, item.track.uri)}.`)],
    });
  },
};

export const autoplay: Command = {
  name: 'autoplay',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('autoplay')
      .setDescription('Continua tocando músicas relacionadas quando a fila acabar')
      .addBooleanOption((o) =>
        o.setName('ativo').setDescription('Ligar ou desligar').setRequired(true),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'autoplay');
    const enabled = interaction.options.getBoolean('ativo', true);
    await session.setAutoplay(enabled);
    await respond(interaction, {
      embeds: [
        successEmbed(
          `Autoplay **${enabled ? 'ligado' : 'desligado'}** nesta sessão.${enabled ? ' Sugestões vêm de mixes do YouTube ou do mesmo artista.' : ''}`,
        ),
      ],
    });
  },
};

export const filters: Command = {
  name: 'filters',
  category: 'Música',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('filters')
      .setDescription('Aplica um efeito de áudio')
      .addStringOption((o) =>
        o
          .setName('efeito')
          .setDescription('Efeito a aplicar')
          .setRequired(true)
          .addChoices(
            ...FILTER_PRESET_IDS.map((id) => ({
              name: `${FILTER_PRESETS[id].label} — ${FILTER_PRESETS[id].description}`,
              value: id,
            })),
          ),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    const session = requireSession(app, interaction);
    requireVoice(interaction, session);
    await requirePermission(app, interaction, 'filters');
    const preset = interaction.options.getString('efeito', true) as FilterPreset;
    if (!FILTER_PRESET_IDS.includes(preset)) throw new UserError('Efeito desconhecido.');
    await session.setFilter(preset);
    await respond(interaction, {
      embeds: [
        successEmbed(
          preset === 'off'
            ? 'Efeitos removidos.'
            : `Efeito **${FILTER_PRESETS[preset].label}** aplicado. Pode levar alguns segundos para ser ouvido.`,
        ),
      ],
    });
  },
};

/** Usado pelo /help para indicar o que o usuário pode fazer. */
export async function describeAccess(
  app: Parameters<Command['execute']>[0],
  interaction: Parameters<Command['execute']>[1],
): Promise<string> {
  const isDj = await can(app, interaction, 'skip');
  const isManager = await can(app, interaction, 'settings');
  return isManager ? 'Gerente/Administrador' : isDj ? 'DJ' : 'Usuário';
}

export const musicCommands = [
  play,
  search,
  pause,
  resume,
  skip,
  stop,
  nowplaying,
  volume,
  shuffle,
  loop,
  seek,
  join,
  leave,
  previous,
  autoplay,
  filters,
];
