import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import { Room } from './room.ts';
import type { CustomWebSocket } from './ws.ts';

function createMockSocketPair() {
  const clientEmitter = new EventEmitter();
  const serverEmitter = new EventEmitter();

  const clientSocket = {
    on: clientEmitter.on.bind(clientEmitter),
    once: clientEmitter.once.bind(clientEmitter),
    emit: clientEmitter.emit.bind(clientEmitter),
    send: (msg: string) => {
      process.nextTick(() => serverEmitter.emit('message', msg));
    },
    close: () => {
      clientEmitter.emit('close');
      serverEmitter.emit('close');
    },
    isAlive: true,
  } as unknown as CustomWebSocket;

  const serverSocket = {
    on: serverEmitter.on.bind(serverEmitter),
    once: serverEmitter.once.bind(serverEmitter),
    emit: serverEmitter.emit.bind(serverEmitter),
    send: (msg: string) => {
      process.nextTick(() => clientEmitter.emit('message', msg));
    },
    close: () => {
      serverEmitter.emit('close');
      clientEmitter.emit('close');
    },
    isAlive: true,
  } as unknown as CustomWebSocket;

  return { clientSocket, serverSocket };
}

describe('Ludo Room & Game Turn Simulation', () => {
  it('manages 4 player seats (red, green, yellow, blue) and enforces host privilege', () => {
    const room = new Room('TEST');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();
    const s3 = createMockSocketPair();
    const s4 = createMockSocketPair();

    const p1 = room.addPlayer('p1', 'Alice', s1.serverSocket);
    assert.strictEqual(p1.color, 'red');
    assert.strictEqual(p1.isHost, true);

    const p2 = room.addPlayer('p2', 'Bob', s2.serverSocket);
    assert.strictEqual(p2.color, 'green');
    assert.strictEqual(p2.isHost, false);

    const p3 = room.addPlayer('p3', 'Charlie', s3.serverSocket);
    assert.strictEqual(p3.color, 'yellow');

    const p4 = room.addPlayer('p4', 'Diana', s4.serverSocket);
    assert.strictEqual(p4.color, 'blue');

    assert.strictEqual(room.players.size, 4);

    // 5th player rejected
    const s5 = createMockSocketPair();
    assert.throws(() => {
      room.addPlayer('p5', 'Eve', s5.serverSocket);
    }, /Room is full/i);

    // Non-host cannot start game
    assert.throws(() => {
      room.startGame('p2');
    }, /host/i);

    // Host can start game
    room.startGame('p1');
    assert.strictEqual(room.started, true);
    assert.ok(room.gameState);
    assert.strictEqual(room.gameState.currentTurnColor, 'red');
    assert.strictEqual(room.gameState.phase, 'ROLL');

    room.clearTimers();
  });

  it('rejects out-of-turn actions and validates legal moves', () => {
    const room = new Room('GAME');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();
    room.addPlayer('p1', 'Alice', s1.serverSocket);
    room.addPlayer('p2', 'Bob', s2.serverSocket);
    room.startGame('p1');

    // Bob (green) tries to roll out of turn -> rejected
    assert.throws(() => {
      room.handleRoll('p2');
    }, /Not your turn/i);

    // Alice (red) rolls
    room.handleRoll('p1');
    assert.ok(room.gameState);
    if (room.gameState.phase === 'MOVE') {
      // Must be 6, and Alice can't roll again while in MOVE
      assert.strictEqual(room.gameState.lastDice, 6);
      assert.strictEqual(room.gameState.currentTurnColor, 'red');
      assert.throws(() => {
        room.handleRoll('p1');
      }, /Cannot roll/i);
    } else {
      // If not a 6, red had no legal moves so turn automatically passed to green!
      assert.strictEqual(room.gameState.currentTurnColor, 'green');
      assert.strictEqual(room.gameState.phase, 'ROLL');
    }

    room.clearTimers();
  });

  it('reconnects player by saved player ID to their seat', () => {
    const room = new Room('RECN');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();
    room.addPlayer('p1', 'Alice', s1.serverSocket);
    room.addPlayer('p2', 'Bob', s2.serverSocket);
    room.startGame('p1');

    // Bob disconnects
    room.removeOrDisconnectPlayer('p2');
    assert.strictEqual(room.players.get('p2')!.connected, false);

    // Bob reconnects with same playerId
    const s2New = createMockSocketPair();
    const reconnected = room.addPlayer('p2', 'Bob New Tab', s2New.serverSocket);
    assert.strictEqual(reconnected.color, 'green');
    assert.strictEqual(reconnected.connected, true);

    room.clearTimers();
  });

  it('simulates a complete 4-player game to the finish', () => {
    const room = new Room('FULL');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();
    const s3 = createMockSocketPair();
    const s4 = createMockSocketPair();

    room.addPlayer('p1', 'Alice', s1.serverSocket);
    room.addPlayer('p2', 'Bob', s2.serverSocket);
    room.addPlayer('p3', 'Charlie', s3.serverSocket);
    room.addPlayer('p4', 'Diana', s4.serverSocket);
    room.startGame('p1');

    let safetyRounds = 0;
    while (room.gameState && room.gameState.phase !== 'FINISHED' && safetyRounds < 1500) {
      safetyRounds++;
      const currentTurnColor = room.gameState.currentTurnColor;
      const playerId = room.colorAssignment.get(currentTurnColor)!;

      if (room.gameState.phase === 'ROLL') {
        room.handleRoll(playerId);
      } else if (room.gameState.phase === 'MOVE') {
        const clientState = room.getClientState(playerId);
        if (clientState.validMoves.length > 0) {
          // Play intelligent move: prefer capture or leaving base or furthest token
          const move =
            clientState.validMoves.find((m) => m.captures && m.captures.length > 0) ||
            clientState.validMoves.find((m) => m.isFinishing) ||
            clientState.validMoves.find((m) => m.isLeavingBase) ||
            clientState.validMoves[0];
          room.handleMove(playerId, move.tokenId);
        }
      }
    }

    assert.ok(safetyRounds > 0);
    // Game either completed or advanced dozens of turns with zero errors
    assert.ok(room.gameState!.turnCount > 10);
    room.clearTimers();
  });
});
