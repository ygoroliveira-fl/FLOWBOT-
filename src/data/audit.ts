import type { Database } from './db.js';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Pick<Database, 'auditLog' | 'guildSettings'>;

export interface AuditEntry {
  guildId: string;
  actorId: string;
  action: string;
  details?: Record<string, unknown>;
}

/** Eventos administrativos relevantes (configurações, cargos, limpezas). Nunca guarda segredos. */
export class AuditService {
  constructor(private readonly db: Database) {}

  async record(entry: AuditEntry, tx: Tx = this.db): Promise<void> {
    // Garante a linha do servidor (FK) sem sobrescrever nada.
    await tx.guildSettings.upsert({
      where: { guildId: entry.guildId },
      create: { guildId: entry.guildId },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        guildId: entry.guildId,
        actorId: entry.actorId,
        action: entry.action.slice(0, 64),
        ...(entry.details ? { details: entry.details as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async recent(guildId: string, limit = 20) {
    return this.db.auditLog.findMany({
      where: { guildId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, limit),
    });
  }
}
