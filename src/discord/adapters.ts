import { ChannelType, DiscordAPIError, type Client, type EmbedBuilder } from 'discord.js';
import type { Database } from '../data/db.js';
import type { VoiceInspector } from '../music/sessionManager.js';
import {
  PanelGoneError,
  type PanelPayload,
  type PanelStore,
  type PanelTransport,
} from '../ui/panelManager.js';

/** Códigos que significam "mensagem/canal não existe ou sem acesso". */
const GONE_CODES = new Set([10003, 10008, 50001, 50013]);

function isGone(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError && typeof error.code === 'number' && GONE_CODES.has(error.code)
  );
}

export class DiscordPanelTransport implements PanelTransport {
  constructor(private readonly client: Client) {}

  private async textChannel(channelId: string) {
    const channel =
      this.client.channels.cache.get(channelId) ??
      (await this.client.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased() || !('send' in channel)) throw new PanelGoneError();
    return channel;
  }

  async send(channelId: string, payload: PanelPayload): Promise<string> {
    const channel = await this.textChannel(channelId);
    const message = await channel.send({ ...payload, allowedMentions: { parse: [] } });
    return message.id;
  }

  async edit(channelId: string, messageId: string, payload: PanelPayload): Promise<void> {
    const channel = await this.textChannel(channelId);
    try {
      await channel.messages.edit(messageId, { ...payload, allowedMentions: { parse: [] } });
    } catch (error) {
      if (isGone(error)) throw new PanelGoneError();
      throw error;
    }
  }

  async notice(channelId: string, embed: EmbedBuilder, ttlMs: number): Promise<void> {
    const channel = await this.textChannel(channelId);
    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    setTimeout(() => void message.delete().catch(() => undefined), ttlMs).unref();
  }
}

export class PrismaPanelStore implements PanelStore {
  constructor(private readonly db: Database) {}

  async get(guildId: string) {
    const row = await this.db.panelState.findUnique({ where: { guildId } });
    return row ? { channelId: row.channelId, messageId: row.messageId } : null;
  }

  async set(guildId: string, channelId: string, messageId: string): Promise<void> {
    await this.db.guildSettings.upsert({ where: { guildId }, create: { guildId }, update: {} });
    await this.db.panelState.upsert({
      where: { guildId },
      create: { guildId, channelId, messageId },
      update: { channelId, messageId },
    });
  }

  async clear(guildId: string): Promise<void> {
    await this.db.panelState.deleteMany({ where: { guildId } });
  }
}

export class DiscordVoiceInspector implements VoiceInspector {
  constructor(private readonly client: Client) {}

  humansInChannel(guildId: string, channelId: string): number | null {
    const guild = this.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
    )
      return null;
    return channel.members.filter((member) => !member.user.bot).size;
  }

  async channelExists(guildId: string, channelId: string): Promise<boolean> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;
    const channel =
      guild.channels.cache.get(channelId) ??
      (await guild.channels.fetch(channelId).catch(() => null));
    return Boolean(channel?.isVoiceBased());
  }
}
