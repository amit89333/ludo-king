import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LudoServer } from './server.ts';

function createClientHelper(port: number) {
  const ws = new (globalThis as any).WebSocket(`ws://localhost:${port}`);
  const messages: any[] = [];
  const waiters: ((msg: any) => void)[] = [];

  ws.onmessage = (event: any) => {
    const data = JSON.parse(event.data);
    messages.push(data);
    if (waiters.length > 0) {
      const waiter = waiters.shift()!;
      waiter(data);
    }
  };

  const waitForMessage = (predicate?: (msg: any) => boolean): Promise<any> => {
    return new Promise((resolve) => {
      // Check already received messages
      if (predicate) {
        const idx = messages.findIndex(predicate);
        if (idx !== -1) {
          const [found] = messages.splice(idx, 1);
          return resolve(found);
        }
      }

      const checkWaiter = (msg: any) => {
        if (!predicate || predicate(msg)) {
          resolve(msg);
        } else {
          waiters.push(checkWaiter);
        }
      };
      waiters.push(checkWaiter);
    });
  };

  const waitForOpen = (): Promise<void> => {
    return new Promise((resolve) => {
      if (ws.readyState === ws.OPEN) return resolve();
      ws.onopen = () => resolve();
    });
  };

  return { ws, messages, waitForOpen, waitForMessage };
}

describe('Ludo Server & Multi-Client Integration', () => {
  let server: LudoServer;
  let port: number;

  before(async () => {
    server = new LudoServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('handles room creation, 4 player seat assignment, and game start', async () => {
    // 1. Host creates room
    const c1 = createClientHelper(port);
    await c1.waitForOpen();

    c1.ws.send(
      JSON.stringify({
        type: 'CREATE_ROOM',
        payload: { playerId: 'p1-host', playerName: 'Alice (Host)' },
      })
    );

    const createdMsg = await c1.waitForMessage((m) => m.type === 'ROOM_CREATED');
    const roomCode = createdMsg.payload.code;
    assert.strictEqual(roomCode.length, 4);
    assert.strictEqual(createdMsg.payload.player.color, 'red');
    assert.strictEqual(createdMsg.payload.player.isHost, true);

    // 2. Client 2 joins
    const c2 = createClientHelper(port);
    await c2.waitForOpen();
    c2.ws.send(
      JSON.stringify({
        type: 'JOIN_ROOM',
        payload: { code: roomCode, playerId: 'p2', playerName: 'Bob' },
      })
    );
    const joined2 = await c2.waitForMessage((m) => m.type === 'ROOM_JOINED');
    assert.strictEqual(joined2.payload.player.color, 'green');

    // 3. Client 3 joins
    const c3 = createClientHelper(port);
    await c3.waitForOpen();
    c3.ws.send(
      JSON.stringify({
        type: 'JOIN_ROOM',
        payload: { code: roomCode, playerId: 'p3', playerName: 'Charlie' },
      })
    );
    const joined3 = await c3.waitForMessage((m) => m.type === 'ROOM_JOINED');
    assert.strictEqual(joined3.payload.player.color, 'yellow');

    // 4. Client 4 joins
    const c4 = createClientHelper(port);
    await c4.waitForOpen();
    c4.ws.send(
      JSON.stringify({
        type: 'JOIN_ROOM',
        payload: { code: roomCode, playerId: 'p4', playerName: 'Diana' },
      })
    );
    const joined4 = await c4.waitForMessage((m) => m.type === 'ROOM_JOINED');
    assert.strictEqual(joined4.payload.player.color, 'blue');

    // 5. Non-host tries to start game -> rejected
    c2.ws.send(
      JSON.stringify({
        type: 'START_GAME',
        payload: { playerId: 'p2' },
      })
    );
    const errNotHost = await c2.waitForMessage((m) => m.type === 'ERROR');
    assert.match(errNotHost.payload.message, /host/i);

    // 6. Host starts game -> broadcasted to all 4
    c1.ws.send(
      JSON.stringify({
        type: 'START_GAME',
        payload: { playerId: 'p1-host' },
      })
    );

    const c1State = await c1.waitForMessage((m) => m.type === 'ROOM_STATE' && m.payload.started);
    assert.strictEqual(c1State.payload.started, true);
    assert.strictEqual(c1State.payload.gameState.currentTurnColor, 'red');

    // 7. Non-current player rolls dice -> rejected
    c2.ws.send(
      JSON.stringify({
        type: 'ROLL_DICE',
        payload: { playerId: 'p2' },
      })
    );
    const errNotTurn = await c2.waitForMessage((m) => m.type === 'ERROR');
    assert.match(errNotTurn.payload.message, /Not your turn/i);

    // 8. Host (red) rolls dice
    c1.ws.send(
      JSON.stringify({
        type: 'ROLL_DICE',
        payload: { playerId: 'p1-host' },
      })
    );

    const afterRoll = await c1.waitForMessage(
      (m) => m.type === 'ROOM_STATE' && m.payload.gameState.lastDice !== null
    );
    assert.ok(afterRoll.payload.gameState.lastDice >= 1 && afterRoll.payload.gameState.lastDice <= 6);

    // 9. Emoji reaction broadcast
    c3.ws.send(
      JSON.stringify({
        type: 'REACTION',
        payload: { playerId: 'p3', emoji: '🔥' },
      })
    );
    const reactionMsg = await c1.waitForMessage((m) => m.type === 'REACTION');
    assert.strictEqual(reactionMsg.payload.emoji, '🔥');
    assert.strictEqual(reactionMsg.payload.color, 'yellow');

    // 10. Reconnect test: Diana (c4) disconnects and reconnects
    c4.ws.close();
    const c4Rejoined = createClientHelper(port);
    await c4Rejoined.waitForOpen();
    c4Rejoined.ws.send(
      JSON.stringify({
        type: 'JOIN_ROOM',
        payload: { code: roomCode, playerId: 'p4', playerName: 'Diana' },
      })
    );
    const reconMsg = await c4Rejoined.waitForMessage((m) => m.type === 'ROOM_JOINED');
    assert.strictEqual(reconMsg.payload.player.color, 'blue');
    assert.strictEqual(reconMsg.payload.player.id, 'p4');

    // Clean up test sockets
    c1.ws.close();
    c2.ws.close();
    c3.ws.close();
    c4Rejoined.ws.close();
  });
});
