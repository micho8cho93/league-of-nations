import test from "node:test";
import assert from "node:assert/strict";
import { LeagueRoom } from "./LeagueRoom.js";

type SentMessage = { type: string; payload: any };

function fakeClient(sessionId: string) {
  const sent: SentMessage[] = [];
  return {
    client: {
      sessionId,
      send(type: string, payload: any) {
        sent.push({ type, payload });
      },
    } as any,
    sent,
  };
}

async function createRoom(nationCount = 3) {
  const room = new LeagueRoom();
  (room as any).presence = {
    smembers: async () => [],
    sadd: async () => {},
    srem: async () => {},
  };
  (room as any).setMetadata = () => {};
  (room as any).broadcast = (type: string, payload: any) => {
    ((room as any).broadcasts ||= []).push({ type, payload });
  };
  (room as any).lock = () => {};
  await room.onCreate({
    mapSize: "Small",
    nationCount,
    maxTurns: 30,
    timeLimitMinutes: 0,
    unlimitedMode: false,
    seed: 12345,
  });
  return room;
}

function join(room: LeagueRoom, sessionId: string, playerName: string, options: Record<string, unknown> = {}) {
  const client = fakeClient(sessionId);
  room.onAuth(client.client, { playerName, ...options });
  room.onJoin(client.client, { playerName, ...options });
  return client;
}

function startGame(room: LeagueRoom, host: ReturnType<typeof fakeClient>) {
  room.messages.startGame(host.client);
  return (room as any).gameState;
}

function buildableTileId(gameState: any, nationId = "nation-1") {
  const tile = gameState.map.tiles.find((item: any) => (
    item.ownerId === nationId &&
    item.terrain === "land" &&
    item.type === "empty"
  ));
  assert.ok(tile, `expected ${nationId} to have an empty owned land tile`);
  return tile.id;
}

test("creator gets the first nation", async () => {
  const room = await createRoom();
  const creator = join(room, "creator", "Creator");

  assert.equal(room.state.players.get("creator")?.nationId, "nation-1");
  assert.equal(creator.sent.find((message) => message.type === "joinedLobby")?.payload.nationId, "nation-1");
});

test("second player gets a different available nation", async () => {
  const room = await createRoom();
  join(room, "creator", "Creator");
  const second = join(room, "second", "Second");

  assert.equal(room.state.players.get("second")?.nationId, "nation-2");
  assert.equal(second.sent.find((message) => message.type === "joinedLobby")?.payload.nationId, "nation-2");
});

test("room rejects duplicate or unavailable nation assignments", async () => {
  const room = await createRoom(2);
  join(room, "creator", "Creator");
  join(room, "second", "Second");

  const assigned = Array.from(room.state.players.values()).map((player) => player.nationId);
  assert.deepEqual(new Set(assigned), new Set(["nation-1", "nation-2"]));

  const duplicate = fakeClient("duplicate");
  assert.throws(
    () => room.onAuth(duplicate.client, { playerName: "Duplicate", nationId: "nation-1" }),
    /already taken|full/,
  );

  const third = fakeClient("third");
  assert.throws(
    () => room.onAuth(third.client, { playerName: "Third" }),
    /full; no nations are available/,
  );
});

test("gameplay build action is accepted for the active player", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const tileId = buildableTileId(gameState, "nation-1");
  const startingMoney = gameState.nations["nation-1"].money;

  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId,
    buildingType: "farm",
  });

  assert.equal(gameState.map.tiles.find((tile: any) => tile.id === tileId).type, "farm");
  assert.equal(gameState.nations["nation-1"].money, startingMoney - 140);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 9);
  assert.equal(creator.sent.some((message) => message.type === "actionRejected"), false);
  assert.equal((room as any).broadcasts.some((message: any) => message.type === "gameSnapshot"), true);
});

test("gameplay build action is rejected for the wrong player or wrong turn", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  const second = join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const creatorTileId = buildableTileId(gameState, "nation-1");
  const secondTileId = buildableTileId(gameState, "nation-2");

  await room.messages.playerAction(second.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId: creatorTileId,
    buildingType: "farm",
  });

  assert.match(
    second.sent.find((message) => message.type === "actionRejected")?.payload.message,
    /do not control/,
  );

  second.sent.length = 0;
  await room.messages.playerAction(second.client, {
    type: "buildTile",
    nationId: "nation-2",
    tileId: secondTileId,
    buildingType: "farm",
  });

  assert.match(
    second.sent.find((message) => message.type === "actionRejected")?.payload.message,
    /not your turn/,
  );
});
