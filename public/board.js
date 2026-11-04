// 15x15 SVG Ludo Board Renderer

const TRACK_COORDINATES = [
  // Red side arm (bottom of left arm -> cell 0 to 4)
  { col: 1, row: 6 }, // 0 (Red Start, Safe)
  { col: 2, row: 6 }, // 1
  { col: 3, row: 6 }, // 2
  { col: 4, row: 6 }, // 3
  { col: 5, row: 6 }, // 4

  // Going up the left side of top arm -> cells 5 to 10
  { col: 6, row: 5 }, // 5
  { col: 6, row: 4 }, // 6
  { col: 6, row: 3 }, // 7
  { col: 6, row: 2 }, // 8 (Safe)
  { col: 6, row: 1 }, // 9
  { col: 6, row: 0 }, // 10

  // Top cell
  { col: 7, row: 0 }, // 11
  { col: 8, row: 0 }, // 12

  // Going down right side of top arm -> cells 13 to 17
  { col: 8, row: 1 }, // 13 (Green Start, Safe)
  { col: 8, row: 2 }, // 14
  { col: 8, row: 3 }, // 15
  { col: 8, row: 4 }, // 16
  { col: 8, row: 5 }, // 17

  // Going right on top side of right arm -> cells 18 to 23
  { col: 9, row: 6 },  // 18
  { col: 10, row: 6 }, // 19
  { col: 11, row: 6 }, // 20
  { col: 12, row: 6 }, // 21 (Safe)
  { col: 13, row: 6 }, // 22
  { col: 14, row: 6 }, // 23

  // Rightmost end
  { col: 14, row: 7 }, // 24
  { col: 14, row: 8 }, // 25

  // Going left on bottom side of right arm -> cells 26 to 30
  { col: 13, row: 8 }, // 26 (Yellow Start, Safe)
  { col: 12, row: 8 }, // 27
  { col: 11, row: 8 }, // 28
  { col: 10, row: 8 }, // 29
  { col: 9, row: 8 },  // 30

  // Going down right side of bottom arm -> cells 31 to 36
  { col: 8, row: 9 },  // 31
  { col: 8, row: 10 }, // 32
  { col: 8, row: 11 }, // 33
  { col: 8, row: 12 }, // 34 (Safe)
  { col: 8, row: 13 }, // 35
  { col: 8, row: 14 }, // 36

  // Bottom cell
  { col: 7, row: 14 }, // 37
  { col: 6, row: 14 }, // 38

  // Going up left side of bottom arm -> cells 39 to 43
  { col: 6, row: 13 }, // 39 (Blue Start, Safe)
  { col: 6, row: 12 }, // 40
  { col: 6, row: 11 }, // 41
  { col: 6, row: 10 }, // 42
  { col: 6, row: 9 },  // 43

  // Going left on bottom side of left arm -> cells 44 to 49
  { col: 5, row: 8 },  // 44
  { col: 4, row: 8 },  // 45
  { col: 3, row: 8 },  // 46
  { col: 2, row: 8 },  // 47 (Safe)
  { col: 1, row: 8 },  // 48
  { col: 0, row: 8 },  // 49

  // Leftmost cell & entry to red home column
  { col: 0, row: 7 }, // 50
  { col: 0, row: 6 }, // 51 (Corner track cell)
];

const SAFE_SQUARES_SET = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const START_CELLS_MAP = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

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

const BASE_SLOTS = {
  red: [
    { x: 1.8, y: 1.8 },
    { x: 4.2, y: 1.8 },
    { x: 1.8, y: 4.2 },
    { x: 4.2, y: 4.2 },
  ],
  green: [
    { x: 10.8, y: 1.8 },
    { x: 13.2, y: 1.8 },
    { x: 10.8, y: 4.2 },
    { x: 13.2, y: 4.2 },
  ],
  yellow: [
    { x: 10.8, y: 10.8 },
    { x: 13.2, y: 10.8 },
    { x: 10.8, y: 13.2 },
    { x: 13.2, y: 13.2 },
  ],
  blue: [
    { x: 1.8, y: 10.8 },
    { x: 4.2, y: 10.8 },
    { x: 1.8, y: 13.2 },
    { x: 4.2, y: 13.2 },
  ],
};

