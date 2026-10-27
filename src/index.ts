import 'dotenv/config';
import { startApp, type RunningApp } from './app.js';
import { ConfigError, loadEnv } from './config/env.js';
import { createLogger, scrubSecrets } from './core/logger.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\nVeja .env.example e docs/DEPLOYMENT.md.\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY });
  let app: RunningApp | null = null;

  const shutdown = (signal: string, code = 0) => {
    logger.info({ signal }, 'Sinal recebido');
    const force = setTimeout(() => {
      logger.error('Encerramento excedeu o tempo limite; forçando saída');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    void (app?.stop(signal) ?? Promise.resolve()).finally(() => {
      clearTimeout(force);
      process.exit(code);
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error(
      {
        err:
          reason instanceof Error
            ? { message: scrubSecrets(reason.message), stack: reason.stack }
            : String(reason),
      },
      'Promise rejeitada sem tratamento',
    );
  });
  process.on('uncaughtException', (error) => {
    logger.fatal(
      { err: { message: scrubSecrets(error.message), stack: error.stack } },
      'Exceção não capturada; reiniciando',
    );
    shutdown('uncaughtException', 1);
  });

  try {
    app = await startApp(env, logger);
    logger.info('Bot pronto');
  } catch (error) {
    logger.fatal(
      {
        err:
          error instanceof Error
            ? { message: scrubSecrets(error.message), stack: error.stack }
            : String(error),
      },
      'Falha ao iniciar',
    );
    process.exit(1);
  }
}

void main();
