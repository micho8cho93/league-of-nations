# League of Nations

Browser-based educational turn-based strategy game.

## Colyseus Multiplayer Server

This repo includes a standalone Colyseus backend in `server/` for private online lobby creation and joining. It does not add authentication, accounts, matchmaking, persistence, a database, local saves, or gameplay synchronization yet.

Run the server locally:

```sh
cd server
npm install
npm run dev
```

By default the server listens on `ws://localhost:2567`. You can override the port:

```sh
PORT=3001 npm run dev
```

Build and run the compiled server:

```sh
npm run build
npm start
```

Railway should use the `server/` directory as the service root:

```sh
npm install
npm run build
npm start
```

The server binds to `0.0.0.0` and uses `process.env.PORT || 2567`, which lets Railway route the public domain to the internal process port. Health checks can use `/health`, which returns `ok`.

Set `CLIENT_ORIGIN` or `FRONTEND_URL` to the deployed Vercel origin when it is known. Local development origins on ports `3000`, `5173`, and `127.0.0.1:5500` are allowed by default.

For Vercel frontend deployments, set:

```sh
VITE_COLYSEUS_ENDPOINT=wss://league-of-nations-production.up.railway.app
```

The plain browser frontend also falls back to `window.COLYSEUS_ENDPOINT`, then production hostname detection. Production must use `wss://league-of-nations-production.up.railway.app` without `:2567`; local development uses `ws://localhost:2567`.

The Colyseus room name is `league`. Creating a room generates a short room code used as the Colyseus `roomId`, so clients can create a lobby and later join it by ID. Players may only join while the room status is `"lobby"`. When the host sends `startGame`, the room locks, status changes to `"playing"`, future joins are rejected, and all connected clients receive a `gameStarted` snapshot.

Supported client-to-server messages:

- `updateSettings`: host-only, lobby-only settings update.
- `playerReady`: lobby-only readiness toggle/update.
- `startGame`: host-only, locks the lobby and starts the room.