const COLOR_HEX = {
  red: '#EF4444',
  green: '#10B981',
  yellow: '#F59E0B',
  blue: '#3B82F6',
};

const COLOR_LIGHT_HEX = {
  red: '#FEE2E2',
  green: '#D1FAE5',
  yellow: '#FEF3C7',
  blue: '#DBEAFE',
};

class LudoBoardRenderer {
  constructor(svgContainerId, onTokenClick) {
    this.container = document.getElementById(svgContainerId);
    this.onTokenClick = onTokenClick;
    this.cellSize = 40; // 15 cells * 40 = 600px viewBox
    this.viewSize = 600;
  }

  render(gameState, validMoves = [], myColor = null) {
    if (!this.container) return;

    let svg = `<svg viewBox="0 0 600 600" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="ludo-board-svg">
      <defs>
        <!-- Gradients -->
        <linearGradient id="grad-red" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#F87171"/>
          <stop offset="100%" stop-color="#DC2626"/>
        </linearGradient>
        <linearGradient id="grad-green" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#34D399"/>
          <stop offset="100%" stop-color="#059669"/>
        </linearGradient>
        <linearGradient id="grad-yellow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FBBF24"/>
          <stop offset="100%" stop-color="#D97706"/>
        </linearGradient>
        <linearGradient id="grad-blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#60A5FA"/>
          <stop offset="100%" stop-color="#2563EB"/>
        </linearGradient>

        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity="0.3"/>
        </filter>
        <filter id="token-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#FBBF24" flood-opacity="0.9"/>
        </filter>
      </defs>

      <!-- Board Background -->
      <rect x="0" y="0" width="600" height="600" rx="16" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="4"/>
    `;

    // 1. Draw 4 Corner Bases
    svg += this.renderBases();

    // 2. Draw Track Cells
    svg += this.renderTrack();

    // 3. Draw Home Columns
    svg += this.renderHomeColumns();

    // 4. Draw Center Finish Triangles
    svg += this.renderCenterTriangles();

    // 5. Draw Tokens
    if (gameState) {
      svg += this.renderTokens(gameState, validMoves, myColor);
    }

    svg += '</svg>';
    this.container.innerHTML = svg;

    this.attachEvents();
  }

  renderBases() {
    const cs = this.cellSize;
    const baseW = 6 * cs; // 240px

    const drawBase = (color, x, y, gradId, lightColor) => {
      let b = `
        <rect x="${x}" y="${y}" width="${baseW}" height="${baseW}" fill="url(#${gradId})" rx="12"/>
        <rect x="${x + 30}" y="${y + 30}" width="${baseW - 60}" height="${baseW - 60}" fill="#FFFFFF" rx="16" filter="url(#shadow)"/>
      `;
      // Draw 4 slots inside base
      const slots = BASE_SLOTS[color];
      slots.forEach((s) => {
        b += `
          <circle cx="${s.x * cs}" cy="${s.y * cs}" r="22" fill="${lightColor}" stroke="url(#${gradId})" stroke-width="3"/>
        `;
      });
      return b;
    };

    return `
      <!-- Red Base (Top-Left) -->
      ${drawBase('red', 0, 0, 'grad-red', COLOR_LIGHT_HEX.red)}
      <!-- Green Base (Top-Right) -->
      ${drawBase('green', 9 * cs, 0, 'grad-green', COLOR_LIGHT_HEX.green)}
      <!-- Blue Base (Bottom-Left) -->
      ${drawBase('blue', 0, 9 * cs, 'grad-blue', COLOR_LIGHT_HEX.blue)}
      <!-- Yellow Base (Bottom-Right) -->
      ${drawBase('yellow', 9 * cs, 9 * cs, 'grad-yellow', COLOR_LIGHT_HEX.yellow)}
    `;
  }

