// Shared Board Geometry & Coordinates for Browser Client
(function() {
  const TRACK_COORDINATES = [
    { col: 1, row: 6 }, // 0: Red Start (SAFE STOP ★)
    { col: 2, row: 6 }, // 1
    { col: 3, row: 6 }, // 2
    { col: 4, row: 6 }, // 3
    { col: 5, row: 6 }, // 4

    { col: 6, row: 5 }, // 5
    { col: 6, row: 4 }, // 6
    { col: 6, row: 3 }, // 7
    { col: 6, row: 2 }, // 8: Top Star (SAFE STOP ★)
    { col: 6, row: 1 }, // 9
    { col: 6, row: 0 }, // 10

    { col: 7, row: 0 }, // 11
    { col: 8, row: 0 }, // 12

    { col: 8, row: 1 }, // 13: Green Start (SAFE STOP ★)
    { col: 8, row: 2 }, // 14
    { col: 8, row: 3 }, // 15
    { col: 8, row: 4 }, // 16
    { col: 8, row: 5 }, // 17

    { col: 9, row: 6 },  // 18
    { col: 10, row: 6 }, // 19
    { col: 11, row: 6 }, // 20
    { col: 12, row: 6 }, // 21: Right Star (SAFE STOP ★)
    { col: 13, row: 6 }, // 22
    { col: 14, row: 6 }, // 23

    { col: 14, row: 7 }, // 24
    { col: 14, row: 8 }, // 25

    { col: 13, row: 8 }, // 26: Yellow Start (SAFE STOP ★)
    { col: 12, row: 8 }, // 27
    { col: 11, row: 8 }, // 28
    { col: 10, row: 8 }, // 29
    { col: 9, row: 8 },  // 30

    { col: 8, row: 9 },  // 31
    { col: 8, row: 10 }, // 32
    { col: 8, row: 11 }, // 33
    { col: 8, row: 12 }, // 34: Bottom Star (SAFE STOP ★)
    { col: 8, row: 13 }, // 35
    { col: 8, row: 14 }, // 36

    { col: 7, row: 14 }, // 37
    { col: 6, row: 14 }, // 38

    { col: 6, row: 13 }, // 39: Blue Start (SAFE STOP ★)
    { col: 6, row: 12 }, // 40
    { col: 6, row: 11 }, // 41
    { col: 6, row: 10 }, // 42
    { col: 6, row: 9 },  // 43

    { col: 5, row: 8 },  // 44
    { col: 4, row: 8 },  // 45
    { col: 3, row: 8 },  // 46
    { col: 2, row: 8 },  // 47: Left Star (SAFE STOP ★)
    { col: 1, row: 8 },  // 48
    { col: 0, row: 8 },  // 49

    { col: 0, row: 7 }, // 50
    { col: 0, row: 6 }, // 51
  ];

  const SAFE_STOPS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

  const HOME_COLUMNS = {
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

  const START_CELLS = {
    red: 0,
    green: 13,
    yellow: 26,
    blue: 39,
  };

  const YARD_SLOTS = {
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

  window.LudoCoords = {
    TRACK_COORDINATES,
    SAFE_STOPS,
    HOME_COLUMNS,
    START_CELLS,
    YARD_SLOTS,
    CENTER_FINISH: { col: 7, row: 7 },
    getCoordinates: function(color, progress, tokenId) {
      if (progress === -1) {
        return YARD_SLOTS[color][tokenId];
      }
      if (progress >= 0 && progress <= 50) {
        const abs = (START_CELLS[color] + progress) % 52;
        return TRACK_COORDINATES[abs];
      }
      if (progress >= 51 && progress <= 55) {
        const step = progress - 51;
        return HOME_COLUMNS[color][step];
      }
      return { col: 7, row: 7 };
    }
  };
})();
