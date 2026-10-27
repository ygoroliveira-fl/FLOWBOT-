import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PanelGoneError,
  PanelManager,
  type PanelPayload,
  type PanelStore,
  type PanelTransport,
} from '../../src/ui/panelManager.js';
import { makeSession, makeTrack, silentLogger } from '../helpers/fakes.js';

class FakeTransport implements PanelTransport {
  sent: PanelPayload[] = [];
  edits: { messageId: string; payload: PanelPayload }[] = [];
  gone = new Set<string>();
  notices = 0;
  private next = 1;
  async send(_channelId: string, payload: PanelPayload) {
    this.sent.push(payload);
    return `m${this.next++}`;
  }
  async edit(_channelId: string, messageId: string, payload: PanelPayload) {
    if (this.gone.has(messageId)) throw new PanelGoneError();
    this.edits.push({ messageId, payload });
  }
  async notice() {
    this.notices++;
  }
}

class MemoryStore implements PanelStore {
  rows = new Map<string, { channelId: string; messageId: string }>();
  async get(g: string) {
    return this.rows.get(g) ?? null;
  }
  async set(g: string, channelId: string, messageId: string) {
    this.rows.set(g, { channelId, messageId });
  }
  async clear(g: string) {
    this.rows.delete(g);
  }
}

const brand = { name: 'Aurora', accent: 1 };
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('PanelManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(store = new MemoryStore()) {
    const transport = new FakeTransport();
    const panels = new PanelManager(transport, store, brand, silentLogger, {
      minIntervalMs: 2000,
      tickMs: 15_000,
      resolveChannel: async () => 'c1',
    });
    return { transport, store, panels };
  }

  it('cria uma única mensagem e agrupa atualizações em rajada', async () => {
    const { transport, panels, store } = setup();
    const { session } = await makeSession();
    await session.enqueue([makeTrack(), makeTrack()], 'u');
    panels.schedule(session);
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.sent).toHaveLength(1);
    expect(store.rows.get('g1')?.messageId).toBe('m1');
    for (let i = 0; i < 20; i++) panels.schedule(session);
    await vi.advanceTimersByTimeAsync(2100);
    expect(transport.sent).toHaveLength(1);
    expect(transport.edits).toHaveLength(1);
  });

  it('recria o painel se a mensagem foi apagada', async () => {
    const { transport, panels } = setup();
    const { session } = await makeSession();
    await session.enqueue([makeTrack()], 'u');
    panels.schedule(session);
    await vi.advanceTimersByTimeAsync(10);
    transport.gone.add('m1');
    panels.schedule(session);
    await vi.advanceTimersByTimeAsync(2100);
    expect(transport.sent).toHaveLength(2);
  });

  it('reaproveita a mensagem salva após reinício', async () => {
    const store = new MemoryStore();
    store.rows.set('g1', { channelId: 'c1', messageId: 'antiga' });
    const { transport, panels } = setup(store);
    const { session } = await makeSession();
    await session.enqueue([makeTrack()], 'u');
    panels.schedule(session);
    await vi.advanceTimersByTimeAsync(10);
    expect(transport.sent).toHaveLength(0);
    expect(transport.edits[0]?.messageId).toBe('antiga');
  });

  it('atualiza a barra periodicamente só enquanto toca', async () => {
    const { transport, panels } = setup();
    const { session } = await makeSession();
    await session.enqueue([makeTrack()], 'u');
    panels.schedule(session);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(31_000);
    const whilePlaying = transport.edits.length;
    expect(whilePlaying).toBeGreaterThanOrEqual(2);
    await session.setPaused(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.edits.length).toBe(whilePlaying);
  });

  it('ao encerrar, congela o painel sem botões e limpa o registro', async () => {
    const { transport, panels, store } = setup();
    const { session } = await makeSession();
    await session.enqueue([makeTrack()], 'u');
    panels.schedule(session);
    await vi.advanceTimersByTimeAsync(10);
    await panels.close('g1', 'Fim');
    await flush();
    const last = transport.edits.at(-1)!;
    expect(last.payload.components).toHaveLength(0);
    expect(store.rows.has('g1')).toBe(false);
    expect(panels.activeCount).toBe(0);
  });

  it('painéis antigos são encerrados no início', async () => {
    const { transport, panels, store } = setup();
    store.rows.set('g9', { channelId: 'c', messageId: 'velha' });
    await panels.closeStale([{ guildId: 'g9', channelId: 'c', messageId: 'velha' }]);
    expect(transport.edits[0]?.payload.components).toEqual([]);
    expect(store.rows.size).toBe(0);
  });
});
