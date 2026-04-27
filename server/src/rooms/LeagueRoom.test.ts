import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LeagueRoom } from "./LeagueRoom.js";
import { DEFAULT_VICTORY_CONFIG, SERVER_PLAYER_ACTION_TYPES, processServerRound } from "../game/actions.js";
import { expireEvents, maybeTriggerEvent } from "../game/events.js";
import { createInitialServerGame, serializeGameSnapshot } from "../game/initialGame.js";

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
    turnTimerMinutes: 0,
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

function workerTile(gameState: any, nationId = "nation-1", type = "farm") {
  const tile = gameState.map.tiles.find((item: any) => (
    item.ownerId === nationId &&
    item.type === type
  ));
  assert.ok(tile, `expected ${nationId} to have an owned ${type} tile`);
  return tile;
}

function latestRejection(client: ReturnType<typeof fakeClient>) {
  return client.sent.findLast((message) => message.type === "actionRejected")?.payload.message || "";
}

function latestRejectionPayload(client: ReturnType<typeof fakeClient>) {
  return client.sent.findLast((message) => message.type === "actionRejected")?.payload || null;
}

function clearMessages(client: ReturnType<typeof fakeClient>) {
  client.sent.length = 0;
}

function setResources(nation: any, values: Record<string, number>) {
  nation.resources = { ...nation.resources, ...values };
}

function resetActions(gameState: any, nationId = "nation-1") {
  gameState.nations[nationId].actionPoints = 5;
  gameState.nations[nationId].maxActionPoints = 5;
  gameState.nations[nationId].actionsRemaining = 5;
  gameState.nations[nationId].actionsUsedThisTurn = 0;
}

function tileAt(gameState: any, q: number, r: number) {
  return gameState.map.tiles.find((tile: any) => tile.q === q && tile.r === r);
}

function neighborsOf(gameState: any, tile: any) {
  const directions = [
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: -1, r: 1 },
  ];
  return directions.map((dir) => tileAt(gameState, tile.q + dir.q, tile.r + dir.r)).filter(Boolean);
}

function prepareTile(tile: any, values: Record<string, unknown>) {
  Object.assign(tile, {
    terrain: "land",
    landform: "continent",
    type: "empty",
    ownerId: null,
    workers: 0,
    unit: null,
    isCapital: false,
    effects: { disabledTurns: 0, floodedTurns: 0, bountifulTurns: 0 },
    ...values,
  });
}

function makeOwnedTile(gameState: any, nationId: string, type: string, workers = 0) {
  const tile = gameState.map.tiles.find((item: any) => (
    item.terrain === "land" &&
    !item.isCapital &&
    (item.ownerId !== nationId || item.type !== type)
  ));
  assert.ok(tile, "expected a reusable land tile");
  prepareTile(tile, { ownerId: nationId, type, workers });
  if (!gameState.nations[nationId].territory.includes(tile.id)) gameState.nations[nationId].territory.push(tile.id);
  return tile;
}

function makeAdjacentPair(gameState: any) {
  for (const from of gameState.map.tiles) {
    if (from.terrain !== "land" || from.isCapital) continue;
    const to = neighborsOf(gameState, from).find((tile: any) => tile.terrain === "land" && !tile.isCapital);
    if (to) return { from, to };
  }
  assert.fail("expected an adjacent land tile pair");
}

function makeOwnedAnchorWithNeighbor(gameState: any, neighborValues: Record<string, unknown>, nationId = "nation-1") {
  const { from, to } = makeAdjacentPair(gameState);
  prepareTile(from, { ownerId: nationId, type: "empty" });
  prepareTile(to, neighborValues);
  if (!gameState.nations[nationId].territory.includes(from.id)) gameState.nations[nationId].territory.push(from.id);
  return { anchor: from, target: to };
}

