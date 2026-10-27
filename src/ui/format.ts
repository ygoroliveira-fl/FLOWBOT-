import { BAR } from './theme.js';

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Aceita "90", "1:30", "01:02:03". Retorna ms ou null. */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,5}(:\d{1,2}){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  const seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
  return seconds * 1000;
}

/**
 * Barra de progresso aproximada. A posição vem da estimativa do cliente Lavalink (último
 * playerUpdate + tempo decorrido), então pode divergir alguns segundos — por isso o painel
 * mostra "≈" e não é atualizado em tempo real.
 */
export function progressBar(
  positionMs: number,
  durationMs: number,
  width: number = BAR.width,
): string {
  if (durationMs <= 0) return BAR.empty.repeat(width);
  const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
  const head = Math.min(width - 1, Math.round(ratio * (width - 1)));
  return BAR.filled.repeat(head) + BAR.head + BAR.empty.repeat(width - head - 1);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/** Escapa markdown e neutraliza menções em textos vindos de fontes externas. */
export function safeText(text: string, max = 256): string {
  const escaped = text
    .replace(/([\\*_`~|>[\]()#-])/g, '\\$1')
    .replace(/@/g, '@​')
    .replace(/<(?=[@#:&!a])/g, '<​')
    .replace(/\n+/g, ' ');
  return truncate(escaped, max);
}

/** Link markdown seguro (só http/https). */
export function trackLink(title: string, uri: string | null, max = 80): string {
  const label = safeText(title, max);
  if (!uri) return `**${label}**`;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return `**${label}**`;
    return `**[${label}](${url.href.replace(/\)/g, '%29')})**`;
  } catch {
    return `**${label}**`;
  }
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
