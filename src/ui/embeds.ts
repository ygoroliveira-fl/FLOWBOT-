import { EmbedBuilder } from 'discord.js';
import { FILTER_PRESETS } from '../audio/filters.js';
import type { GuildSession } from '../music/session.js';
import { AUTOPLAY_REQUESTER } from '../music/session.js';
import type { LoopMode, QueueItem, Track } from '../music/types.js';
import { sourceLabel } from '../providers/providers.js';
import { formatDuration, plural, progressBar, safeText, trackLink, truncate } from './format.js';
import { COLORS, ICON } from './theme.js';

export interface Branding {
  name: string;
  accent: number;
}

export const LOOP_LABEL: Record<LoopMode, string> = {
  off: 'Desligada',
  queue: 'Fila',
  track: 'Faixa',
};

export const QUEUE_PAGE_SIZE = 10;

function requesterLabel(requesterId: string): string {
  return requesterId === AUTOPLAY_REQUESTER ? `${ICON.autoplay} Autoplay` : `<@${requesterId}>`;
}

function durationLabel(track: Track): string {
  return track.isStream ? ICON.live : formatDuration(track.durationMs);
}

function queueLine(item: QueueItem, position: number): string {
  return `\`${String(position).padStart(2, ' ')}.\` ${trackLink(item.track.title, item.track.uri, 60)} ${ICON.dot} ${safeText(item.track.author, 40)} \`${durationLabel(item.track)}\``;
}

/** Painel principal ("Tocando agora"). */
export function panelEmbed(session: GuildSession, brand: Branding): EmbedBuilder {
  const current = session.current;
  if (!current) return idlePanelEmbed(session, brand);
  const track = current.track;
  const paused = session.state === 'paused';
  const position = session.positionMs();

  const status = session.audioLost
    ? `${ICON.warn} Reconectando ao servidor de áudio…`
    : paused
      ? `${ICON.paused} Pausado`
      : `${ICON.playing} Tocando agora`;

  const lines = [
    `por **${safeText(track.author, 80)}** ${ICON.dot} ${sourceLabel(track.sourceName)}`,
  ];
  if (track.isStream) {
    lines.push(`\`${ICON.live}\``);
  } else if (position !== null) {
    lines.push(
      `\`${formatDuration(position)}\` ${progressBar(position, track.durationMs)} \`${formatDuration(track.durationMs)}\``,
    );
  } else {
    lines.push(`Duração: \`${formatDuration(track.durationMs)}\``);
  }

  const embed = new EmbedBuilder()
    .setColor(session.audioLost ? COLORS.warn : paused ? COLORS.muted : brand.accent)
    .setAuthor({ name: `${brand.name} ${ICON.dot} ${status}` })
    .setTitle(truncate(track.title, 256))
    .setDescription(lines.join('\n'))
    .addFields(
      { name: 'Pedido por', value: requesterLabel(current.requesterId), inline: true },
      { name: 'Volume', value: `${session.volume}%`, inline: true },
      { name: 'Repetição', value: LOOP_LABEL[session.loop], inline: true },
    );
  if (track.uri && /^https?:\/\//.test(track.uri)) embed.setURL(track.uri);
  if (track.artworkUrl && /^https:\/\//.test(track.artworkUrl))
    embed.setThumbnail(track.artworkUrl);

  const upcoming = session.queue.tracks.slice(0, 3);
  embed.addFields({
    name: 'A seguir',
    value: upcoming.length
      ? upcoming.map((item, i) => queueLine(item, i + 1)).join('\n') +
        (session.queue.size > 3 ? `\n…e mais ${plural(session.queue.size - 3, 'faixa')}` : '')
      : session.autoplay
        ? `${ICON.autoplay} Fila vazia — o autoplay escolherá a próxima.`
        : 'Fila vazia — use `/play` para adicionar.',
  });

  const footer = [
    plural(session.queue.size, 'faixa') + ' na fila',
    session.queue.size ? `total ${formatDuration(session.queue.totalDurationMs)}` : null,
    `Autoplay ${session.autoplay ? 'ligado' : 'desligado'}`,
    session.filter !== 'off' ? `Filtro: ${FILTER_PRESETS[session.filter].label}` : null,
    position !== null && !track.isStream ? 'posição aproximada' : null,
  ].filter(Boolean);
  embed.setFooter({ text: footer.join(` ${ICON.dot} `) });
  return embed;
}

export function idlePanelEmbed(session: GuildSession | null, brand: Branding): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.muted)
    .setAuthor({ name: `${brand.name} ${ICON.dot} ${ICON.stopped} Nada tocando` })
    .setDescription(
      session && session.queue.size
        ? `Há ${plural(session.queue.size, 'faixa')} na fila.`
        : 'Use `/play` com o nome de uma música ou um link para começar.',
    )
    .setFooter({
      text: session
        ? `Volume ${session.volume}% ${ICON.dot} Repetição ${LOOP_LABEL[session.loop]}`
        : brand.name,
    });
}

