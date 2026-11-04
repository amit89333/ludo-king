import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  rollDice,
  getValidMoves,
  applyRoll,
  applyMove,
  getAbsoluteTrackCell,
  isSafeCell,
} from './engine.ts';
import {
  START_CELLS,
  SAFE_SQUARES,
  FINISHED_PROGRESS,
} from './types.ts';
import type { PlayerColor } from './types.ts';

describe('Ludo King Board & Stop Geometry', () => {
  it('has exact start cells defined for all 4 colors', () => {
    assert.strictEqual(START_CELLS.red, 0);
    assert.strictEqual(START_CELLS.green, 13);
    assert.strictEqual(START_CELLS.yellow, 26);
    assert.strictEqual(START_CELLS.blue, 39);
  });

  it('has all 8 authentic Ludo King stops (safe squares)', () => {
    const expectedSafeStops = [0, 8, 13, 21, 26, 34, 39, 47];
    assert.strictEqual(SAFE_SQUARES.size, 8);
    for (const sq of expectedSafeStops) {
      assert.strictEqual(SAFE_SQUARES.has(sq), true, `Square ${sq} must be safe`);
      assert.strictEqual(isSafeCell(sq), true);
    }
    // Normal track squares are not safe
    assert.strictEqual(isSafeCell(1), false);
    assert.strictEqual(isSafeCell(7), false);
    assert.strictEqual(isSafeCell(14), false);
    assert.strictEqual(isSafeCell(25), false);
  });

  it('computes absolute track cell correctly for all 4 arms', () => {
    assert.strictEqual(getAbsoluteTrackCell('red', 0), 0);
    assert.strictEqual(getAbsoluteTrackCell('red', 50), 50);

    assert.strictEqual(getAbsoluteTrackCell('green', 0), 13);
    assert.strictEqual(getAbsoluteTrackCell('green', 39), 0);

    assert.strictEqual(getAbsoluteTrackCell('yellow', 0), 26);
    assert.strictEqual(getAbsoluteTrackCell('yellow', 26), 0);

    assert.strictEqual(getAbsoluteTrackCell('blue', 0), 39);
    assert.strictEqual(getAbsoluteTrackCell('blue', 13), 0);
  });
});

describe('Ludo King Capture & Extra Turn Rules', () => {
  it('cutting an opponent pawn sends it back to base AND awards an extra turn', () => {
    let state = createInitialState();
    // Opponent green token at absolute track cell 14 (not a safe stop)
    state.players.green.tokens[0].progress = 1; // green start is 13 -> cell 14
    assert.strictEqual(getAbsoluteTrackCell('green', 1), 14);
    assert.strictEqual(isSafeCell(14), false);

    // Red token #0 at progress 10 (cell 10)
    state.players.red.tokens[0].progress = 10;
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    // Red rolls a 4 -> lands on cell 14
    state = applyRoll(state, 4);
    assert.strictEqual(state.phase, 'MOVE');

    state = applyMove(state, { color: 'red', tokenId: 0 });

    // Green pawn was cut and returned to yard (-1)
    assert.strictEqual(state.players.green.tokens[0].progress, -1);
    assert.strictEqual(state.players.red.capturesCount, 1);
    assert.strictEqual(state.players.green.tokensLostCount, 1);

    // Red gets an EXTRA TURN for cutting the pawn (even on a roll of 4)!
    assert.strictEqual(state.currentTurnColor, 'red');
    assert.strictEqual(state.phase, 'ROLL');
    assert.strictEqual(state.lastMoveEvent?.extraTurnReason, 'capture');
  });

  it('STOPS (safe squares) strictly protect pawns from being cut', () => {
    let state = createInitialState();
    // Yellow pawn is on stop cell 8 (cell 8 is safe)
    // Yellow start is 26: (26 + 34) % 52 = 60 % 52 = 8
    state.players.yellow.tokens[0].progress = 34;
    assert.strictEqual(getAbsoluteTrackCell('yellow', 34), 8);
    assert.strictEqual(isSafeCell(8), true);

    // Red pawn is at progress 5 (cell 5)
    state.players.red.tokens[0].progress = 5;
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    // Red rolls 3 -> lands on stop cell 8
    state = applyRoll(state, 3);
    const validMoves = getValidMoves(state, 3);
    const redMove = validMoves.find((m) => m.tokenId === 0);
    assert.ok(redMove);
    assert.strictEqual(redMove.captures, undefined, 'Must not capture on safe stop');

    state = applyMove(state, { color: 'red', tokenId: 0 });
    // Yellow pawn remains untouched on cell 8
    assert.strictEqual(state.players.yellow.tokens[0].progress, 34);
    assert.strictEqual(state.players.red.tokens[0].progress, 8);
    // Turn passes to green (no capture, no 6)
    assert.strictEqual(state.currentTurnColor, 'green');
  });

  it('reaching home awards an extra turn', () => {
    let state = createInitialState();
    state.players.red.tokens[0].progress = 54; // needs 2 to reach 56
    state.players.red.tokens[1].progress = 0;  // other token on board so game doesn't end
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    state = applyRoll(state, 2);
    state = applyMove(state, { color: 'red', tokenId: 0 });

    assert.strictEqual(state.players.red.tokens[0].progress, FINISHED_PROGRESS);
    // Extra turn awarded for reaching home!
    assert.strictEqual(state.currentTurnColor, 'red');
    assert.strictEqual(state.phase, 'ROLL');
    assert.strictEqual(state.lastMoveEvent?.extraTurnReason, 'home');
  });

  it('three consecutive 6s forfeits the turn', () => {
    let state = createInitialState();
    // 1st 6
    state = applyRoll(state, 6);
    state = applyMove(state, { color: 'red', tokenId: 0 });
    assert.strictEqual(state.currentTurnColor, 'red');

    // 2nd 6
    state = applyRoll(state, 6);
    state = applyMove(state, { color: 'red', tokenId: 0 });
    assert.strictEqual(state.currentTurnColor, 'red');

    // 3rd 6 -> canceled & forfeited!
    state = applyRoll(state, 6);
    assert.strictEqual(state.currentTurnColor, 'green');
    assert.strictEqual(state.phase, 'ROLL');
  });

  it('exact roll is required to enter home; overshoot is illegal', () => {
    let state = createInitialState();
    state.players.red.tokens[0].progress = 55; // 1 step from home (56)
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    // Rolling a 2 overshoots 56
    state = applyRoll(state, 2);
    const validMoves = getValidMoves(state, 2);
    const token0Move = validMoves.find((m) => m.tokenId === 0);
    assert.strictEqual(token0Move, undefined);
  });
});
