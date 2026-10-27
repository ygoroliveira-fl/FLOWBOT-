import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { z } from 'zod';
import { commandPayloads } from './commands/index.js';

/**
 * Registra os comandos slash. Com DISCORD_DEV_GUILD_ID registra só no servidor de testes
 * (efeito imediato); sem ele, registra globalmente (pode levar alguns minutos para aparecer).
 * Uso: pnpm deploy-commands [--global] [--clear-guild]
 */
const env = z
  .object({
    DISCORD_TOKEN: z.string().min(50),
    DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
    DISCORD_DEV_GUILD_ID: z
      .string()
      .regex(/^\d{17,20}$/)
      .optional(),
  })
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)));

const args = new Set(process.argv.slice(2));
const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
const payload = commandPayloads();

async function run(): Promise<void> {
  if (args.has('--clear-guild')) {
    if (!env.DISCORD_DEV_GUILD_ID) throw new Error('DISCORD_DEV_GUILD_ID não definido');
    await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID),
      { body: [] },
    );
    process.stdout.write('Comandos do servidor de testes removidos.\n');
    return;
  }
  const route =
    env.DISCORD_DEV_GUILD_ID && !args.has('--global')
      ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID)
      : Routes.applicationCommands(env.DISCORD_CLIENT_ID);
  const result = (await rest.put(route, { body: payload })) as unknown[];
  process.stdout.write(
    `${result.length} comandos registrados (${route.includes('/guilds/') ? 'servidor de testes' : 'global'}).\n`,
  );
}

run().catch((error: unknown) => {
  process.stderr.write(
    `Falha ao registrar comandos: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
