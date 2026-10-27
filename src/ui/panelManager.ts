import type { EmbedBuilder, ActionRowBuilder, MessageActionRowComponentBuilder } from 'discord.js';
import type { Logger } from '../core/logger.js';
import type { GuildSession } from '../music/session.js';
import { panelComponents } from './components.js';
import { endedPanelEmbed, panelEmbed, type Branding } from './embeds.js';

export interface PanelPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/** A mensagem/canal não existe mais ou o bot perdeu acesso. */
export class PanelGoneError extends Error {
  constructor() {
    super('panel message gone');
    this.name = 'PanelGoneError';
  }
}

export interface PanelTransport {
  send(channelId: string, payload: PanelPayload): Promise<string>;
  /** Lança PanelGoneError se a mensagem foi apagada. */
  edit(channelId: string, messageId: string, payload: PanelPayload): Promise<void>;
  /** Mensagem curta temporária (some sozinha). */
  notice(channelId: string, embed: EmbedBuilder, ttlMs: number): Promise<void>;
}

export interface PanelStore {
  get(guildId: string): Promise<{ channelId: string; messageId: string } | null>;
  set(guildId: string, channelId: string, messageId: string): Promise<void>;
  clear(guildId: string): Promise<void>;
}

interface PanelEntry {
  channelId: string;
  messageId: string | null;
  lastRenderAt: number;
  pending: NodeJS.Timeout | null;
  ticker: NodeJS.Timeout | null;
  /** Serializa envios/edições do mesmo painel. */
  chain: Promise<void>;
}

/**
 * Mantém UMA mensagem de painel por servidor e a atualiza com controle de frequência:
 * mudanças de estado são agrupadas (no máximo uma edição a cada `minIntervalMs`), e a barra
 * de progresso é renovada a cada `tickMs` apenas enquanto toca. Mensagem apagada → recriada.
 */
export class PanelManager {
  private readonly entries = new Map<string, PanelEntry>();

  constructor(
    private readonly transport: PanelTransport,
    private readonly store: PanelStore,
    private readonly brand: Branding,
    private readonly logger: Logger,
    private readonly options: {
      minIntervalMs?: number;
      tickMs: number;
      resolveChannel: (session: GuildSession) => Promise<string>;
    },
  ) {}

  private get minInterval(): number {
    return this.options.minIntervalMs ?? 2_500;
  }

  /** Agenda uma atualização (chamado a cada mudança de estado da sessão). */
  schedule(session: GuildSession): void {
    const entry = this.entries.get(session.guildId);
    if (!entry) {
      void this.attach(session);
      return;
    }
    if (entry.pending) return;
    const wait = Math.max(0, entry.lastRenderAt + this.minInterval - Date.now());
    entry.pending = setTimeout(() => {
      entry.pending = null;
      this.enqueue(session.guildId, () => this.render(session));
    }, wait);
    entry.pending.unref();
  }

  /** Cria (ou reaproveita) a mensagem do painel para uma nova sessão. */
  private async attach(session: GuildSession): Promise<void> {
    let channelId: string;
    try {
      channelId = await this.options.resolveChannel(session);
    } catch (error) {
      this.logger.warn({ guildId: session.guildId, err: error }, 'Sem canal para o painel');
      return;
    }
    if (this.entries.has(session.guildId)) return this.schedule(session);
    const stored = await this.store.get(session.guildId).catch(() => null);
    const entry: PanelEntry = {
      channelId,
      messageId: stored && stored.channelId === channelId ? stored.messageId : null,
      lastRenderAt: 0,
      pending: null,
      ticker: null,
      chain: Promise.resolve(),
    };
    this.entries.set(session.guildId, entry);
    entry.ticker = setInterval(() => {
      if (session.state === 'playing' && !session.current?.track.isStream) this.schedule(session);
    }, this.options.tickMs);
    entry.ticker.unref();
    this.enqueue(session.guildId, () => this.render(session));
  }

  private enqueue(guildId: string, task: () => Promise<void>): void {
    const entry = this.entries.get(guildId);
    if (!entry) return;
    entry.chain = entry.chain.then(task).catch((error: unknown) => {
      this.logger.warn({ guildId, err: error }, 'Falha ao atualizar painel');
    });
  }

  private async render(session: GuildSession): Promise<void> {
    const entry = this.entries.get(session.guildId);
    if (!entry || session.destroyed) return;
    const payload: PanelPayload = {
      embeds: [panelEmbed(session, this.brand)],
      components: panelComponents(session, session.guildId),
    };
    entry.lastRenderAt = Date.now();
    if (entry.messageId) {
      try {
        await this.transport.edit(entry.channelId, entry.messageId, payload);
        return;
      } catch (error) {
        if (!(error instanceof PanelGoneError)) throw error;
        entry.messageId = null; // apagada: recria abaixo
      }
    }
    entry.messageId = await this.transport.send(entry.channelId, payload);
    await this.store.set(session.guildId, entry.channelId, entry.messageId).catch(() => undefined);
  }

  /** Sessão encerrada: congela o painel sem botões e libera timers. */
  async close(guildId: string, reason: string): Promise<void> {
    const entry = this.entries.get(guildId);
    if (!entry) return;
    if (entry.pending) clearTimeout(entry.pending);
    if (entry.ticker) clearInterval(entry.ticker);
    this.entries.delete(guildId);
    await entry.chain;
    if (entry.messageId) {
      await this.transport
        .edit(entry.channelId, entry.messageId, {
          embeds: [endedPanelEmbed(this.brand, reason)],
          components: [],
        })
        .catch(() => undefined);
    }
    await this.store.clear(guildId).catch(() => undefined);
  }

  /** Mensagem informativa temporária no canal do painel. */
  async notice(session: GuildSession, embed: EmbedBuilder): Promise<void> {
    const channelId = this.entries.get(session.guildId)?.channelId ?? session.textChannelId;
    await this.transport.notice(channelId, embed, 20_000).catch(() => undefined);
  }

  /** Após reinício: painéis antigos ficam marcados como encerrados (sem botões ativos). */
  async closeStale(
    stale: { guildId: string; channelId: string; messageId: string }[],
  ): Promise<void> {
    for (const panel of stale) {
      if (this.entries.has(panel.guildId)) continue;
      await this.transport
        .edit(panel.channelId, panel.messageId, {
          embeds: [
            endedPanelEmbed(
              this.brand,
              'O bot foi reiniciado. Use `/play` para começar uma nova sessão.',
            ),
          ],
          components: [],
        })
        .catch(() => undefined);
      await this.store.clear(panel.guildId).catch(() => undefined);
    }
  }

  get activeCount(): number {
    return this.entries.size;
  }

  shutdown(): void {
    for (const entry of this.entries.values()) {
      if (entry.pending) clearTimeout(entry.pending);
      if (entry.ticker) clearInterval(entry.ticker);
    }
  }
}
