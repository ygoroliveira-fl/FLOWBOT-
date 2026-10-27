import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface RecordedRequest {
  method: string;
  path: string;
  body: any;
  headers: IncomingMessage['headers'];
}

/**
 * Servidor que imita a API v4 do Lavalink (WebSocket + REST) o suficiente para testar o
 * LavalinkEngine sem Java/Lavalink real. Não reproduz áudio.
 */
export class MockLavalink {
  readonly requests: RecordedRequest[] = [];
  readonly wsHeaders: IncomingMessage['headers'][] = [];
  sessionId = 'mock-session';
  sourceManagers = ['youtube', 'soundcloud', 'bandcamp', 'twitch', 'vimeo', 'http'];
  loadResult: any = { loadType: 'empty', data: {} };
  private server!: Server;
  private wss!: WebSocketServer;
  private sockets = new Set<WebSocket>();
  port = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const body = raw ? JSON.parse(raw) : undefined;
        this.requests.push({
          method: req.method ?? 'GET',
          path: url.pathname + url.search,
          body,
          headers: req.headers,
        });
        if (req.headers.authorization !== 'senha-teste') {
          res.writeHead(401).end();
          return;
        }
        const json = (status: number, data: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(data));
        };
        if (url.pathname === '/v4/info') {
          return json(200, {
            version: {
              semver: '4.2.2',
              major: 4,
              minor: 2,
              patch: 2,
              preRelease: null,
              build: null,
            },
            buildTime: 0,
            git: { branch: 'main', commit: 'mock', commitTime: 0 },
            jvm: '17',
            lavaplayer: '2.2.6',
            sourceManagers: this.sourceManagers,
            filters: ['equalizer', 'timescale', 'rotation', 'karaoke', 'lowPass'],
            plugins: [{ name: 'youtube-plugin', version: '1.18.2' }],
          });
        }
        if (url.pathname === '/version') return res.writeHead(200).end('4.2.2');
        if (url.pathname === '/v4/stats') return json(200, this.stats());
        if (url.pathname === '/v4/loadtracks') return json(200, this.loadResult);
        const playerMatch = url.pathname.match(/^\/v4\/sessions\/([^/]+)\/players\/(\d+)$/);
        if (playerMatch) {
          if (req.method === 'DELETE') return res.writeHead(204).end();
          return json(200, {
            guildId: playerMatch[2],
            track: null,
            volume: body?.volume ?? 100,
            paused: body?.paused ?? false,
            state: { time: Date.now(), position: 0, connected: true, ping: 10 },
            voice: body?.voice ?? {},
            filters: body?.filters ?? {},
          });
        }
        if (/^\/v4\/sessions\/[^/]+$/.test(url.pathname))
          return json(200, { resuming: false, timeout: 60 });
        if (/^\/v4\/sessions\/[^/]+\/players$/.test(url.pathname)) return json(200, []);
        json(404, { error: 'not found' });
      });
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/v4/websocket' || req.headers.authorization !== 'senha-teste') {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wsHeaders.push(req.headers);
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.sockets.add(ws);
        ws.on('close', () => this.sockets.delete(ws));
        ws.send(JSON.stringify({ op: 'ready', resumed: false, sessionId: this.sessionId }));
        ws.send(JSON.stringify({ op: 'stats', ...this.stats() }));
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  private stats() {
    return {
      players: 1,
      playingPlayers: 1,
      uptime: 1000,
      memory: { free: 1, used: 2, allocated: 3, reservable: 4 },
      cpu: { cores: 2, systemLoad: 0.1, lavalinkLoad: 0.05 },
      frameStats: null,
    };
  }

  /** Envia um evento do protocolo v4 a todos os clientes conectados. */
  emit(payload: Record<string, unknown>): void {
    for (const ws of this.sockets) ws.send(JSON.stringify(payload));
  }

  dropConnections(): void {
    for (const ws of this.sockets) ws.terminate();
  }

  playerUpdates(guildId: string): any[] {
    return this.requests
      .filter((r) => r.method === 'PATCH' && r.path.includes(`/players/${guildId}`))
      .map((r) => r.body);
  }

  async stop(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    this.wss.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

export function lavalinkTrack(id: string, overrides: Record<string, unknown> = {}) {
  return {
    encoded: `QAAA${id}`,
    info: {
      identifier: id,
      isSeekable: true,
      author: 'Artista Mock',
      length: 200_000,
      isStream: false,
      position: 0,
      title: `Faixa ${id}`,
      uri: `https://www.youtube.com/watch?v=${id}`,
      artworkUrl: `https://i.ytimg.com/vi/${id}/hq.jpg`,
      isrc: null,
      sourceName: 'youtube',
      ...overrides,
    },
    pluginInfo: {},
    userData: {},
  };
}
