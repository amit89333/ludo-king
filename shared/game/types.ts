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
}

export type TurnPhase = 'ROLL' | 'MOVE' | 'FINISHED';

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
  lastActionDescription?: string;
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

export const SAFE_SQUARES = new Set<number>([0, 8, 13, 21, 26, 34, 39, 47]);

export const TOTAL_TRACK_CELLS = 52;
export const MAX_TRACK_PROGRESS = 50;
export const HOME_COLUMN_START_PROGRESS = 51;
export const HOME_COLUMN_END_PROGRESS = 55;
export const FINISHED_PROGRESS = 56;
