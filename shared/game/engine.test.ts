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

describe('Ludo Board Model & Coordinates', () => {
  it('has exact start cells defined in PROJECT.md', () => {
    assert.strictEqual(START_CELLS.red, 0);
    assert.strictEqual(START_CELLS.green, 13);
    assert.strictEqual(START_CELLS.yellow, 26);
    assert.strictEqual(START_CELLS.blue, 39);
  });

  it('has 8 exact safe squares defined in PROJECT.md', () => {
    const expectedSafe = [0, 8, 13, 21, 26, 34, 39, 47];
    assert.strictEqual(SAFE_SQUARES.size, 8);
    for (const sq of expectedSafe) {
      assert.strictEqual(SAFE_SQUARES.has(sq), true, `Square ${sq} must be safe`);
      assert.strictEqual(isSafeCell(sq), true);
    }
    assert.strictEqual(isSafeCell(1), false);
    assert.strictEqual(isSafeCell(7), false);
  });

  it('computes absolute track cell correctly for all colors', () => {
    // Red: start cell 0
    assert.strictEqual(getAbsoluteTrackCell('red', 0), 0);
    assert.strictEqual(getAbsoluteTrackCell('red', 50), 50);

    // Green: start cell 13
    assert.strictEqual(getAbsoluteTrackCell('green', 0), 13);
    assert.strictEqual(getAbsoluteTrackCell('green', 38), 51);
    assert.strictEqual(getAbsoluteTrackCell('green', 39), 0); // wraps around 52

    // Yellow: start cell 26
    assert.strictEqual(getAbsoluteTrackCell('yellow', 0), 26);
    assert.strictEqual(getAbsoluteTrackCell('yellow', 26), 0); // 26 + 26 = 52 -> 0

    // Blue: start cell 39
    assert.strictEqual(getAbsoluteTrackCell('blue', 0), 39);
    assert.strictEqual(getAbsoluteTrackCell('blue', 13), 0); // 39 + 13 = 52 -> 0

    // Out of bounds / in base / in home column returns null
    assert.strictEqual(getAbsoluteTrackCell('red', -1), null);
    assert.strictEqual(getAbsoluteTrackCell('red', 51), null);
    assert.strictEqual(getAbsoluteTrackCell('red', 56), null);
  });
});

describe('Game Rules: Movement and Rolls', () => {
  it('cannot leave base without a 6', () => {
    const state = createInitialState();
    // Roll a 5
    const rolled = applyRoll(state, 5);
    // Since all red tokens are at -1, roll 5 gives 0 moves and automatically skips turn to green
    assert.strictEqual(rolled.currentTurnColor, 'green');
    assert.strictEqual(rolled.phase, 'ROLL');
  });

  it('can leave base when rolling a 6', () => {
    const state = createInitialState();
    const rolled = applyRoll(state, 6);
    assert.strictEqual(rolled.phase, 'MOVE');
    assert.strictEqual(rolled.currentTurnColor, 'red');

    const validMoves = getValidMoves(rolled, 6);
    assert.strictEqual(validMoves.length, 4); // all 4 tokens can leave base
    assert.strictEqual(validMoves[0].toProgress, 0);
    assert.strictEqual(validMoves[0].isLeavingBase, true);

    const moved = applyMove(rolled, { color: 'red', tokenId: 0 });
    assert.strictEqual(moved.players.red.tokens[0].progress, 0);
    // Rolling a 6 gives an extra turn!
    assert.strictEqual(moved.currentTurnColor, 'red');
    assert.strictEqual(moved.phase, 'ROLL');
  });

  it('forfeits turn on three consecutive 6s', () => {
    let state = createInitialState();
    // Roll 1: 6
    state = applyRoll(state, 6);
    state = applyMove(state, { color: 'red', tokenId: 0 }); // progress is 0
    assert.strictEqual(state.currentTurnColor, 'red');
    assert.strictEqual(state.consecutiveSixes, 1);

    // Roll 2: 6
    state = applyRoll(state, 6);
    state = applyMove(state, { color: 'red', tokenId: 0 }); // progress is 6
    assert.strictEqual(state.currentTurnColor, 'red');
    assert.strictEqual(state.consecutiveSixes, 2);

    // Roll 3: 6 -> turn forfeited!
    state = applyRoll(state, 6);
    assert.strictEqual(state.currentTurnColor, 'green'); // passed to green!
    assert.strictEqual(state.phase, 'ROLL');
    assert.strictEqual(state.consecutiveSixes, 0);
  });

  it('injectable RNG produces deterministic rolls', () => {
    const mockRng = () => 0.999; // Math.floor(0.999 * 6) + 1 = 6
    assert.strictEqual(rollDice(mockRng), 6);

    const mockRngLow = () => 0.0; // Math.floor(0 * 6) + 1 = 1
    assert.strictEqual(rollDice(mockRngLow), 1);
  });
});

