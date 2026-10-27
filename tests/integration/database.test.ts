import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/data/audit.js';
import type { Database } from '../../src/data/db.js';
import { pingDatabase } from '../../src/data/db.js';
import { GuildSettingsService } from '../../src/data/guildSettings.js';
import { applyRetention, HistoryService } from '../../src/data/history.js';
import { PlaylistService, playlistTrackToTrack } from '../../src/data/playlists.js';
import { PrismaPanelStore } from '../../src/discord/adapters.js';
import { makeTrack } from '../helpers/fakes.js';
import { resetDatabase, TEST_DATABASE_URL, truncateAll } from './db.js';

describe.skipIf(!TEST_DATABASE_URL)('PostgreSQL (integração)', () => {
  let db: Database;
  let playlists: PlaylistService;
  let settings: GuildSettingsService;
  let history: HistoryService;

  beforeAll(async () => {
    db = await resetDatabase();
    const audit = new AuditService(db);
    settings = new GuildSettingsService(db, audit, 1000);
    playlists = new PlaylistService(db, { maxPlaylistsPerUser: 3, maxTracksPerPlaylist: 5 });
    history = new HistoryService(db);
  });
  afterAll(async () => db?.$disconnect());
  beforeEach(async () => truncateAll(db));

  it('migrações aplicadas e conexão saudável', async () => {
    expect(await pingDatabase(db)).toBeGreaterThanOrEqual(0);
    const rows = await db.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('configurações: cria padrões, valida limites e registra auditoria', async () => {
    const initial = await settings.get('g1');
    expect(initial.controlMode).toBe('DJ');
    expect(initial.defaultVolume).toBe(80);
    const updated = await settings.update('g1', 'admin', {
      defaultVolume: 999,
      inactivityTimeoutSec: 1,
      maxQueueSize: 99999,
      djRoleId: '123',
    });
    expect(updated.defaultVolume).toBe(200);
    expect(updated.inactivityTimeoutSec).toBe(30);
    expect(updated.maxQueueSize).toBe(1000);
    const audit = await db.auditLog.findMany({ where: { guildId: 'g1' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('settings.update');
  });

  it('configurações sobrevivem a um novo cliente (reinício)', async () => {
    await settings.update('g2', 'admin', { autoplay: true });
    const fresh = new GuildSettingsService(db, new AuditService(db), 1000);
    expect((await fresh.get('g2')).autoplay).toBe(true);
  });

  it('playlists: criação, unicidade por dono, limite e validação de nome', async () => {
    await playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'Rock  Nacional' });
    await expect(
      playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'rock nacional' }),
    ).rejects.toThrow('já tem');
    await expect(
      playlists.create({ ownerId: 'u1', guildId: 'g1', name: '@everyone' }),
    ).rejects.toThrow('menções');
    await expect(playlists.create({ ownerId: 'u1', guildId: 'g1', name: '   ' })).rejects.toThrow(
      'entre 1 e',
    );
    await playlists.create({ ownerId: 'u2', guildId: 'g1', name: 'Rock Nacional' }); // outro dono: ok
    await playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'B' });
    await playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'C' });
    await expect(playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'D' })).rejects.toThrow(
      'limite de 3',
    );
  });

  it('playlists: adicionar respeita limite e ordem; remover compacta posições', async () => {
    const p = await playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'Mix' });
    const tracks = Array.from({ length: 7 }, (_, i) => makeTrack({ title: `T${i}` }));
    const out = await playlists.addTracks(p.id, 'u1', 'g1', tracks);
    expect(out.added).toBe(5);
    expect(out.skipped).toBe(2);
    await expect(playlists.addTracks(p.id, 'u1', 'g1', [makeTrack()])).rejects.toThrow(
      'limite de 5',
    );
    await playlists.removeTrack('Mix', 'u1', 'g1', 2);
    const rows = await playlists.getTracks(p.id);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.title)).toEqual(['T0', 'T2', 'T3', 'T4']);
    expect(playlistTrackToTrack(rows[0]!).encoded).toBe(tracks[0]!.encoded);
    await expect(playlists.removeTrack('Mix', 'u1', 'g1', 10)).rejects.toThrow('posição 10');
  });

  it('playlists: adições concorrentes não duplicam posições', async () => {
    const big = new PlaylistService(db, { maxPlaylistsPerUser: 5, maxTracksPerPlaylist: 100 });
    const p = await big.create({ ownerId: 'u1', guildId: 'g1', name: 'Concorrência' });
    await Promise.all(
      Array.from({ length: 10 }, () => big.addTracks(p.id, 'u1', 'g1', [makeTrack(), makeTrack()])),
    );
    const rows = await big.getTracks(p.id);
    expect(rows).toHaveLength(20);
    expect(rows.map((r) => r.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('playlists: regras de acesso privada x compartilhada', async () => {
    const p = await playlists.create({ ownerId: 'dono', guildId: 'g1', name: 'Segredo' });
    await expect(playlists.findAccessible(p.id, 'outro', 'g1')).rejects.toThrow('não encontrada');
    await playlists.setVisibility(p.id, 'dono', 'g1', 'GUILD');
    expect((await playlists.findAccessible('Segredo', 'outro', 'g1')).id).toBe(p.id);
    await expect(playlists.findAccessible(p.id, 'outro', 'g2')).rejects.toThrow('não encontrada');
    await expect(playlists.addTracks(p.id, 'outro', 'g1', [makeTrack()])).rejects.toThrow(
      'Só o dono',
    );
    await expect(playlists.delete(p.id, 'outro', 'g1')).rejects.toThrow('Só o dono');
    const listed = await playlists.listAccessible('outro', 'g1');
    expect(listed.map((l) => l.name)).toEqual(['Segredo']);
  });

  it('playlists: renomear e apagar em cascata', async () => {
    const p = await playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'Antiga' });
    await playlists.addTracks(p.id, 'u1', 'g1', [makeTrack()]);
    await playlists.create({ ownerId: 'u1', guildId: 'g1', name: 'Outra' });
    await expect(playlists.rename(p.id, 'u1', 'g1', 'outra')).rejects.toThrow('já tem');
    expect((await playlists.rename(p.id, 'u1', 'g1', 'Nova')).name).toBe('Nova');
    await playlists.delete(p.id, 'u1', 'g1');
    expect(await db.playlistTrack.count()).toBe(0);
  });

  it('histórico, estatísticas e retenção', async () => {
    await settings.get('g1');
    const t = makeTrack({ title: 'Hit', durationMs: 1000 });
    await history.record('g1', 'u1', t);
    await history.record('g1', 'u2', t);
    await history.record('g1', 'u1', makeTrack({ title: 'Outra', durationMs: 500 }));
    const stats = await history.stats('g1');
    expect(stats.totalPlays).toBe(3);
    expect(stats.uniqueListeners).toBe(2);
    expect(stats.totalListenedMs).toBe(2500);
    expect(stats.topTracks[0]).toMatchObject({ title: 'Hit', plays: 2 });
    await db.playHistory.updateMany({
      where: { title: 'Outra' },
      data: { playedAt: new Date(Date.now() - 100 * 86_400_000) },
    });
    const removed = await applyRetention(db, { historyDays: 90, auditDays: 180 });
    expect(removed.history).toBe(1);
    expect(await db.playHistory.count()).toBe(2);
  });

  it('estado do painel persistido', async () => {
    const store = new PrismaPanelStore(db);
    await store.set('g1', 'c1', 'm1');
    await store.set('g1', 'c1', 'm2');
    expect(await store.get('g1')).toEqual({ channelId: 'c1', messageId: 'm2' });
    await store.clear('g1');
    expect(await store.get('g1')).toBeNull();
  });

  it('exclusão de dados do usuário', async () => {
    await playlists.create({ ownerId: 'u9', guildId: 'g1', name: 'X' });
    expect(await playlists.deleteAllForUser('u9')).toBe(1);
  });
});
