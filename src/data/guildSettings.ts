import type { Database } from './db.js';
import type { GuildSettings } from '../generated/prisma/client.js';
import type { AuditService } from './audit.js';

export type { GuildSettings };

export type SettingsPatch = Partial<
  Pick<
    GuildSettings,
    | 'djRoleId'
    | 'managerRoleId'
    | 'controlMode'
    | 'aloneIsDj'
    | 'panelChannelId'
    | 'defaultVolume'
    | 'maxVolume'
    | 'inactivityTimeoutSec'
    | 'autoplay'
    | 'allowDuplicates'
    | 'maxQueueSize'
    | 'maxTrackDurationSec'
    | 'historyEnabled'
    | 'allowHttpStreams'
    | 'timezone'
  >
>;

export const SETTINGS_LIMITS = {
  volume: { min: 1, max: 200 },
  inactivitySec: { min: 30, max: 24 * 60 * 60 },
  queueSize: { min: 10 },
} as const;

/** Configurações por servidor com cache em memória (invalidado em cada alteração). */
export class GuildSettingsService {
  private readonly cache = new Map<string, { value: GuildSettings; expiresAt: number }>();

  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly globalMaxQueue: number,
    private readonly ttlMs = 60_000,
  ) {}

  async get(guildId: string): Promise<GuildSettings> {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.db.guildSettings.upsert({
      where: { guildId },
      create: { guildId, maxQueueSize: Math.min(500, this.globalMaxQueue) },
      update: {},
    });
    this.cache.set(guildId, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  async update(guildId: string, actorId: string, patch: SettingsPatch): Promise<GuildSettings> {
    const validated = this.validate(patch);
    const value = await this.db.$transaction(async (tx) => {
      const updated = await tx.guildSettings.upsert({
        where: { guildId },
        create: { guildId, ...validated },
        update: validated,
      });
      await this.audit.record(
        { guildId, actorId, action: 'settings.update', details: validated },
        tx,
      );
      return updated;
    });
    this.cache.set(guildId, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  /** Remove todos os dados do servidor (bot removido do servidor + retenção). */
  async purgeGuild(guildId: string): Promise<void> {
    this.cache.delete(guildId);
    await this.db.guildSettings.deleteMany({ where: { guildId } });
  }

  private validate(patch: SettingsPatch): SettingsPatch {
    const out: SettingsPatch = { ...patch };
    const clamp = (n: number, min: number, max: number) =>
      Math.min(max, Math.max(min, Math.round(n)));
    if (out.defaultVolume !== undefined) out.defaultVolume = clamp(out.defaultVolume, 1, 200);
    if (out.maxVolume !== undefined) out.maxVolume = clamp(out.maxVolume, 1, 200);
    if (out.inactivityTimeoutSec !== undefined) {
      out.inactivityTimeoutSec = clamp(
        out.inactivityTimeoutSec,
        SETTINGS_LIMITS.inactivitySec.min,
        SETTINGS_LIMITS.inactivitySec.max,
      );
    }
    if (out.maxQueueSize !== undefined)
      out.maxQueueSize = clamp(out.maxQueueSize, 10, this.globalMaxQueue);
    return out;
  }
}