function clientGameplayActionTypes() {
  const uiSource = readFileSync(new URL("../../../js/ui.js", import.meta.url), "utf8");
  return Array.from(uiSource.matchAll(/sendPlayerAction\(\s*\{[\s\S]*?type:\s*"([^"]+)"/g), (match) => match[1]).sort();
}

test("creator gets the first nation", async () => {
  const room = await createRoom();
  const creator = join(room, "creator", "Creator");

  assert.equal(room.state.players.get("creator")?.nationId, "nation-1");
  assert.equal(creator.sent.find((message) => message.type === "joinedLobby")?.payload.nationId, "nation-1");
});

test("new server nations include default population happiness", () => {
  const gameState = createInitialServerGame(
    { mapSize: "Small", nationCount: 2, maxTurns: 30, turnTimerMinutes: 0, unlimitedMode: false, seed: 12345 },
    [
      { sessionId: "creator", playerName: "Creator", nationId: "nation-1", controllerType: "human", bot: false },
      { sessionId: "second", playerName: "Second", nationId: "nation-2", controllerType: "human", bot: false },
    ],
  );

  assert.equal(gameState.nations["nation-1"].population.happiness, 65);
  assert.equal(gameState.nations["nation-2"].population.happiness, 65);
  assert.equal(gameState.nations["nation-1"].reputation, 0);
  assert.deepEqual(gameState.tradeProposals, []);
  assert.deepEqual(gameState.warLog, []);
  assert.deepEqual(gameState.activeEvents, []);
  assert.deepEqual(gameState.eventHistory, []);
});

test("new server nations start each turn with five action points", () => {
  const gameState = createInitialServerGame(
    { mapSize: "Small", nationCount: 2, maxTurns: 30, turnTimerMinutes: 0, unlimitedMode: false, seed: 12345 },
    [
      { sessionId: "creator", playerName: "Creator", nationId: "nation-1", controllerType: "human", bot: false },
      { sessionId: "second", playerName: "Second", nationId: "nation-2", controllerType: "human", bot: false },
    ],
  );

  assert.equal(gameState.nations["nation-1"].actionPoints, 5);
  assert.equal(gameState.nations["nation-1"].maxActionPoints, 5);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 5);
  assert.equal(gameState.nations["nation-1"].actionsUsedThisTurn, 0);
});

test("server snapshots preserve population happiness", () => {
  const gameState = createInitialServerGame(
    { mapSize: "Small", nationCount: 2, maxTurns: 30, turnTimerMinutes: 0, unlimitedMode: false, seed: 12345 },
    [
      { sessionId: "creator", playerName: "Creator", nationId: "nation-1", controllerType: "human", bot: false },
      { sessionId: "second", playerName: "Second", nationId: "nation-2", controllerType: "human", bot: false },
    ],
  );
  gameState.nations["nation-1"].population.happiness = 12;

  const snapshot = serializeGameSnapshot(gameState);

  assert.equal(snapshot.gameState.nations["nation-1"].population.happiness, 12);
});

test("second player gets a different available nation", async () => {
  const room = await createRoom();
  join(room, "creator", "Creator");
  const second = join(room, "second", "Second");

  assert.equal(room.state.players.get("second")?.nationId, "nation-2");
  assert.equal(second.sent.find((message) => message.type === "joinedLobby")?.payload.nationId, "nation-2");
  assert.notEqual(room.state.players.get("creator")?.name, room.state.players.get("second")?.name);
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

test("room settings use turnTimerMinutes and accept legacy timeLimitMinutes", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");

  room.messages.updateSettings(creator.client, { turnTimerMinutes: 4 });
  assert.equal(room.state.settings.turnTimerMinutes, 4);

  room.messages.updateSettings(creator.client, { timeLimitMinutes: 7 });
  assert.equal(room.state.settings.turnTimerMinutes, 7);
});

test("room settings preserve map options and happiness toggle", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");

  room.messages.updateSettings(creator.client, {
    waterLevel: "High",
    landscapeDiversity: "Low",
    happinessEnabled: false,
  });

  assert.equal(room.state.settings.waterLevel, "High");
  assert.equal(room.state.settings.landscapeDiversity, "Low");
  assert.equal(room.state.settings.happinessEnabled, false);

  const gameState = startGame(room, creator);
  const snapshot = (room as any).createInitialGameSnapshot();

  assert.equal(gameState.settings.waterLevel, "High");
  assert.equal(gameState.settings.landscapeDiversity, "Low");
  assert.equal(gameState.settings.happinessEnabled, false);
  assert.equal(snapshot.settings.waterLevel, "High");
  assert.equal(snapshot.settings.landscapeDiversity, "Low");
  assert.equal(snapshot.settings.happinessEnabled, false);
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
  assert.equal(gameState.nations["nation-1"].actionPoints, 4);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 4);
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

test("action points reject exhausted and spoofed client actions", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  const tile = workerTile(gameState, "nation-1", "farm");

  for (const amount of [1, -1, 1, -1, 1]) {
    clearMessages(creator);
    await room.messages.playerAction(creator.client, {
      type: "assignWorkers",
      nationId: "nation-1",
      tileId: tile.id,
      amount,
    });
    assert.equal(latestRejection(creator), "");
  }

  assert.equal(nation.actionPoints, 0);
  assert.equal(nation.actionsRemaining, 0);
  const beforeWorkers = tile.workers;

  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-1",
    tileId: tile.id,
    amount: -1,
    actionPoints: 99,
    maxActionPoints: 99,
    actionsRemaining: 99,
  });

  assert.equal(tile.workers, beforeWorkers);
  assert.equal(nation.actionPoints, 0);
  assert.match(latestRejection(creator), /action points/i);
});

test("fishery builds on adjacent water and land buildings fail there", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 2000;
  nation.tech.farming = 1;
  const { target: water } = makeOwnedAnchorWithNeighbor(gameState, {
    terrain: "water",
    landform: "sea",
    type: "water",
    ownerId: null,
  });

  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId: water.id,
    buildingType: "fishery",
  });

  assert.equal(water.type, "fishery");
  assert.equal(water.ownerId, "nation-1");
  assert.equal(latestRejection(creator), "");

  resetActions(gameState);
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId: water.id,
    buildingType: "farm",
  });

  assert.match(latestRejection(creator), /Buildings require land|already developed/);
});

test("mountain mines require Mining tier 2 and mountain terrain", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 2000;
  const { target: mountain } = makeOwnedAnchorWithNeighbor(gameState, {
    terrain: "land",
    landform: "continent",
    type: "mountain",
    ownerId: null,
  });

  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId: mountain.id,
    buildingType: "mountainMine",
  });
  assert.match(latestRejection(creator), /Mining tier 2/);

  nation.tech.mining = 2;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId: mountain.id,
    buildingType: "mountainMine",
  });

  assert.equal(mountain.type, "mountainMine");
  assert.equal(latestRejection(creator), "");
});

test("universities require Education tier 3", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 2000;
  const tile = makeOwnedTile(gameState, "nation-1", "empty", 0);

  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId: tile.id,
    buildingType: "university",
  });
  assert.match(latestRejection(creator), /Education tier 3/);

  nation.tech.education = 3;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId: tile.id,
    buildingType: "university",
  });

  assert.equal(tile.type, "university");
  assert.equal(latestRejection(creator), "");
});

test("transport buildings are rejected as tile builds", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 5000;
  nation.tech.infrastructure = 4;
  gameState.era = 4;

  for (const buildingType of ["road", "railroad", "highway", "airport"]) {
    resetActions(gameState);
    clearMessages(creator);
    const tile = makeOwnedTile(gameState, "nation-1", "empty", 0);
    await room.messages.playerAction(creator.client, { type: "buildTile", nationId: "nation-1", tileId: tile.id, buildingType });
    assert.match(latestRejection(creator), /Unknown building type/);
    assert.equal(tile.type, "empty");
  }
});

