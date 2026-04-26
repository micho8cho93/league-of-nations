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

The Colyseus room name is `league`. Creating a room generates a short room code used as the Colyseus `roomId`, so clients can create a lobby and later join it by ID. Players may only join while the room status is `"lobby"`. When the host sends `startGame`, the room locks, status changes to `"playing"`, future joins are rejected, and all connected clients receive a `gameStarted` snapshot.

Supported client-to-server messages:

- `updateSettings`: host-only, lobby-only settings update.
- `playerReady`: lobby-only readiness toggle/update.
- `startGame`: host-only, locks the lobby and starts the room.
