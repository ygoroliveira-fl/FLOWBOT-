import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError } from '../../core/errors.js';
import type { GuildSettings, SettingsPatch } from '../../data/guildSettings.js';
import { limitsFromSettings } from '../../music/sessionManager.js';
import { successEmbed } from '../../ui/embeds.js';
import { formatDuration } from '../../ui/format.js';
import { COLORS, ICON } from '../../ui/theme.js';
import { canPostIn, requirePermission, respond, type AppContext } from '../context.js';
import { guildOnly } from './shared.js';
import type { Command } from './types.js';

function yesNo(value: boolean): string {
  return value ? 'Sim' : 'Não';
}

export function settingsEmbed(settings: GuildSettings, app: AppContext): EmbedBuilder {
  const role = (id: string | null) => (id ? `<@&${id}>` : '—');
  return new EmbedBuilder()
    .setColor(COLORS.deep)
    .setAuthor({ name: `${app.brand.name} ${ICON.dot} Configurações do servidor` })
    .addFields(
      { name: 'Cargo de DJ', value: role(settings.djRoleId), inline: true },
      { name: 'Cargo de gerente', value: role(settings.managerRoleId), inline: true },
      {
        name: 'Controle',
        value: settings.controlMode === 'DJ' ? 'Só DJs' : 'Todos no canal',
        inline: true,
      },
      { name: 'Sozinho = DJ', value: yesNo(settings.aloneIsDj), inline: true },
      {
        name: 'Canal do painel',
        value: settings.panelChannelId ? `<#${settings.panelChannelId}>` : 'Canal do /play',
        inline: true,
      },
      {
        name: 'Volume padrão / máximo',
        value: `${settings.defaultVolume}% / ${settings.maxVolume}%`,
        inline: true,
      },
      {
        name: 'Inatividade',
        value: formatDuration(settings.inactivityTimeoutSec * 1000),
        inline: true,
      },
      { name: 'Autoplay padrão', value: yesNo(settings.autoplay), inline: true },
      { name: 'Duplicatas na fila', value: yesNo(settings.allowDuplicates), inline: true },
      {
        name: 'Limite da fila',
        value: `${Math.min(settings.maxQueueSize, app.env.MAX_QUEUE_SIZE)} faixas`,
        inline: true,
      },
      {
        name: 'Duração máx. por faixa',
        value: settings.maxTrackDurationSec
          ? formatDuration(settings.maxTrackDurationSec * 1000)
          : 'Sem limite',
        inline: true,
      },
      { name: 'Streams HTTP genéricos', value: yesNo(settings.allowHttpStreams), inline: true },
      { name: 'Histórico de reprodução', value: yesNo(settings.historyEnabled), inline: true },
    )
    .setFooter({ text: 'Altere com /settings e /djrole' });
}

async function applyAndReply(
  app: AppContext,
  interaction: Parameters<Command['execute']>[1],
  patch: SettingsPatch,
  message: string,
) {
  const updated = await app.settings.update(interaction.guildId, interaction.user.id, patch);
  // Sessões em andamento passam a usar os novos limites imediatamente.
  const session = app.sessions.get(interaction.guildId);
  session?.updateLimits(
    limitsFromSettings(updated, app.env.MAX_QUEUE_SIZE),
    updated.maxVolume,
    updated.inactivityTimeoutSec * 1000,
  );
  await respond(interaction, { embeds: [successEmbed(message)], ephemeral: true });
}

