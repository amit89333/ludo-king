# Ludo Online: Project Spec

## Goal
Real-time multiplayer Ludo for 2-4 friends, playable in the browser on phones and desktops.

## Stack
- **Backend:** Node.js, Express / Native HTTP + WebSocket (or Socket.IO), TypeScript / modern JavaScript
- **Frontend:** Responsive Web App, board drawn with crisp vector SVG, mobile-first design
- **Tests:** Vitest & Node 24 native test runner (`node:test`, `node:assert`)
- **Hosting:** Free & safe deployment options: Render (Web Service Free Tier), Railway, or Fly.io with WebSocket support

## Folder Structure
- `/shared/game`: Pure game logic. No networking, no UI. Fully unit-tested.
- `/server`: WebSocket / Socket.IO rooms, player seats, turn handling, reconnection, and timers. Single source of truth.
- `/client`: Renders the game state it receives, sends player intents (`roll`, `moveToken`, `reaction`). Contains no game rules.
- `/public`: Static assets, sound synthesis / audio effects, icons.

## Architecture Rules
1. The server rolls the dice. Clients only send intents (`roll`, `moveToken`).
2. Validate every action on the server: right player, right turn, legal move.
3. Game state is plain JSON so it can be broadcast and tested easily.
4. Random number generator is injectable so tests and simulations are deterministic.

## Game Rules
- 4 colors: `red`, `green`, `yellow`, `blue`, with 4 tokens each.
- A **6** is needed to move a token out of base onto the start cell.
- Rolling a **6** gives an extra turn. Three 6s in a row forfeits the turn immediately.
- Landing on an opponent's token **captures** it (sends it back to base), unless the cell is a safe square.
- Safe squares: 8 designated safe cells where tokens can never be captured.
- An **exact roll** is needed to reach the final home cell. Overshooting is invalid.
- The first player to bring all 4 tokens home wins.
- If no legal move exists after a roll, the turn passes automatically.

## Board Model
- Shared track: 52 cells, numbered 0 to 51 clockwise.
- Start cells:
  - Red: `0`
  - Green: `13`
  - Yellow: `26`
  - Blue: `39`
- Safe squares: `0, 8, 13, 21, 26, 34, 39, 47`.
- Token progress values:
  - `-1`: in base
  - `0` to `50`: on the track (51 steps from token's own start cell)
  - `51` to `55`: in player's private home column (cannot be captured)
  - `56`: finished (home center)
- Absolute track cell formula:
  - `(color start cell + relative progress) mod 52` (valid only while progress is 0 to 50).
- Tokens in the home column (`51` to `55`) or finished (`56`) can never be captured.

## Rooms and Connection
- The host creates a room and receives a 4-letter room code (e.g. `LUDO`).
- Other players join using the 4-letter code.
- Each player receives a persistent `playerId` stored in local storage, allowing seamless reconnect to their assigned seat after a refresh or network drop.
- 30-second turn timer. On timeout, auto-roll and auto-move the first valid token.
- Empty rooms are cleaned up after inactivity.

## Quality Bar
- Mobile-first layout, tested at 375px (mobile) and 1280px (desktop) widths.
- Sound effects (dice roll, token move, capture, win) synthesized natively with Web Audio API (no external asset download failures, zero lag).
- Smooth token moving animations and 3D dice rolling animations.
- Safe and 100% Free deployment instructions with production server and 1-click deploy configuration (`render.yaml`, Dockerfile, README).
