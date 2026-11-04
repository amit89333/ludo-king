// Ludo Online Client Controller

(function () {
  // Generate or retrieve persistent playerId
  let playerId = localStorage.getItem('ludo_player_id');
  if (!playerId) {
    playerId = 'usr_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem('ludo_player_id', playerId);
  }

  let playerName = localStorage.getItem('ludo_player_name') || `Player ${Math.floor(100 + Math.random() * 900)}`;

  let ws = null;
  let roomCode = null;
  let roomState = null;
  let myColor = null;
  let isHost = false;
  let boardRenderer = null;
  let timerInterval = null;

  // Dice face unicode / dots
  const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  // DOM Elements
  const elHeader = document.getElementById('game-header');
  const elLobby = document.getElementById('lobby-view');
  const elWaiting = document.getElementById('waiting-view');
  const elArena = document.getElementById('arena-view');

  const elPlayerName = document.getElementById('player-name-input');
  const elCreateRoomBtn = document.getElementById('btn-create-room');
  const elJoinCodeInput = document.getElementById('join-code-input');
  const elJoinRoomBtn = document.getElementById('btn-join-room');

  const elWaitingCode = document.getElementById('waiting-room-code');
  const elCopyLinkBtn = document.getElementById('btn-copy-invite');
  const elSeatsContainer = document.getElementById('seats-container');
  const elStartGameBtn = document.getElementById('btn-start-game');

  const elTurnBadge = document.getElementById('turn-player-badge');
  const elTimerSeconds = document.getElementById('timer-seconds');
  const elTimerBar = document.getElementById('timer-progress-bar');
  const elActionText = document.getElementById('action-text');

  const elDiceCube = document.getElementById('dice-cube');
  const elRollBtn = document.getElementById('btn-roll-dice');
  const elReactionBtns = document.querySelectorAll('.emoji-btn');

  const elWinnerModal = document.getElementById('winner-modal');
  const elWinnerName = document.getElementById('winner-name');
  const elPlayAgainBtn = document.getElementById('btn-play-again');
  const elMuteBtn = document.getElementById('btn-toggle-mute');

  // Initialize Name Input
  if (elPlayerName) {
    elPlayerName.value = playerName;
    elPlayerName.addEventListener('change', (e) => {
      playerName = e.target.value.trim() || playerName;
      localStorage.setItem('ludo_player_name', playerName);
    });
  }

  // Check URL params for room code invite (e.g. ?room=ABCD)
  const urlParams = new URLSearchParams(window.location.search);
  const invitedRoom = urlParams.get('room');
  if (invitedRoom && elJoinCodeInput) {
    elJoinCodeInput.value = invitedRoom.toUpperCase();
  }

  // Mute button
  if (elMuteBtn) {
    elMuteBtn.textContent = window.soundManager.muted ? '🔇' : '🔊';
    elMuteBtn.addEventListener('click', () => {
      const isMuted = window.soundManager.toggleMute();
      elMuteBtn.textContent = isMuted ? '🔇' : '🔊';
    });
  }

  // Initialize Board Renderer
  boardRenderer = new window.LudoBoardRenderer('board-container', (color, tokenId) => {
    handleTokenMove(tokenId);
  });

  // Connect to WebSocket Server
  function connectWebSocket(onOpenCallback) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (onOpenCallback && ws.readyState === WebSocket.OPEN) onOpenCallback();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
      console.log('Connected to Ludo Server');
      if (onOpenCallback) onOpenCallback();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('Failed to parse message', e);
      }
    };

    ws.onclose = () => {
      console.warn('Socket closed. Auto-reconnecting in 2s...');
      setTimeout(() => {
        if (roomCode) {
          connectWebSocket(() => {
            // Rejoin room
            sendSocketMessage('JOIN_ROOM', {
              code: roomCode,
              playerId,
              playerName,
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

  function handleServerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'ROOM_CREATED':
      case 'ROOM_JOINED': {
        roomCode = payload.code;
        myColor = payload.player.color;
        isHost = payload.player.isHost;

        // Update URL so player can copy or refresh cleanly
        const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${roomCode}`;
        window.history.replaceState({ path: newUrl }, '', newUrl);

        updateRoomState(payload.roomState);
        break;
      }

      case 'ROOM_STATE': {
        updateRoomState(payload);
        break;
      }

      case 'REACTION': {
        showFloatingReaction(payload.emoji, payload.color);
        break;
      }

      case 'ERROR': {
        alert(payload.message || 'Error occurred');
        break;
      }

      default:
        break;
    }
  }

  function updateRoomState(state) {
    roomState = state;
    if (!state) return;

    // Determine current user role & color
    const me = state.players.find((p) => p.id === playerId);
    if (me) {
      myColor = me.color;
      isHost = me.isHost;
    }

    if (!state.started) {
      // Waiting room view
      showView('waiting');
      renderWaitingRoom();
    } else {
      // Game arena view
      showView('arena');
      renderArena();
    }
  }

  function showView(view) {
    elLobby.style.display = view === 'lobby' ? 'flex' : 'none';
    elWaiting.style.display = view === 'waiting' ? 'flex' : 'none';
    elArena.style.display = view === 'arena' ? 'flex' : 'none';
    elHeader.style.display = view === 'lobby' ? 'none' : 'flex';
  }

  // --- WAITING ROOM ---
  function renderWaitingRoom() {
    elWaitingCode.textContent = roomState.code;

    const colors = ['red', 'green', 'yellow', 'blue'];
    let seatsHtml = '';

    colors.forEach((color) => {
      const occupant = roomState.players.find((p) => p.color === color);
      const isVacant = !occupant;

      seatsHtml += `
        <div class="seat-card ${color}">
          <div class="seat-info">
            <span class="seat-player-name">${
              occupant ? occupant.name : 'Empty Seat'
            } ${occupant && occupant.id === playerId ? '(You)' : ''}</span>
            <span class="seat-tag">${
              occupant
                ? occupant.isHost
                  ? '👑 Host'
                  : occupant.isBot
                  ? '🤖 Bot'
                  : '🟢 Player'
                : 'Available'
            }</span>
          </div>
          ${
            isHost && isVacant
              ? `<button class="bot-btn" onclick="window.toggleBot('${color}')">+ Add Bot</button>`
              : isHost && occupant && occupant.isBot
              ? `<button class="bot-btn" onclick="window.toggleBot('${color}')">Remove</button>`
              : ''
          }
        </div>
      `;
    });

    elSeatsContainer.innerHTML = seatsHtml;

    if (isHost) {
      elStartGameBtn.style.display = 'flex';
      elStartGameBtn.disabled = roomState.players.length < 2;
    } else {
      elStartGameBtn.style.display = 'none';
    }
  }

  window.toggleBot = function (color) {
    sendSocketMessage('TOGGLE_BOT', { playerId, color });
  };

  // --- ARENA ---
  function renderArena() {
    const gs = roomState.gameState;
    if (!gs) return;

    // 1. Update Board
    boardRenderer.render(gs, roomState.validMoves, myColor);

    // 2. Update Turn Banner
    const isMyTurn = gs.currentTurnColor === myColor;
    const currentPlayerData = roomState.players.find((p) => p.color === gs.currentTurnColor);
    const turnName = currentPlayerData
      ? `${currentPlayerData.name} ${isMyTurn ? '(You)' : ''}`
      : gs.currentTurnColor;

    elTurnBadge.innerHTML = `
      <span class="color-dot ${gs.currentTurnColor}"></span>
      <span>${isMyTurn ? "Your Turn!" : `${turnName}'s Turn`}</span>
    `;

    // 3. Update Turn Timer Bar
    const timeLeft = roomState.turnTimeRemaining !== undefined ? roomState.turnTimeRemaining : 30;
    elTimerSeconds.textContent = `${timeLeft}s`;
    const pct = Math.max(0, Math.min(100, (timeLeft / 30) * 100));
    elTimerBar.style.width = `${pct}%`;

    if (timeLeft <= 5) {
      elTimerBar.classList.add('urgent');
      if (isMyTurn && timeLeft > 0) {
        window.soundManager.playTick();
      }
    } else {
      elTimerBar.classList.remove('urgent');
    }

    // 4. Update Dice
    const lastDice = gs.lastDice || 1;
    elDiceCube.textContent = DICE_FACES[lastDice] || '⚅';

    // 5. Update Action / Status Text
    elActionText.textContent = gs.lastActionDescription || '';

    // 6. Update Dice Roll Button State
    const canRoll = isMyTurn && gs.phase === 'ROLL';
    elRollBtn.disabled = !canRoll;

    // 7. Check Winner
    if (gs.phase === 'FINISHED' && gs.winner) {
      const winnerPlayer = roomState.players.find((p) => p.color === gs.winner);
      elWinnerName.textContent = winnerPlayer ? winnerPlayer.name : gs.winner;
      elWinnerModal.style.display = 'flex';
      window.soundManager.playVictory();
    } else {
      elWinnerModal.style.display = 'none';
    }
  }

  function handleRollDice() {
    if (!roomState || !roomState.gameState) return;
    if (roomState.gameState.currentTurnColor !== myColor) return;
    if (roomState.gameState.phase !== 'ROLL') return;

    window.soundManager.playDiceRoll();
    elDiceCube.classList.add('rolling');

    setTimeout(() => {
      elDiceCube.classList.remove('rolling');
      sendSocketMessage('ROLL_DICE', { playerId });
    }, 400);
  }

  function handleTokenMove(tokenId) {
    if (!roomState || !roomState.gameState) return;
    if (roomState.gameState.currentTurnColor !== myColor) return;
    if (roomState.gameState.phase !== 'MOVE') return;

    window.soundManager.playTokenMove();
    sendSocketMessage('MOVE_TOKEN', { playerId, tokenId });
  }

  function showFloatingReaction(emoji, color) {
    const reaction = document.createElement('div');
    reaction.className = 'floating-reaction';
    reaction.textContent = emoji;

    // Position near the board center or bottom
    reaction.style.left = `${35 + Math.random() * 30}%`;
    reaction.style.bottom = `${30 + Math.random() * 20}%`;

    const arena = document.getElementById('arena-view');
    if (arena) {
      arena.appendChild(reaction);
      setTimeout(() => reaction.remove(), 1800);
    }
  }

  // Event Listeners
  if (elCreateRoomBtn) {
    elCreateRoomBtn.addEventListener('click', () => {
      connectWebSocket(() => {
        sendSocketMessage('CREATE_ROOM', { playerId, playerName });
      });
    });
  }

  if (elJoinRoomBtn) {
    elJoinRoomBtn.addEventListener('click', () => {
      const code = (elJoinCodeInput.value || '').trim();
      if (!code) return alert('Please enter 4-letter room code');
      connectWebSocket(() => {
        sendSocketMessage('JOIN_ROOM', { code, playerId, playerName });
      });
    });
  }

  if (elCopyLinkBtn) {
    elCopyLinkBtn.addEventListener('click', () => {
      const inviteUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?room=${roomCode}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(inviteUrl);
        elCopyLinkBtn.textContent = '✅ Copied!';
        setTimeout(() => (elCopyLinkBtn.textContent = '📋 Copy Invite Link'), 2000);
      } else {
        prompt('Copy this link:', inviteUrl);
      }
    });
  }

  if (elStartGameBtn) {
    elStartGameBtn.addEventListener('click', () => {
      sendSocketMessage('START_GAME', { playerId });
    });
  }

  if (elRollBtn) {
    elRollBtn.addEventListener('click', handleRollDice);
  }
  if (elDiceCube) {
    elDiceCube.addEventListener('click', handleRollDice);
  }

  if (elReactionBtns) {
    elReactionBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        sendSocketMessage('REACTION', { playerId, emoji });
      });
    });
  }

  if (elPlayAgainBtn) {
    elPlayAgainBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }
})();
