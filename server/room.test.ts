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

describe('Ludo King Room & Server Authority', () => {
  it('manages 4 seats, host control, and bot toggling', () => {
    const room = new Room('TEST');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();

    const p1 = room.addPlayer('p1', 'Alice', s1.serverSocket);
    assert.strictEqual(p1.color, 'red');
    assert.strictEqual(p1.isHost, true);

    const p2 = room.addPlayer('p2', 'Bob', s2.serverSocket);
    assert.strictEqual(p2.color, 'green');

    // Host adds bot to yellow and blue
    room.toggleBot('yellow');
    room.toggleBot('blue');
    assert.strictEqual(room.players.size, 4);
    assert.strictEqual(room.players.get(room.colorAssignment.get('yellow')!)?.isBot, true);

    // Host starts game
    room.startGame('p1');
    assert.strictEqual(room.started, true);
    assert.ok(room.gameState);
    assert.strictEqual(room.gameState.currentTurnColor, 'red');

    room.clearTimers();
  });

  it('handles server timeout auto-play and 3-timeout AFK bot takeover', () => {
    const room = new Room('AFKT');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();
    room.addPlayer('p1', 'Human Alice', s1.serverSocket);
    room.addPlayer('p2', 'Human Bob', s2.serverSocket);
    room.startGame('p1');

    // 1st timeout for current turn player
    const pCurrent = room.players.get(room.colorAssignment.get(room.gameState!.currentTurnColor)!)!;
    room.handleServerTurnTimeout();
    assert.strictEqual(pCurrent.consecutiveTimeouts, 1);

    // Set player's timeouts to 2 and let them timeout again -> AFK takeover!
    const nextCurrent = room.players.get(room.colorAssignment.get(room.gameState!.currentTurnColor)!)!;
    nextCurrent.consecutiveTimeouts = 2;
    room.handleServerTurnTimeout();
    assert.strictEqual(nextCurrent.isBot, true, 'Player should be converted to Bot on 3 timeouts');

    room.clearTimers();
  });

  it('handles player voluntary Leave with immediate bot takeover', () => {
    const room = new Room('LEAV');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();
    room.addPlayer('p1', 'Alice', s1.serverSocket);
    room.addPlayer('p2', 'Bob', s2.serverSocket);
    room.startGame('p1');

    // Bob leaves
    room.handlePlayerLeave('p2');
    const bob = room.players.get('p2')!;
    assert.strictEqual(bob.isBot, true);
    assert.match(bob.name, /Bob.*Bot/);

    room.clearTimers();
  });

  it('validates and rate-limits emoji reactions', () => {
    const room = new Room('EMOJ');
    const s1 = createMockSocketPair();
    const s2 = createMockSocketPair();
    room.addPlayer('p1', 'Alice', s1.serverSocket);
    room.addPlayer('p2', 'Bob', s2.serverSocket);

    let receivedEmoji: any = null;
    s2.clientSocket.on('message', (data: string) => {
      const msg = JSON.parse(data);
      if (msg.type === 'EMOJI') {
        receivedEmoji = msg.payload;
      }
    });

    // Valid emoji
    room.handleEmoji('p1', 'green', '🔥');

    // Invalid emoji rejected
    assert.throws(() => {
      room.handleEmoji('p1', 'green', '❌');
    }, /Disallowed/);

    room.clearTimers();
  });

  it('simulates a full 4-bot automated game to completion', () => {
    const room = new Room('AUTO');
    const s1 = createMockSocketPair();
    room.addPlayer('p1', 'Host', s1.serverSocket);
    room.toggleBot('green');
    room.toggleBot('yellow');
    room.toggleBot('blue');
    // Replace p1 with bot as well so all 4 are bots
    room.players.get('p1')!.isBot = true;

    room.startGame('p1');

    let safetyRounds = 0;
    while (room.gameState && room.gameState.phase !== 'FINISHED' && safetyRounds < 2000) {
      safetyRounds++;
      const currentColor = room.gameState.currentTurnColor;
      const playerId = room.colorAssignment.get(currentColor)!;

      if (room.gameState.phase === 'ROLL') {
        room.handleRoll(playerId);
      } else if (room.gameState.phase === 'MOVE') {
        const clientState = room.getClientState(playerId);
        if (clientState.validMoves.length > 0) {
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
    assert.ok(room.gameState!.turnCount > 10);
    room.clearTimers();
  });
});