test("active player can assign workers for their own nation", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const tile = workerTile(gameState, "nation-1", "farm");
  const nation = gameState.nations["nation-1"];
  const startingWorkers = tile.workers;
  const startingAvailable = nation.population.available;
  const startingMoney = nation.money;

  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-1",
    tileId: tile.id,
    amount: 1,
  });

  assert.equal(tile.workers, startingWorkers + 1);
  assert.equal(nation.population.available, startingAvailable - 1);
  assert.equal(nation.workers.farmers, 3);
  assert.equal(nation.money, startingMoney - 5);
  assert.equal(nation.actionsRemaining, 4);
  assert.equal(creator.sent.some((message) => message.type === "actionRejected"), false);
  assert.equal((room as any).broadcasts.some((message: any) => message.type === "gameSnapshot"), true);
});

test("player cannot assign workers for another nation", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const foreignTile = workerTile(gameState, "nation-2", "farm");
  const startingWorkers = foreignTile.workers;

  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-1",
    tileId: foreignTile.id,
    amount: 1,
  });

  assert.equal(foreignTile.workers, startingWorkers);
  assert.match(
    creator.sent.find((message) => message.type === "actionRejected")?.payload.message,
    /owned tiles/,
  );
});

test("player cannot assign workers outside their turn", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  const second = join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const secondTile = workerTile(gameState, "nation-2", "farm");

  await room.messages.playerAction(second.client, {
    type: "assignWorkers",
    nationId: "nation-2",
    tileId: secondTile.id,
    amount: 1,
  });

  assert.match(
    second.sent.find((message) => message.type === "actionRejected")?.payload.message,
    /not your turn/,
  );
});

test("end turn hands control to the next active human player", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  const second = join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const startingTurn = gameState.turn;
  gameState.nations["nation-2"].actionPoints = 0;
  gameState.nations["nation-2"].actionsRemaining = 0;
  gameState.nations["nation-2"].actionsUsedThisTurn = 5;

  await room.messages.playerAction(creator.client, {
    type: "endTurn",
    nationId: "nation-1",
  });

  assert.equal(gameState.currentTurnIndex, 1);
  assert.equal(gameState.turn, startingTurn);
  assert.equal(gameState.nations["nation-2"].actionPoints, 5);
  assert.equal(gameState.nations["nation-2"].actionsRemaining, 5);
  assert.equal(gameState.nations["nation-2"].actionsUsedThisTurn, 0);
  assert.equal(latestRejection(creator), "");

  await room.messages.playerAction(creator.client, {
    type: "endTurn",
    nationId: "nation-1",
  });

  assert.match(latestRejection(creator), /not your turn/);

  await room.messages.playerAction(second.client, {
    type: "endTurn",
    nationId: "nation-2",
  });

  assert.equal(gameState.currentTurnIndex, 0);
  assert.equal(gameState.turn, startingTurn + 1);
  assert.equal(latestRejection(second), "");
});

test("turn timer skips expired online turns before accepting stale actions", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  room.messages.updateSettings(creator.client, { turnTimerMinutes: 1 });
  const gameState = startGame(room, creator);
  const tileId = buildableTileId(gameState, "nation-1");

  gameState.turnStartedAt = Date.now() - 61_000;
  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-1",
    tileId,
    buildingType: "farm",
  });

  assert.equal(gameState.currentTurnIndex, 1);
  assert.match(latestRejection(creator), /not your turn/);
  assert.equal(gameState.map.tiles.find((tile: any) => tile.id === tileId).type, "empty");
  assert.ok(gameState.events.some((event: any) => /missed their turn/i.test(event.message)));
  assert.equal((room as any).broadcasts.some((message: any) => message.type === "gameSnapshot"), true);
});

test("generated maps respect water bounds and keep enough viable starting land", () => {
  const validBiomes = new Set(["grassland", "desert", "arctic", "jungle", "woods"]);
	  for (const [seed, mapSize, nationCount] of [
	    [101, "Small", 5],
	    [202, "Medium", 8],
	    [303, "Large", 10],
	    [404, "Extra Large", 14],
	    [505, "Enormous", 16],
	  ] as const) {
    const game = createInitialServerGame({
      mapSize,
      nationCount,
      maxTurns: 30,
      turnTimerMinutes: 0,
      unlimitedMode: false,
      seed,
    }, []);
    const tiles = game.map.tiles;
    const waterRatio = tiles.filter((tile: any) => tile.terrain === "water").length / tiles.length;
    const buildableLand = tiles.filter((tile: any) => tile.terrain === "land" && tile.type !== "mountain" && tile.type !== "water").length;
    const landBiomes = new Set(tiles.filter((tile: any) => tile.terrain === "land").map((tile: any) => tile.biome));
    const regions = new Set(tiles.filter((tile: any) => tile.terrain === "land" && tile.regionId).map((tile: any) => tile.regionId));
    const index = new Map(tiles.map((tile: any) => [tile.id, tile]));
    const lakeLikeWaters = tiles.filter((tile: any) => {
      if (tile.terrain !== "water") return false;
      const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, -1],
        [-1, 1],
      ].map(([q, r]) => index.get(`${tile.q + q}:${tile.r + r}`)).filter(Boolean);
      return neighbors.filter((neighbor: any) => neighbor.terrain === "land").length >= 4;
    });

    assert.ok(waterRatio >= 0.19 && waterRatio <= 0.61, `${mapSize} seed ${seed} water ratio ${waterRatio}`);
    assert.ok(buildableLand >= nationCount * 5, `${mapSize} seed ${seed} has enough buildable land`);
    assert.ok(landBiomes.size >= 1, `${mapSize} seed ${seed} should assign land biomes`);
    assert.ok([...landBiomes].every((biome) => validBiomes.has(String(biome))), `${mapSize} seed ${seed} should only assign valid land biomes`);
    assert.ok(regions.size >= 2 || mapSize === "Small", `${mapSize} seed ${seed} should avoid one giant pangea`);
    assert.ok(lakeLikeWaters.length > 0, `${mapSize} seed ${seed} should include lake-like inland water`);
    for (const nation of Object.values(game.nations) as any[]) {
      assert.ok(nation.capitalTileId, `${nation.id} should receive a capital`);
      assert.ok(nation.territory.length > 0, `${nation.id} should receive territory`);
    }
  }
});

