import type { AudioEngine } from '../audio/engine.js';
import { TimeoutError, withTimeout } from '../core/async.js';
import { RateLimitedError, ServiceUnavailableError, UserError } from '../core/errors.js';
import type { RateLimiter } from '../core/rateLimiter.js';
import type { SearchResult } from '../music/types.js';
import {
  getProvider,
  providerForHost,
  getProvider as findProvider,
  type MusicProvider,
} from './providers.js';
import { checkPublicUrl, parseUserUrl, type Resolver } from './urlSafety.js';

export const MAX_QUERY_LENGTH = 500;
export const DEFAULT_SOURCE = 'youtube';

export interface ResolveOptions {
  guildId: string;
  /** Id do provedor para pesquisas por texto. */
  source?: string;
  allowHttpStreams: boolean;
  signal?: AbortSignal;
}

export interface ResolveOutcome {
  provider: MusicProvider;
  result: SearchResult;
  isUrl: boolean;
}

export interface SearchMetrics {
  observe(providerId: string, outcome: 'success' | 'empty' | 'error' | 'timeout', ms: number): void;
}

const URL_PATTERN = /^https?:\/\//i;

const URL_ERRORS: Record<string, string> = {
  invalid: 'Esse link não parece válido.',
  protocol: 'Só aceito links http(s).',
  credentials: 'Links com usuário/senha embutidos não são aceitos.',
  private_address: 'Esse endereço não é permitido.',
  dns_failed: 'Não consegui resolver o endereço desse link.',
};

/**
 * Converte o que o usuário digitou em uma consulta segura ao Lavalink, escolhendo o provedor,
 * aplicando SSRF/allowlist, limite de requisições e timeout.
 */
export class SearchService {
  constructor(
    private readonly engine: AudioEngine,
    private readonly rateLimiter: RateLimiter,
    private readonly metrics: SearchMetrics,
    private readonly options: { timeoutMs?: number; resolver?: Resolver } = {},
  ) {}

  async resolve(rawQuery: string, options: ResolveOptions): Promise<ResolveOutcome> {
    const query = rawQuery.trim();
    if (!query) throw new UserError('Digite o nome de uma música ou um link.');
    if (query.length > MAX_QUERY_LENGTH) throw new UserError('A pesquisa é longa demais.');

    const isUrl = URL_PATTERN.test(query);
    const { provider, identifier } = isUrl
      ? await this.prepareUrl(query, options)
      : this.prepareText(query, options.source);

    this.ensureAvailable(provider);

    const limit = await this.rateLimiter.consume(`search:${options.guildId}`, 20, 60_000);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterMs);

    const started = Date.now();
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await withTimeout(
        this.engine.search({ identifier, signal: controller.signal }),
        this.options.timeoutMs ?? 15_000,
        `search:${provider.id}`,
      );
      const outcome =
        result.kind === 'error' ? 'error' : result.tracks.length ? 'success' : 'empty';
      this.metrics.observe(provider.id, outcome, Date.now() - started);
      return { provider, result, isUrl };
    } catch (error) {
      controller.abort();
      if (error instanceof TimeoutError) {
        this.metrics.observe(provider.id, 'timeout', Date.now() - started);
        throw new ServiceUnavailableError(
          `${provider.displayName} demorou demais para responder. Tente novamente${provider.id === 'youtube' ? ' ou use `fonte: SoundCloud`' : ''}.`,
          'SEARCH_TIMEOUT',
        );
      }
      this.metrics.observe(provider.id, 'error', Date.now() - started);
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private prepareText(
    query: string,
    sourceId?: string,
  ): { provider: MusicProvider; identifier: string } {
    const provider = findProvider(sourceId ?? DEFAULT_SOURCE);
    if (!provider?.capabilities.search || !provider.searchPrefix) {
      throw new UserError('Essa fonte não suporta pesquisa por texto. Envie um link.');
    }
    return { provider, identifier: `${provider.searchPrefix}:${query}` };
  }

  private async prepareUrl(
    query: string,
    options: ResolveOptions,
  ): Promise<{ provider: MusicProvider; identifier: string }> {
    const parsed = parseUserUrl(query);
    if (!parsed.ok) throw new UserError(URL_ERRORS[parsed.reason] ?? 'Link inválido.');
    const known = providerForHost(parsed.url.hostname);
    if (known && !known.capabilities.playback) {
      throw new UserError(
        known.unsupportedMessage ?? `${known.displayName} não é suportado.`,
        'UNSUPPORTED_SOURCE',
      );
    }
    if (known) return { provider: known, identifier: parsed.url.href };

    if (!options.allowHttpStreams) {
      throw new UserError(
        'Links desse site não são suportados. Fontes aceitas: YouTube, YouTube Music, SoundCloud, Bandcamp, Twitch e Vimeo. Um administrador pode liberar streams HTTP em `/settings http-streams`.',
        'UNSUPPORTED_SOURCE',
      );
    }
    const checked = await checkPublicUrl(parsed.url.href, this.options.resolver);
    if (!checked.ok) throw new UserError(URL_ERRORS[checked.reason] ?? 'Link inválido.');
    return { provider: getProvider('http')!, identifier: checked.url.href };
  }

  private ensureAvailable(provider: MusicProvider): void {
    const sources = this.engine.availableSources();
    if (sources && provider.sourceManager && !sources.has(provider.sourceManager)) {
      throw new ServiceUnavailableError(
        `${provider.displayName} não está disponível neste servidor de áudio no momento.${provider.id.startsWith('youtube') ? ' Tente `fonte: SoundCloud`.' : ''}`,
        'SOURCE_DISABLED',
      );
    }
  }
}
