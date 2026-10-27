import 'dotenv/config';
import { createDatabase } from '../src/data/db.js';

/**
 * Seed de desenvolvimento: cria as configurações padrão do servidor de testes
 * (DISCORD_DEV_GUILD_ID). Idempotente e não altera dados existentes.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const guildId = process.env.DISCORD_DEV_GUILD_ID;
  if (!url) throw new Error('DATABASE_URL não definido');
  if (process.env.NODE_ENV === 'production') throw new Error('Seed é só para desenvolvimento');
  if (!guildId) {
    process.stdout.write('DISCORD_DEV_GUILD_ID não definido; nada a semear.\n');
    return;
  }
  const db = createDatabase({ url, poolMax: 2 });
  try {
    await db.guildSettings.upsert({ where: { guildId }, create: { guildId }, update: {} });
    process.stdout.write(`Configurações padrão garantidas para o servidor ${guildId}.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