test("generated maps follow water coverage presets", () => {
  for (const [waterLevel, min, max] of [
    ["Low", 0.2, 0.32],
    ["Balanced", 0.34, 0.46],
    ["High", 0.49, 0.6],
  ] as const) {
    const game = createInitialServerGame({
      mapSize: "Medium",
      waterLevel,
      landscapeDiversity: "Balanced",
      nationCount: 5,
      maxTurns: 30,
      turnTimerMinutes: 0,
      unlimitedMode: false,
      happinessEnabled: true,
      seed: 98765,
    }, []);
    const waterRatio = game.map.tiles.filter((tile: any) => tile.terrain === "water").length / game.map.tiles.length;
    const buildableLand = game.map.tiles.filter((tile: any) => tile.terrain === "land" && tile.type !== "mountain" && tile.type !== "water").length;

    assert.ok(waterRatio >= min && waterRatio <= max, `${waterLevel} water ratio ${waterRatio}`);
    assert.ok(buildableLand >= game.settings.nationCount * 5, `${waterLevel} should keep viable land`);
  }
});

test("invalid worker counts are rejected", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const tile = workerTile(gameState, "nation-1", "farm");
  const nation = gameState.nations["nation-1"];
  const startingWorkers = tile.workers;
  const startingAvailable = nation.population.available;

  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-1",
    tileId: tile.id,
    amount: startingAvailable + 1,
  });

  assert.equal(tile.workers, startingWorkers);
  assert.equal(nation.population.available, startingAvailable);
  assert.match(
    creator.sent.find((message) => message.type === "actionRejected")?.payload.message,
    /available population/,
  );

  creator.sent.length = 0;
  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-1",
    tileId: tile.id,
    amount: -(startingWorkers + 1),
  });

  assert.equal(tile.workers, startingWorkers);
  assert.match(
    creator.sent.find((message) => message.type === "actionRejected")?.payload.message,
    /remove more workers/,
  );
});

test("assignWorkers is recognized by the multiplayer action router", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const tile = workerTile(gameState, "nation-1", "farm");

  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-1",
    tileId: tile.id,
    amount: 0,
  });

  const rejection = creator.sent.find((message) => message.type === "actionRejected")?.payload.message;
  assert.match(rejection, /No worker change requested/);
  assert.doesNotMatch(rejection, /Unsupported multiplayer action/);
});

test("every frontend gameplay action has a server handler", () => {
  const serverSupported = new Set([...SERVER_PLAYER_ACTION_TYPES, "endTurn"]);
  const frontendTypes = clientGameplayActionTypes();

  assert.ok(frontendTypes.length > 0, "expected to discover gameplay action types in js/ui.js");
  assert.deepEqual(
    frontendTypes.filter((type) => !serverSupported.has(type)),
    [],
  );
});

test("destroyTile works online", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const tile = makeOwnedTile(gameState, "nation-1", "mine", 2);
  const nation = gameState.nations["nation-1"];
  const startingMoney = nation.money;

  await room.messages.playerAction(creator.client, {
    type: "destroyTile",
    nationId: "nation-1",
    tileId: tile.id,
  });

  assert.equal(tile.type, "empty");
  assert.equal(tile.workers, 0);
  assert.equal(nation.money, startingMoney - 70);
  assert.equal(nation.actionsRemaining, 4);
  assert.equal(latestRejection(creator), "");
});

test("trainUnit works online", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const tile = makeOwnedTile(gameState, "nation-1", "military", 4);
  const nation = gameState.nations["nation-1"];
  nation.money = 1000;
  nation.population.available = 20;
  setResources(nation, { materials: 20 });

  await room.messages.playerAction(creator.client, {
    type: "trainUnit",
    nationId: "nation-1",
    tileId: tile.id,
    strength: 3,
    branch: "infantry",
  });

  assert.equal(tile.unit?.nationId, "nation-1");
  assert.equal(tile.unit?.strength, 3);
  assert.equal(nation.actionsRemaining, 4);
  assert.equal(latestRejection(creator), "");
});

test("moveOrAttackUnit movement works online", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const { from, to } = makeAdjacentPair(gameState);
  prepareTile(from, {
    ownerId: "nation-1",
    type: "military",
    workers: 4,
    unit: { nationId: "nation-1", strength: 4, branch: "infantry", movedTurn: 0, branches: { infantry: 4 } },
  });
  prepareTile(to, { ownerId: null, type: "empty" });
  gameState.nations["nation-1"].money = 1000;

  await room.messages.playerAction(creator.client, {
    type: "moveOrAttackUnit",
    nationId: "nation-1",
    fromTileId: from.id,
    toTileId: to.id,
  });

  assert.equal(from.unit, null);
  assert.equal(to.ownerId, "nation-1");
  assert.equal(to.unit?.strength, 4);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 4);
  assert.equal(latestRejection(creator), "");
});

