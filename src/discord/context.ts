import { randomUUID } from 'node:crypto';
import {
  ChannelType,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type EmbedBuilder,
  type Guild,
  type InteractionReplyOptions,
  type StringSelectMenuInteraction,
  type VoiceBasedChannel,
} from 'discord.js';
import type { AudioEngine } from '../audio/engine.js';
import type { Env } from '../config/env.js';
import { PermissionDeniedError, UserError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import type { RateLimiter } from '../core/rateLimiter.js';
import type { AuditService } from '../data/audit.js';
import type { Database } from '../data/db.js';
import type { GuildSettings, GuildSettingsService } from '../data/guildSettings.js';
import type { HistoryService } from '../data/history.js';
import type { PlaylistService } from '../data/playlists.js';
import type { GuildSession } from '../music/session.js';
import type { SessionManager } from '../music/sessionManager.js';
import type { Metrics } from '../observability/metrics.js';
import {
  authorize,
  denialMessage,
  type Action,
  type MemberContext,
} from '../permissions/permissions.js';
import type { SearchService } from '../providers/searchService.js';
import type { Track } from '../music/types.js';
import type { Branding } from '../ui/embeds.js';
import type { PanelManager } from '../ui/panelManager.js';
import type { TtlMap } from './ttlMap.js';

export interface AppContext {
  env: Env;
  logger: Logger;
  client: Client;
  db: Database;
  settings: GuildSettingsService;
  playlists: PlaylistService;
  history: HistoryService;
  audit: AuditService;
  sessions: SessionManager;
  search: SearchService;
  panels: PanelManager;
  engine: AudioEngine;
  rateLimiter: RateLimiter;
  metrics: Metrics;
  brand: Branding;
  /** Resultados de /search aguardando escolha no menu (expiram em 5 min). */
  pendingSearches: TtlMap<{ userId: string; tracks: Track[]; providerName: string }>;
  /** Confirmações de operações destrutivas (expiram em 60 s). */
  pendingConfirmations: TtlMap<{ userId: string; run: () => Promise<string> }>;
}

export type GuildInteraction =
  | ChatInputCommandInteraction<'cached'>
  | ButtonInteraction<'cached'>
  | StringSelectMenuInteraction<'cached'>;

export function newToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export const EPHEMERAL = MessageFlags.Ephemeral;

/** Responde ou edita conforme o estado da interação (respeita deferimento). */
export async function respond(
  interaction: GuildInteraction | ChatInputCommandInteraction,
  payload: {
    embeds: EmbedBuilder[];
    components?: InteractionReplyOptions['components'];
    ephemeral?: boolean;
  },
): Promise<void> {
  const base = {
    embeds: payload.embeds,
    components: payload.components ?? [],
    allowedMentions: { parse: [] as never[] },
  };
  if (interaction.deferred || interaction.replied) {
    if (interaction.deferred && !interaction.replied) await interaction.editReply(base);
    else
      await interaction.followUp({ ...base, ...(payload.ephemeral ? { flags: EPHEMERAL } : {}) });
    return;
  }
  await interaction.reply({ ...base, ...(payload.ephemeral ? { flags: EPHEMERAL } : {}) });
}

/** Membro atualizado (cargos e permissões no momento da ação). */
export function memberContext(
  interaction: GuildInteraction,
  sessions: SessionManager,
): MemberContext {
  const member = interaction.member;
  const isOwner = interaction.guild.ownerId === interaction.user.id;
  // memberPermissions é calculado pelo Discord para esta interação (já considera overrides do canal).
  const perms = interaction.memberPermissions;
  const isAdmin =
    isOwner ||
    perms.has(PermissionFlagsBits.Administrator) ||
    perms.has(PermissionFlagsBits.ManageGuild);
  const session = sessions.get(interaction.guildId);
  const inBotChannel = Boolean(session && member.voice.channelId === session.voiceChannelId);
  const humans = sessions.humansWithBot(interaction.guildId);
  return {
    userId: interaction.user.id,
    isAdmin,
    roleIds: new Set(member.roles.cache.keys()),
    isAloneWithBot: inBotChannel && humans === 1,
  };
}

export function permissionSettings(settings: GuildSettings) {
  return {
    djRoleId: settings.djRoleId,
    managerRoleId: settings.managerRoleId,
    controlMode: settings.controlMode,
    aloneIsDj: settings.aloneIsDj,
  };
}

export async function requirePermission(
  app: AppContext,
  interaction: GuildInteraction,
  action: Action,
): Promise<GuildSettings> {
  const settings = await app.settings.get(interaction.guildId);
  const decision = authorize(
    action,
    memberContext(interaction, app.sessions),
    permissionSettings(settings),
  );
  if (!decision.allowed) throw new PermissionDeniedError(denialMessage(decision));
  return settings;
}

/** Verifica se pode executar a ação, sem lançar. */
export async function can(
  app: AppContext,
  interaction: GuildInteraction,
  action: Action,
): Promise<boolean> {
  const settings = await app.settings.get(interaction.guildId);
  return authorize(action, memberContext(interaction, app.sessions), permissionSettings(settings))
    .allowed;
}

/** Usuário precisa estar em um canal de voz e, se o bot já estiver tocando, no mesmo canal. */
export function requireVoice(
  interaction: GuildInteraction,
  session: GuildSession | undefined,
): VoiceBasedChannel {
  const channel = interaction.member.voice.channel;
  if (!channel) throw new UserError('Entre em um canal de voz primeiro.');
  if (session && !session.destroyed && session.voiceChannelId !== channel.id) {
    throw new UserError(
      `Estou tocando em <#${session.voiceChannelId}>. Entre nesse canal para controlar a música.`,
    );
  }
  return channel;
}

export function requireSession(app: AppContext, interaction: GuildInteraction): GuildSession {
  const session = app.sessions.get(interaction.guildId);
  if (!session || session.destroyed)
    throw new UserError('Não estou tocando nada neste servidor. Use `/play` para começar.');
  return session;
}

/** Permissões que o bot precisa no canal de voz. */
export function assertBotCanJoin(channel: VoiceBasedChannel, guild: Guild): void {
  const me = guild.members.me;
  if (!me) throw new UserError('Não consegui verificar minhas permissões neste servidor.');
  if (channel.type === ChannelType.GuildStageVoice) {
    throw new UserError('Canais de palco ainda não são suportados. Use um canal de voz comum.');
  }
  const perms = channel.permissionsFor(me);
  const missing: string[] = [];
  if (!perms.has(PermissionFlagsBits.ViewChannel)) missing.push('Ver canal');
  if (!perms.has(PermissionFlagsBits.Connect)) missing.push('Conectar');
  if (!perms.has(PermissionFlagsBits.Speak)) missing.push('Falar');
  if (missing.length)
    throw new UserError(`Preciso das permissões **${missing.join(', ')}** em <#${channel.id}>.`);
  if (channel.full && !perms.has(PermissionFlagsBits.MoveMembers)) {
    throw new UserError(`O canal <#${channel.id}> está cheio.`);
  }
}

/** Canal de texto onde o bot pode enviar o painel. */
export function canPostIn(client: Client, guild: Guild, channelId: string): boolean {
  const channel = guild.channels.cache.get(channelId);
  const me = guild.members.me;
  if (!channel || !me || !channel.isTextBased()) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(
    perms?.has(PermissionFlagsBits.ViewChannel) &&
    perms.has(PermissionFlagsBits.SendMessages) &&
    perms.has(PermissionFlagsBits.EmbedLinks) &&
    client.user,
  );
}

export function isGuildMember(value: unknown): value is GuildMember {
  return value instanceof GuildMember;
}
