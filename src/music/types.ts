/** Faixa normalizada, independente do cliente de áudio. */
export interface Track {
  /** Faixa codificada pelo Lavalink (necessária para tocar). */
  encoded: string;
  identifier: string;
  title: string;
  author: string;
  uri: string | null;
  /** Nome da fonte reportado pelo Lavalink (youtube, soundcloud, bandcamp, twitch, http...). */
  sourceName: string;
  durationMs: number;
  isStream: boolean;
  isSeekable: boolean;
  artworkUrl: string | null;
  isrc: string | null;
}

export interface QueueItem {
  /** Identificador único deste item na fila (o mesmo áudio pode estar duas vezes). */
  uid: string;
  track: Track;
  requesterId: string;
  addedAt: number;
}

export type LoopMode = 'off' | 'track' | 'queue';

export type PlaybackState = 'idle' | 'playing' | 'paused';

/** Motivo de término de faixa conforme o protocolo do Lavalink v4. */
export type TrackEndReason = 'finished' | 'loadFailed' | 'stopped' | 'replaced' | 'cleanup';

export interface SearchResult {
  kind: 'track' | 'playlist' | 'search' | 'empty' | 'error';
  tracks: Track[];
  playlistName?: string;
  /** Mensagem do erro, já segura para exibir (sem detalhes internos). */
  errorMessage?: string;
}
