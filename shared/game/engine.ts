import type {
  GameState,
  PlayerColor,
  PlayerState,
  Token,
  ValidMove,
  MoveIntent,
} from './types.ts';
import {
  START_CELLS,
  COLOR_ORDER,
  SAFE_SQUARES,
  TOTAL_TRACK_CELLS,
  MAX_TRACK_PROGRESS,
  FINISHED_PROGRESS,
} from './types.ts';

export function createInitialState(activeColors: PlayerColor[] = COLOR_ORDER): GameState {
  if (!activeColors || activeColors.length === 0) {
    activeColors = [...COLOR_ORDER];
  }

  const players = {} as Record<PlayerColor, PlayerState>;
  for (const color of COLOR_ORDER) {
    const tokens: Token[] = [0, 1, 2, 3].map((id) => ({
      id,
      color,
      progress: -1,
    }));

    players[color] = {
      color,
      tokens,
      hasWon: false,
    };
  }

  return {
    players,
    activeColors: [...activeColors],
    currentTurnColor: activeColors[0],
    phase: 'ROLL',
    lastDice: null,
    consecutiveSixes: 0,
    winner: null,
    winningOrder: [],
    turnCount: 1,
    lastActionDescription: 'Game started. Roll dice to begin.',
  };
}

export function rollDice(rng: () => number = Math.random): number {
  return Math.floor(rng() * 6) + 1;
}

export function getAbsoluteTrackCell(color: PlayerColor, progress: number): number | null {
  if (progress < 0 || progress > MAX_TRACK_PROGRESS) {
    return null;
  }
  return (START_CELLS[color] + progress) % TOTAL_TRACK_CELLS;
}

export function isSafeCell(absoluteTrackCell: number): boolean {
  return SAFE_SQUARES.has(absoluteTrackCell);
}

export function getValidMoves(state: GameState, dice: number): ValidMove[] {
  if (state.phase === 'FINISHED') return [];
  const player = state.players[state.currentTurnColor];
  if (!player || player.hasWon) return [];

  const validMoves: ValidMove[] = [];

  for (const token of player.tokens) {
    if (token.progress === FINISHED_PROGRESS) {
      // Already finished, cannot move
      continue;
    }

    if (token.progress === -1) {
      // In base: needs exactly 6 to emerge onto start cell (progress 0)
      if (dice === 6) {
        const targetAbs = START_CELLS[player.color];
        const captures = findCaptures(state, player.color, targetAbs);
        validMoves.push({
          tokenId: token.id,
          color: player.color,
          fromProgress: -1,
          toProgress: 0,
          isLeavingBase: true,
          isFinishing: false,
          captures: captures.length > 0 ? captures : undefined,
        });
      }
    } else {
      const nextProgress = token.progress + dice;
      // Exact roll needed to finish (progress 56)
      if (nextProgress <= FINISHED_PROGRESS) {
        let captures: { color: PlayerColor; tokenId: number }[] = [];
        if (nextProgress <= MAX_TRACK_PROGRESS) {
          const targetAbs = getAbsoluteTrackCell(player.color, nextProgress);
          if (targetAbs !== null) {
            captures = findCaptures(state, player.color, targetAbs);
          }
        }

        validMoves.push({
          tokenId: token.id,
          color: player.color,
          fromProgress: token.progress,
          toProgress: nextProgress,
          isLeavingBase: false,
          isFinishing: nextProgress === FINISHED_PROGRESS,
          captures: captures.length > 0 ? captures : undefined,
        });
      }
    }
  }

  return validMoves;
}

