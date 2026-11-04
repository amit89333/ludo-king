import crypto from 'node:crypto';
import {
  createInitialState,
  getValidMoves,
  applyRoll,
  applyMove,
} from '../shared/game/engine.ts';
import type { GameState, PlayerColor, ValidMove } from '../shared/game/types.ts';
import { COLOR_ORDER, TURN_TIMEOUT_MS } from '../shared/game/types.ts';
import type { CustomWebSocket } from './ws.ts';

export interface RoomPlayer {
  id: string; // persistent player session token (UUID)
  name: string;
  avatarEmoji: string;
  color: PlayerColor;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  consecutiveTimeouts: number;
  reconnectDeadline?: number;
  reconnectTimeout?: NodeJS.Timeout;
  socket?: CustomWebSocket;
  lastEmojiTime?: number;
}

export interface ClientRoomState {
  code: string;
  players: {
    id: string;
    name: string;
    avatarEmoji: string;
    color: PlayerColor;
    isHost: boolean;
    isBot: boolean;
    connected: boolean;
    statusBadge?: string;
    reconnectSecondsLeft?: number;
  }[];
  started: boolean;
  gameState: GameState | null;
  validMoves: ValidMove[];
  serverNow: number;
  turnDeadline: number;
}

export const ALLOWED_EMOJIS = new Set([
  '😂', '😍', '😎', '😡', '😭', '👍', '👏', '🔥', '🥳', '🤝'
]);

export class Room {
  public code: string;
  public players: Map<string, RoomPlayer> = new Map();
  public colorAssignment: Map<PlayerColor, string> = new Map(); // color -> playerId
  public started: boolean = false;
  public gameState: GameState | null = null;
  public turnTimer: NodeJS.Timeout | null = null;
  public singleMoveTimer: NodeJS.Timeout | null = null;
  public emptyCleanupTimer: NodeJS.Timeout | null = null;
  public lastActiveAt: number = Date.now();
  public onEmptyRoomCleanup?: (code: string) => void;

  constructor(code: string) {
    this.code = code;
  }

  public getAvailableColor(): PlayerColor | null {
    for (const color of COLOR_ORDER) {
      if (!this.colorAssignment.has(color)) {
        return color;
      }
    }
    return null;
  }

  public addPlayer(
    id: string,
    name: string,
    socket: CustomWebSocket,
    avatarEmoji: string = '😎',
    isBot: boolean = false
  ): RoomPlayer {
    this.lastActiveAt = Date.now();
    this.clearEmptyCleanup();

    // Check if player is rejoining an existing seat
    if (this.players.has(id)) {
      const existing = this.players.get(id)!;
      const wasDisconnected = !existing.connected;
      existing.socket = socket;
      existing.connected = true;
      existing.name = name || existing.name;
      existing.avatarEmoji = avatarEmoji || existing.avatarEmoji;
      existing.consecutiveTimeouts = 0;

      if (existing.reconnectTimeout) {
        clearTimeout(existing.reconnectTimeout);
        existing.reconnectTimeout = undefined;
      }
      existing.reconnectDeadline = undefined;

      if (wasDisconnected && this.started) {
        this.broadcastToast(`${existing.name} is back!`);
      }

      this.broadcastState();
      return existing;
    }

    if (this.players.size >= 4) {
      throw new Error('Room is full (max 4 players)');
    }

    const assignedColor = this.getAvailableColor();
    if (!assignedColor) {
      throw new Error('No available seats');
    }

    const isHost = this.players.size === 0 && !isBot;
    const player: RoomPlayer = {
      id,
      name: (name || `Player ${this.players.size + 1}`).substring(0, 16),
      avatarEmoji,
      color: assignedColor,
      isHost,
      isBot,
      connected: true,
      consecutiveTimeouts: 0,
      socket,
    };

    this.players.set(id, player);
    this.colorAssignment.set(assignedColor, id);
    return player;
  }

