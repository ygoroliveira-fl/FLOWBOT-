import type { Database } from './db.js';
import type { Playlist, PlaylistTrack, PlaylistVisibility } from '../generated/prisma/client.js';
import { NotFoundError, PermissionDeniedError, UserError } from '../core/errors.js';
import type { Track } from '../music/types.js';

export type { Playlist, PlaylistTrack };

export const PLAYLIST_NAME_MAX = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlaylistLimits {
  maxPlaylistsPerUser: number;
  maxTracksPerPlaylist: number;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  ownerId: string;
  visibility: PlaylistVisibility;
  trackCount: number;
  updatedAt: Date;
}

export function normalizePlaylistName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Valida e limpa o nome: sem menções, sem caracteres de controle, 1–64 caracteres. */
export function validatePlaylistName(raw: string): string {
  const name = [...raw.normalize('NFKC')]
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > PLAYLIST_NAME_MAX) {
    throw new UserError(`O nome deve ter entre 1 e ${PLAYLIST_NAME_MAX} caracteres.`);
  }
  if (/[@#]|<[@#:&!]/.test(name) || /```/.test(name)) {
    throw new UserError('O nome não pode conter menções, # ou blocos de código.');
  }
  return name;
}

/**
 * Playlists persistentes. Regras de acesso:
 * - PRIVATE: só o dono vê, toca e edita.
 * - GUILD: membros do servidor associado veem e tocam; só o dono edita/apaga.
 */
export class PlaylistService {
  constructor(
    private readonly db: Database,
    private readonly limits: PlaylistLimits,
  ) {}

  async create(input: {
    ownerId: string;
    guildId: string;
    name: string;
    visibility?: PlaylistVisibility;
  }): Promise<Playlist> {
    const name = validatePlaylistName(input.name);
    const nameNormalized = normalizePlaylistName(name);
    return this.db.$transaction(async (tx) => {
      const count = await tx.playlist.count({ where: { ownerId: input.ownerId } });
      if (count >= this.limits.maxPlaylistsPerUser) {
        throw new UserError(
          `Você atingiu o limite de ${this.limits.maxPlaylistsPerUser} playlists.`,
        );
      }
      const existing = await tx.playlist.findUnique({
        where: { ownerId_nameNormalized: { ownerId: input.ownerId, nameNormalized } },
      });
      if (existing) throw new UserError(`Você já tem uma playlist chamada **${existing.name}**.`);
      await tx.guildSettings.upsert({
        where: { guildId: input.guildId },
        create: { guildId: input.guildId },
        update: {},
      });
      return tx.playlist.create({
        data: {
          name,
          nameNormalized,
          ownerId: input.ownerId,
          guildId: input.guildId,
          visibility: input.visibility ?? 'PRIVATE',
        },
      });
    });
  }

