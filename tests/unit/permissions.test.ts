import { describe, expect, it } from 'vitest';
import {
  ACTION_LEVEL,
  authorize,
  Level,
  resolveLevel,
  type Action,
  type MemberContext,
  type PermissionSettings,
} from '../../src/permissions/permissions.js';

const settings: PermissionSettings = {
  djRoleId: 'dj',
  managerRoleId: 'mgr',
  controlMode: 'DJ',
  aloneIsDj: true,
};
const member = (overrides: Partial<MemberContext> = {}): MemberContext => ({
  userId: 'u',
  isAdmin: false,
  roleIds: new Set(),
  isAloneWithBot: false,
  ...overrides,
});

describe('permissões', () => {
  it('resolve níveis por cargo e administrador', () => {
    expect(resolveLevel(member(), settings)).toBe(Level.USER);
    expect(resolveLevel(member({ roleIds: new Set(['dj']) }), settings)).toBe(Level.DJ);
    expect(resolveLevel(member({ roleIds: new Set(['mgr', 'dj']) }), settings)).toBe(Level.MANAGER);
    expect(resolveLevel(member({ isAdmin: true }), settings)).toBe(Level.ADMIN);
  });

  it('cargo de DJ não configurado não concede DJ a ninguém', () => {
    expect(
      resolveLevel(member({ roleIds: new Set(['dj']) }), { ...settings, djRoleId: null }),
    ).toBe(Level.USER);
  });

  const matrix: [Action, Level][] = Object.entries(ACTION_LEVEL) as [Action, Level][];
  it.each(matrix)('ação %s exige o nível configurado no modo DJ', (action, required) => {
    for (const level of [Level.USER, Level.DJ, Level.MANAGER, Level.ADMIN]) {
      const m =
        level === Level.ADMIN
          ? member({ isAdmin: true })
          : level === Level.MANAGER
            ? member({ roleIds: new Set(['mgr']) })
            : level === Level.DJ
              ? member({ roleIds: new Set(['dj']) })
              : member();
      expect(authorize(action, m, settings).allowed).toBe(level >= required);
    }
  });

  it('usuário comum pode pedir músicas, ver a fila e pular/remover as próprias', () => {
    for (const action of ['play', 'view', 'join', 'skip.own', 'remove.own'] as Action[]) {
      expect(authorize(action, member(), settings).allowed).toBe(true);
    }
    for (const action of ['skip', 'stop', 'volume', 'clear', 'settings', 'djrole'] as Action[]) {
      expect(authorize(action, member(), settings).allowed).toBe(false);
    }
  });

  it('sozinho com o bot ganha controles de música, mas não configuração', () => {
    const alone = member({ isAloneWithBot: true });
    expect(authorize('stop', alone, settings).allowed).toBe(true);
    expect(authorize('settings', alone, settings).allowed).toBe(false);
    expect(authorize('stop', alone, { ...settings, aloneIsDj: false }).allowed).toBe(false);
  });

  it('modo EVERYONE libera controles de música para todos, mas não configurações', () => {
    const open = { ...settings, controlMode: 'EVERYONE' as const };
    expect(authorize('skip', member(), open).allowed).toBe(true);
    expect(authorize('stats', member(), open).allowed).toBe(false);
    expect(authorize('djrole', member({ roleIds: new Set(['mgr']) }), open).allowed).toBe(false);
  });

  it('nega por padrão quando o membro não pode ser verificado', () => {
    expect(authorize('skip', null, settings).allowed).toBe(false);
    expect(authorize('play', null, settings).allowed).toBe(false);
    expect(authorize('view', null, settings).allowed).toBe(true);
    expect(authorize('inexistente' as Action, member({ isAdmin: true }), settings).allowed).toBe(
      false,
    );
  });
});
