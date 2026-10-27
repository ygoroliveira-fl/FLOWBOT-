import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type Database = PrismaClient;

export interface DatabaseOptions {
  url: string;
  poolMax: number;
}

/**
 * Prisma 7 usa o driver `pg` via adapter. O pool é do node-postgres; definimos timeouts
 * explícitos porque o padrão do `pg` é esperar indefinidamente por uma conexão.
 */
export function createDatabase(options: DatabaseOptions): Database {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    application_name: 'aurora-bot',
  });
  return new PrismaClient({ adapter });
}

export async function pingDatabase(db: Database): Promise<number> {
  const started = performance.now();
  await db.$queryRaw`SELECT 1`;
  return performance.now() - started;
}