test("low happiness can make military refuse movement online without spending resources", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.gameId = "";
  gameState.roomId = "";
  const { from, to } = makeAdjacentPair(gameState);
  prepareTile(from, {
    ownerId: "nation-1",
    type: "military",
    workers: 4,
    unit: { nationId: "nation-1", strength: 4, branch: "infantry", movedTurn: 0, branches: { infantry: 4 } },
  });
  prepareTile(to, { ownerId: null, type: "empty" });
  const nation = gameState.nations["nation-1"];
  nation.money = 1000;
  nation.population.happiness = 0;

  await room.messages.playerAction(creator.client, {
    type: "moveOrAttackUnit",
    nationId: "nation-1",
    fromTileId: from.id,
    toTileId: to.id,
  });

  assert.equal(from.unit?.strength, 4);
  assert.equal(to.ownerId, null);
  assert.equal(nation.money, 1000);
  assert.equal(nation.actionsRemaining, 5);
  assert.match(latestRejection(creator), /refused orders/);
});

test("disabled happiness does not make military refuse movement online", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.settings.happinessEnabled = false;
  gameState.gameId = "";
  gameState.roomId = "";
  const { from, to } = makeAdjacentPair(gameState);
  prepareTile(from, {
    ownerId: "nation-1",
    type: "military",
    workers: 4,
    unit: { nationId: "nation-1", strength: 4, branch: "infantry", movedTurn: 0, branches: { infantry: 4 } },
  });
  prepareTile(to, { ownerId: null, type: "empty" });
  const nation = gameState.nations["nation-1"];
  nation.money = 1000;
  nation.population.happiness = 0;

  await room.messages.playerAction(creator.client, {
    type: "moveOrAttackUnit",
    nationId: "nation-1",
    fromTileId: from.id,
    toTileId: to.id,
  });

  assert.equal(from.unit, null);
  assert.equal(to.ownerId, "nation-1");
  assert.equal(to.unit?.strength, 4);
  assert.equal(nation.actionsRemaining, 4);
  assert.equal(latestRejection(creator), "");
});

test("declareWar and moveOrAttackUnit attack work online", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 3;
  gameState.nations["nation-1"].money = 1000;
  const { from, to } = makeAdjacentPair(gameState);
  prepareTile(from, {
    ownerId: "nation-1",
    type: "military",
    workers: 4,
    unit: { nationId: "nation-1", strength: 10, branch: "infantry", movedTurn: 0, branches: { infantry: 10 } },
  });
  prepareTile(to, { ownerId: "nation-2", type: "empty", workers: 0 });

  await room.messages.playerAction(creator.client, {
    type: "declareWar",
    nationId: "nation-1",
    targetId: "nation-2",
  });

  assert.equal(Boolean(gameState.wars["nation-1::nation-2"]?.active), true);
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "moveOrAttackUnit",
    nationId: "nation-1",
    fromTileId: from.id,
    toTileId: to.id,
  });

  assert.equal(to.ownerId, "nation-1");
  assert.equal(to.unit?.nationId, "nation-1");
  assert.equal(latestRejection(creator), "");
});

test("research and researchBranch work online", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 5000;
  setResources(nation, { food: 100, materials: 300, education: 300, industry: 100 });
  makeOwnedTile(gameState, "nation-1", "farm", 2);
  makeOwnedTile(gameState, "nation-1", "farm", 2);

  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "farming",
  });

  assert.equal(nation.tech.farming, 1);
  assert.equal(nation.actionPoints, 4);
  assert.equal(latestRejection(creator), "");

  gameState.era = 4;
  nation.tech.military = 3;
  resetActions(gameState);
  makeOwnedTile(gameState, "nation-1", "factory", 5);
  clearMessages(creator);

  await room.messages.playerAction(creator.client, {
    type: "researchBranch",
    nationId: "nation-1",
    branch: "tanks",
  });

  assert.equal(nation.tech.branches.tanks, 1);
  assert.equal(nation.actionPoints, 4);
  assert.equal(latestRejection(creator), "");
});

test("researchTech rejects invalid category, max tier, missing money, resource, active tiles, and AP spoofing", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 5000;
  setResources(nation, { food: 100, materials: 300, education: 300, industry: 100 });
  makeOwnedTile(gameState, "nation-1", "farm", 2);
  makeOwnedTile(gameState, "nation-1", "farm", 2);

  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "irrigation",
  });
  assert.match(latestRejection(creator), /Unknown technology/);

  clearMessages(creator);
  nation.tech.farming = 4;
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "farming",
  });
  assert.match(latestRejection(creator), /Maximum linear tier/);

  clearMessages(creator);
  nation.tech.farming = 0;
  nation.money = 0;
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "farming",
  });
  assert.match(latestRejection(creator), /Requires \$260/);

  clearMessages(creator);
  nation.money = 5000;
  nation.resources.food = 0;
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "farming",
  });
  assert.match(latestRejection(creator), /Requires \d+ food/);

  clearMessages(creator);
  nation.resources.food = 100;
  for (const tile of gameState.map.tiles.filter((item: any) => item.ownerId === "nation-1" && item.type === "farm")) {
    tile.workers = 0;
  }
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "farming",
  });
  assert.match(latestRejection(creator), /active farming tiles/);

  clearMessages(creator);
  for (const tile of gameState.map.tiles.filter((item: any) => item.ownerId === "nation-1" && item.type === "farm")) {
    tile.workers = 2;
  }
  nation.actionPoints = 0;
  nation.actionsRemaining = 0;
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "farming",
    tech: { farming: 4 },
    cost: 0,
    actionPoints: 99,
  });
  assert.equal(nation.tech.farming, 0);
  assert.match(latestRejection(creator), /action points/i);
});

