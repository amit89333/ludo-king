// Ludo King Client Controller & Game Renderer

(function() {
  const $ = id => document.getElementById(id);

  // Persistent Player Identity
  let sessionToken = localStorage.getItem('ludo_session_token');
  if (!sessionToken) {
    sessionToken = 'sess_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    localStorage.setItem('ludo_session_token', sessionToken);
  }

  let playerName = localStorage.getItem('ludo_player_name') || `Player ${Math.floor(100 + Math.random() * 900)}`;
  let avatarEmoji = localStorage.getItem('ludo_avatar_emoji') || '😎';

  // Game & Socket State
  let ws = null;
  let roomCode = null;
  let roomState = null;
  let myColor = null;
  let isHost = false;
  let isPassAndPlay = false;

  // Time Sync & Animation Frame
  let clockOffset = 0; // serverNow - clientNow
  let rafId = null;
  let lastTickSecond = -1;
  let isRolling = false;
  let animatingTokens = false;

  // Dice 3D Pips Geometry
  const pips = [
    [],
    [4],
    [0, 8],
    [0, 4, 8],
    [0, 2, 6, 8],
    [0, 2, 4, 6, 8],
    [0, 2, 3, 5, 6, 8]
  ];

  function dieH(n, extraClass = '') {
    n = Math.max(1, Math.min(6, n || 1));
    const dots = [...Array(9)].map((_, i) =>
      `<i class="${pips[n].includes(i) ? 'o' : ''}"></i>`
    ).join('');
    return `<div class="die ${extraClass}">${dots}</div>`;
  }

  // Toast System
  let toastTimer;
  function toast(message) {
    const t = $('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
  }

  // Navigation between screens
  function showScreen(id) {
    document.querySelectorAll('.scr').forEach(s => s.classList.toggle('on', s.id === id));
    window.scrollTo(0, 0);
  }

  const AVATAR_OPTIONS = ['😎', '🦁', '👑', '🦊', '🐼', '🦄', '⚡', '🚀', '🐯', '🐉', '🐱', '🤖'];
  let selectedProfileEmoji = avatarEmoji;

  // --- 1. HOME SCREEN INITIALIZATION ---
  function initHome() {
    updateProfileDisplay();
    $('hd').outerHTML = dieH(6, 'big').replace('class="die big"', 'class="die big" id="hd"');

    // Edit Profile Modal
    $('btn-edit-profile').onclick = () => {
      openProfileSheet();
    };

    $('btn-save-profile').onclick = () => {
      const newName = ($('input-profile-name').value || '').trim();
      playerName = newName.substring(0, 16) || 'Player';
      avatarEmoji = selectedProfileEmoji || '😎';

      localStorage.setItem('ludo_player_name', playerName);
      localStorage.setItem('ludo_avatar_emoji', avatarEmoji);

      updateProfileDisplay();
      closeSheets();
      toast(`Profile saved! Name: ${playerName}`);
    };

    // Mute button in game header
    const muteBtn = $('btn-mute');
    if (muteBtn) {
      muteBtn.textContent = window.soundEngine.muted ? '🔇' : '🔊';
      muteBtn.onclick = () => {
        const isMuted = window.soundEngine.toggleMute();
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
      };
    }

    // 4 Mode Buttons
    $('btn-mode-computer').onclick = () => {
      isPassAndPlay = false;
      connectWebSocket(() => {
        sendSocketMessage('CREATE_ROOM', {
          playerId: sessionToken,
          playerName,
          avatarEmoji
        });
        // Auto fill bots once room created
        setTimeout(() => {
          sendSocketMessage('TOGGLE_BOT', { playerId: sessionToken, color: 'green' });
          sendSocketMessage('TOGGLE_BOT', { playerId: sessionToken, color: 'yellow' });
          sendSocketMessage('TOGGLE_BOT', { playerId: sessionToken, color: 'blue' });
          setTimeout(() => {
            sendSocketMessage('START_GAME', { playerId: sessionToken });
          }, 300);
        }, 300);
      });
    };

    $('btn-mode-online').onclick = () => {
      isPassAndPlay = false;
      connectWebSocket(() => {
        sendSocketMessage('CREATE_ROOM', {
          playerId: sessionToken,
          playerName,
          avatarEmoji
        });
      });
    };

    $('btn-mode-private').onclick = () => {
      $('join-sheet').classList.add('on');
      $('veil').classList.add('on');
    };

    $('btn-mode-passplay').onclick = () => {
      isPassAndPlay = true;
      connectWebSocket(() => {
        sendSocketMessage('CREATE_ROOM', {
          playerId: sessionToken,
          playerName: 'Player 1',
          avatarEmoji: '😎'
        });
        setTimeout(() => {
          sendSocketMessage('START_GAME', { playerId: sessionToken });
        }, 400);
      });
    };

    // Private Room Modal Buttons
    $('btn-create-new-private').onclick = () => {
      closeSheets();
      connectWebSocket(() => {
        sendSocketMessage('CREATE_ROOM', {
          playerId: sessionToken,
          playerName,
          avatarEmoji
        });
      });
    };

    $('btn-submit-join').onclick = () => {
      const code = ($('join-code-input').value || '').trim().toUpperCase();
      if (!code || code.length !== 4) {
        toast('Please enter a 4-letter room code');
        return;
      }
      closeSheets();
      connectWebSocket(() => {
        sendSocketMessage('JOIN_ROOM', {
          code,
          playerId: sessionToken,
          playerName,
          avatarEmoji
        });
      });
    };

    // Check URL query param ?room=ABCD
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      connectWebSocket(() => {
        sendSocketMessage('JOIN_ROOM', {
          code: roomParam.toUpperCase(),
          playerId: sessionToken,
          playerName,
          avatarEmoji
        });
      });
    }
  }

  // --- 2. WEBSOCKET CONNECTION & TIME SYNC ---
  function connectWebSocket(onOpenCallback) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (onOpenCallback && ws.readyState === WebSocket.OPEN) onOpenCallback();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
      startTimeSync();
      if (onOpenCallback) onOpenCallback();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('Socket message parse error:', e);
      }
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (roomCode) {
          connectWebSocket(() => {
            sendSocketMessage('JOIN_ROOM', {
              code: roomCode,
              playerId: sessionToken,
              playerName,
              avatarEmoji
            });
          });
        }
      }, 2000);
    };
  }

  function sendSocketMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  function startTimeSync() {
    sendSocketMessage('TIME_SYNC', { clientSendTime: performance.now() });
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendSocketMessage('TIME_SYNC', { clientSendTime: performance.now() });
      }
    }, 15000);
  }

  function correctedNow() {
    return Date.now() + clockOffset;
  }

  // --- 3. SERVER MESSAGE ROUTING ---
  function handleServerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'TIME_SYNC_RESP': {
        const rtt = performance.now() - payload.clientSendTime;
        clockOffset = payload.serverNow - (Date.now() - rtt / 2);
        break;
      }

      case 'ROOM_CREATED':
      case 'ROOM_JOINED': {
        roomCode = payload.code;
        myColor = payload.player.color;
        isHost = payload.player.isHost;

        const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${roomCode}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);

        updateRoomState(payload.roomState);
        break;
      }

      case 'ROOM_STATE': {
        updateRoomState(payload);
        break;
      }

      case 'TOAST': {
        toast(payload.message);
        break;
      }

      case 'EMOJI': {
        renderFlyingEmoji(payload.fromColor, payload.to, payload.emoji, payload.senderName);
        break;
      }

      case 'ERROR': {
        toast(payload.message || 'Error');
        break;
      }

      default:
        break;
    }
  }

  function updateRoomState(state) {
    if (!state) return;
    roomState = state;

    const me = state.players.find(p => p.id === sessionToken);
    if (me) {
      myColor = me.color;
      isHost = me.isHost;
    }

    if (!state.started) {
      stopTimerLoop();
      showScreen('lobby');
      renderLobby();
    } else {
      showScreen('game');
      renderGameScreen();
      startTimerLoop();
    }
  }

  // --- 4. LOBBY SCREEN RENDERING ---
  function renderLobby() {
    $('lobby-code').textContent = roomState.code;

    $('btn-copy-invite').onclick = (e) => {
      const inviteUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${roomState.code}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(inviteUrl);
        e.target.textContent = 'Link copied ✓';
        setTimeout(() => (e.target.textContent = 'Copy invite link'), 1800);
      } else {
        prompt('Copy invite link:', inviteUrl);
      }
    };

    $('btn-lobby-back').onclick = () => {
      showScreen('home');
    };

    const seatsEl = $('seats');
    const colors = ['red', 'green', 'yellow', 'blue'];
    const colorHex = { red: '#e8453c', green: '#22b573', yellow: '#f6a91b', blue: '#2f7df6' };

    let seatsHtml = '';
    colors.forEach(col => {
      const occupant = roomState.players.find(p => p.color === col);
      if (occupant) {
        const isMe = occupant.id === sessionToken;
        seatsHtml += `
          <div class="seat" style="border-color:${colorHex[col]}">
            <span class="av" style="border-color:${colorHex[col]}">${occupant.avatarEmoji || '😎'}</span>
            <div>
              ${occupant.name} ${isMe ? '(You)' : ''}
              <small>${occupant.isHost ? '👑 Host' : occupant.isBot ? '🤖 Bot' : '🟢 Player'}</small>
            </div>
            ${isHost && occupant.isBot ? `<button class="add" onclick="window.removeBotSeat('${col}')">Remove</button>` : ''}
          </div>
        `;
      } else {
        seatsHtml += `
          <div class="seat">
            <span class="av" style="border-color:${colorHex[col]}">+</span>
            <div>Empty seat<small>Open</small></div>
            ${isHost ? `<button class="add" onclick="window.addBotSeat('${col}')">Add bot</button>` : ''}
          </div>
        `;
      }
    });

    seatsEl.innerHTML = seatsHtml;

    const startBtn = $('btn-start-game');
    if (isHost) {
      startBtn.style.display = 'flex';
      startBtn.disabled = roomState.players.length < 2;
      startBtn.onclick = () => {
        sendSocketMessage('START_GAME', { playerId: sessionToken });
      };
    } else {
      startBtn.style.display = 'none';
    }
  }

  window.addBotSeat = (color) => {
    sendSocketMessage('TOGGLE_BOT', { playerId: sessionToken, color });
  };
  window.removeBotSeat = (color) => {
    sendSocketMessage('TOGGLE_BOT', { playerId: sessionToken, color });
  };

  // --- 5. EXACT LUDO KING BOARD CONSTRUCTION (15x15 GRID) ---
  let boardConstructed = false;
  function buildBoardGrid() {
    if (boardConstructed) return;
    boardConstructed = true;

    const b = $('board');
    let h = '';

    // 4 Corner Yards (6x6) with white inner box and 4 pawn sockets
    const makeYard = (k, r, c, title, isTop) => `
      <div class="yard ${k}" style="grid-area:${r}/${c}/span 6/span 6">
        <div class="yard-title ${isTop ? 'top' : 'bottom'}" id="yard-title-${k}">${title}</div>
        <div class="yard-inner-box">
          ${[0, 1, 2, 3].map(n => `
            <div class="pawn-socket ${k}" id="socket-${k}-${n}">
              <div class="socket-empty-dot ${k}"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    h += makeYard('r', 1, 1, 'Bot1', true);
    h += makeYard('g', 1, 10, 'Bot2', true);
    h += makeYard('b', 10, 1, 'You', false);
    h += makeYard('y', 10, 10, 'Bot3', false);

    // Center Finish (3x3 with 4 triangles meeting at center)
    h += `
      <div class="center-finish">
        <div class="center-triangle r"></div>
        <div class="center-triangle g"></div>
        <div class="center-triangle y"></div>
        <div class="center-triangle b"></div>
      </div>
    `;

    // 4 Solid Start cells
    const startMap = {
      '6,1': 'r-start',
      '1,8': 'g-start',
      '8,13': 'y-start',
      '13,6': 'b-start',
    };

    // 4 Directional Entry Arrows
    const arrowMap = {
      '6,0': '<span class="c-arrow r">→</span>',
      '0,8': '<span class="c-arrow g">↓</span>',
      '8,14': '<span class="c-arrow y">←</span>',
      '14,6': '<span class="c-arrow b">↑</span>',
    };

    // 4 Star Stops (Safe Squares)
    const starStopSet = new Set(['8,2', '2,6', '6,12', '12,8']);

    // 4 Solid Home Path Columns
    const homeColorMap = {};
    for (let i = 1; i <= 5; i++) {
      homeColorMap[`7,${i}`] = 'r-home';
      homeColorMap[`${i},7`] = 'g-home';
      homeColorMap[`7,${14 - i}`] = 'y-home';
      homeColorMap[`${14 - i},7`] = 'b-home';
    }

    // Render 15x15 Track Cells
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        // Skip corner yards and 3x3 center finish
        if ((r < 6 || r > 8) && (c < 6 || c > 8)) continue;
        if (r > 5 && r < 9 && c > 5 && c < 9) continue;

        const key = `${r},${c}`;
        const isStart = startMap[key] || '';
        const isHome = homeColorMap[key] || '';
        const isStar = starStopSet.has(key);
        const arrow = arrowMap[key] || '';

        const starIcon = isStar ? '<span class="star-stop">☆</span>' : '';
        const cellClasses = `c ${isStart} ${isHome} ${isStar ? 'star-stop-cell' : ''}`;

        h += `<div class="${cellClasses}" id="cell-${r}-${c}" style="grid-area:${r + 1}/${c + 1}">${arrow}${starIcon}</div>`;
      }
    }

    b.innerHTML = h;
  }

  // --- 6. GAME SCREEN RENDERING ---
  function renderGameScreen() {
    buildBoardGrid();

    const gs = roomState.gameState;
    if (!gs) return;

    if (gs.phase === 'FINISHED') {
      stopTimerLoop();
      showScreen('win');
      renderWinnerScreen(gs);
      return;
    }

    // Render 4 Player Panels (matching screenshot)
    renderPlayerPanels(gs);

    // Render Teardrop Pawns on Sockets & Board
    renderTokensOnBoard(gs);

    // Update Bottom Bar Message & Roll Button
    const isMyTurn = isPassAndPlay || gs.currentTurnColor === myColor;
    const canRoll = isMyTurn && gs.phase === 'ROLL';
    const rollBtn = $('btn-roll');

    rollBtn.disabled = !canRoll;
    rollBtn.onclick = handleRollClick;

    $('msg').textContent = gs.lastActionDescription || (isMyTurn ? 'Your turn. Tap dice to roll!' : `${gs.currentTurnColor.toUpperCase()} is playing...`);

    // Handle Leave Match
    $('btn-leave').onclick = () => {
      if (confirm("Leave match? You'll lose and a bot will take over.")) {
        sendSocketMessage('LEAVE_MATCH', { playerId: sessionToken });
        showScreen('home');
      }
    };
  }

  // Teardrop Pin Marker SVG (matches screenshot)
  function pinMarkerSvg(color) {
    const colorHex = { red: '#e52521', green: '#009e3f', yellow: '#fec200', blue: '#0078d7' };
    const c = colorHex[color] || '#e52521';
    return `
      <svg viewBox="0 0 24 32" width="24" height="30">
        <defs>
          <radialGradient id="pin-grad-${color}" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="40%" stop-color="${c}"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0.6"/>
          </radialGradient>
        </defs>
        <path d="M 12,1 C 6,1 1,6 1,12 C 1,19 12,31 12,31 C 12,31 23,19 23,12 C 23,6 18,1 12,1 Z" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>
        <circle cx="12" cy="11" r="4.5" fill="#ffffff"/>
      </svg>
    `;
  }

  // 3D Teardrop Pawn SVG (matches screenshot)
  function pawnSvg(color) {
    return `
      <svg viewBox="0 0 32 40" width="100%" height="100%" class="pawn-svg">
        <defs>
          <linearGradient id="pawn-g-${color}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${color === 'red' ? '#ff4d4d' : color === 'green' ? '#38df64' : color === 'yellow' ? '#ffe033' : '#3399ff'}"/>
            <stop offset="100%" stop-color="${color === 'red' ? '#b31512' : color === 'green' ? '#006b2b' : color === 'yellow' ? '#c48800' : '#004da6'}"/>
          </linearGradient>
        </defs>
        <ellipse cx="16" cy="35" rx="10" ry="3.5" fill="rgba(0,0,0,0.35)"/>
        <ellipse cx="16" cy="33" rx="9" ry="2.6" fill="rgba(0,0,0,0.2)"/>
        <path d="M 8,32 C 8,26 12.5,20 12.5,15 C 10.5,13.5 8,11.5 8,8 C 8,3.5 11.5,0 16,0 C 20.5,0 24,3.5 24,8 C 24,11.5 21.5,13.5 19.5,15 C 19.5,20 24,26 24,32 Z" fill="url(#pawn-g-${color})" stroke="#ffffff" stroke-width="1.2"/>
        <circle cx="16" cy="8" r="3.6" fill="#ffffff" opacity="0.95"/>
        <circle cx="16" cy="8" r="1.8" fill="url(#pawn-g-${color})"/>
      </svg>
    `;
  }

  // Player Panel HTML (Matching exact Ludo King screenshot)
  function lkPanel(color, rev) {
    const isRev = !!rev;
    return `
      <div class="lk-panel ${isRev ? 'rev' : ''}" id="panel-${color}">
        <div class="lk-badge">${pinMarkerSvg(color)}</div>
        <div class="lk-dice-box" id="dice-slot-${color}">
          ${dieH(1)}
        </div>
      </div>
    `;
  }

  function renderPlayerPanels(gs) {
    $('t').innerHTML = lkPanel('red', false) + lkPanel('green', true);
    $('bt').innerHTML = lkPanel('blue', false) + lkPanel('yellow', true);

    const colors = ['red', 'green', 'yellow', 'blue'];
    colors.forEach(col => {
      const panel = $(`panel-${col}`);
      const isCurrent = gs.currentTurnColor === col;
      if (panel) {
        panel.classList.toggle('active', isCurrent);
      }

      // Update yard titles to match player names
      const p = roomState.players.find(pl => pl.color === col);
      const titleEl = $(`yard-title-${col[0]}`);
      if (titleEl && p) {
        titleEl.textContent = p.name;
      }

      // Update 3D Dice display inside the cream dice box
      const dSlot = $(`dice-slot-${col}`);
      if (dSlot) {
        if (isCurrent && gs.lastDice !== null) {
          dSlot.innerHTML = dieH(gs.lastDice, isRolling ? 'roll' : '');
          dSlot.onclick = handleRollClick;
        } else if (isCurrent && gs.phase === 'ROLL') {
          dSlot.innerHTML = dieH(gs.lastDice || 6);
          dSlot.onclick = handleRollClick;
        } else {
          dSlot.innerHTML = dieH(gs.players[col]?.tokens?.every(t => t.progress === -1) ? 6 : 1);
          dSlot.onclick = null;
        }
      }
    });
  }

  function handleRollClick() {
    const gs = roomState?.gameState;
    if (!gs || gs.phase !== 'ROLL') return;
    const isMyTurn = isPassAndPlay || gs.currentTurnColor === myColor;
    if (!isMyTurn) return;

    isRolling = true;
    window.soundEngine.playDiceRoll();

    const dSlot = $(`dice-slot-${gs.currentTurnColor}`);
    if (dSlot) {
      dSlot.innerHTML = dieH(6, 'roll');
    }

    setTimeout(() => {
      isRolling = false;
      sendSocketMessage('ROLL_DICE', { playerId: sessionToken });
    }, 450);
  }

  // Render 3D Teardrop Pawns & Stacks on 15x15 Ludo Board
  function renderTokensOnBoard(gs) {
    // Clear all existing pawns from sockets and cells
    document.querySelectorAll('.pawn-pin').forEach(el => el.remove());
    // Restore empty dots on all sockets
    document.querySelectorAll('.socket-empty-dot').forEach(el => el.style.display = 'block');

    const isMyTurn = isPassAndPlay || gs.currentTurnColor === myColor;
    const validMoves = roomState.validMoves || [];

    const cellGroups = {};

    gs.activeColors.forEach(color => {
      const p = gs.players[color];
      if (!p) return;

      p.tokens.forEach(token => {
        if (token.progress === 56) return; // finished home

        if (token.progress === -1) {
          // In Yard Socket
          const socket = $(`socket-${color[0]}-${token.id}`);
          if (socket) {
            const dot = socket.querySelector('.socket-empty-dot');
            if (dot) dot.style.display = 'none';

            const isMovable = isMyTurn && gs.phase === 'MOVE' && (isPassAndPlay || color === myColor) && validMoves.some(m => m.color === color && m.tokenId === token.id);
            const pawn = document.createElement('div');
            pawn.className = `pawn-pin ${isMovable ? 'movable' : ''}`;
            pawn.innerHTML = pawnSvg(color);
            if (isMovable) {
              pawn.onclick = () => handleTokenClick(color, token.id);
            }
            socket.appendChild(pawn);
          }
        } else {
          // On Track or Home Path
          const coords = window.LudoCoords.getCoordinates(color, token.progress, token.id);
          const cellKey = `${coords.row},${coords.col}`;
          if (!cellGroups[cellKey]) cellGroups[cellKey] = [];
          cellGroups[cellKey].push({ color, token });
        }
      });
    });

    // Render track pawns with stacking badges
    for (const [cellKey, list] of Object.entries(cellGroups)) {
      const [r, c] = cellKey.split(',').map(Number);
      const cell = $(`cell-${r}-${c}`);
      if (!cell) continue;

      const topItem = list[list.length - 1];
      const isMovable = isMyTurn && gs.phase === 'MOVE' && (isPassAndPlay || topItem.color === myColor) && validMoves.some(m => m.color === topItem.color && m.tokenId === topItem.token.id);

      const pawn = document.createElement('div');
      pawn.className = `pawn-pin ${isMovable ? 'movable' : ''}`;
      pawn.innerHTML = pawnSvg(topItem.color);

      // Stack count badge if multiple pawns share the square
      if (list.length > 1) {
        const badge = document.createElement('span');
        badge.className = 'pawn-badge';
        badge.textContent = `x${list.length}`;
        pawn.appendChild(badge);
      }

      if (isMovable) {
        pawn.onclick = () => handleTokenClick(topItem.color, topItem.token.id);
      }

      cell.appendChild(pawn);
    }

    if (gs.lastMoveEvent && !animatingTokens) {
      handleMoveAnimation(gs.lastMoveEvent);
    }
  }

  function handleTokenClick(color, tokenId) {
    const gs = roomState?.gameState;
    if (!gs || gs.phase !== 'MOVE') return;

    window.soundEngine.playTokenHop();
    sendSocketMessage('MOVE_TOKEN', { playerId: sessionToken, tokenId });
  }

  function handleMoveAnimation(event) {
    animatingTokens = true;

    // Hop sound
    window.soundEngine.playTokenHop();

    if (event.captures && event.captures.length > 0) {
      setTimeout(() => {
        window.soundEngine.playCapture();
        toast(`💥 Pawn cut! Extra turn awarded.`);
      }, 250);
    } else if (event.toProgress === 56) {
      setTimeout(() => {
        window.soundEngine.playHome();
      }, 250);
    }

    setTimeout(() => {
      animatingTokens = false;
    }, 350);
  }

  // --- 7. SERVER-DEADLINE TIMER LOOP (requestAnimationFrame) ---
  function startTimerLoop() {
    stopTimerLoop();
    function tick() {
      if (!roomState || !roomState.gameState || roomState.gameState.phase === 'FINISHED') {
        return;
      }

      const gs = roomState.gameState;
      const turnDeadline = gs.turnDeadline || (Date.now() + 30000);
      const remainingMs = Math.max(0, turnDeadline - correctedNow());
      const pct = (remainingMs / 30000) * 100;

      // Color changes: Green -> Yellow (<10s) -> Red (<5s)
      const colorHex = remainingMs < 5000 ? '#ff5d5d' : remainingMs < 10000 ? '#f6c64b' : '#4be08f';

      const panel = $(`panel-${gs.currentTurnColor}`);
      if (panel) {
        panel.style.boxShadow = `0 0 16px ${colorHex}, 0 4px 12px rgba(0,0,0,0.5)`;
        panel.style.borderColor = colorHex;
      }

      // Soft tick sound in last 5 seconds
      const currentSecond = Math.floor(remainingMs / 1000);
      if (currentSecond <= 5 && currentSecond >= 1 && currentSecond !== lastTickSecond) {
        lastTickSecond = currentSecond;
        if (gs.currentTurnColor === myColor) {
          window.soundEngine.playTick();
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
  }

  function stopTimerLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // --- 8. EMOJI REACTIONS (SEND TO ANYONE OR EVERYONE) ---
  const EMOJI_LIST = ['😂', '😍', '😎', '😡', '😭', '👍', '👏', '🔥', '🥳', '🤝'];
  let selectedEmojiTarget = 'all';

  function initEmojiSheet() {
    $('btn-open-emoji').onclick = () => {
      renderEmojiChips();
      renderEmojiGrid();
      $('sheet').classList.add('on');
      $('veil').classList.add('on');
    };

    $('veil').onclick = closeSheets;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSheets();
    });
  }

  function updateProfileDisplay() {
    const dispEl = $('display-name');
    if (dispEl) dispEl.textContent = playerName;
    const avEl = $('home-av');
    if (avEl) avEl.textContent = avatarEmoji;
  }

  function openProfileSheet() {
    $('input-profile-name').value = playerName;
    selectedProfileEmoji = avatarEmoji;
    renderAvatarChips();
    $('profile-sheet').classList.add('on');
    $('veil').classList.add('on');
  }

  function renderAvatarChips() {
    const container = $('avatar-chips');
    if (!container) return;
    container.innerHTML = AVATAR_OPTIONS.map(em => `
      <button class="chip" data-em="${em}" aria-pressed="${selectedProfileEmoji === em}" style="font-size:1.4rem;padding:6px 12px">
        ${em}
      </button>
    `).join('');

    container.querySelectorAll('.chip').forEach(btn => {
      btn.onclick = () => {
        selectedProfileEmoji = btn.dataset.em;
        renderAvatarChips();
      };
    });
  }

  function closeSheets() {
    $('sheet').classList.remove('on');
    $('join-sheet').classList.remove('on');
    const profSheet = $('profile-sheet');
    if (profSheet) profSheet.classList.remove('on');
    $('veil').classList.remove('on');
  }

  function renderEmojiChips() {
    const chipsEl = $('target-chips');
    const players = roomState ? roomState.players : [];

    let h = `<button class="chip" data-t="all" aria-pressed="${selectedEmojiTarget === 'all'}">Everyone</button>`;
    players.forEach(p => {
      if (p.color !== myColor) {
        h += `<button class="chip" data-t="${p.color}" aria-pressed="${selectedEmojiTarget === p.color}">${p.avatarEmoji || '😎'} ${p.name}</button>`;
      }
    });

    chipsEl.innerHTML = h;
    chipsEl.querySelectorAll('.chip').forEach(b => {
      b.onclick = () => {
        selectedEmojiTarget = b.dataset.t;
        renderEmojiChips();
      };
    });
  }

  function renderEmojiGrid() {
    const grid = $('emoji-grid');
    grid.innerHTML = EMOJI_LIST.map(e => `<button>${e}</button>`).join('');
    grid.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const emoji = btn.textContent;
        sendSocketMessage('EMOJI', {
          playerId: sessionToken,
          to: selectedEmojiTarget,
          emoji
        });
        closeSheets();
      };
    });
  }

  function getPanelCenter(color) {
    const el = $(`panel-${color}`) || document.body;
    const rect = el.getBoundingClientRect();
    return [rect.left + rect.width / 2 - 20, rect.top + rect.height / 2 - 20];
  }

  function renderFlyingEmoji(fromColor, toTarget, emoji, senderName) {
    const fly = document.createElement('div');
    fly.className = 'fly';
    fly.innerHTML = `${emoji}<small>${senderName}${toTarget === 'all' ? '' : ' → ' + toTarget.toUpperCase()}</small>`;

    const [startX, startY] = getPanelCenter(fromColor);
    fly.style.left = `${startX}px`;
    fly.style.top = `${startY}px`;
    document.body.appendChild(fly);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (toTarget === 'all') {
          fly.style.top = `${startY - 80}px`;
          fly.style.transform = 'scale(1.7)';
        } else {
          const [destX, destY] = getPanelCenter(toTarget);
          fly.style.left = `${destX}px`;
          fly.style.top = `${destY}px`;
        }
      });
    });

    setTimeout(() => (fly.style.opacity = '0'), 2100);
    setTimeout(() => fly.remove(), 2600);
  }

  // --- 9. WINNER SCREEN & CONFETTI ---
  function renderWinnerScreen(gs) {
    window.soundEngine.playVictory();
    runConfetti();

    const ranksEl = $('ranks');
    const winningOrder = gs.winningOrder || [];
    const iconRanks = ['🥇', '🥈', '🥉', '4'];

    const iWon = winningOrder[0] === myColor;
    $('win-title').textContent = iWon ? 'You won! 🎉' : `${gs.winner?.toUpperCase()} Won!`;
    $('win-subtitle').textContent = iWon
      ? 'Great game. The crown is yours.'
      : `You finished ${gs.players[myColor]?.rank || 4}th. Better luck next time!`;

    let ranksHtml = '';
    winningOrder.forEach((color, idx) => {
      const p = roomState.players.find(pl => pl.color === color);
      const pState = gs.players[color];
      const colorHex = { red: '#e8453c', green: '#22b573', yellow: '#f6a91b', blue: '#2f7df6' };

      ranksHtml += `
        <div class="rk ${idx === 0 ? 'first' : ''}">
          <span class="n">${iconRanks[idx] || idx + 1}</span>
          <span class="av" style="background:${colorHex[color]}">${p?.avatarEmoji || '😎'}</span>
          <b>${p?.name || color}<small>${pState?.capturesCount || 0} captures</small></b>
        </div>
      `;
    });
    ranksEl.innerHTML = ranksHtml;

    const myStats = gs.players[myColor];
    $('st-turns').textContent = gs.turnCount;
    $('st-captured').textContent = myStats?.capturesCount || 0;
    $('st-lost').textContent = myStats?.tokensLostCount || 0;

    // Play again rematch
    $('btn-play-again').onclick = () => {
      if (isHost) {
        sendSocketMessage('START_GAME', { playerId: sessionToken });
      } else {
        toast('Waiting for host to start rematch...');
      }
    };

    $('btn-win-lobby').onclick = () => showScreen('lobby');
    $('btn-win-home').onclick = () => showScreen('home');
  }

  function runConfetti() {
    const cv = $('cv');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;

    const colors = ['#e8453c', '#22b573', '#f6a91b', '#2f7df6', '#fff'];
    const particles = [...Array(120)].map(() => ({
      x: Math.random() * cv.width,
      y: -20 - Math.random() * cv.height * 0.5,
      v: 2 + Math.random() * 4,
      s: 5 + Math.random() * 7,
      c: colors[Math.floor(Math.random() * 5)],
      r: Math.random() * 6,
      w: Math.random() * 0.2
    }));

    const startTime = Date.now();
    function step() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (Date.now() - startTime > 4200) return;
      particles.forEach(p => {
        p.y += p.v;
        p.r += p.w;
        p.x += Math.sin(p.r);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      });
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Initial Boot
  window.addEventListener('DOMContentLoaded', () => {
    initHome();
    initEmojiSheet();
  });
})();
