import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { createDatabase, type Database } from '../../src/data/db.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

/** Recria o schema e aplica as migrações versionadas (o mesmo caminho da produção). */
export async function resetDatabase(): Promise<Database> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL não definido');
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
  return createDatabase({ url: TEST_DATABASE_URL, poolMax: 5 });
}

export async function truncateAll(db: Database): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "PlaylistTrack", "Playlist", "PlayHistory", "AuditLog", "PanelState", "UserPreference", "GuildSettings" RESTART IDENTITY CASCADE',
  );
}
