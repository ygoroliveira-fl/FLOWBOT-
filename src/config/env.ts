import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const snowflake = z.string().regex(/^\d{17,20}$/, 'deve ser um ID (snowflake) do Discord');

/** Um nó Lavalink no formato `id|host|porta|senha|seguro` separado por vírgula. */
const lavalinkNodes = z
  .string()
  .min(1)
  .transform((raw, ctx) => {
    const nodes = raw.split(',').map((entry, index) => {
      const [id, host, port, password, secure] = entry.trim().split('|');
      const portNumber = Number(port);
      if (!id || !host || !password || !Number.isInteger(portNumber) || portNumber <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: `LAVALINK_NODES[${index}] inválido. Formato: id|host|porta|senha|true/false`,
        });
        return null;
      }
      return { id, host, port: portNumber, password, secure: secure === 'true' };
    });
    return nodes.filter((n): n is NonNullable<typeof n> => n !== null);
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: bool.default(false),

  DISCORD_TOKEN: z.string().min(50, 'DISCORD_TOKEN ausente ou inválido'),
  DISCORD_CLIENT_ID: snowflake,
  /** Se definido, comandos são registrados só neste servidor (propagação imediata, ideal para dev). */
  DISCORD_DEV_GUILD_ID: snowflake.optional(),

  BOT_NAME: z.string().min(1).max(32).default('Aurora'),
  BOT_ACCENT_COLOR: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .default('#7C5CFF'),

  DATABASE_URL: z.string().url().startsWith('postgres'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z.string().url().startsWith('redis').optional(),

  LAVALINK_NODES: lavalinkNodes,

  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
  /** Token exigido em /metrics (Authorization: Bearer). Sem ele, /metrics fica desativado. */
  METRICS_TOKEN: z.string().min(24).optional(),

  HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),

  /** Limites globais (servidores podem reduzir, nunca ultrapassar). */
  MAX_QUEUE_SIZE: z.coerce.number().int().min(10).max(5000).default(1000),
  MAX_PLAYLISTS_PER_USER: z.coerce.number().int().min(1).max(500).default(25),
  MAX_PLAYLIST_TRACKS: z.coerce.number().int().min(10).max(5000).default(500),
  PANEL_UPDATE_INTERVAL_MS: z.coerce.number().int().min(5000).max(120000).default(15000),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração inválida:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

/** Valida variáveis de ambiente. Nunca inclui valores nas mensagens de erro (podem ser segredos). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`),
    );
  }
  return parsed.data;
}
