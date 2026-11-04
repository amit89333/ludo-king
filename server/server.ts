import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MiniWebSocketServer } from './ws.ts';
import type { CustomWebSocket } from './ws.ts';
import { Room } from './room.ts';
import type { PlayerColor } from '../shared/game/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');
const SHARED_DIR = path.resolve(ROOT_DIR, 'shared');

function sanitizeName(name: string): string {
  if (!name || typeof name !== 'string') return 'Player';
  return name.replace(/[<>&"']/g, '').trim().substring(0, 16) || 'Player';
}

export class LudoServer {
  public server: http.Server;
  public wsServer: MiniWebSocketServer;
  public rooms: Map<string, Room> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.server = http.createServer(this.handleHttpRequest.bind(this));
    this.wsServer = new MiniWebSocketServer(this.server);
    this.setupWebSocket();
    this.setupCleanup();
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return this.rooms.has(code) ? this.generateRoomCode() : code;
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Health check endpoint
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', rooms: this.rooms.size, uptime: process.uptime() }));
      return;
    }

    // Allow serving shared coords.js or game modules if requested
    let filePath: string;
    if (pathname.startsWith('/shared/')) {
      filePath = path.join(SHARED_DIR, pathname.replace('/shared/', ''));
    } else {
      filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    }

    // Normalize and prevent path traversal
    if (!filePath.startsWith(PUBLIC_DIR) && !filePath.startsWith(SHARED_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  }

  private setupWebSocket(): void {
    this.wsServer.on('connection', (ws: CustomWebSocket) => {
      let currentRoomCode: string | null = null;
      let currentPlayerId: string | null = null;

      ws.on('message', (data: string) => {
        try {
          const msg = JSON.parse(data);
          const { type, payload } = msg;

          switch (type) {
            case 'TIME_SYNC': {
              ws.send(
                JSON.stringify({
                  type: 'TIME_SYNC_RESP',
                  payload: {
                    clientSendTime: payload?.clientSendTime || 0,
                    serverNow: Date.now(),
                  },
                })
              );
              break;
            }

            case 'CREATE_ROOM': {
              const code = this.generateRoomCode();
              const room = new Room(code);
              room.onEmptyRoomCleanup = (c) => this.rooms.delete(c);
              this.rooms.set(code, room);

              currentRoomCode = code;
              currentPlayerId = payload.playerId;
              const safeName = sanitizeName(payload.playerName);

              const player = room.addPlayer(
                payload.playerId,
                safeName,
                ws,
                payload.avatarEmoji || '😎'
              );

              ws.send(
                JSON.stringify({
                  type: 'ROOM_CREATED',
                  payload: {
                    code,
                    player: {
                      id: player.id,
                      name: player.name,
                      avatarEmoji: player.avatarEmoji,
                      color: player.color,
                      isHost: player.isHost,
                    },
                    roomState: room.getClientState(player.id),
                  },
                })
              );
              room.broadcastState();
              break;
            }

            case 'JOIN_ROOM': {
              const targetCode = (payload.code || '').trim().toUpperCase();
              const room = this.rooms.get(targetCode);
              if (!room) {
                ws.send(
                  JSON.stringify({
                    type: 'ERROR',
                    payload: { message: `Room ${targetCode} does not exist.` },
                  })
                );
                return;
              }

              try {
                const safeName = sanitizeName(payload.playerName);
                const player = room.addPlayer(
                  payload.playerId,
                  safeName,
                  ws,
                  payload.avatarEmoji || '😎'
                );
                currentRoomCode = targetCode;
                currentPlayerId = payload.playerId;

                ws.send(
                  JSON.stringify({
                    type: 'ROOM_JOINED',
                    payload: {
                      code: targetCode,
                      player: {
                        id: player.id,
                        name: player.name,
                        avatarEmoji: player.avatarEmoji,
                        color: player.color,
                        isHost: player.isHost,
                      },
                      roomState: room.getClientState(player.id),
                    },
                  })
                );
                room.broadcastState();
              } catch (err: any) {
                ws.send(
                  JSON.stringify({
                    type: 'ERROR',
                    payload: { message: err.message || 'Failed to join room.' },
                  })
                );
              }
              break;
            }

            case 'TOGGLE_BOT': {
              if (!currentRoomCode) return;
              const room = this.rooms.get(currentRoomCode);
              if (!room) return;

              const requestingPlayer = room.players.get(payload.playerId);
              if (!requestingPlayer || !requestingPlayer.isHost) {
                ws.send(
                  JSON.stringify({
                    type: 'ERROR',
                    payload: { message: 'Only host can toggle bot players.' },
                  })
                );
                return;
              }

              room.toggleBot(payload.color as PlayerColor);
              break;
            }

            case 'START_GAME': {
              if (!currentRoomCode) return;
              const room = this.rooms.get(currentRoomCode);
              if (!room) return;

              try {
                room.startGame(payload.playerId);
              } catch (err: any) {
                ws.send(
                  JSON.stringify({
                    type: 'ERROR',
                    payload: { message: err.message || 'Cannot start game.' },
                  })
                );
              }
              break;
            }

            case 'ROLL_DICE': {
              if (!currentRoomCode) return;
              const room = this.rooms.get(currentRoomCode);
              if (!room) return;

              try {
                room.handleRoll(payload.playerId);
              } catch (err: any) {
                ws.send(
                  JSON.stringify({
                    type: 'ERROR',
                    payload: { message: err.message },
                  })
                );
              }
              break;
            }

            case 'MOVE_TOKEN': {
              if (!currentRoomCode) return;
              const room = this.rooms.get(currentRoomCode);
              if (!room) return;

              try {
                room.handleMove(payload.playerId, payload.tokenId);
              } catch (err: any) {
                ws.send(
                  JSON.stringify({
                    type: 'ERROR',
                    payload: { message: err.message },
                  })
                );
              }
              break;
            }

            case 'LEAVE_MATCH': {
              if (!currentRoomCode) return;
              const room = this.rooms.get(currentRoomCode);
              if (!room) return;
              room.handlePlayerLeave(payload.playerId);
              break;
            }

            case 'EMOJI': {
              if (!currentRoomCode) return;
              const room = this.rooms.get(currentRoomCode);
              if (!room) return;
              try {
                room.handleEmoji(payload.playerId, payload.to, payload.emoji);
              } catch (e: any) {
                // disallowed emoji or rate limited
              }
              break;
            }

            default:
              break;
          }
        } catch (e: any) {
          ws.send(
            JSON.stringify({
              type: 'ERROR',
              payload: { message: 'Invalid message payload' },
            })
          );
        }
      });

      ws.on('close', () => {
        if (currentRoomCode && currentPlayerId) {
          const room = this.rooms.get(currentRoomCode);
          if (room) {
            room.handlePlayerDisconnect(currentPlayerId);
          }
        }
      });
    });
  }

  private setupCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [code, room] of this.rooms.entries()) {
        const humanCount = Array.from(room.players.values()).filter(
          (p) => !p.isBot && p.connected
        ).length;
        // Inactive if empty for > 5 minutes
        if (humanCount === 0 && now - room.lastActiveAt > 5 * 60 * 1000) {
          room.clearTimers();
          this.rooms.delete(code);
        }
      }
    }, 60 * 1000);
    if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  public listen(port: number, callback?: () => void) {
    return this.server.listen(port, callback);
  }

  public close(callback?: () => void) {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const room of this.rooms.values()) {
      room.clearTimers();
    }
    this.server.close(callback);
  }
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const PORT = Number(process.env.PORT) || 3000;
  const ludoServer = new LudoServer();
  ludoServer.listen(PORT, () => {
    console.log(`🎲 Ludo King Server running at http://localhost:${PORT}`);
  });
}
