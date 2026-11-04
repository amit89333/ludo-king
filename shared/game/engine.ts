import type {
  GameState,
  PlayerColor,
  PlayerState,
  Token,
  ValidMove,
  MoveIntent,
  MoveStepEvent,
} from './types.ts';
import {
  START_CELLS,
  COLOR_ORDER,
  SAFE_SQUARES,
  TOTAL_TRACK_CELLS,
  MAX_TRACK_PROGRESS,
  FINISHED_PROGRESS,
  TURN_TIMEOUT_MS,
} from './types.ts';

export function createInitialState(
  activeColors: PlayerColor[] = COLOR_ORDER,
  now: number = Date.now()
): GameState {
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
      capturesCount: 0,
      tokensLostCount: 0,
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
    turnDeadline: now + TURN_TIMEOUT_MS,
    lastActionDescription: 'Game started. Roll dice to begin.',
    lastMoveEvent: null,
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

export function findCaptures(
  state: GameState,
  movingColor: PlayerColor,
  targetAbsoluteCell: number
): { color: PlayerColor; tokenId: number }[] {
  // Safe squares / stops NEVER allow capture
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

export function getValidMoves(state: GameState, dice: number): ValidMove[] {
  if (state.phase === 'FINISHED') return [];
  const player = state.players[state.currentTurnColor];
  if (!player || player.hasWon) return [];

  const validMoves: ValidMove[] = [];

  for (const token of player.tokens) {
    if (token.progress === FINISHED_PROGRESS) {
      // Already home, cannot move
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

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

export function nextTurn(state: GameState, now: number = Date.now()): void {
  const activeUnfinished = state.activeColors.filter((c) => !state.players[c].hasWon);
  if (activeUnfinished.length <= 1) {
    state.phase = 'FINISHED';
    if (activeUnfinished.length === 1 && !state.winningOrder.includes(activeUnfinished[0])) {
      state.winningOrder.push(activeUnfinished[0]);
      state.players[activeUnfinished[0]].rank = state.winningOrder.length;
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
  state.turnDeadline = now + TURN_TIMEOUT_MS;
  state.turnCount++;
}

export function applyRoll(state: GameState, dice: number, now: number = Date.now()): GameState {
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
      // Three consecutive 6s in a row cancels the 3rd roll and forfeits turn
      next.lastActionDescription = `${next.currentTurnColor} rolled three 6s in a row! Turn forfeited.`;
      next.consecutiveSixes = 0;
      nextTurn(next, now);
      return next;
    }
  } else {
    next.consecutiveSixes = 0;
  }

  const validMoves = getValidMoves(next, dice);

  if (validMoves.length === 0) {
    // No legal moves: pass turn automatically
    next.lastActionDescription = `${next.currentTurnColor} rolled a ${dice} with no legal moves. Passing turn...`;
    nextTurn(next, now);
  } else {
    next.phase = 'MOVE';
    next.turnDeadline = now + TURN_TIMEOUT_MS; // fresh 30s allowance for move
    next.lastActionDescription = `${next.currentTurnColor} rolled a ${dice}. Choose a token to move.`;
  }

  return next;
}

export function applyMove(state: GameState, moveIntent: MoveIntent, now: number = Date.now()): GameState {
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

  // Build step-by-step hop path for 120ms animation
  const path: number[] = [];
  if (matchedMove.isLeavingBase) {
    path.push(0);
  } else {
    for (let p = matchedMove.fromProgress + 1; p <= matchedMove.toProgress; p++) {
      path.push(p);
    }
  }

  // Apply token movement
  token.progress = matchedMove.toProgress;

  // Apply captures ("cutting opponent pawn")
  const capturedList: { color: PlayerColor; tokenId: number }[] = [];
  let captureNotice = '';

  if (matchedMove.captures && matchedMove.captures.length > 0) {
    for (const cap of matchedMove.captures) {
      const capturedToken = next.players[cap.color].tokens.find((t) => t.id === cap.tokenId);
      if (capturedToken) {
        capturedToken.progress = -1; // back to yard
        capturedList.push({ color: cap.color, tokenId: cap.tokenId });
        next.players[cap.color].tokensLostCount += 1;
      }
    }
    player.capturesCount += capturedList.length;
    const names = capturedList.map((c) => `${c.color} token #${c.tokenId + 1}`).join(', ');
    captureNotice = ` and cut ${names}!`;
  }

  // Check if player won
  const reachedHomeJustNow = matchedMove.toProgress === FINISHED_PROGRESS;
  const allHome = player.tokens.every((t) => t.progress === FINISHED_PROGRESS);

  if (allHome && !player.hasWon) {
    player.hasWon = true;
    next.winningOrder.push(player.color);
    player.rank = next.winningOrder.length;
    if (next.winner === null) {
      next.winner = player.color;
    }
  }

  // Determine Extra Turn Reason (Ludo King rules):
  // 1. Rolled a 6
  // 2. Captured opponent pawn
  // 3. Reached home
  let extraTurnReason: 'six' | 'capture' | 'home' | undefined;
  if (!player.hasWon) {
    if (capturedList.length > 0) {
      extraTurnReason = 'capture';
    } else if (reachedHomeJustNow) {
      extraTurnReason = 'home';
    } else if (dice === 6) {
      extraTurnReason = 'six';
    }
  }

  const moveEvent: MoveStepEvent = {
    color: moveIntent.color,
    tokenId: moveIntent.tokenId,
    fromProgress: matchedMove.fromProgress,
    toProgress: matchedMove.toProgress,
    path,
    captures: capturedList,
    extraTurnReason,
  };
  next.lastMoveEvent = moveEvent;

  // Check if game is completed (only 1 or 0 players left unfinished)
  const unfinishedCount = next.activeColors.filter((c) => !next.players[c].hasWon).length;
  if (unfinishedCount <= 1) {
    next.phase = 'FINISHED';
    const remaining = next.activeColors.find((c) => !next.players[c].hasWon);
    if (remaining && !next.winningOrder.includes(remaining)) {
      next.winningOrder.push(remaining);
      next.players[remaining].rank = next.winningOrder.length;
    }
    next.lastActionDescription = `${next.winner} won the game!`;
    return next;
  }

  // Handle extra turn or advance turn
  if (extraTurnReason) {
    next.phase = 'ROLL';
    next.lastDice = null;
    next.turnDeadline = now + TURN_TIMEOUT_MS;
    const reasonText =
      extraTurnReason === 'capture'
        ? 'cut an opponent'
        : extraTurnReason === 'home'
        ? 'reached home'
        : 'rolled a 6';
    next.lastActionDescription = `${moveIntent.color} moved token #${token.id + 1}${captureNotice} and got an extra turn (${reasonText})!`;
  } else {
    nextTurn(next, now);
    next.lastActionDescription = `${moveIntent.color} moved token #${token.id + 1}${captureNotice}. Next turn: ${next.currentTurnColor}.`;
  }

  return next;
}
