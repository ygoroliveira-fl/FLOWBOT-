import { describe, expect, it } from 'vitest';
import { checkPublicUrl, isPrivateAddress, parseUserUrl } from '../../src/providers/urlSafety.js';

describe('proteção contra SSRF', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('%s é privado', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s é público',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );

  it('rejeita protocolos, credenciais, hosts internos e URLs longas', () => {
    expect(parseUserUrl('ftp://example.com/a.mp3')).toMatchObject({
      ok: false,
      reason: 'protocol',
    });
    expect(parseUserUrl('file:///etc/passwd')).toMatchObject({ ok: false, reason: 'protocol' });
    expect(parseUserUrl('http://user:pw@example.com/')).toMatchObject({
      ok: false,
      reason: 'credentials',
    });
    expect(parseUserUrl('http://localhost:2333/version')).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect(parseUserUrl('http://postgres:5432/')).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect(parseUserUrl('http://lavalink:2333/')).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect(parseUserUrl('http://[::1]/')).toMatchObject({ ok: false, reason: 'private_address' });
    expect(parseUserUrl('http://169.254.169.254/latest/meta-data')).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect(parseUserUrl('http://metadata.google.internal/')).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect(parseUserUrl(`https://example.com/${'a'.repeat(3000)}`)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(parseUserUrl('https://radio.example.com/stream.mp3').ok).toBe(true);
  });

  it('bloqueia hosts que resolvem para endereços privados (DNS)', async () => {
    const resolver = async (host: string) =>
      host === 'evil.example.com' ? ['8.8.8.8', '10.0.0.5'] : ['93.184.216.34'];
    expect(await checkPublicUrl('https://evil.example.com/a.mp3', resolver)).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect((await checkPublicUrl('https://good.example.com/a.mp3', resolver)).ok).toBe(true);
    expect(
      await checkPublicUrl('https://x.example.com', async () => {
        throw new Error('nx');
      }),
    ).toMatchObject({ ok: false, reason: 'dns_failed' });
    expect(await checkPublicUrl('https://x.example.com', async () => [])).toMatchObject({
      ok: false,
      reason: 'dns_failed',
    });
  });
});
