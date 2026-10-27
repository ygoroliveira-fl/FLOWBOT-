import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type UrlCheck =
  | { ok: true; url: URL }
  | {
      ok: false;
      reason: 'invalid' | 'protocol' | 'credentials' | 'private_address' | 'dns_failed';
    };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;

/** Faz o parse e aplica as regras estáticas (sem DNS). */
export function parseUserUrl(input: string): UrlCheck {
  if (input.length > MAX_URL_LENGTH) return { ok: false, reason: 'invalid' };
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'protocol' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  const host = stripBrackets(url.hostname);
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, reason: 'private_address' };
  }
  if (isIP(host) && isPrivateAddress(host)) return { ok: false, reason: 'private_address' };
  // Nomes sem ponto (ex.: "postgres", "lavalink") resolvem para serviços internos do Compose.
  if (!isIP(host) && !host.includes('.')) return { ok: false, reason: 'private_address' };
  return { ok: true, url };
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Validação completa para URLs genéricas que o Lavalink vai buscar (proteção contra SSRF).
 * Todos os endereços resolvidos precisam ser públicos. Risco residual: DNS rebinding entre
 * esta verificação e a requisição feita pelo Lavalink — por isso streams HTTP genéricos ficam
 * desativados por padrão e o Lavalink deve rodar numa rede sem acesso a serviços sensíveis.
 */
export async function checkPublicUrl(
  input: string,
  resolver: Resolver = defaultResolver,
): Promise<UrlCheck> {
  const parsed = parseUserUrl(input);
  if (!parsed.ok) return parsed;
  const host = stripBrackets(parsed.url.hostname);
  if (isIP(host)) return parsed;
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    return { ok: false, reason: 'dns_failed' };
  }
  if (addresses.length === 0) return { ok: false, reason: 'dns_failed' };
  if (addresses.some(isPrivateAddress)) return { ok: false, reason: 'private_address' };
  return parsed;
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host.toLowerCase();
}

/** Endereços que não devem ser acessados a partir de entrada do usuário. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateV4(mapped[1]);
    if (lower === '::' || lower === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 (ULA)
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 (link-local)
    if (lower.startsWith('ff')) return true; // multicast
    if (lower.startsWith('64:ff9b:')) return true; // NAT64 pode mapear para IPv4 interno
    if (lower.startsWith('2001:db8:')) return true; // documentação
    return false;
  }
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadados de nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