  public toggleBot(botColor: PlayerColor): void {
    if (this.started) {
      throw new Error('Game already started');
    }

    const existingPlayerId = this.colorAssignment.get(botColor);
    if (existingPlayerId) {
      const p = this.players.get(existingPlayerId);
      if (p && p.isBot) {
        this.players.delete(existingPlayerId);
        this.colorAssignment.delete(botColor);
        this.broadcastState();
        return;
      }
    }

    // Add bot to this seat
    if (!this.colorAssignment.has(botColor)) {
      const botEmojis: Record<PlayerColor, string> = {
        red: '🦁',
        green: '🦊',
        yellow: '🐼',
        blue: '🦄',
      };
      const botNames: Record<PlayerColor, string> = {
        red: 'Scar (Bot)',
        green: 'Aarav (Bot)',
        yellow: 'Meera (Bot)',
        blue: 'Kabir (Bot)',
      };

      const botId = `bot-${botColor}-${Date.now()}`;
      const botPlayer: RoomPlayer = {
        id: botId,
        name: botNames[botColor],
        avatarEmoji: botEmojis[botColor],
        color: botColor,
        isHost: false,
        isBot: true,
        connected: true,
        consecutiveTimeouts: 0,
      };
      this.players.set(botId, botPlayer);
      this.colorAssignment.set(botColor, botId);
      this.broadcastState();
    }
  }

  public handlePlayerDisconnect(id: string): void {
    const player = this.players.get(id);
    if (!player || player.isBot) return;

    if (!this.started) {
      // In lobby: remove completely
      this.players.delete(id);
      this.colorAssignment.delete(player.color);
      if (player.isHost) {
        const nextHuman = Array.from(this.players.values()).find((p) => !p.isBot);
        if (nextHuman) nextHuman.isHost = true;
      }
      this.broadcastState();
      this.checkEmptyRoom();
      return;
    }

    // In game: mark disconnected, start 30s reconnect countdown
    player.connected = false;
    player.socket = undefined;
    player.reconnectDeadline = Date.now() + 30000;
    this.broadcastToast(`${player.name} lost connection.`);
    this.broadcastState();

    player.reconnectTimeout = setTimeout(() => {
      if (!player.connected && this.started) {
        this.replacePlayerWithBot(id, 'timeout');
      }
    }, 30000);
    if (player.reconnectTimeout.unref) player.reconnectTimeout.unref();

    this.checkAutoBotIfTurn();
  }

  public handlePlayerLeave(id: string): void {
    const player = this.players.get(id);
    if (!player) return;

    if (!this.started) {
      this.handlePlayerDisconnect(id);
      return;
    }

    // Player voluntarily left the match -> replace with bot immediately
    this.replacePlayerWithBot(id, 'left');
  }

  private replacePlayerWithBot(id: string, reason: 'left' | 'timeout' | 'afk'): void {
    const player = this.players.get(id);
    if (!player || player.isBot) return;

    if (player.reconnectTimeout) {
      clearTimeout(player.reconnectTimeout);
      player.reconnectTimeout = undefined;
    }

    const oldName = player.name;
    player.isBot = true;
    player.connected = true;
    player.name = `${oldName.replace(/ \(Bot\)/g, '')} (Bot)`.substring(0, 16);

    const toastMsg =
      reason === 'left'
        ? `${oldName} left. Bot took over.`
        : reason === 'afk'
        ? `${oldName} was AFK. Bot took over.`
        : `${oldName} disconnected. Bot took over.`;
    this.broadcastToast(toastMsg);

    // If host left, pass host to next human
    if (player.isHost) {
      player.isHost = false;
      const nextHuman = Array.from(this.players.values()).find((p) => !p.isBot);
      if (nextHuman) nextHuman.isHost = true;
    }

    this.broadcastState();
    this.checkEmptyRoom();
    this.checkAutoBotIfTurn();
  }

  private checkEmptyRoom(): void {
    const humanCount = Array.from(this.players.values()).filter((p) => !p.isBot).length;
    if (humanCount === 0) {
      this.clearEmptyCleanup();
      this.emptyCleanupTimer = setTimeout(() => {
        if (this.onEmptyRoomCleanup) {
          this.onEmptyRoomCleanup(this.code);
        }
      }, 5 * 60 * 1000); // 5 minutes empty cleanup
      if (this.emptyCleanupTimer.unref) this.emptyCleanupTimer.unref();
    }
  }