function findCaptures(
  state: GameState,
  movingColor: PlayerColor,
  targetAbsoluteCell: number
): { color: PlayerColor; tokenId: number }[] {
  // Safe squares never capture
  if (isSafeCell(targetAbsoluteCell)) {
    return [];
  }

  const captures: { color: PlayerColor; tokenId: number }[] = [];
  for (const color of state.activeColors) {
    if (color === movingColor) continue;
    const opponent = state.players[color];
    for (const token of opponent.tokens) {
      if (token.progress >= 0 && token.progress <= MAX_TRACK_PROGRESS) {
        const abs = getAbsoluteTrackCell(token.color, token.progress);
        if (abs === targetAbsoluteCell) {
          captures.push({ color: token.color, tokenId: token.id });
        }
      }
    }
  }

  return captures;
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

export function nextTurn(state: GameState): void {
  const activeUnfinished = state.activeColors.filter((c) => !state.players[c].hasWon);
  if (activeUnfinished.length <= 1) {
    state.phase = 'FINISHED';
    if (activeUnfinished.length === 1 && !state.winningOrder.includes(activeUnfinished[0])) {
      state.winningOrder.push(activeUnfinished[0]);
    }
    return;
  }

  const currentIndex = state.activeColors.indexOf(state.currentTurnColor);
  let nextIndex = (currentIndex + 1) % state.activeColors.length;
  let attempts = 0;

  while (state.players[state.activeColors[nextIndex]].hasWon && attempts < state.activeColors.length) {
    nextIndex = (nextIndex + 1) % state.activeColors.length;
    attempts++;
  }

  state.currentTurnColor = state.activeColors[nextIndex];
  state.phase = 'ROLL';
  state.lastDice = null;
  state.consecutiveSixes = 0;
  state.turnCount++;
}

export function applyRoll(state: GameState, dice: number): GameState {
  const next = cloneState(state);

  if (next.phase !== 'ROLL') {
    throw new Error(`Cannot roll dice during phase: ${next.phase}`);
  }

  if (dice < 1 || dice > 6) {
    throw new Error(`Invalid dice value: ${dice}`);
  }

  next.lastDice = dice;

  if (dice === 6) {
    next.consecutiveSixes += 1;
    if (next.consecutiveSixes === 3) {
      // Three 6s in a row forfeits the turn
      next.lastActionDescription = `${next.currentTurnColor} rolled three 6s in a row! Turn forfeited.`;
      next.consecutiveSixes = 0;
      nextTurn(next);
      return next;
    }
  } else {
    next.consecutiveSixes = 0;
  }

  const validMoves = getValidMoves(next, dice);

  if (validMoves.length === 0) {
    // No legal moves: pass turn automatically
    next.lastActionDescription = `${next.currentTurnColor} rolled a ${dice} but has no legal moves. Turn passed.`;
    nextTurn(next);
  } else {
    next.phase = 'MOVE';
    next.lastActionDescription = `${next.currentTurnColor} rolled a ${dice}. Choose a token to move.`;
  }

  return next;
}

export function applyMove(state: GameState, moveIntent: MoveIntent): GameState {
  const next = cloneState(state);

  if (next.phase !== 'MOVE') {
    throw new Error(`Cannot move token during phase: ${next.phase}`);
  }

  if (moveIntent.color !== next.currentTurnColor) {
    throw new Error(`It is ${next.currentTurnColor}'s turn, not ${moveIntent.color}`);
  }

  const dice = next.lastDice;
  if (dice === null) {
    throw new Error('No dice roll recorded');
  }

  const validMoves = getValidMoves(next, dice);
  const matchedMove = validMoves.find(
    (m) => m.tokenId === moveIntent.tokenId && m.color === moveIntent.color
  );

  if (!matchedMove) {
    throw new Error(`Illegal move: token ${moveIntent.tokenId} cannot be moved with dice ${dice}`);
  }

  const player = next.players[moveIntent.color];
  const token = player.tokens.find((t) => t.id === moveIntent.tokenId)!;

  // Apply movement
  token.progress = matchedMove.toProgress;

  // Apply captures if any
  let captureNotice = '';
  if (matchedMove.captures && matchedMove.captures.length > 0) {
    for (const cap of matchedMove.captures) {
      const capturedToken = next.players[cap.color].tokens.find((t) => t.id === cap.tokenId);
      if (capturedToken) {
        capturedToken.progress = -1; // back to base!
      }
    }
    const capNames = matchedMove.captures.map((c) => `${c.color} token #${c.tokenId}`).join(', ');
    captureNotice = ` and captured ${capNames}!`;
  }

  // Check if player won
  const allHome = player.tokens.every((t) => t.progress === FINISHED_PROGRESS);
  if (allHome && !player.hasWon) {
    player.hasWon = true;
    next.winningOrder.push(player.color);
    player.rank = next.winningOrder.length;
    if (next.winner === null) {
      next.winner = player.color;
    }
  }

  // Check if whole game is finished
  const unfinishedCount = next.activeColors.filter((c) => !next.players[c].hasWon).length;
  if (unfinishedCount <= 1) {
    next.phase = 'FINISHED';
    next.lastActionDescription = `${next.winner} won the game!`;
    return next;
  }

  // Extra turn rule:
  // Rolling a 6 gives an extra turn (if player hasn't already won)
  if (dice === 6 && !player.hasWon) {
    next.phase = 'ROLL';
    next.lastDice = null;
    next.lastActionDescription = `${next.currentTurnColor} moved token #${token.id}${captureNotice} and rolled a 6, so gets an extra turn!`;
  } else {
    nextTurn(next);
    next.lastActionDescription = `${moveIntent.color} moved token #${token.id}${captureNotice}. Next turn: ${next.currentTurnColor}.`;
  }

  return next;
}