test("researchBranch rejects era, military tier, factory, resource, max level, and AP failures", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 5000;
  setResources(nation, { materials: 300, education: 300, industry: 100 });
  nation.tech.military = 3;

  await room.messages.playerAction(creator.client, {
    type: "researchBranch",
    nationId: "nation-1",
    branch: "tanks",
  });
  assert.match(latestRejection(creator), /Era 4/);

  gameState.era = 4;
  nation.tech.military = 2;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchBranch",
    nationId: "nation-1",
    branch: "tanks",
  });
  assert.match(latestRejection(creator), /Military tier 3/);

  nation.tech.military = 3;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchBranch",
    nationId: "nation-1",
    branch: "tanks",
  });
  assert.match(latestRejection(creator), /active factory/);

  makeOwnedTile(gameState, "nation-1", "factory", 5);
  nation.resources.materials = 0;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchBranch",
    nationId: "nation-1",
    branch: "tanks",
  });
  assert.match(latestRejection(creator), /materials/);

  nation.resources.materials = 300;
  nation.tech.branches.tanks = 3;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchBranch",
    nationId: "nation-1",
    branch: "tanks",
  });
  assert.match(latestRejection(creator), /fully specialized/);

  nation.tech.branches.tanks = 0;
  nation.actionPoints = 0;
  nation.actionsRemaining = 0;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchBranch",
    nationId: "nation-1",
    branch: "tanks",
    cost: { money: 0, materials: 0, education: 0, industry: 0 },
    actionPoints: 99,
  });
  assert.equal(nation.tech.branches.tanks, 0);
  assert.match(latestRejection(creator), /action points/i);
});

test("infrastructure research uses starter requirements then tech-only era gates", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const nation = gameState.nations["nation-1"];
  nation.money = 8000;
  setResources(nation, { materials: 500, education: 300, food: 100, industry: 100 });

  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.match(latestRejection(creator), /active mine/);

  const mine = makeOwnedTile(gameState, "nation-1", "mine", 3);
  const school = gameState.map.tiles.find((tile: any) => tile.id !== mine.id && tile.terrain === "land" && !tile.isCapital);
  assert.ok(school, "expected a separate school tile");
  prepareTile(school, { ownerId: "nation-1", type: "school", workers: 3 });
  if (!nation.territory.includes(school.id)) nation.territory.push(school.id);
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.equal(nation.tech.infrastructure, 1);
  assert.equal(latestRejection(creator), "");

  resetActions(gameState);
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.match(latestRejection(creator), /Era 2/);

  gameState.era = 2;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.equal(nation.tech.infrastructure, 2);
  assert.equal(latestRejection(creator), "");

  resetActions(gameState);
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.match(latestRejection(creator), /Era 3/);

  gameState.era = 3;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.equal(nation.tech.infrastructure, 3);
  assert.equal(latestRejection(creator), "");

  resetActions(gameState);
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.match(latestRejection(creator), /Era 4/);

  gameState.era = 4;
  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "researchTech",
    nationId: "nation-1",
    category: "infrastructure",
  });
  assert.equal(nation.tech.infrastructure, 4);
  assert.equal(latestRejection(creator), "");
});

test("trade, alliance, and breakAlliance work online", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 2;
  const nation = gameState.nations["nation-1"];
  nation.money = 1000;

  await room.messages.playerAction(creator.client, {
    type: "trade",
    nationId: "nation-1",
    partnerId: "nation-2",
    offer: { money: 100 },
    request: {},
  });

  assert.equal(gameState.trades.length, 1);
  assert.equal(latestRejection(creator), "");
  clearMessages(creator);

  await room.messages.playerAction(creator.client, {
    type: "proposeAlliance",
    nationId: "nation-1",
    partnerId: "nation-2",
    allianceType: "trade",
  });

  const alliance = gameState.alliances.find((item: any) => item.active);
  assert.ok(alliance, "expected an active alliance");
  assert.equal(latestRejection(creator), "");
  clearMessages(creator);

  await room.messages.playerAction(creator.client, {
    type: "breakAlliance",
    nationId: "nation-1",
    allianceId: alliance.id,
  });

  assert.equal(alliance.active, false);
  assert.equal(latestRejection(creator), "");
});

test("trade proposal is created through the dedicated server message", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 2;
  gameState.nations["nation-1"].money = 1000;

  await room.messages.proposeTrade(creator.client, {
    nationId: "nation-1",
    partnerId: "nation-2",
    offer: { money: 100 },
    request: { food: 5 },
  });

  assert.equal(gameState.tradeProposals.length, 1);
  assert.equal(gameState.tradeProposals[0].fromId, "nation-1");
  assert.equal(gameState.tradeProposals[0].toId, "nation-2");
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 4);
  assert.equal(latestRejection(creator), "");
});

test("accepted trade proposal transfers resources and removes proposal", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  const second = join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 2;
  gameState.nations["nation-1"].money = 1000;
  setResources(gameState.nations["nation-2"], { food: 50 });

  await room.messages.proposeTrade(creator.client, {
    nationId: "nation-1",
    partnerId: "nation-2",
    offer: { money: 100 },
    request: { food: 5 },
  });
  const proposalId = gameState.tradeProposals[0].id;
  gameState.currentTurnIndex = 1;
  resetActions(gameState, "nation-2");

  await room.messages.acceptTrade(second.client, {
    nationId: "nation-2",
    proposalId,
  });

  assert.equal(gameState.tradeProposals.length, 0);
  assert.equal(gameState.nations["nation-1"].money, 900);
  assert.equal(gameState.nations["nation-2"].money, 1090);
  assert.equal(gameState.nations["nation-1"].resources.food, 63);
  assert.equal(gameState.nations["nation-2"].resources.food, 45);
  assert.equal(gameState.trades.length, 1);
  assert.equal(gameState.nations["nation-2"].actionsRemaining, 4);
  assert.equal(latestRejection(second), "");
});

