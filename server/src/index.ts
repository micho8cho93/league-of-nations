import { defineRoom, defineServer, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LeagueRoom } from "./rooms/LeagueRoom.js";

const port = Number(process.env.PORT ?? 2567);
const localFrontendOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
];
const configuredClientOrigins = parseOriginList(process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || "*");
const allowAnyClientOrigin = configuredClientOrigins.includes("*");
const allowedClientOrigins = new Set([
  ...localFrontendOrigins,
  ...configuredClientOrigins.filter((origin) => origin !== "*"),
]);

matchMaker.controller.getCorsHeaders = (headers) => {
  const origin = headers.get("origin");

  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "*",
      Vary: "Origin",
    };
  }

  return {
    "Access-Control-Allow-Origin": allowAnyClientOrigin || allowedClientOrigins.has(origin) ? origin : "null",
    Vary: "Origin",
  };
};

const server = defineServer({
  transport: new WebSocketTransport(),
  express: (app) => {
    app.get("/health", (_req: unknown, res: HealthResponse) => {
      res.status(200).send("ok");
    });
  },
  rooms: {
    league: defineRoom(LeagueRoom),
  },
});

await server.listen(port, "0.0.0.0", undefined, () => {
  console.log(`Colyseus server running on port ${port}`);
});

function parseOriginList(value: string) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

type HealthResponse = {
  status: (code: number) => {
    send: (body: string) => void;
  };
};
