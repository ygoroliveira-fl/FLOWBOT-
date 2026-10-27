import type { Database } from './db.js';
import type { Track } from '../music/types.js';

export interface GuildStats {
  totalPlays: number;
  uniqueListeners: number;
  totalListenedMs: number;
  topTracks: { title: string; author: string; plays: number }[];
  topSources: { sourceName: string; plays: number }[];
}

/** Histórico de reprodução (opcional por servidor) e estatísticas agregadas. */
export class HistoryService {
  constructor(private readonly db: Database) {}

  async record(guildId: string, userId: string, track: Track): Promise<void> {
    await this.db.playHistory.create({
      data: {
        // connectOrCreate: não depende da linha de configurações já existir (FK).
        guild: { connectOrCreate: { where: { guildId }, create: { guildId } } },
        userId,
        title: track.title.slice(0, 256),
        author: track.author.slice(0, 256),
        uri: track.uri?.slice(0, 1024) ?? null,
        sourceName: track.sourceName.slice(0, 32),
        durationMs: Math.min(2_147_483_647, Math.max(0, Math.round(track.durationMs))),
      },
    });
  }

  async stats(guildId: string, sinceDays = 30): Promise<GuildStats> {
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const where = { guildId, playedAt: { gte: since } };
    const [aggregate, listeners, topTracks, topSources] = await Promise.all([
      this.db.playHistory.aggregate({ where, _count: { _all: true }, _sum: { durationMs: true } }),
      this.db.playHistory.groupBy({ by: ['userId'], where }),
      this.db.playHistory.groupBy({
        by: ['title', 'author'],
        where,
        _count: { _all: true },
        orderBy: { _count: { title: 'desc' } },
        take: 5,
      }),
      this.db.playHistory.groupBy({
        by: ['sourceName'],
        where,
        _count: { _all: true },
        orderBy: { _count: { sourceName: 'desc' } },
        take: 5,
      }),
    ]);
    return {
      totalPlays: aggregate._count._all,
      uniqueListeners: listeners.length,
      totalListenedMs: aggregate._sum.durationMs ?? 0,
      topTracks: topTracks.map((row) => ({
        title: row.title,
        author: row.author,
        plays: row._count._all,
      })),
      topSources: topSources.map((row) => ({ sourceName: row.sourceName, plays: row._count._all })),
    };
  }

  /** Últimas faixas tocadas no servidor (base do autoplay). */
  async recent(guildId: string, limit = 10) {
    return this.db.playHistory.findMany({
      where: { guildId },
      orderBy: { playedAt: 'desc' },
      take: limit,
    });
  }
}

/** Política de retenção: apaga histórico e auditoria antigos. */
export async function applyRetention(
  db: Database,
  options: { historyDays: number; auditDays: number; now?: Date },
): Promise<{ history: number; audit: number }> {
  const now = options.now ?? new Date();
  const historyCutoff = new Date(now.getTime() - options.historyDays * 86_400_000);
  const auditCutoff = new Date(now.getTime() - options.auditDays * 86_400_000);
  const [history, audit] = await Promise.all([
    db.playHistory.deleteMany({ where: { playedAt: { lt: historyCutoff } } }),
    db.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
  ]);
  return { history: history.count, audit: audit.count };
}
