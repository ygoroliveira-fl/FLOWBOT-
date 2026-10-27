/**
 * Identidade visual "Aurora": tema escuro, azul profundo → violeta, detalhes em ciano.
 * As cores das embeds aparecem como a barra lateral; o restante usa texto com hierarquia.
 */
export const COLORS = {
  /** Violeta principal (tocando). */
  primary: 0x7c5cff,
  /** Azul profundo (fila, informação). */
  deep: 0x1e2a78,
  /** Ciano (sucesso, destaque). */
  accent: 0x22d3ee,
  /** Âmbar suave (pausado, aviso). */
  warn: 0xf5a524,
  /** Rosa-avermelhado (erro). */
  danger: 0xf0506e,
  /** Cinza-azulado (vazio/ocioso). */
  muted: 0x4b5675,
} as const;

/** Ícones Unicode usados com moderação; sempre acompanhados de texto. */
export const ICON = {
  playing: '▶',
  paused: '⏸',
  stopped: '■',
  next: '⏭',
  previous: '⏮',
  shuffle: '🔀',
  loopQueue: '🔁',
  loopTrack: '🔂',
  queue: '☰',
  volume: '🔊',
  success: '✓',
  error: '✕',
  warn: '!',
  live: '● AO VIVO',
  autoplay: '∞',
  dot: '·',
} as const;

export const BAR = { filled: '━', head: '●', empty: '─', width: 18 } as const;

export function parseAccent(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(value) ? value : COLORS.primary;
}