  renderTrack() {
    const cs = this.cellSize;
    let cellsSvg = '';

    TRACK_COORDINATES.forEach((coord, idx) => {
      const x = coord.col * cs;
      const y = coord.row * cs;
      const isSafe = SAFE_SQUARES_SET.has(idx);

      let fill = '#FFFFFF';
      let stroke = '#CBD5E1';

      // Start squares get color tint
      if (idx === START_CELLS_MAP.red) fill = COLOR_LIGHT_HEX.red;
      if (idx === START_CELLS_MAP.green) fill = COLOR_LIGHT_HEX.green;
      if (idx === START_CELLS_MAP.yellow) fill = COLOR_LIGHT_HEX.yellow;
      if (idx === START_CELLS_MAP.blue) fill = COLOR_LIGHT_HEX.blue;

      cellsSvg += `
        <rect x="${x}" y="${y}" width="${cs}" height="${cs}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      `;

      if (isSafe) {
        cellsSvg += this.renderStar(x + cs / 2, y + cs / 2, idx);
      }
    });

    return cellsSvg;
  }

  renderHomeColumns() {
    const cs = this.cellSize;
    let s = '';

    for (const [color, coords] of Object.entries(HOME_COLUMNS)) {
      const grad = `url(#grad-${color})`;
      coords.forEach((coord) => {
        s += `
          <rect x="${coord.col * cs}" y="${coord.row * cs}" width="${cs}" height="${cs}" fill="${grad}" stroke="#FFFFFF" stroke-width="1.5"/>
        `;
      });
    }
    return s;
  }

  renderCenterTriangles() {
    const cs = this.cellSize;
    const centerStart = 6 * cs; // 240
    const centerEnd = 9 * cs;   // 360
    const mid = 7.5 * cs;       // 300

    return `
      <polygon points="${centerStart},${centerStart} ${centerStart},${centerEnd} ${mid},${mid}" fill="url(#grad-red)" stroke="#FFFFFF" stroke-width="1.5"/>
      <polygon points="${centerStart},${centerStart} ${centerEnd},${centerStart} ${mid},${mid}" fill="url(#grad-green)" stroke="#FFFFFF" stroke-width="1.5"/>
      <polygon points="${centerEnd},${centerStart} ${centerEnd},${centerEnd} ${mid},${mid}" fill="url(#grad-yellow)" stroke="#FFFFFF" stroke-width="1.5"/>
      <polygon points="${centerStart},${centerEnd} ${centerEnd},${centerEnd} ${mid},${mid}" fill="url(#grad-blue)" stroke="#FFFFFF" stroke-width="1.5"/>
      <circle cx="${mid}" cy="${mid}" r="22" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="2" filter="url(#shadow)"/>
      <text x="${mid}" y="${mid + 6}" font-size="18" text-anchor="middle" font-weight="bold">👑</text>
    `;
  }

  renderStar(cx, cy, cellIdx) {
    // 5-pointed golden star
    let color = '#D97706';
    if (cellIdx === 0) color = '#DC2626';
    if (cellIdx === 13) color = '#059669';
    if (cellIdx === 26) color = '#D97706';
    if (cellIdx === 39) color = '#2563EB';

    return `
      <g transform="translate(${cx}, ${cy}) scale(0.65)">
        <polygon points="0,-18 5,-5 18,-5 8,4 12,17 0,9 -12,17 -8,4 -18,-5 -5,-5" fill="${color}" stroke="#FFFFFF" stroke-width="1.5"/>
      </g>
    `;
  }