  /** Playlists do usuário e as compartilhadas no servidor atual. */
  async listAccessible(userId: string, guildId: string, search = ''): Promise<PlaylistSummary[]> {
    const normalized = normalizePlaylistName(search);
    const rows = await this.db.playlist.findMany({
      where: {
        OR: [{ ownerId: userId }, { guildId, visibility: 'GUILD' }],
        ...(normalized ? { nameNormalized: { contains: normalized } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
      include: { _count: { select: { tracks: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      visibility: row.visibility,
      trackCount: row._count.tracks,
      updatedAt: row.updatedAt,
    }));
  }

  /** Busca por id (do autocomplete) ou nome; aplica as regras de leitura. */
  async findAccessible(ref: string, userId: string, guildId: string): Promise<Playlist> {
    const trimmed = ref.trim();
    let playlist: Playlist | null;
    if (UUID_RE.test(trimmed)) {
      playlist = await this.db.playlist.findUnique({ where: { id: trimmed } });
    } else {
      const nameNormalized = normalizePlaylistName(trimmed);
      playlist =
        (await this.db.playlist.findUnique({
          where: { ownerId_nameNormalized: { ownerId: userId, nameNormalized } },
        })) ??
        (await this.db.playlist.findFirst({
          where: { guildId, visibility: 'GUILD', nameNormalized },
          orderBy: { updatedAt: 'desc' },
        }));
    }
    if (!playlist || !this.canRead(playlist, userId, guildId)) {
      throw new NotFoundError('Playlist não encontrada.');
    }
    return playlist;
  }

  canRead(playlist: Playlist, userId: string, guildId: string): boolean {
    return (
      playlist.ownerId === userId ||
      (playlist.visibility === 'GUILD' && playlist.guildId === guildId)
    );
  }

  private async findOwned(ref: string, userId: string, guildId: string): Promise<Playlist> {
    const playlist = await this.findAccessible(ref, userId, guildId);
    if (playlist.ownerId !== userId)
      throw new PermissionDeniedError('Só o dono pode alterar esta playlist.');
    return playlist;
  }

  async getTracks(
    playlistId: string,
    page?: { skip: number; take: number },
  ): Promise<PlaylistTrack[]> {
    return this.db.playlistTrack.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
      ...(page ? { skip: page.skip, take: page.take } : {}),
    });
  }

  async countTracks(playlistId: string): Promise<number> {
    return this.db.playlistTrack.count({ where: { playlistId } });
  }

  /** Adiciona faixas ao final, respeitando o limite. Retorna quantas entraram. */
  async addTracks(
    ref: string,
    userId: string,
    guildId: string,
    tracks: Track[],
  ): Promise<{ playlist: Playlist; added: number; skipped: number }> {
    const owned = await this.findOwned(ref, userId, guildId);
    const valid = tracks.filter((t) => t.encoded && t.encoded.length < 20_000);
    return this.db.$transaction(async (tx) => {
      // Trava a playlist para que adições concorrentes não disputem as mesmas posições.
      await tx.$queryRaw`SELECT id FROM "Playlist" WHERE id = ${owned.id}::uuid FOR UPDATE`;
      const count = await tx.playlistTrack.count({ where: { playlistId: owned.id } });
      const room = Math.max(0, this.limits.maxTracksPerPlaylist - count);
      if (room === 0)
        throw new UserError(
          `A playlist atingiu o limite de ${this.limits.maxTracksPerPlaylist} faixas.`,
        );
      const toAdd = valid.slice(0, room);
      await tx.playlistTrack.createMany({
        data: toAdd.map((track, index) => ({
          playlistId: owned.id,
          position: count + index + 1,
          encoded: track.encoded,
          identifier: track.identifier.slice(0, 512),
          title: track.title.slice(0, 256),
          author: track.author.slice(0, 256),
          uri: track.uri?.slice(0, 1024) ?? null,
          sourceName: track.sourceName.slice(0, 32),
          durationMs: Math.min(2_147_483_647, Math.max(0, Math.round(track.durationMs))),
          isStream: track.isStream,
          artworkUrl: track.artworkUrl?.slice(0, 1024) ?? null,
        })),
      });
      const playlist = await tx.playlist.update({
        where: { id: owned.id },
        data: { updatedAt: new Date() },
      });
      return { playlist, added: toAdd.length, skipped: tracks.length - toAdd.length };
    });
  }

  /** Remove a faixa na posição (1-based) e compacta as posições seguintes. */
  async removeTrack(
    ref: string,
    userId: string,
    guildId: string,
    position: number,
  ): Promise<PlaylistTrack> {
    const owned = await this.findOwned(ref, userId, guildId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Playlist" WHERE id = ${owned.id}::uuid FOR UPDATE`;
      const track = await tx.playlistTrack.findUnique({
        where: { playlistId_position: { playlistId: owned.id, position } },
      });
      if (!track) throw new NotFoundError(`Não existe faixa na posição ${position}.`);
      await tx.playlistTrack.delete({ where: { id: track.id } });
      // Duas etapas (desloca para uma faixa alta e volta) para não violar
      // UNIQUE(playlistId, position) nem o CHECK position >= 1 durante a atualização.
      await tx.$executeRaw`UPDATE "PlaylistTrack" SET position = position + 1000000 WHERE "playlistId" = ${owned.id}::uuid AND position > ${position}`;
      await tx.$executeRaw`UPDATE "PlaylistTrack" SET position = position - 1000001 WHERE "playlistId" = ${owned.id}::uuid AND position > 1000000`;
      await tx.playlist.update({ where: { id: owned.id }, data: { updatedAt: new Date() } });
      return track;
    });
  }

  async rename(ref: string, userId: string, guildId: string, newName: string): Promise<Playlist> {
    const owned = await this.findOwned(ref, userId, guildId);
    const name = validatePlaylistName(newName);
    const nameNormalized = normalizePlaylistName(name);
    const clash = await this.db.playlist.findUnique({
      where: { ownerId_nameNormalized: { ownerId: userId, nameNormalized } },
    });
    if (clash && clash.id !== owned.id)
      throw new UserError(`Você já tem uma playlist chamada **${clash.name}**.`);
    return this.db.playlist.update({ where: { id: owned.id }, data: { name, nameNormalized } });
  }

  async setVisibility(
    ref: string,
    userId: string,
    guildId: string,
    visibility: PlaylistVisibility,
  ): Promise<Playlist> {
    const owned = await this.findOwned(ref, userId, guildId);
    // Compartilhar vincula a playlist ao servidor atual.
    return this.db.playlist.update({
      where: { id: owned.id },
      data: { visibility, ...(visibility === 'GUILD' ? { guildId } : {}) },
    });
  }

  async delete(ref: string, userId: string, guildId: string): Promise<Playlist> {
    const owned = await this.findOwned(ref, userId, guildId);
    await this.db.playlist.delete({ where: { id: owned.id } });
    return owned;
  }

  /** Exclusão de dados a pedido do usuário. */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await this.db.playlist.deleteMany({ where: { ownerId: userId } });
    return result.count;
  }
}

export function playlistTrackToTrack(row: PlaylistTrack): Track {
  return {
    encoded: row.encoded,
    identifier: row.identifier,
    title: row.title,
    author: row.author,
    uri: row.uri,
    sourceName: row.sourceName,
    durationMs: row.durationMs,
    isStream: row.isStream,
    isSeekable: !row.isStream,
    artworkUrl: row.artworkUrl,
    isrc: null,
  };
}
