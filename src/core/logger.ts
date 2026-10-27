import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

/** Caminhos com segredos que nunca devem ir para os logs. */
export const REDACT_PATHS = [
  'token',
  'password',
  'authorization',
  'headers.authorization',
  'headers.Authorization',
  '*.token',
  '*.password',
  '*.authorization',
  'DISCORD_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
  'METRICS_TOKEN',
  'LAVALINK_NODES',
  'voice.token',
];

export function createLogger(options: { level: string; pretty: boolean }): Logger {
  const base: LoggerOptions = {
    level: options.level,
    base: { service: 'aurora-bot' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: { err: pino.stdSerializers.err },
  };
  if (options.pretty) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'UTC:isoTime' },
      },
    });
  }
  return pino(base);
}

/** Remove trechos que parecem credenciais de uma string livre (ex.: mensagens de erro de terceiros). */
export function scrubSecrets(text: string): string {
  return text
    .replace(/[MN][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}/g, '[DISCORD_TOKEN]')
    .replace(/(postgres(?:ql)?|redis):\/\/[^@\s]+@/gi, '$1://[CREDENCIAIS]@')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[REDACTED]');
}
