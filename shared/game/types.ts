import { SAFE_STOPS } from './coords.ts';

export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export interface Token {
  id: number; // 0, 1, 2, 3
  color: PlayerColor;
  progress: number; // -1 = base, 0..50 = track, 51..55 = home column, 56 = finished
}

export interface PlayerState {
  color: PlayerColor;
  tokens: Token[];
  hasWon: boolean;
  rank?: number; // 1 for 1st place, 2 for 2nd, etc.
  capturesCount: number;
  tokensLostCount: number;
}

export type TurnPhase = 'ROLL' | 'MOVE' | 'FINISHED';

export interface MoveStepEvent {
  color: PlayerColor;
  tokenId: number;
  fromProgress: number;
  toProgress: number;
  path: number[]; // sequence of progress steps for 120ms hop animation
  captures: {
    color: PlayerColor;
    tokenId: number;
  }[];
  extraTurnReason?: 'six' | 'capture' | 'home';
}

export interface GameState {
  players: Record<PlayerColor, PlayerState>;
  activeColors: PlayerColor[]; // ordered list of players participating
  currentTurnColor: PlayerColor;
  phase: TurnPhase;
  lastDice: number | null;
  consecutiveSixes: number;
  winner: PlayerColor | null;
  winningOrder: PlayerColor[];
  turnCount: number;
  turnDeadline: number; // server timestamp (Date.now() + 30000)
  lastActionDescription?: string;
  lastMoveEvent?: MoveStepEvent | null;
}

export interface MoveIntent {
  color: PlayerColor;
  tokenId: number;
}

export interface ValidMove {
  tokenId: number;
  color: PlayerColor;
  fromProgress: number;
  toProgress: number;
  isLeavingBase: boolean;
  isFinishing: boolean;
  captures?: {
    color: PlayerColor;
    tokenId: number;
  }[];
}

export const START_CELLS: Record<PlayerColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

export const COLOR_ORDER: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export const SAFE_SQUARES = SAFE_STOPS;

export const TOTAL_TRACK_CELLS = 52;
export const MAX_TRACK_PROGRESS = 50;
export const HOME_COLUMN_START_PROGRESS = 51;
export const HOME_COLUMN_END_PROGRESS = 55;
export const FINISHED_PROGRESS = 56;
export const TURN_TIMEOUT_MS = 30000;
