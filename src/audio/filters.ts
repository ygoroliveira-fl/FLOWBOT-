/**
 * Predefinições de filtros no formato do Lavalink v4 (PATCH /v4/sessions/{id}/players/{guild}).
 * Referência: https://lavalink.dev/api/rest#filters
 */
export const FILTER_PRESETS = {
  off: { label: 'Nenhum', description: 'Áudio original' },
  bassboost: { label: 'Graves reforçados', description: 'Realça frequências baixas' },
  nightcore: { label: 'Nightcore', description: 'Mais rápido e agudo' },
  vaporwave: { label: 'Vaporwave', description: 'Mais lento e grave' },
  eightd: { label: '8D', description: 'Áudio girando entre os canais' },
  karaoke: { label: 'Karaokê', description: 'Atenua a voz principal' },
  soft: { label: 'Suave', description: 'Corta agudos (passa-baixa)' },
} as const;

export type FilterPreset = keyof typeof FILTER_PRESETS;

export const FILTER_PRESET_IDS = Object.keys(FILTER_PRESETS) as FilterPreset[];

export interface LavalinkFilters {
  equalizer?: { band: number; gain: number }[];
  timescale?: { speed?: number; pitch?: number; rate?: number };
  rotation?: { rotationHz: number };
  karaoke?: { level: number; monoLevel: number; filterBand: number; filterWidth: number };
  lowPass?: { smoothing: number };
}

/**
 * Corpo de filtros completo para o preset. Sempre enviamos todos os campos para que o preset
 * anterior seja removido (o Lavalink substitui o objeto de filtros inteiro).
 */
export function buildFilters(preset: FilterPreset): LavalinkFilters {
  switch (preset) {
    case 'bassboost':
      return {
        equalizer: [0.2, 0.15, 0.1, 0.05, 0.0].map((gain, band) => ({ band, gain })),
      };
    case 'nightcore':
      return { timescale: { speed: 1.2, pitch: 1.2, rate: 1 } };
    case 'vaporwave':
      return {
        timescale: { speed: 0.85, pitch: 0.85, rate: 1 },
        equalizer: [
          { band: 0, gain: 0.15 },
          { band: 1, gain: 0.1 },
        ],
      };
    case 'eightd':
      return { rotation: { rotationHz: 0.2 } };
    case 'karaoke':
      return { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } };
    case 'soft':
      return { lowPass: { smoothing: 20 } };
    case 'off':
      return {};
  }
}

/** Fator de velocidade do preset (afeta a estimativa de posição exibida). */
export function playbackSpeed(preset: FilterPreset): number {
  return buildFilters(preset).timescale?.speed ?? 1;
}
