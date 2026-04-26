import type { ServerGameState } from "./initialGame.js";

type PlayerActionPayload = {
  tileId?: unknown;
  buildingType?: unknown;
};

type ActionResult = { ok: true; [key: string]: unknown } | { ok: false; reason: string };

const MAX_ACTIONS_PER_TURN = 10;

const TILE_TYPES = {
  EMPTY: "empty",
  FARM: "farm",
  MINE: "mine",
  SCHOOL: "school",
  FACTORY: "factory",
  MILITARY: "military",
  WATER: "water",
  MOUNTAIN: "mountain",
} as const;

const BUILDING_TYPES = [
  TILE_TYPES.FARM,
  TILE_TYPES.MINE,
  TILE_TYPES.SCHOOL,
  TILE_TYPES.FACTORY,
  TILE_TYPES.MILITARY,
];

const WORKER_MIN: Record<string, number> = {
  [TILE_TYPES.FARM]: 2,
  [TILE_TYPES.MINE]: 3,
  [TILE_TYPES.SCHOOL]: 3,
  [TILE_TYPES.FACTORY]: 5,
  [TILE_TYPES.MILITARY]: 4,
};

const BUILD_COST: Record<string, number> = {
  [TILE_TYPES.FARM]: 140,
  [TILE_TYPES.MINE]: 190,
  [TILE_TYPES.SCHOOL]: 230,
  [TILE_TYPES.MILITARY]: 330,
  [TILE_TYPES.FACTORY]: 780,
};

const BUILD_ERA_MULTIPLIERS = {
  era3: 1.65,
  era4: 2.35,
};

const FACTORY_ERA_4_BUILD_COST = 1250;

const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
];

export function applyServerPlayerAction(
  game: ServerGameState,
  type: string,
  nationId: string,
  payload: PlayerActionPayload,
): ActionResult {
  if (type === "buildTile") {
    return buildTile(game, String(payload.tileId || ""), String(payload.buildingType || ""), nationId);
  }

  return { ok: false, reason: `Unsupported multiplayer action: ${type}.` };
}

function buildTile(game: ServerGameState, tileId: string, type: string, nationId: string): ActionResult {
  const check = canBuild(game, tileId, type, nationId);
  if (!check.ok) return check;

  const action = spendAction(game, nationId, 1);
  if (!action.ok) return action;

  const nation = game.nations[nationId];
  const tile = tileById(game, tileId);
  if (!nation || !tile) return { ok: false, reason: "Build target is unavailable." };
  if (nation.money < check.cost) return { ok: false, reason: "Not enough money." };

  nation.money -= check.cost;
  nation.stats.moneySpent = Number(nation.stats.moneySpent || 0) + check.cost;
  tile.ownerId = nationId;
  tile.type = type;
  tile.workers = 0;
  tile.unit = null;
  nation.stats.built = Number(nation.stats.built || 0) + 1;
  recomputeTerritories(game);
  addEvent(game, `${nation.name} built a ${typeLabel(type)} for $${check.cost}.`, {
    nationId,
    type: "build",
    tileId: tile.id,
  });

  return { ok: true, cost: check.cost };
}

function canBuild(
  game: ServerGameState,
  tileId: string,
  type: string,
  nationId: string,
): { ok: true; cost: number } | { ok: false; reason: string } {
  const nation = game.nations[nationId];
  const tile = tileById(game, tileId);
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  if (!tile || !isLand(tile)) return { ok: false, reason: "Buildings require land." };
  if (tile.type !== TILE_TYPES.EMPTY) return { ok: false, reason: "Tile is already developed." };
  if (tile.ownerId && tile.ownerId !== nationId) return { ok: false, reason: "Cannot build on foreign territory." };
  if (!BUILDING_TYPES.includes(type as (typeof BUILDING_TYPES)[number])) return { ok: false, reason: "Unknown building type." };
  if (!tileTypeUnlocked(type, game.era)) return { ok: false, reason: "This building is not unlocked yet." };

  if (!tile.ownerId) {
    const adjacentOwned = neighbors(game, tile.id).some((neighbor) => neighbor.ownerId === nationId);
    if (!adjacentOwned && nation.territory.length > 0) {
      return { ok: false, reason: "Unowned tiles must border your territory." };
    }
  }

  if (type === TILE_TYPES.FACTORY) {
    const factoryCheck = canBuildFactory(game, nationId);
    if (!factoryCheck.ok) return factoryCheck;
  }

  const cost = buildingCost(type, game.era);
  if (nation.money < cost) return { ok: false, reason: `Requires $${cost}.` };
  return { ok: true, cost };
}

function spendAction(game: ServerGameState, nationId: string, amount: number): ActionResult {
  const nation = game.nations[nationId];
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  const cost = Math.max(1, Math.floor(Number(amount) || 1));
  nation.actionsRemaining = normalizeActionCount(nation.actionsRemaining, MAX_ACTIONS_PER_TURN);
  nation.actionsUsedThisTurn = normalizeActionCount(nation.actionsUsedThisTurn, 0);
  if (nation.actionsRemaining < cost) return { ok: false, reason: "No actions remaining this turn." };
  nation.actionsRemaining -= cost;
  nation.actionsUsedThisTurn += cost;
  return { ok: true };
}