export const settings: Command = {
  name: 'settings',
  category: 'Configuração',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('settings')
      .setDescription('Configurações do bot neste servidor')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) => s.setName('view').setDescription('Mostra as configurações'))
      .addSubcommand((s) =>
        s
          .setName('panel-channel')
          .setDescription('Define o canal fixo do painel musical')
          .addChannelOption((o) =>
            o
              .setName('canal')
              .setDescription('Canal de texto (vazio = canal do /play)')
              .addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('volume')
          .setDescription('Volume padrão e máximo')
          .addIntegerOption((o) =>
            o
              .setName('padrao')
              .setDescription('Volume inicial (1–200)')
              .setMinValue(1)
              .setMaxValue(200),
          )
          .addIntegerOption((o) =>
            o
              .setName('maximo')
              .setDescription('Volume máximo (1–200)')
              .setMinValue(1)
              .setMaxValue(200),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('inactivity')
          .setDescription('Tempo até sair do canal quando ocioso ou sozinho')
          .addIntegerOption((o) =>
            o
              .setName('minutos')
              .setDescription('1 a 1440 minutos')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(1440),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('autoplay')
          .setDescription('Autoplay padrão para novas sessões')
          .addBooleanOption((o) =>
            o.setName('ativo').setDescription('Ligar ou desligar').setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('control')
          .setDescription('Quem pode controlar a música')
          .addStringOption((o) =>
            o
              .setName('modo')
              .setDescription('Modo de controle')
              .setRequired(true)
              .addChoices(
                { name: 'Somente DJs (recomendado)', value: 'DJ' },
                { name: 'Qualquer pessoa no canal', value: 'EVERYONE' },
              ),
          )
          .addBooleanOption((o) =>
            o
              .setName('sozinho_e_dj')
              .setDescription('Quem estiver sozinho com o bot ganha controle de DJ'),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('queue')
          .setDescription('Regras da fila')
          .addIntegerOption((o) =>
            o
              .setName('limite')
              .setDescription('Máximo de faixas na fila')
              .setMinValue(10)
              .setMaxValue(5000),
          )
          .addBooleanOption((o) =>
            o.setName('duplicatas').setDescription('Permitir a mesma faixa mais de uma vez'),
          )
          .addIntegerOption((o) =>
            o
              .setName('duracao_max_min')
              .setDescription('Duração máxima por faixa em minutos (0 = sem limite)')
              .setMinValue(0)
              .setMaxValue(1440),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('http-streams')
          .setDescription(
            'Permitir links de rádios/streams HTTP fora da lista de fontes conhecidas',
          )
          .addBooleanOption((o) =>
            o.setName('ativo').setDescription('Ligar ou desligar').setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('history')
          .setDescription('Guardar histórico de reprodução (usado em /stats e autoplay)')
          .addBooleanOption((o) =>
            o.setName('ativo').setDescription('Ligar ou desligar').setRequired(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('manager-role')
          .setDescription('Define o cargo de gerente do bot (somente administradores)')
          .addRoleOption((o) => o.setName('cargo').setDescription('Cargo (vazio = remover)')),
      ),
  ).toJSON(),

  async execute(app, interaction) {
    const sub = interaction.options.getSubcommand(true);
    const current = await requirePermission(
      app,
      interaction,
      sub === 'manager-role' ? 'djrole' : 'settings',
    );
    switch (sub) {
      case 'view':
        await respond(interaction, { embeds: [settingsEmbed(current, app)], ephemeral: true });
        return;
      case 'panel-channel': {
        const channel = interaction.options.getChannel('canal');
        if (channel && !canPostIn(app.client, interaction.guild, channel.id)) {
          throw new UserError(
            `Preciso das permissões **Ver canal, Enviar mensagens e Inserir links** em <#${channel.id}>.`,
          );
        }
        await applyAndReply(
          app,
          interaction,
          { panelChannelId: channel?.id ?? null },
          channel
            ? `Painel fixado em <#${channel.id}> (vale a partir da próxima sessão).`
            : 'O painel aparecerá no canal onde `/play` for usado.',
        );
        return;
      }
      case 'volume': {
        const def = interaction.options.getInteger('padrao');
        const max = interaction.options.getInteger('maximo');
        if (def === null && max === null) throw new UserError('Informe `padrao` e/ou `maximo`.');
        const nextMax = max ?? current.maxVolume;
        const nextDef = Math.min(def ?? current.defaultVolume, nextMax);
        await applyAndReply(
          app,
          interaction,
          { defaultVolume: nextDef, maxVolume: nextMax },
          `Volume padrão **${nextDef}%**, máximo **${nextMax}%**.`,
        );
        return;
      }
      case 'inactivity': {
        const minutes = interaction.options.getInteger('minutos', true);
        await applyAndReply(
          app,
          interaction,
          { inactivityTimeoutSec: minutes * 60 },
          `Vou sair após **${minutes} min** ocioso ou sozinho no canal.`,
        );
        return;
      }
      case 'autoplay': {
        const enabled = interaction.options.getBoolean('ativo', true);
        await applyAndReply(
          app,
          interaction,
          { autoplay: enabled },
          `Autoplay padrão **${enabled ? 'ligado' : 'desligado'}** para novas sessões.`,
        );
        return;
      }
      case 'control': {
        const mode = interaction.options.getString('modo', true) as 'DJ' | 'EVERYONE';
        const alone = interaction.options.getBoolean('sozinho_e_dj');
        await applyAndReply(
          app,
          interaction,
          { controlMode: mode, ...(alone !== null ? { aloneIsDj: alone } : {}) },
          mode === 'DJ'
            ? 'Somente DJs, gerentes e administradores controlam a música.'
            : 'Qualquer pessoa no canal de voz pode controlar a música.',
        );
        return;
      }
      case 'queue': {
        const limit = interaction.options.getInteger('limite');
        const dup = interaction.options.getBoolean('duplicatas');
        const maxMin = interaction.options.getInteger('duracao_max_min');
        const patch: SettingsPatch = {
          ...(limit !== null ? { maxQueueSize: limit } : {}),
          ...(dup !== null ? { allowDuplicates: dup } : {}),
          ...(maxMin !== null ? { maxTrackDurationSec: maxMin === 0 ? null : maxMin * 60 } : {}),
        };
        if (!Object.keys(patch).length) throw new UserError('Informe ao menos uma opção.');
        await applyAndReply(app, interaction, patch, 'Regras da fila atualizadas.');
        return;
      }
      case 'http-streams': {
        const enabled = interaction.options.getBoolean('ativo', true);
        await applyAndReply(
          app,
          interaction,
          { allowHttpStreams: enabled },
          enabled
            ? 'Streams HTTP liberados. Endereços internos/privados continuam bloqueados. Libere apenas fontes que você tem direito de reproduzir.'
            : 'Streams HTTP genéricos desativados.',
        );
        return;
      }
      case 'history': {
        const enabled = interaction.options.getBoolean('ativo', true);
        await applyAndReply(
          app,
          interaction,
          { historyEnabled: enabled },
          `Histórico de reprodução **${enabled ? 'ativado' : 'desativado'}**.`,
        );
        return;
      }
      case 'manager-role': {
        const role = interaction.options.getRole('cargo');
        await applyAndReply(
          app,
          interaction,
          { managerRoleId: role?.id ?? null },
          role ? `Cargo de gerente: <@&${role.id}>.` : 'Cargo de gerente removido.',
        );
        return;
      }
      default:
        throw new UserError('Subcomando desconhecido.');
    }
  },
};

export const djrole: Command = {
  name: 'djrole',
  category: 'Configuração',
  data: guildOnly(
    new SlashCommandBuilder()
      .setName('djrole')
      .setDescription('Configura o cargo de DJ')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) =>
        s
          .setName('set')
          .setDescription('Define o cargo de DJ')
          .addRoleOption((o) => o.setName('cargo').setDescription('Cargo de DJ').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('remove').setDescription('Remove o cargo de DJ (só gerentes/admins controlam)'),
      ),
  ).toJSON(),
  async execute(app, interaction) {
    await requirePermission(app, interaction, 'djrole');
    const sub = interaction.options.getSubcommand(true);
    if (sub === 'set') {
      const role = interaction.options.getRole('cargo', true);
      if (role.id === interaction.guildId)
        throw new UserError('Use `/settings control modo: Qualquer pessoa` em vez de @everyone.');
      await applyAndReply(
        app,
        interaction,
        { djRoleId: role.id },
        `Cargo de DJ definido: <@&${role.id}>.`,
      );
      return;
    }
    await applyAndReply(app, interaction, { djRoleId: null }, 'Cargo de DJ removido.');
  },
};

export const settingsCommands = [settings, djrole];