  private clearEmptyCleanup(): void {
    if (this.emptyCleanupTimer) {
      clearTimeout(this.emptyCleanupTimer);
      this.emptyCleanupTimer = null;
    }
  }

  public startGame(requestingPlayerId: string): void {
    const player = this.players.get(requestingPlayerId);
    if (!player || !player.isHost) {
      throw new Error('Only the host can start the game');
    }

    if (this.players.size < 2) {
      throw new Error('At least 2 players (human or bots) are needed to start');
    }

    const activeColors: PlayerColor[] = [];
    for (const color of COLOR_ORDER) {
      if (this.colorAssignment.has(color)) {
        activeColors.push(color);
      }
    }

    this.started = true;
    this.gameState = createInitialState(activeColors, Date.now());
    this.scheduleTurnDeadline();
    this.broadcastState();

    this.checkAutoBotIfTurn();
  }

  private serverRollDice(): number {
    return crypto.randomInt(1, 7); // 1..6
  }

  public handleRoll(requestingPlayerId: string): void {
    if (!this.started || !this.gameState) {
      throw new Error('Game not started');
    }

    const player = this.players.get(requestingPlayerId);
    if (!player) throw new Error('Player not found');

    if (this.gameState.currentTurnColor !== player.color) {
      throw new Error(`Not your turn! Current turn: ${this.gameState.currentTurnColor}`);
    }

    if (this.gameState.phase !== 'ROLL') {
      throw new Error('Cannot roll in current phase');
    }

    // Human active roll resets consecutive timeout count
    player.consecutiveTimeouts = 0;

    const dice = this.serverRollDice();
    const now = Date.now();
    this.gameState = applyRoll(this.gameState, dice, now);

    this.afterRollStateHandling();
  }

  public handleMove(requestingPlayerId: string, tokenId: number): void {
    if (!this.started || !this.gameState) {
      throw new Error('Game not started');
    }

    const player = this.players.get(requestingPlayerId);
    if (!player) throw new Error('Player not found');

    if (this.gameState.currentTurnColor !== player.color) {
      throw new Error(`Not your turn!`);
    }

    if (this.gameState.phase !== 'MOVE') {
      throw new Error('Cannot move in current phase');
    }

    player.consecutiveTimeouts = 0;
    this.clearSingleMoveTimer();

    const now = Date.now();
    this.gameState = applyMove(
      this.gameState,
      { color: player.color, tokenId },
      now
    );

    this.scheduleTurnDeadline();
    this.broadcastState();

    this.checkAutoBotIfTurn();
  }

  private afterRollStateHandling(): void {
    if (!this.gameState) return;

    this.clearSingleMoveTimer();

    if (this.gameState.phase === 'MOVE') {
      const validMoves = getValidMoves(this.gameState, this.gameState.lastDice!);

      // Single Legal Move: auto-move after 600ms
      if (validMoves.length === 1) {
        const onlyMove = validMoves[0];
        const currentColor = this.gameState.currentTurnColor;
        this.scheduleTurnDeadline();
        this.broadcastState();

        this.singleMoveTimer = setTimeout(() => {
          if (
            this.gameState &&
            this.gameState.phase === 'MOVE' &&
            this.gameState.currentTurnColor === currentColor
          ) {
            this.gameState = applyMove(
              this.gameState,
              { color: currentColor, tokenId: onlyMove.tokenId },
              Date.now()
            );
            this.scheduleTurnDeadline();
            this.broadcastState();
            this.checkAutoBotIfTurn();
          }
        }, 600);
        if (this.singleMoveTimer.unref) this.singleMoveTimer.unref();
        return;
      }
    }

    this.scheduleTurnDeadline();
    this.broadcastState();
    this.checkAutoBotIfTurn();
  }

