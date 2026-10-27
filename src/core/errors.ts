/**
 * Erros com mensagem segura para o usuário (pt-BR). Qualquer outro erro vira uma mensagem
 * genérica com um código de correlação; o stack trace fica apenas no log.
 */
export class UserError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string = 'USER_ERROR',
  ) {
    super(userMessage);
    this.name = 'UserError';
  }
}

export class PermissionDeniedError extends UserError {
  constructor(message = 'Você não tem permissão para fazer isso.') {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionDeniedError';
  }
}

export class NotFoundError extends UserError {
  constructor(message: string) {
    super(message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/** Falha de uma dependência externa (Lavalink, banco, provedor). */
export class ServiceUnavailableError extends UserError {
  constructor(message: string, code = 'SERVICE_UNAVAILABLE') {
    super(message, code);
    this.name = 'ServiceUnavailableError';
  }
}

export class RateLimitedError extends UserError {
  constructor(public readonly retryAfterMs: number) {
    super(
      `Calma! Tente novamente em ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`,
      'RATE_LIMITED',
    );
    this.name = 'RateLimitedError';
  }
}

export function isUserError(error: unknown): error is UserError {
  return error instanceof UserError;
}