describe('Game Rules: Capture & Safe Squares', () => {
  it('captures opponent token on a normal cell and sends them back to base', () => {
    let state = createInitialState();
    // Put green token #0 on absolute cell 14 (green progress = 1, since green start is 13)
    state.players.green.tokens[0].progress = 1; // absolute cell = (13 + 1) = 14 (not safe)

    // Put red token #0 on absolute cell 10 (red progress = 10)
    state.players.red.tokens[0].progress = 10;
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    // Red rolls a 4 -> moves to progress 14 -> absolute cell 14
    state = applyRoll(state, 4);
    assert.strictEqual(state.phase, 'MOVE');

    const validMoves = getValidMoves(state, 4);
    const redMove = validMoves.find((m) => m.tokenId === 0);
    assert.ok(redMove);
    assert.ok(redMove.captures && redMove.captures.length === 1);
    assert.strictEqual(redMove.captures[0].color, 'green');
    assert.strictEqual(redMove.captures[0].tokenId, 0);

    state = applyMove(state, { color: 'red', tokenId: 0 });

    // Red token is now at progress 14
    assert.strictEqual(state.players.red.tokens[0].progress, 14);
    // Green token was captured and sent back to -1 (base)
    assert.strictEqual(state.players.green.tokens[0].progress, -1);
  });

  it('does NOT capture opponent token on a safe square', () => {
    let state = createInitialState();
    // Safe square 8 (red progress 8 is absolute cell 8)
    // Put green token on absolute cell 8: green start is 13, (13 + 47) % 52 = 60 % 52 = 8
    state.players.green.tokens[0].progress = 47; // absolute cell 8
    assert.strictEqual(getAbsoluteTrackCell('green', 47), 8);
    assert.strictEqual(isSafeCell(8), true);

    // Put red token at progress 5 (absolute cell 5)
    state.players.red.tokens[0].progress = 5;
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    // Red rolls 3 -> lands on cell 8 (safe square!)
    state = applyRoll(state, 3);
    const validMoves = getValidMoves(state, 3);
    const redMove = validMoves.find((m) => m.tokenId === 0);
    assert.ok(redMove);
    assert.strictEqual(redMove.captures, undefined); // No capture allowed on safe cell!

    state = applyMove(state, { color: 'red', tokenId: 0 });
    // Green token is untouched
    assert.strictEqual(state.players.green.tokens[0].progress, 47);
    assert.strictEqual(state.players.red.tokens[0].progress, 8);
  });

  it('tokens in home column cannot be captured', () => {
    let state = createInitialState();
    // Home column is progress 51 to 55
    state.players.red.tokens[0].progress = 52;
    assert.strictEqual(getAbsoluteTrackCell('red', 52), null);
  });
});

describe('Game Rules: Home Column & Exact Finish', () => {
  it('disallows overshooting the finish cell 56', () => {
    let state = createInitialState();
    state.players.red.tokens[0].progress = 54; // needs exactly 2 to reach 56
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    // Roll a 3: 54 + 3 = 57 > 56 -> illegal overshoot!
    state = applyRoll(state, 3);
    const validMoves = getValidMoves(state, 3);
    const moveForToken0 = validMoves.find((m) => m.tokenId === 0);
    assert.strictEqual(moveForToken0, undefined); // Token 0 cannot move
  });

  it('allows exact roll to finish into cell 56', () => {
    let state = createInitialState();
    state.players.red.tokens[0].progress = 54;
    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    // Roll a 2: 54 + 2 = 56 (exact finish!)
    state = applyRoll(state, 2);
    const validMoves = getValidMoves(state, 2);
    const moveForToken0 = validMoves.find((m) => m.tokenId === 0);
    assert.ok(moveForToken0);
    assert.strictEqual(moveForToken0.toProgress, 56);
    assert.strictEqual(moveForToken0.isFinishing, true);

    state = applyMove(state, { color: 'red', tokenId: 0 });
    assert.strictEqual(state.players.red.tokens[0].progress, FINISHED_PROGRESS);
  });

  it('detects win when all 4 tokens reach 56', () => {
    let state = createInitialState();
    state.players.red.tokens[0].progress = 56;
    state.players.red.tokens[1].progress = 56;
    state.players.red.tokens[2].progress = 56;
    state.players.red.tokens[3].progress = 55; // 1 step away

    state.currentTurnColor = 'red';
    state.phase = 'ROLL';

    state = applyRoll(state, 1);
    state = applyMove(state, { color: 'red', tokenId: 3 });

    assert.strictEqual(state.players.red.tokens[3].progress, 56);
    assert.strictEqual(state.players.red.hasWon, true);
    assert.strictEqual(state.winner, 'red');
    assert.ok(state.winningOrder.includes('red'));
  });
});