  public scheduleTurnDeadline(): void {
    this.clearTimers();
    if (!this.started || !this.gameState || this.gameState.phase === 'FINISHED') return;

    const remainingTime = Math.max(100, this.gameState.turnDeadline - Date.now());
    this.turnTimer = setTimeout(() => {
      this.handleServerTurnTimeout();
    }, remainingTime);
    if (this.turnTimer.unref) this.turnTimer.unref();
  }

  public handleServerTurnTimeout(): void {
    if (!this.started || !this.gameState || this.gameState.phase === 'FINISHED') {
      this.clearTimers();
      return;
    }

    const currentColor = this.gameState.currentTurnColor;
    const playerId = this.colorAssignment.get(currentColor);
    const player = playerId ? this.players.get(playerId) : null;

    if (player && !player.isBot) {
      player.consecutiveTimeouts += 1;
      this.broadcastToast(`Time's up! Auto-played for ${player.name}.`);

      // 3 timeouts in a row: AFK bot takeover
      if (player.consecutiveTimeouts >= 3) {
        this.replacePlayerWithBot(player.id, 'afk');
        return;
      }
    }

    if (this.gameState.phase === 'ROLL') {
      const dice = this.serverRollDice();
      this.gameState = applyRoll(this.gameState, dice, Date.now());

      if (this.gameState.phase === 'MOVE') {
        const validMoves = getValidMoves(this.gameState, this.gameState.lastDice!);
        if (validMoves.length > 0) {
          const chosenMove = this.selectSmartestMove(validMoves);
          this.gameState = applyMove(
            this.gameState,
            { color: currentColor, tokenId: chosenMove.tokenId },
            Date.now()
          );
        }
      }
    } else if (this.gameState.phase === 'MOVE') {
      const validMoves = getValidMoves(this.gameState, this.gameState.lastDice!);
      if (validMoves.length > 0) {
        const chosenMove = this.selectSmartestMove(validMoves);
        this.gameState = applyMove(
          this.gameState,
          { color: currentColor, tokenId: chosenMove.tokenId },
          Date.now()
        );
      }
    }

    this.scheduleTurnDeadline();
    this.broadcastState();
    this.checkAutoBotIfTurn();
  }

  private selectSmartestMove(validMoves: ValidMove[]): ValidMove {
    // 1. Prefer Capture
    const captureMove = validMoves.find((m) => m.captures && m.captures.length > 0);
    if (captureMove) return captureMove;

    // 2. Prefer Home Finish
    const finishMove = validMoves.find((m) => m.isFinishing);
    if (finishMove) return finishMove;

    // 3. Prefer Emerging from Base
    const baseMove = validMoves.find((m) => m.isLeavingBase);
    if (baseMove) return baseMove;

    // 4. Prefer Most Advanced Token
    return validMoves.slice().sort((a, b) => b.toProgress - a.toProgress)[0];
  }

  public checkAutoBotIfTurn(): void {
    if (!this.started || !this.gameState || this.gameState.phase === 'FINISHED') return;

    const currentColor = this.gameState.currentTurnColor;
    const playerId = this.colorAssignment.get(currentColor);
    if (!playerId) return;

    const player = this.players.get(playerId);
    if (!player) return;

    if (player.isBot || !player.connected) {
      setTimeout(() => {
        if (!this.gameState || this.gameState.currentTurnColor !== currentColor) return;

        if (this.gameState.phase === 'ROLL') {
          const dice = this.serverRollDice();
          this.gameState = applyRoll(this.gameState, dice, Date.now());

          if (this.gameState.phase === 'MOVE') {
            const valid = getValidMoves(this.gameState, this.gameState.lastDice!);
            if (valid.length > 0) {
              const bestMove = this.selectSmartestMove(valid);
              setTimeout(() => {
                if (!this.gameState || this.gameState.phase !== 'MOVE') return;
                this.gameState = applyMove(
                  this.gameState,
                  { color: currentColor, tokenId: bestMove.tokenId },
                  Date.now()
                );
                this.scheduleTurnDeadline();
                this.broadcastState();
                this.checkAutoBotIfTurn();
              }, 400);
              return;
            }
          }
          this.scheduleTurnDeadline();
          this.broadcastState();
          this.checkAutoBotIfTurn();
        } else if (this.gameState.phase === 'MOVE') {
          const valid = getValidMoves(this.gameState, this.gameState.lastDice!);
          if (valid.length > 0) {
            const bestMove = this.selectSmartestMove(valid);
            this.gameState = applyMove(
              this.gameState,
              { color: currentColor, tokenId: bestMove.tokenId },
              Date.now()
            );
            this.scheduleTurnDeadline();
            this.broadcastState();
            this.checkAutoBotIfTurn();
          }
        }
      }, 500);
    }
  }

