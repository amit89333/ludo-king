# 🎲 Ludo Online (Real-Time Multiplayer)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/amit89333/ludo-king)

A responsive, real-time multiplayer Ludo web application for 2–4 players, playable instantly in any mobile or desktop browser without installing any app.

Built following the **Ludo King / Ludo Online Antigravity Spec**.

---

## ✨ Features

- **Real-Time Multiplayer:** Instant synchronization via WebSockets.
- **Mobile-First Responsive Design:** Crisp vector SVG board optimized for 375px mobile screens up to 4K desktop displays.
- **True-to-Life Ludo Rules:**
  - 4 Colors: Red, Green, Yellow, Blue (4 tokens each).
  - Roll a **6** to release tokens from base.
  - Extra turn on rolling a 6.
  - Three consecutive 6s forfeits turn.
  - Capturing opponent tokens sends them back to base.
  - **8 Safe Squares** (0, 8, 13, 21, 26, 34, 39, 47) where tokens cannot be captured.
  - Exact roll required to reach the center finish cell (progress 56).
  - Auto-skips turns if no legal moves exist.
- **Rooms & Matchmaking:**
  - Create room with a 4-letter room code (e.g. `KING`).
  - 1-click **"Copy Invite Link"** to share with friends.
  - **AI Bots Toggle:** Play with 1, 2, or 3 friends and fill remaining seats with smart bots!
  - **30-Second Turn Timer:** With auto-roll & auto-move fallback for AFK players.
  - **Persistent Session & Reconnection:** Saved player ID ensures seamless rejoining if the tab is refreshed or connection drops.
  - **Zero-Latency Sound FX:** Synthesized dynamically with Web Audio API (no external downloads needed, mute toggle included).
  - **Live Emoji Reactions:** Send animated floating emoji reactions during gameplay.

---

## 📁 Project Architecture

```
├── PROJECT.md             # Complete build spec & rules model
├── shared/game/
│   ├── types.ts           # Game state, token, move, and board types
│   ├── engine.ts          # Pure deterministic game logic & RNG
│   └── engine.test.ts     # Unit tests (movement, captures, safe squares, win condition)
├── server/
│   ├── ws.ts              # Lightweight RFC 6455 WebSocket implementation
│   ├── room.ts            # Room management, player seats, turn timers & bots
│   ├── room.test.ts       # Room & 4-player game simulation tests
│   └── server.ts          # Express/HTTP server + static asset router + WebSocket dispatcher
├── public/
│   ├── index.html         # Mobile-first responsive app shell
│   ├── app.css            # Dark mode glassmorphic UI styles
│   ├── board.js           # 15x15 SVG Ludo board & token renderer
│   ├── audio.js           # Native Web Audio sound synthesis
│   └── app.js             # Client state controller & WebSocket handlers
├── Dockerfile             # Multi-cloud deployment container
├── render.yaml            # 1-Click Render.com free deployment blueprint
└── package.json           # Scripts and dependencies
```

---

## 🚀 Running Locally

### 1. Run Unit & Integration Tests
```bash
node --experimental-strip-types --test shared/game/engine.test.ts server/room.test.ts
```

### 2. Start the Server
```bash
node --experimental-strip-types server/server.ts
```
Then open your browser to **`http://localhost:3000`**.

---

## 🌐 Deploy It in a 100% Free and Safe Way

### Option 1: Render.com (Recommended — 100% Free & Supports WebSockets)
Render provides a **free web service tier** with native WebSocket support and automated SSL/HTTPS certificates:

1. Push this project to your GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Ludo Online"
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git branch -M main
   git push -u origin main
   ```
2. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** > **Web Service**.
3. Connect your GitHub repository.
4. Set the following settings:
   - **Environment:** `Node`
   - **Build Command:** `echo "Ready"`
   - **Start Command:** `node --experimental-strip-types server/server.ts`
   - **Plan:** `Free`
5. Click **Create Web Service**.
6. Render will build and deploy your app. You will get a live URL like:
   `https://ludo-online-xxxx.onrender.com`

---

### Option 2: Railway.app (Free Trial Credit)
1. Go to [railway.app](https://railway.app/).
2. Click **New Project** > **Deploy from GitHub repo**.
3. Railway automatically detects the `Dockerfile` or `package.json` and deploys your WebSocket server immediately.

---

### Option 3: Fly.io (Free Tier)
1. Install flyctl: `curl -L https://fly.io/install.sh | sh`
2. Run `fly launch` in this folder.
3. Fly.io will build the included `Dockerfile` and give you a global URL with WebSocket support.

---

### Option 4: Koyeb (Free Hobby Tier)
1. Go to [koyeb.com](https://www.koyeb.com/).
2. Select GitHub repository, set run command to `node --experimental-strip-types server/server.ts`, and deploy with free tier.

---

## 🔒 Safety & Security Best Practices
- **No External CDN/Script Injection:** All scripts, audio synthesis, and SVG boards are hosted locally and self-contained.
- **Path Traversal Protection:** Static file server enforces strict directory boundaries.
- **Input Sanitization:** Player names, room codes, and action payloads are strictly validated on the server.
- **Single Source of Truth:** Clients cannot forge dice rolls or illegal token movements; all state changes are calculated deterministically on the server.
