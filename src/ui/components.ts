import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { GuildSession } from '../music/session.js';
import type { Track } from '../music/types.js';
import { formatDuration, truncate } from './format.js';
import { ICON } from './theme.js';

/**
 * Formato dos customIds: `<escopo>:<ação>:<guildId>[:<arg>]` (máx. 100 caracteres).
 * O guildId embutido garante que um painel só controle o próprio servidor — a ação é
 * recusada se não bater com interaction.guildId.
 */
export const PANEL_PREFIX = 'pnl';
export const QUEUE_PREFIX = 'que';
export const VOLUME_PREFIX = 'vol';
export const SEARCH_PREFIX = 'sch';
export const CONFIRM_PREFIX = 'cfm';

export type PanelAction =
  'prev' | 'toggle' | 'skip' | 'stop' | 'loop' | 'shuffle' | 'queue' | 'volume';

export function customId(prefix: string, action: string, guildId: string, arg?: string): string {
  const id = [prefix, action, guildId, arg].filter((part) => part !== undefined).join(':');
  if (id.length > 100) throw new Error('customId excede 100 caracteres');
  return id;
}

export interface ParsedCustomId {
  prefix: string;
  action: string;
  guildId: string;
  arg: string | undefined;
}

export function parseCustomId(id: string): ParsedCustomId | null {
  const [prefix, action, guildId, ...rest] = id.split(':');
  if (!prefix || !action || !guildId || !/^\d{17,20}$/.test(guildId)) return null;
  return { prefix, action, guildId, arg: rest.length ? rest.join(':') : undefined };
}

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

/** Botões do painel; controles incompatíveis com o estado atual ficam desativados. */
export function panelComponents(session: GuildSession | null, guildId: string): Row[] {
  const active = Boolean(session?.current) && !session?.destroyed;
  const paused = session?.state === 'paused';
  const uid = session?.current?.uid;
  const hasPrevious = Boolean(session?.queue.previous.length);
  const loop = session?.loop ?? 'off';

  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(PANEL_PREFIX, 'prev', guildId))
      .setLabel(`${ICON.previous} Anterior`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!session || !hasPrevious),
    new ButtonBuilder()
      .setCustomId(customId(PANEL_PREFIX, 'toggle', guildId))
      .setLabel(`${paused ? ICON.playing : ICON.paused} ${paused ? 'Retomar' : 'Pausar'}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!active),
    new ButtonBuilder()
      // O uid da faixa evita que um clique atrasado pule a música seguinte.
      .setCustomId(customId(PANEL_PREFIX, 'skip', guildId, uid?.slice(0, 36)))
      .setLabel(`${ICON.next} Pular`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!active),
    new ButtonBuilder()
      .setCustomId(customId(PANEL_PREFIX, 'stop', guildId))
      .setLabel(`${ICON.stopped} Parar`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!active),
  );

  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(PANEL_PREFIX, 'loop', guildId))
      .setLabel(
        `${loop === 'track' ? ICON.loopTrack : ICON.loopQueue} ${loop === 'off' ? 'Repetir: não' : loop === 'queue' ? 'Repetir: fila' : 'Repetir: faixa'}`,
      )
      .setStyle(loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!session),
    new ButtonBuilder()
      .setCustomId(customId(PANEL_PREFIX, 'shuffle', guildId))
      .setLabel(`${ICON.shuffle} Embaralhar`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!session || session.queue.size < 2),
    new ButtonBuilder()
      .setCustomId(customId(PANEL_PREFIX, 'queue', guildId))
      .setLabel(`${ICON.queue} Fila`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!session),
    new ButtonBuilder()
      .setCustomId(customId(PANEL_PREFIX, 'volume', guildId))
      .setLabel(`${ICON.volume} Volume`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!session),
  );
  return [row1, row2];
}

export function queuePager(guildId: string, page: number, pages: number): Row[] {
  if (pages <= 1) return [];
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(QUEUE_PREFIX, 'page', guildId, String(page - 1)))
        .setLabel('‹ Anterior')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(customId(QUEUE_PREFIX, 'noop', guildId, String(page)))
        .setLabel(`${page + 1}/${pages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(customId(QUEUE_PREFIX, 'page', guildId, String(page + 1)))
        .setLabel('Próxima ›')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
    ),
  ];
}

export function volumeControls(guildId: string, volume: number, maxVolume: number): Row[] {
  const step = (delta: number, label: string) =>
    new ButtonBuilder()
      .setCustomId(
        customId(
          VOLUME_PREFIX,
          'set',
          guildId,
          String(Math.max(0, Math.min(maxVolume, volume + delta))),
        ),
      )
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled((delta < 0 && volume <= 0) || (delta > 0 && volume >= maxVolume));
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      step(-20, '−20'),
      step(-10, '−10'),
      step(10, '+10'),
      step(20, '+20'),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(VOLUME_PREFIX, 'set', guildId, '50'))
        .setLabel('50%')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(maxVolume < 50),
      new ButtonBuilder()
        .setCustomId(customId(VOLUME_PREFIX, 'set', guildId, String(Math.min(100, maxVolume))))
        .setLabel('100%')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

/** Menu de seleção de resultados de /search (até 10 opções). */
export function searchMenu(guildId: string, token: string, tracks: Track[]): Row[] {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(SEARCH_PREFIX, 'pick', guildId, token))
    .setPlaceholder('Escolha uma ou mais faixas para adicionar')
    .setMinValues(1)
    .setMaxValues(Math.min(tracks.length, 10))
    .addOptions(
      tracks.slice(0, 10).map((track, index) => ({
        label: truncate(`${index + 1}. ${track.title}`, 100),
        description: truncate(
          `${track.author} · ${track.isStream ? 'ao vivo' : formatDuration(track.durationMs)}`,
          100,
        ),
        value: String(index),
      })),
    );
  return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)];
}

export function confirmButtons(guildId: string, token: string, confirmLabel: string): Row[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId(CONFIRM_PREFIX, 'yes', guildId, token))
        .setLabel(confirmLabel)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(customId(CONFIRM_PREFIX, 'no', guildId, token))
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}