test("invalid trade proposal is rejected without spending action points", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 2;
  gameState.nations["nation-1"].money = 10;

  await room.messages.proposeTrade(creator.client, {
    nationId: "nation-1",
    partnerId: "nation-2",
    offer: { money: 100 },
    request: {},
  });

  assert.equal(gameState.tradeProposals.length, 0);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 5);
  assert.match(latestRejection(creator), /cannot afford/);
});

test("trade proposal can be rejected through the dedicated server message", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  const second = join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 2;
  gameState.nations["nation-1"].money = 1000;

  await room.messages.proposeTrade(creator.client, {
    nationId: "nation-1",
    partnerId: "nation-2",
    offer: { money: 100 },
    request: {},
  });
  const proposalId = gameState.tradeProposals[0].id;
  gameState.currentTurnIndex = 1;

  await room.messages.rejectTrade(second.client, {
    nationId: "nation-2",
    proposalId,
  });

  assert.equal(gameState.tradeProposals.length, 0);
  assert.equal(latestRejection(second), "");
});

test("dedicated attack changes tile ownership, spends action points, and increases war exhaustion", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 3;
  gameState.nations["nation-1"].money = 1000;
  const { from, to } = makeAdjacentPair(gameState);
  prepareTile(from, {
    ownerId: "nation-1",
    type: "military",
    workers: 4,
    unit: { nationId: "nation-1", strength: 10, branch: "infantry", movedTurn: 0, branches: { infantry: 10 } },
  });
  prepareTile(to, { ownerId: "nation-2", type: "empty", workers: 0 });

  await room.messages.playerAction(creator.client, {
    type: "declareWar",
    nationId: "nation-1",
    targetId: "nation-2",
  });
  resetActions(gameState);
  clearMessages(creator);

  await room.messages.attack(creator.client, {
    nationId: "nation-1",
    fromTileId: from.id,
    toTileId: to.id,
  });

  assert.equal(to.ownerId, "nation-1");
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 4);
  assert.ok(gameState.nations["nation-1"].warExhaustion > 0);
  assert.ok(gameState.warLog.length > 0);
  assert.equal(latestRejection(creator), "");
});

test("dedicated attack rejects invalid targets without spending action points", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const { from, to } = makeAdjacentPair(gameState);
  prepareTile(from, {
    ownerId: "nation-1",
    type: "military",
    workers: 4,
    unit: { nationId: "nation-1", strength: 5, branch: "infantry", movedTurn: 0, branches: { infantry: 5 } },
  });
  prepareTile(to, { ownerId: null, type: "empty" });

  await room.messages.attack(creator.client, {
    nationId: "nation-1",
    fromTileId: from.id,
    toTileId: to.id,
  });

  assert.equal(to.ownerId, null);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 5);
  assert.match(latestRejection(creator), /not a valid attack/);
});

test("wrong player, wrong nation, and bot control are rejected", async () => {
  const room = await createRoom(3);
  const creator = join(room, "creator", "Creator");
  const second = join(room, "second", "Second");
  const gameState = startGame(room, creator);

  await room.messages.playerAction(second.client, {
    type: "destroyTile",
    nationId: "nation-1",
    tileId: buildableTileId(gameState, "nation-1"),
  });

  assert.match(latestRejection(second), /do not control/);
  clearMessages(creator);

  await room.messages.playerAction(creator.client, {
    type: "destroyTile",
    nationId: "nation-3",
    tileId: buildableTileId(gameState, "nation-3"),
  });

  assert.match(latestRejection(creator), /do not control|Bot nations/);
});

test("valid gameplay actions no longer hit unsupported-action errors", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);

  for (const type of SERVER_PLAYER_ACTION_TYPES) {
    clearMessages(creator);
    await room.messages.playerAction(creator.client, {
      type,
      nationId: "nation-1",
    });
    assert.doesNotMatch(latestRejection(creator), /Unsupported multiplayer action/, `${type} should be routed`);
  }

  clearMessages(creator);
  await room.messages.playerAction(creator.client, {
    type: "endTurn",
    nationId: "nation-1",
  });
  assert.doesNotMatch(latestRejection(creator), /Unsupported multiplayer action/);
  assert.ok(gameState);
});

test("unsupported multiplayer action returns a structured action error", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  startGame(room, creator);

  await room.messages.playerAction(creator.client, {
    type: "notARealAction",
    nationId: "nation-1",
  });

  const rejection = creator.sent.findLast((message) => message.type === "actionRejected");
  assert.equal(rejection?.payload.type, "ACTION_ERROR");
  assert.equal(rejection?.payload.actionType, "notARealAction");
  assert.match(rejection?.payload.message, /Unsupported multiplayer action/);
});

test("economic victory is set when a nation reaches the configured gold threshold", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.nations["nation-1"].money = DEFAULT_VICTORY_CONFIG.economicGoldThreshold;
  const tile = makeOwnedTile(gameState, "nation-1", "farm", 2);

  await room.messages.playerAction(creator.client, {
    type: "ASSIGN_WORKERS",
    nationId: "nation-1",
    tileId: tile.id,
    amount: -1,
  });

  assert.equal(gameState.gameOver?.isGameOver, true);
  assert.equal(gameState.gameOver?.winnerNationId, "nation-1");
  assert.equal(gameState.gameOver?.victoryType, "economic");
  assert.equal((room as any).state.status, "finished");
});

test("server event trigger stores active event and history", () => {
  const gameState = createInitialServerGame(
    { mapSize: "Small", nationCount: 2, maxTurns: 30, turnTimerMinutes: 0, unlimitedMode: false, seed: 12345 },
    [],
  );

  const event = maybeTriggerEvent(gameState, { force: true, eventId: "resource_boom" });

  assert.equal(event?.eventId, "resource_boom");
  assert.equal(gameState.activeEvents.length, 1);
  assert.equal(gameState.activeEvents[0].eventId, "resource_boom");
  assert.equal(gameState.eventHistory.length, 1);
  assert.ok(gameState.events.some((entry: any) => entry.type === "global_event"));
});

