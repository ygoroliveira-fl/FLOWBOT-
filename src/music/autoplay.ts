import type { AudioEngine } from '../audio/engine.js';
import type { Logger } from '../core/logger.js';
import { trackKey } from './queue.js';
import type { GuildSession } from './session.js';
import type { QueueItem, Track } from './types.js';

/**
 * Sugestões para o autoplay, usando apenas recursos das fontes já suportadas:
 * - YouTube: playlist "Mix" (RD<videoId>), que o plugin youtube-source resolve.
 * - Demais fontes: pesquisa pelo mesmo artista na própria fonte (ou no YouTube).
 * Nunca repete faixas que estão na fila ou no histórico recente.
 */
export function createAutoplay(engine: AudioEngine, logger: Logger) {
  return async (session: GuildSession, last: QueueItem): Promise<Track | null> => {
    const recent = session.recentKeys();
    const candidates: string[] = [];
    const track = last.track;
    if (track.sourceName === 'youtube' && /^[\w-]{11}$/.test(track.identifier)) {
      candidates.push(
        `https://www.youtube.com/watch?v=${track.identifier}&list=RD${track.identifier}`,
      );
    }
    const artist = track.author.replace(/\s*-\s*Topic$/i, '').trim();
    if (artist) {
      candidates.push(
        track.sourceName === 'soundcloud' ? `scsearch:${artist}` : `ytsearch:${artist}`,
      );
    }
    for (const identifier of candidates) {
      try {
        const result = await engine.search({ identifier });
        const pick = result.tracks.find(
          (t) =>
            !recent.has(trackKey(t)) &&
            !t.isStream &&
            t.durationMs > 30_000 &&
            t.durationMs < 15 * 60_000,
        );
        if (pick) return pick;
      } catch (error) {
        logger.debug({ err: error }, 'Autoplay: candidato falhou');
      }
    }
    return null;
  };
}
