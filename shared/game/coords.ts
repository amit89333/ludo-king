export interface BoardCoordinate {
  col: number; // 0..14
  row: number; // 0..14
}

// 52-cell shared outer track (0..51 clockwise)
// Red start = 0, Green start = 13, Yellow start = 26, Blue start = 39
export const TRACK_COORDINATES: BoardCoordinate[] = [
  // Left arm, bottom row -> cell 0..4
  { col: 1, row: 6 }, // 0: Red Start (SAFE STOP ★)
  { col: 2, row: 6 }, // 1
  { col: 3, row: 6 }, // 2
  { col: 4, row: 6 }, // 3
  { col: 5, row: 6 }, // 4

  // Top arm, left column -> cell 5..10
  { col: 6, row: 5 }, // 5
  { col: 6, row: 4 }, // 6
  { col: 6, row: 3 }, // 7
  { col: 6, row: 2 }, // 8: Top Star (SAFE STOP ★)
  { col: 6, row: 1 }, // 9
  { col: 6, row: 0 }, // 10

  // Top turn
  { col: 7, row: 0 }, // 11
  { col: 8, row: 0 }, // 12

  // Top arm, right column -> cell 13..17
  { col: 8, row: 1 }, // 13: Green Start (SAFE STOP ★)
  { col: 8, row: 2 }, // 14
  { col: 8, row: 3 }, // 15
  { col: 8, row: 4 }, // 16
  { col: 8, row: 5 }, // 17

  // Right arm, top row -> cell 18..23
  { col: 9, row: 6 },  // 18
  { col: 10, row: 6 }, // 19
  { col: 11, row: 6 }, // 20
  { col: 12, row: 6 }, // 21: Right Star (SAFE STOP ★)
  { col: 13, row: 6 }, // 22
  { col: 14, row: 6 }, // 23

  // Right turn
  { col: 14, row: 7 }, // 24
  { col: 14, row: 8 }, // 25

  // Right arm, bottom row -> cell 26..30
  { col: 13, row: 8 }, // 26: Yellow Start (SAFE STOP ★)
  { col: 12, row: 8 }, // 27
  { col: 11, row: 8 }, // 28
  { col: 10, row: 8 }, // 29
  { col: 9, row: 8 },  // 30

  // Bottom arm, right column -> cell 31..36
  { col: 8, row: 9 },  // 31
  { col: 8, row: 10 }, // 32
  { col: 8, row: 11 }, // 33
  { col: 8, row: 12 }, // 34: Bottom Star (SAFE STOP ★)
  { col: 8, row: 13 }, // 35
  { col: 8, row: 14 }, // 36

  // Bottom turn
  { col: 7, row: 14 }, // 37
  { col: 6, row: 14 }, // 38

  // Bottom arm, left column -> cell 39..43
  { col: 6, row: 13 }, // 39: Blue Start (SAFE STOP ★)
  { col: 6, row: 12 }, // 40
  { col: 6, row: 11 }, // 41
  { col: 6, row: 10 }, // 42
  { col: 6, row: 9 },  // 43

  // Left arm, bottom row -> cell 44..49
  { col: 5, row: 8 },  // 44
  { col: 4, row: 8 },  // 45
  { col: 3, row: 8 },  // 46
  { col: 2, row: 8 },  // 47: Left Star (SAFE STOP ★)
  { col: 1, row: 8 },  // 48
  { col: 0, row: 8 },  // 49

  // Left turn
  { col: 0, row: 7 }, // 50
  { col: 0, row: 6 }, // 51
];

// The 8 Safe Squares / Stops in Ludo King
export const SAFE_STOPS = new Set<number>([
  0,  // Red Start Stop
  8,  // Top Star Stop
  13, // Green Start Stop
  21, // Right Star Stop
  26, // Yellow Start Stop
  34, // Bottom Star Stop
  39, // Blue Start Stop
  47  // Left Star Stop
]);

// 4 Home Columns (each has 5 steps from 51 to 55)
export const HOME_COLUMNS: Record<'red' | 'green' | 'yellow' | 'blue', BoardCoordinate[]> = {
  red: [
    { col: 1, row: 7 },
    { col: 2, row: 7 },
    { col: 3, row: 7 },
    { col: 4, row: 7 },
    { col: 5, row: 7 },
  ],
  green: [
    { col: 7, row: 1 },
    { col: 7, row: 2 },
    { col: 7, row: 3 },
    { col: 7, row: 4 },
    { col: 7, row: 5 },
  ],
  yellow: [
    { col: 13, row: 7 },
    { col: 12, row: 7 },
    { col: 11, row: 7 },
    { col: 10, row: 7 },
    { col: 9, row: 7 },
  ],
  blue: [
    { col: 7, row: 13 },
    { col: 7, row: 12 },
    { col: 7, row: 11 },
    { col: 7, row: 10 },
    { col: 7, row: 9 },
  ],
};

// Center finish square coordinate (progress 56)
export const CENTER_FINISH: BoardCoordinate = { col: 7, row: 7 };

// 4 Base Yard coordinates (for 4 tokens in each corner)
export const YARD_SLOTS: Record<'red' | 'green' | 'yellow' | 'blue', BoardCoordinate[]> = {
  red: [
    { col: 1.5, row: 1.5 },
    { col: 3.5, row: 1.5 },
    { col: 1.5, row: 3.5 },
    { col: 3.5, row: 3.5 },
  ],
  green: [
    { col: 10.5, row: 1.5 },
    { col: 12.5, row: 1.5 },
    { col: 10.5, row: 3.5 },
    { col: 12.5, row: 3.5 },
  ],
  yellow: [
    { col: 10.5, row: 10.5 },
    { col: 12.5, row: 10.5 },
    { col: 10.5, row: 12.5 },
    { col: 12.5, row: 12.5 },
  ],
  blue: [
    { col: 1.5, row: 10.5 },
    { col: 3.5, row: 10.5 },
    { col: 1.5, row: 12.5 },
    { col: 3.5, row: 12.5 },
  ],
};