test("server events expire from active state after their duration", () => {
  const gameState = createInitialServerGame(
    { mapSize: "Small", nationCount: 2, maxTurns: 30, turnTimerMinutes: 0, unlimitedMode: false, seed: 12345 },
    [],
  );
  maybeTriggerEvent(gameState, { force: true, eventId: "resource_boom" });

  gameState.turn = 2;
  assert.equal(expireEvents(gameState), 0);
  assert.equal(gameState.activeEvents.length, 1);

  gameState.turn = 3;
  assert.equal(expireEvents(gameState), 1);
  assert.equal(gameState.activeEvents.length, 0);
});

test("active server event modifies resource output", () => {
  const baseGame = createInitialServerGame(
    { mapSize: "Small", nationCount: 2, maxTurns: 30, turnTimerMinutes: 0, unlimitedMode: false, seed: 12345 },
    [],
  );
  const eventGame = createInitialServerGame(
    { mapSize: "Small", nationCount: 2, maxTurns: 30, turnTimerMinutes: 0, unlimitedMode: false, seed: 12345 },
    [],
  );
  const baseFood = baseGame.nations["nation-1"].resources.food;
  const eventFood = eventGame.nations["nation-1"].resources.food;

  processServerRound(baseGame);
  maybeTriggerEvent(eventGame, { force: true, eventId: "resource_boom" });
  processServerRound(eventGame);

  const baseGain = baseGame.nations["nation-1"].resources.food - baseFood;
  const eventGain = eventGame.nations["nation-1"].resources.food - eventFood;
  assert.ok(eventGain > baseGain, `expected event food gain ${eventGain} to exceed base ${baseGain}`);
});

test("actions after game over are rejected", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.gameOver = {
    isGameOver: true,
    winnerNationId: "nation-1",
    winnerId: "nation-1",
    victoryType: "economic",
    label: "Economic Victory",
  };

  await room.messages.playerAction(creator.client, {
    type: "ASSIGN_WORKERS",
    nationId: "nation-1",
    tileId: workerTile(gameState, "nation-1", "farm").id,
    amount: 1,
  });

  assert.match(latestRejection(creator), /already finished/);
});

test("spoofed payload is rejected with a structured ownership error", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const foreignTile = workerTile(gameState, "nation-2", "farm");

  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-2",
    tileId: foreignTile.id,
    amount: 1,
    actionPoints: 99,
    actionsRemaining: 99,
  });

  const rejection = latestRejectionPayload(creator);
  assert.equal(rejection?.code, "OWNERSHIP_MISMATCH");
  assert.match(rejection?.message, /do not control/);
  assert.equal(foreignTile.workers, 2);
});

test("invalid nationId is rejected before action handlers mutate state", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  startGame(room, creator);

  await room.messages.playerAction(creator.client, {
    type: "buildTile",
    nationId: "nation-999",
    tileId: "0:0",
    buildingType: "farm",
  });

  const rejection = latestRejectionPayload(creator);
  assert.equal(rejection?.code, "INVALID_NATION");
  assert.match(rejection?.message, /Unknown nation/);
});

test("invalid tile attack is rejected without spending resources or action points", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const { from } = makeAdjacentPair(gameState);
  prepareTile(from, {
    ownerId: "nation-1",
    type: "military",
    workers: 4,
    unit: { nationId: "nation-1", strength: 8, branch: "infantry", movedTurn: 0, branches: { infantry: 8 } },
  });
  gameState.nations["nation-1"].money = 1000;

  await room.messages.attack(creator.client, {
    nationId: "nation-1",
    fromTileId: from.id,
    toTileId: "missing:tile",
  });

  const rejection = latestRejectionPayload(creator);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 5);
  assert.equal(gameState.nations["nation-1"].money, 1000);
  assert.match(rejection?.message, /Invalid movement|target/i);
});

test("negative resource trade is rejected", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  gameState.era = 2;
  const startingMoney = gameState.nations["nation-1"].money;

  await room.messages.playerAction(creator.client, {
    type: "trade",
    nationId: "nation-1",
    partnerId: "nation-2",
    offer: { money: -50 },
    request: {},
  });

  const rejection = latestRejectionPayload(creator);
  assert.equal(rejection?.code, "INVALID_PAYLOAD");
  assert.match(rejection?.message, /positive/);
  assert.equal(gameState.trades.length, 0);
  assert.equal(gameState.nations["nation-1"].money, startingMoney);
  assert.equal(gameState.nations["nation-1"].actionsRemaining, 5);
});

test("action points cannot go below zero", async () => {
  const room = await createRoom(2);
  const creator = join(room, "creator", "Creator");
  join(room, "second", "Second");
  const gameState = startGame(room, creator);
  const tile = workerTile(gameState, "nation-1", "farm");
  const nation = gameState.nations["nation-1"];
  nation.actionPoints = 0;
  nation.actionsRemaining = 0;
  nation.actionsUsedThisTurn = 5;

  await room.messages.playerAction(creator.client, {
    type: "assignWorkers",
    nationId: "nation-1",
    tileId: tile.id,
    amount: 1,
    actionPoints: 99,
    actionsRemaining: 99,
  });

  const rejection = latestRejectionPayload(creator);
  assert.equal(rejection?.code, "INSUFFICIENT_ACTION_POINTS");
  assert.match(rejection?.message, /action points/i);
  assert.equal(nation.actionPoints, 0);
  assert.equal(nation.actionsRemaining, 0);
  assert.ok(nation.actionPoints >= 0);
});