function canBuildFactory(game: ServerGameState, nationId: string): ActionResult {
  if (game.era < 3) return { ok: false, reason: "Factories unlock in Era 3." };
  const nation = game.nations[nationId];
  if (!nation) return { ok: false, reason: "Nation is inactive." };
  const factories = activeTiles(game, nationId, TILE_TYPES.FACTORY).length;
  const requiredMines = 3 + factories * 2;
  const requiredSchools = 2 + factories * 2;
  const requiredPopulation = 35 + factories * 8;
  if ((nation.tech.mining || 0) < 2) return { ok: false, reason: "Requires Mining tier 2." };
  if ((nation.tech.education || 0) < 2) return { ok: false, reason: "Requires Education tier 2." };
  if (activeTiles(game, nationId, TILE_TYPES.MINE).length < requiredMines) return { ok: false, reason: `Requires ${requiredMines} active mines.` };
  if (activeTiles(game, nationId, TILE_TYPES.SCHOOL).length < requiredSchools) return { ok: false, reason: `Requires ${requiredSchools} active schools.` };
  if (nation.population.total < requiredPopulation) return { ok: false, reason: `Requires ${requiredPopulation} population.` };
  return { ok: true };
}

function activeTiles(game: ServerGameState, nationId: string, type: string) {
  return game.map.tiles.filter((tile) => tile.ownerId === nationId && tile.type === type && isTileActive(tile));
}

function isTileActive(tile: ServerGameState["map"]["tiles"][number]) {
  if (!tile || !WORKER_MIN[tile.type]) return false;
  if (tile.effects?.disabledTurns > 0 || tile.effects?.floodedTurns > 0) return false;
  return (tile.workers || 0) >= WORKER_MIN[tile.type];
}

function tileTypeUnlocked(type: string, era: number) {
  if (type === TILE_TYPES.FACTORY) return era >= 3;
  return type !== TILE_TYPES.WATER;
}

function buildingCost(type: string, era: number) {
  const base = BUILD_COST[type] || 0;
  if (type === TILE_TYPES.FACTORY) return era >= 4 ? FACTORY_ERA_4_BUILD_COST : BUILD_COST[TILE_TYPES.FACTORY];
  if (era >= 4) return Math.ceil(base * BUILD_ERA_MULTIPLIERS.era4);
  if (era >= 3) return Math.ceil(base * BUILD_ERA_MULTIPLIERS.era3);
  return base;
}

function tileById(game: ServerGameState, id: string) {
  return game.map.tiles.find((tile) => tile.id === id) || null;
}

function neighbors(game: ServerGameState, id: string) {
  const tile = tileById(game, id);
  if (!tile) return [];
  return HEX_DIRECTIONS
    .map((dir) => tileByCoords(game, tile.q + dir.q, tile.r + dir.r))
    .filter((neighbor): neighbor is NonNullable<typeof neighbor> => Boolean(neighbor));
}

function tileByCoords(game: ServerGameState, q: number, r: number) {
  return game.map.tiles.find((tile) => tile.q === q && tile.r === r) || null;
}

function isLand(tile?: ServerGameState["map"]["tiles"][number] | null) {
  return tile && tile.terrain === "land" && tile.type !== TILE_TYPES.WATER && tile.type !== TILE_TYPES.MOUNTAIN;
}

function recomputeTerritories(game: ServerGameState) {
  for (const nation of Object.values(game.nations)) {
    nation.territory = game.map.tiles.filter((tile) => tile.ownerId === nation.id).map((tile) => tile.id);
    nation.capitalTileId = game.map.tiles.find((tile) => tile.ownerId === nation.id && tile.isCapital)?.id || nation.capitalTileId;
  }
}

function addEvent(
  game: ServerGameState,
  message: string,
  options: { nationId?: string | null; type?: string; tileId?: string | null } = {},
) {
  const entry = {
    id: `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    turn: game.turn,
    era: game.era,
    phase: game.phase,
    nationId: options.nationId || null,
    type: options.type || "info",
    tileId: options.tileId || null,
    message,
    timestamp: Date.now(),
  };
  game.events.push(entry);
  if (game.events.length > 140) game.events.shift();

  const nation = options.nationId ? game.nations[options.nationId] : null;
  const history = nation?.stats.history;
  if (Array.isArray(history)) {
    history.unshift({
      turn: game.turn,
      message,
      type: options.type || "action",
    });
    if (history.length > 12) history.pop();
  }
}

function normalizeActionCount(value: unknown, fallback: number) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(MAX_ACTIONS_PER_TURN, numeric));
}

function typeLabel(type: string) {
  if (type === TILE_TYPES.MILITARY) return "Military Base";
  return String(type).replace(/^\w/, (letter) => letter.toUpperCase());
}
