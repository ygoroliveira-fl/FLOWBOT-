/**
 * Catálogo de fontes musicais. Cada provedor declara o que realmente suporta; a reprodução
 * efetiva sempre acontece no Lavalink (fontes nativas ou plugin youtube-source).
 * Detalhes, requisitos e limitações: docs/MUSIC_PROVIDERS.md
 */
export interface ProviderCapabilities {
  /** Pesquisa por texto. */
  search: boolean;
  /** Resolução de links do serviço. */
  resolveUrls: boolean;
  /** O áudio pode ser reproduzido pelo motor. */
  playback: boolean;
  /** Necessita credenciais/assinatura configuradas pelo operador. */
  requiresCredentials: boolean;
}

export interface MusicProvider {
  id: string;
  displayName: string;
  /** Prefixo de pesquisa do Lavalink (ex.: "ytsearch"). */
  searchPrefix: string | null;
  /** Nome do source manager no Lavalink (campo info.sourceManagers / track.info.sourceName). */
  sourceManager: string | null;
  hosts: string[];
  capabilities: ProviderCapabilities;
  /** Mensagem exibida quando o link pertence a um serviço sem reprodução suportada. */
  unsupportedMessage?: string;
}

const youtube: MusicProvider = {
  id: 'youtube',
  displayName: 'YouTube',
  searchPrefix: 'ytsearch',
  sourceManager: 'youtube',
  hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  capabilities: { search: true, resolveUrls: true, playback: true, requiresCredentials: false },
};

const youtubeMusic: MusicProvider = {
  id: 'youtubemusic',
  displayName: 'YouTube Music',
  searchPrefix: 'ytmsearch',
  sourceManager: 'youtube',
  hosts: ['music.youtube.com'],
  capabilities: { search: true, resolveUrls: true, playback: true, requiresCredentials: false },
};

const soundcloud: MusicProvider = {
  id: 'soundcloud',
  displayName: 'SoundCloud',
  searchPrefix: 'scsearch',
  sourceManager: 'soundcloud',
  hosts: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com'],
  capabilities: { search: true, resolveUrls: true, playback: true, requiresCredentials: false },
};

const bandcamp: MusicProvider = {
  id: 'bandcamp',
  displayName: 'Bandcamp',
  searchPrefix: 'bcsearch',
  sourceManager: 'bandcamp',
  // Subdomínios de artistas são tratados em matchHost.
  hosts: ['bandcamp.com'],
  capabilities: { search: true, resolveUrls: true, playback: true, requiresCredentials: false },
};

const twitch: MusicProvider = {
  id: 'twitch',
  displayName: 'Twitch (ao vivo)',
  searchPrefix: null,
  sourceManager: 'twitch',
  hosts: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'],
  capabilities: { search: false, resolveUrls: true, playback: true, requiresCredentials: false },
};

const vimeo: MusicProvider = {
  id: 'vimeo',
  displayName: 'Vimeo',
  searchPrefix: null,
  sourceManager: 'vimeo',
  hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
  capabilities: { search: false, resolveUrls: true, playback: true, requiresCredentials: false },
};

const http: MusicProvider = {
  id: 'http',
  displayName: 'Stream HTTP',
  searchPrefix: null,
  sourceManager: 'http',
  hosts: [],
  capabilities: { search: false, resolveUrls: true, playback: true, requiresCredentials: false },
};

/** Serviços de catálogo cuja reprodução direta NÃO é oferecida (DRM/termos). */
const catalogOnly: MusicProvider[] = [
  {
    id: 'spotify',
    displayName: 'Spotify',
    searchPrefix: null,
    sourceManager: null,
    hosts: ['open.spotify.com', 'spotify.link', 'play.spotify.com'],
    capabilities: { search: false, resolveUrls: false, playback: false, requiresCredentials: true },
    unsupportedMessage:
      'O Spotify não permite reproduzir seu áudio fora dos apps oficiais. Pesquise pelo nome da música e artista — por exemplo: `/play Artista - Música`.',
  },
  {
    id: 'applemusic',
    displayName: 'Apple Music',
    searchPrefix: null,
    sourceManager: null,
    hosts: ['music.apple.com', 'itunes.apple.com'],
    capabilities: { search: false, resolveUrls: false, playback: false, requiresCredentials: true },
    unsupportedMessage:
      'O Apple Music usa DRM e não pode ser reproduzido pelo bot. Pesquise pelo nome da música e artista.',
  },
  {
    id: 'deezer',
    displayName: 'Deezer',
    searchPrefix: null,
    sourceManager: null,
    hosts: ['deezer.com', 'www.deezer.com', 'deezer.page.link', 'link.deezer.com'],
    capabilities: { search: false, resolveUrls: false, playback: false, requiresCredentials: true },
    unsupportedMessage:
      'O áudio do Deezer é protegido e não é reproduzido pelo bot. Pesquise pelo nome da música e artista.',
  },
  {
    id: 'tidal',
    displayName: 'TIDAL',
    searchPrefix: null,
    sourceManager: null,
    hosts: ['tidal.com', 'listen.tidal.com'],
    capabilities: { search: false, resolveUrls: false, playback: false, requiresCredentials: true },
    unsupportedMessage:
      'O TIDAL usa DRM e não pode ser reproduzido pelo bot. Pesquise pelo nome da música e artista.',
  },
];

export const PLAYABLE_PROVIDERS: MusicProvider[] = [
  youtube,
  youtubeMusic,
  soundcloud,
  bandcamp,
  twitch,
  vimeo,
  http,
];
export const ALL_PROVIDERS: MusicProvider[] = [...PLAYABLE_PROVIDERS, ...catalogOnly];
export const SEARCHABLE_PROVIDERS = PLAYABLE_PROVIDERS.filter((p) => p.capabilities.search);

export function getProvider(id: string): MusicProvider | undefined {
  return ALL_PROVIDERS.find((provider) => provider.id === id);
}

/** Encontra o provedor de um host. Domínios mais específicos têm prioridade (music.youtube.com > youtube.com). */
export function providerForHost(hostname: string): MusicProvider | undefined {
  const host = hostname.toLowerCase();
  let best: { provider: MusicProvider; length: number } | undefined;
  for (const provider of ALL_PROVIDERS) {
    for (const h of provider.hosts) {
      const matches = host === h || (provider.id === 'bandcamp' && host.endsWith(`.${h}`));
      if (matches && (!best || h.length > best.length)) best = { provider, length: h.length };
    }
  }
  return best?.provider;
}

/** Provedor correspondente a um sourceName do Lavalink. */
export function providerForSource(sourceName: string): MusicProvider | undefined {
  return PLAYABLE_PROVIDERS.find((provider) => provider.sourceManager === sourceName);
}

export function sourceLabel(sourceName: string): string {
  return providerForSource(sourceName)?.displayName ?? sourceName;
}
