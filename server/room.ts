import {
  createInitialState,
  rollDice,
  getValidMoves,
  applyRoll,
  applyMove,
} from '../shared/game/engine.ts';
import type { GameState, PlayerColor, ValidMove } from '../shared/game/types.ts';
import { COLOR_ORDER } from '../shared/game/types.ts';
import type { CustomWebSocket } from './ws.ts';

export interface RoomPlayer {
  id: string; // persistent player ID (UUID)
  name: string;
  color: PlayerColor;
  isHost: boolean;
  isBot: boolean;
  connected: boolean;
  socket?: CustomWebSocket;
}

export interface ClientRoomState {
  code: string;
  players: {
    id: string;
    name: string;
    color: PlayerColor;
    isHost: boolean;
    isBot: boolean;
    connected: boolean;
  }[];
  started: boolean;
  gameState: GameState | null;
  validMoves: ValidMove[];
  turnTimeRemaining: number;
}

export class Room {
  public code: string;
  public players: Map<string, RoomPlayer> = new Map();
  public colorAssignment: Map<PlayerColor, string> = new Map(); // color -> playerId
  public started: boolean = false;
  public gameState: GameState | null = null;
  public turnTimer: NodeJS.Timeout | null = null;
  public turnTimeRemaining: number = 30;
  public countdownInterval: NodeJS.Timeout | null = null;
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
    isBot: boolean = false
  ): RoomPlayer {
    this.lastActiveAt = Date.now();

    // Check if player is rejoining existing seat
    if (this.players.has(id)) {
      const existing = this.players.get(id)!;
      existing.socket = socket;
      existing.connected = true;
      existing.name = name || existing.name;
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
      name: name || `Player ${this.players.size + 1}`,
      color: assignedColor,
      isHost,
      isBot,
      connected: true,
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
        return;
      }
    }

    // Add bot to this color if vacant
    if (!this.colorAssignment.has(botColor)) {
      const botId = `bot-${botColor}-${Date.now()}`;
      const botPlayer: RoomPlayer = {
        id: botId,
        name: `Bot ${botColor.toUpperCase()}`,
        color: botColor,
        isHost: false,
        isBot: true,
        connected: true,
      };
      this.players.set(botId, botPlayer);
      this.colorAssignment.set(botColor, botId);
    }
  }

  public removeOrDisconnectPlayer(id: string): void {
    this.lastActiveAt = Date.now();
    const player = this.players.get(id);
    if (!player) return;

    if (!this.started) {
      // Before game start, remove completely
      this.players.delete(id);
      this.colorAssignment.delete(player.color);
      // Reassign host if needed
      if (player.isHost) {
        const nextPlayer = Array.from(this.players.values()).find((p) => !p.isBot);
        if (nextPlayer) nextPlayer.isHost = true;
      }
    } else {
      // During game, mark as disconnected for reconnect
      player.connected = false;
      player.socket = undefined;
    }

    this.checkAutoBotIfTurn();
    this.broadcastState();
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
    this.gameState = createInitialState(activeColors);
    this.startTurnTimer();
    this.broadcastState();

    this.checkAutoBotIfTurn();
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

    const dice = rollDice();
    this.gameState = applyRoll(this.gameState, dice);
    this.resetTurnTimer();
    this.broadcastState();

    this.checkAutoBotIfTurn();
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

    this.gameState = applyMove(this.gameState, {
      color: player.color,
      tokenId,
    });

    this.resetTurnTimer();
    this.broadcastState();

    this.checkAutoBotIfTurn();
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
          const dice = rollDice();
          this.gameState = applyRoll(this.gameState, dice);
          this.resetTurnTimer();
          this.broadcastState();

          if (this.gameState.phase === 'MOVE') {
            const valid = getValidMoves(this.gameState, this.gameState.lastDice!);
            if (valid.length > 0) {
              // Bot moves first valid move (or prioritizing leaving base / capturing)
              const bestMove =
                valid.find((m) => m.captures && m.captures.length > 0) ||
                valid.find((m) => m.isLeavingBase) ||
                valid[0];
              setTimeout(() => {
                if (!this.gameState || this.gameState.phase !== 'MOVE') return;
                this.gameState = applyMove(this.gameState, {
                  color: currentColor,
                  tokenId: bestMove.tokenId,
                });
                this.resetTurnTimer();
                this.broadcastState();
                this.checkAutoBotIfTurn();
              }, 400);
            }
          } else {
            this.checkAutoBotIfTurn();
          }
        } else if (this.gameState.phase === 'MOVE') {
          const valid = getValidMoves(this.gameState, this.gameState.lastDice!);
          if (valid.length > 0) {
            const bestMove =
              valid.find((m) => m.captures && m.captures.length > 0) ||
              valid.find((m) => m.isLeavingBase) ||
              valid[0];
            this.gameState = applyMove(this.gameState, {
              color: currentColor,
              tokenId: bestMove.tokenId,
            });
            this.resetTurnTimer();
            this.broadcastState();
            this.checkAutoBotIfTurn();
          }
        }
      }, 500);
    }
  }

  public startTurnTimer(): void {
    this.clearTimers();
    this.turnTimeRemaining = 30;

    this.countdownInterval = setInterval(() => {
      this.turnTimeRemaining = Math.max(0, this.turnTimeRemaining - 1);
      if (this.turnTimeRemaining <= 0) {
        this.handleTurnTimeout();
      }
    }, 1000);
    if (this.countdownInterval && typeof this.countdownInterval.unref === 'function') {
      this.countdownInterval.unref();
    }
  }

  public resetTurnTimer(): void {
    if (!this.started || !this.gameState || this.gameState.phase === 'FINISHED') {
      this.clearTimers();
      return;
    }
    this.startTurnTimer();
  }

  public handleTurnTimeout(): void {
    if (!this.started || !this.gameState || this.gameState.phase === 'FINISHED') {
      this.clearTimers();
      return;
    }

    if (this.gameState.phase === 'ROLL') {
      const dice = rollDice();
      this.gameState = applyRoll(this.gameState, dice);
      this.resetTurnTimer();
      this.broadcastState();

      if (this.gameState.phase === 'MOVE') {
        const moves = getValidMoves(this.gameState, this.gameState.lastDice!);
        if (moves.length > 0) {
          this.gameState = applyMove(this.gameState, {
            color: this.gameState.currentTurnColor,
            tokenId: moves[0].tokenId,
          });
          this.resetTurnTimer();
          this.broadcastState();
        }
      }
    } else if (this.gameState.phase === 'MOVE') {
      const moves = getValidMoves(this.gameState, this.gameState.lastDice!);
      if (moves.length > 0) {
        this.gameState = applyMove(this.gameState, {
          color: this.gameState.currentTurnColor,
          tokenId: moves[0].tokenId,
        });
        this.resetTurnTimer();
        this.broadcastState();
      }
    }
  }

  public clearTimers(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  public getClientState(forPlayerId?: string): ClientRoomState {
    const playerList = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isHost: p.isHost,
      isBot: p.isBot,
      connected: p.connected,
    }));

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
      turnTimeRemaining: this.turnTimeRemaining,
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

  public broadcastReaction(playerId: string, emoji: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.broadcast({
      type: 'REACTION',
      payload: {
        playerId,
        playerName: player.name,
        color: player.color,
        emoji,
      },
    });
  }
}