export function endedPanelEmbed(brand: Branding, reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.muted)
    .setAuthor({ name: `${brand.name} ${ICON.dot} Sessão encerrada` })
    .setDescription(reason);
}

export function queueEmbed(
  session: GuildSession,
  page: number,
  brand: Branding,
): { embed: EmbedBuilder; page: number; pages: number } {
  const total = session.queue.size;
  const pages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const start = safePage * QUEUE_PAGE_SIZE;
  const items = session.queue.tracks.slice(start, start + QUEUE_PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(COLORS.deep)
    .setAuthor({ name: `${brand.name} ${ICON.dot} ${ICON.queue} Fila` });
  const current = session.current;
  const header = current
    ? `**Agora:** ${trackLink(current.track.title, current.track.uri, 70)} \`${durationLabel(current.track)}\`\n`
    : '';
  embed.setDescription(
    header +
      (items.length
        ? '\n' + items.map((item, i) => queueLine(item, start + i + 1)).join('\n')
        : '\nA fila está vazia.'),
  );
  embed.setFooter({
    text: [
      `Página ${safePage + 1}/${pages}`,
      plural(total, 'faixa'),
      `total ${formatDuration(session.queue.totalDurationMs)}`,
      `Repetição ${LOOP_LABEL[session.loop]}`,
    ].join(` ${ICON.dot} `),
  });
  return { embed, page: safePage, pages };
}

export function successEmbed(description: string, title?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.accent)
    .setDescription(`${ICON.success} ${description}`);
  if (title) embed.setTitle(title);
  return embed;
}

export function infoEmbed(description: string, title?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.deep).setDescription(description);
  if (title) embed.setTitle(title);
  return embed;
}

export function warnEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.warn).setDescription(`${ICON.warn} ${description}`);
}

export function errorEmbed(description: string, correlationId?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.danger)
    .setDescription(`${ICON.error} ${description}`);
  if (correlationId) embed.setFooter({ text: `Código: ${correlationId}` });
  return embed;
}

export function loadingEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.deep).setDescription(`⋯ ${description}`);
}

export function addedEmbed(input: {
  added: QueueItem[];
  rejected: number;
  playlistName?: string;
  startedPlaying: boolean;
  queuePositionStart: number;
}): EmbedBuilder {
  const { added } = input;
  if (added.length === 1 && !input.playlistName) {
    const item = added[0]!;
    const embed = new EmbedBuilder()
      .setColor(COLORS.accent)
      .setDescription(
        `${ICON.success} ${input.startedPlaying ? 'Tocando agora' : `Adicionada na posição **${input.queuePositionStart}**`}: ${trackLink(item.track.title, item.track.uri)}\n` +
          `${safeText(item.track.author, 80)} ${ICON.dot} \`${durationLabel(item.track)}\` ${ICON.dot} ${sourceLabel(item.track.sourceName)}`,
      );
    if (item.track.artworkUrl && /^https:\/\//.test(item.track.artworkUrl))
      embed.setThumbnail(item.track.artworkUrl);
    if (input.rejected) embed.setFooter({ text: 'Algumas faixas não foram adicionadas.' });
    return embed;
  }
  const total = added.reduce(
    (sum, item) => sum + (item.track.isStream ? 0 : item.track.durationMs),
    0,
  );
  const lines = [
    `${ICON.success} ${plural(added.length, 'faixa adicionada', 'faixas adicionadas')}${input.playlistName ? ` de **${safeText(input.playlistName, 80)}**` : ''} ${ICON.dot} \`${formatDuration(total)}\``,
  ];
  if (input.rejected)
    lines.push(
      `${ICON.warn} ${plural(input.rejected, 'faixa ignorada', 'faixas ignoradas')} (fila cheia, duplicada ou longa demais).`,
    );
  return new EmbedBuilder().setColor(COLORS.accent).setDescription(lines.join('\n'));
}

export function searchResultsEmbed(
  query: string,
  tracks: Track[],
  providerName: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.deep)
    .setAuthor({ name: `Resultados em ${providerName}` })
    .setDescription(
      tracks
        .map(
          (t, i) =>
            `\`${i + 1}.\` ${trackLink(t.title, t.uri, 70)} ${ICON.dot} ${safeText(t.author, 40)} \`${durationLabel(t)}\``,
        )
        .join('\n'),
    )
    .setFooter({ text: `Pesquisa: ${truncate(query, 80)} ${ICON.dot} escolha no menu abaixo` });
}