  public clearTimers(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.clearSingleMoveTimer();
  }

  public clearSingleMoveTimer(): void {
    if (this.singleMoveTimer) {
      clearTimeout(this.singleMoveTimer);
      this.singleMoveTimer = null;
    }
  }

  public getClientState(forPlayerId?: string): ClientRoomState {
    const now = Date.now();
    const playerList = Array.from(this.players.values()).map((p) => {
      let statusBadge = p.isBot ? '🤖 BOT' : p.connected ? '🟢 ONLINE' : '⚠️ RECONNECTING';
      let reconnectSecondsLeft: number | undefined;
      if (!p.connected && p.reconnectDeadline) {
        reconnectSecondsLeft = Math.max(0, Math.ceil((p.reconnectDeadline - now) / 1000));
        statusBadge = `Reconnecting… ${reconnectSecondsLeft}s`;
      }
      return {
        id: p.id,
        name: p.name,
        avatarEmoji: p.avatarEmoji,
        color: p.color,
        isHost: p.isHost,
        isBot: p.isBot,
        connected: p.connected,
        statusBadge,
        reconnectSecondsLeft,
      };
    });

    let validMoves: ValidMove[] = [];
    if (
      this.started &&
      this.gameState &&
      this.gameState.phase === 'MOVE' &&
      this.gameState.lastDice !== null
    ) {
      const player = forPlayerId ? this.players.get(forPlayerId) : null;
      if (player && player.color === this.gameState.currentTurnColor) {
        validMoves = getValidMoves(this.gameState, this.gameState.lastDice);
      }
    }

    return {
      code: this.code,
      players: playerList,
      started: this.started,
      gameState: this.gameState,
      validMoves,
      serverNow: now,
      turnDeadline: this.gameState ? this.gameState.turnDeadline : now + TURN_TIMEOUT_MS,
    };
  }

  public broadcast(message: object): void {
    const payload = JSON.stringify(message);
    for (const player of this.players.values()) {
      if (player.socket && player.connected && player.socket.isAlive) {
        try {
          player.socket.send(payload);
        } catch (e) {
          // ignore dead sockets
        }
      }
    }
  }

  public broadcastToast(message: string): void {
    this.broadcast({
      type: 'TOAST',
      payload: { message },
    });
  }

  public broadcastState(): void {
    for (const player of this.players.values()) {
      if (player.socket && player.connected && player.socket.isAlive) {
        try {
          const clientState = this.getClientState(player.id);
          player.socket.send(
            JSON.stringify({
              type: 'ROOM_STATE',
              payload: clientState,
            })
          );
        } catch (e) {
          // ignore
        }
      }
    }
  }

  public handleEmoji(
    requestingPlayerId: string,
    target: string, // color | 'all'
    emoji: string
  ): void {
    const player = this.players.get(requestingPlayerId);
    if (!player || player.isBot) return;

    if (!ALLOWED_EMOJIS.has(emoji)) {
      throw new Error('Disallowed emoji');
    }

    const now = Date.now();
    // Rate limit: 1 emoji per 2 seconds
    if (player.lastEmojiTime && now - player.lastEmojiTime < 2000) {
      return;
    }
    player.lastEmojiTime = now;

    this.broadcast({
      type: 'EMOJI',
      payload: {
        fromColor: player.color,
        to: target,
        emoji,
        senderName: player.name,
      },
    });
  }
}
