import { defineRoom, defineServer } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LeagueRoom } from "./rooms/LeagueRoom.js";

const port = Number(process.env.PORT ?? 2567);

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: {
    league: defineRoom(LeagueRoom),
  },
});

server.listen(port);

console.log(`League of Nations Colyseus server listening on ws://localhost:${port}`);
