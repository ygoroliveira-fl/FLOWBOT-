/**
 * Autorização. Matriz completa em docs/COMMANDS.md#matriz-de-permissões.
 * Regras: verificação no momento da ação, nunca pelo estado visual do botão, e negação por
 * padrão quando algo não puder ser validado.
 */
export enum Level {
  USER = 0,
  DJ = 1,
  MANAGER = 2,
  ADMIN = 3,
}

export const LEVEL_LABEL: Record<Level, string> = {
  [Level.USER]: 'Usuário',
  [Level.DJ]: 'DJ',
  [Level.MANAGER]: 'Gerente do bot',
  [Level.ADMIN]: 'Administrador',
};

export type Action =
  | 'play'
  | 'view'
  | 'join'
  | 'skip'
  | 'skip.own'
  | 'pause'
  | 'stop'
  | 'leave'
  | 'previous'
  | 'volume'
  | 'shuffle'
  | 'loop'
  | 'remove'
  | 'remove.own'
  | 'move'
  | 'clear'
  | 'seek'
  | 'autoplay'
  | 'filters'
  | 'stats'
  | 'settings'
  | 'djrole';

/** Nível mínimo de cada ação quando o servidor está no modo DJ (padrão). */
export const ACTION_LEVEL: Record<Action, Level> = {
  play: Level.USER,
  view: Level.USER,
  join: Level.USER,
  'skip.own': Level.USER,
  'remove.own': Level.USER,
  skip: Level.DJ,
  pause: Level.DJ,
  stop: Level.DJ,
  leave: Level.DJ,
  previous: Level.DJ,
  volume: Level.DJ,
  shuffle: Level.DJ,
  loop: Level.DJ,
  remove: Level.DJ,
  move: Level.DJ,
  clear: Level.DJ,
  seek: Level.DJ,
  autoplay: Level.DJ,
  filters: Level.DJ,
  stats: Level.MANAGER,
  settings: Level.MANAGER,
  djrole: Level.ADMIN,
};

/** Ações de controle musical que o modo EVERYONE libera para qualquer ouvinte. */
const MUSIC_CONTROL: ReadonlySet<Action> = new Set<Action>([
  'skip',
  'pause',
  'stop',
  'leave',
  'previous',
  'volume',
  'shuffle',
  'loop',
  'remove',
  'move',
  'clear',
  'seek',
  'autoplay',
  'filters',
]);

export interface PermissionSettings {
  djRoleId: string | null;
  managerRoleId: string | null;
  controlMode: 'EVERYONE' | 'DJ';
  aloneIsDj: boolean;
}

export interface MemberContext {
  userId: string;
  /** Dono do servidor, permissão Administrator ou ManageGuild (verificados no Discord). */
  isAdmin: boolean;
  roleIds: ReadonlySet<string>;
  /** É o único humano no canal de voz junto com o bot. */
  isAloneWithBot: boolean;
}

export function resolveLevel(member: MemberContext, settings: PermissionSettings): Level {
  if (member.isAdmin) return Level.ADMIN;
  if (settings.managerRoleId && member.roleIds.has(settings.managerRoleId)) return Level.MANAGER;
  if (settings.djRoleId && member.roleIds.has(settings.djRoleId)) return Level.DJ;
  return Level.USER;
}

export interface Decision {
  allowed: boolean;
  required: Level;
  actual: Level;
}

export function authorize(
  action: Action,
  member: MemberContext | null,
  settings: PermissionSettings,
): Decision {
  const configured = ACTION_LEVEL[action];
  // Ação desconhecida ou membro não verificável: nega (exceto leitura pura).
  if (configured === undefined)
    return { allowed: false, required: Level.ADMIN, actual: Level.USER };
  if (!member) {
    return {
      allowed: configured === Level.USER && action === 'view',
      required: configured,
      actual: Level.USER,
    };
  }

  const actual = resolveLevel(member, settings);
  let required = configured;
  if (MUSIC_CONTROL.has(action)) {
    if (settings.controlMode === 'EVERYONE') required = Level.USER;
    else if (settings.aloneIsDj && member.isAloneWithBot) required = Level.USER;
  }
  return { allowed: actual >= required, required, actual };
}

export function denialMessage(decision: Decision): string {
  if (decision.required === Level.DJ) {
    return 'Somente DJs podem fazer isso. Peça a um administrador o cargo de DJ ou fique sozinho no canal com o bot.';
  }
  return `Esta ação exige o nível **${LEVEL_LABEL[decision.required]}**.`;
}