  renderTokens(gameState, validMoves, myColor) {
    const cs = this.cellSize;
    let tokensSvg = '';

    // Group tokens by physical position to calculate offsets when stacking
    const positionMap = new Map();

    const getTokenPos = (color, token) => {
      if (token.progress === -1) {
        // Base slot
        const slot = BASE_SLOTS[color][token.id];
        return { x: slot.x * cs, y: slot.y * cs };
      }
      if (token.progress >= 0 && token.progress <= 50) {
        const absCell = (START_CELLS_MAP[color] + token.progress) % 52;
        const coord = TRACK_COORDINATES[absCell];
        return { x: (coord.col + 0.5) * cs, y: (coord.row + 0.5) * cs, cellKey: `track-${absCell}` };
      }
      if (token.progress >= 51 && token.progress <= 55) {
        const idx = token.progress - 51;
        const coord = HOME_COLUMNS[color][idx];
        return { x: (coord.col + 0.5) * cs, y: (coord.row + 0.5) * cs, cellKey: `home-${color}-${idx}` };
      }
      // Finished (56)
      return { x: 7.5 * cs, y: 7.5 * cs, cellKey: 'finish' };
    };

    // Calculate stacking
    const allActiveTokens = [];
    for (const color of gameState.activeColors) {
      const p = gameState.players[color];
      if (!p) continue;
      for (const t of p.tokens) {
        const pos = getTokenPos(color, t);
        allActiveTokens.push({ color, token: t, pos });

        if (pos.cellKey && pos.cellKey !== 'finish') {
          if (!positionMap.has(pos.cellKey)) {
            positionMap.set(pos.cellKey, []);
          }
          positionMap.get(pos.cellKey).push({ color, tokenId: t.id });
        }
      }
    }

    allActiveTokens.forEach(({ color, token, pos }) => {
      let cx = pos.x;
      let cy = pos.y;

      // Apply subtle stacking offset if multiple tokens share the track cell
      if (pos.cellKey && positionMap.has(pos.cellKey)) {
        const group = positionMap.get(pos.cellKey);
        if (group.length > 1) {
          const idx = group.findIndex((item) => item.color === color && item.tokenId === token.id);
          const offsets = [
            { dx: -6, dy: -6 },
            { dx: 6, dy: 6 },
            { dx: -6, dy: 6 },
            { dx: 6, dy: -6 },
          ];
          const off = offsets[idx % offsets.length];
          cx += off.dx;
          cy += off.dy;
        }
      }

      // Check if this token is movable right now
      const isMovable =
        color === myColor &&
        validMoves.some((m) => m.color === color && m.tokenId === token.id);

      const grad = `url(#grad-${color})`;
      const glowFilter = isMovable ? 'filter="url(#token-glow)"' : 'filter="url(#shadow)"';
      const animClass = isMovable ? 'token-movable pulse-token' : '';

      tokensSvg += `
        <g class="ludo-token ${animClass}" data-color="${color}" data-token-id="${token.id}" transform="translate(${cx}, ${cy})">
          ${
            isMovable
              ? `<circle cx="0" cy="0" r="21" fill="none" stroke="#FBBF24" stroke-width="4" stroke-dasharray="6 3" class="token-ring"/>`
              : ''
          }
          <circle cx="0" cy="0" r="16" fill="${grad}" stroke="#FFFFFF" stroke-width="2.5" ${glowFilter}/>
          <circle cx="0" cy="0" r="7" fill="#FFFFFF" opacity="0.85"/>
          <text cx="0" y="4" text-anchor="middle" font-size="11" font-weight="900" fill="${COLOR_HEX[color]}">${token.id + 1}</text>
        </g>
      `;
    });

    return tokensSvg;
  }

  attachEvents() {
    const tokens = this.container.querySelectorAll('.token-movable');
    tokens.forEach((el) => {
      el.addEventListener('click', (e) => {
        const color = el.getAttribute('data-color');
        const tokenId = parseInt(el.getAttribute('data-token-id'), 10);
        if (this.onTokenClick) {
          this.onTokenClick(color, tokenId);
        }
      });
    });
  }
}

window.LudoBoardRenderer = LudoBoardRenderer;
