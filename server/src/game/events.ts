import type { ServerGameState } from "./initialGame.js";

type Nation = ServerGameState["nations"][string];
type Tile = ServerGameState["map"]["tiles"][number];

export type ServerEventModifier = {
  resource?: "food" | "materials" | "education" | "industry" | "money" | "all";
  multiplier: number;
};

export type ServerActiveEvent = {
  id: string;
  eventId: string;
  name: string;
  label: string;
  description: string;
  effect: string;
  startedTurn: number;
  expiresTurn: number;
  duration: number;
  modifiers: ServerEventModifier[];
};

type ServerEventDefinition = {
  id: string;
  name: string;
  description: string;
  effect: string;
  duration: number;
  modifiers?: ServerEventModifier[];
  apply?: (game: ServerGameState, rng: () => number) => string[];
};

const TILE_TYPES = {
  EMPTY: "empty",
  WATER: "water",
  MOUNTAIN: "mountain",
  FISHERY: "fishery",
  MOUNTAIN_MINE: "mountainMine",
} as const;

export const SERVER_EVENTS: ServerEventDefinition[] = [
  {
    id: "economic_crisis",
    name: "Economic Crisis",
    description: "Markets contract and treasury income slows.",
    effect: "Money output -10% for 2 turns. Active nations lose a small share of current money.",
    duration: 2,
    modifiers: [{ resource: "money", multiplier: 0.9 }],
    apply(game, rng) {
      return activeNations(game).map((nation) => {
        const lost = Math.ceil(nation.money * (0.08 + rng() * 0.04));
        nation.money = Math.max(0, nation.money - lost);
        incrementStat(nation, "eventsSuffered", 1);
        return `${nation.name} lost $${lost}`;
      });
    },
  },
  {
    id: "resource_boom",
    name: "Resource Boom",
    description: "New deposits and harvests improve production.",
    effect: "Food and materials output +25% for 2 turns.",
    duration: 2,
    modifiers: [
      { resource: "food", multiplier: 1.25 },
      { resource: "materials", multiplier: 1.25 },
    ],
  },
  {
    id: "natural_disaster",
    name: "Natural Disaster",
    description: "A regional disaster disrupts developed tiles.",
    effect: "One developed non-capital tile per active nation may be disabled for 2 turns.",
    duration: 1,
    apply(game, rng) {
      const results: string[] = [];
      for (const nation of activeNations(game)) {
        const targets = game.map.tiles.filter((tile) => {
          return tile.ownerId === nation.id && tile.type !== TILE_TYPES.EMPTY && tile.type !== TILE_TYPES.WATER && !tile.isCapital;
        });
        if (!targets.length) continue;
        const tile = targets[randInt(rng, 0, targets.length - 1)];
        tile.effects.disabledTurns = Math.max(tile.effects.disabledTurns || 0, 2);
        incrementStat(nation, "eventsSuffered", 1);
        results.push(`${nation.name} had a ${tile.type} disabled for 2 turns`);
      }
      return results;
    },
  },
  {
    id: "knowledge_renaissance",
    name: "Knowledge Renaissance",
    description: "Education spreads quickly across active nations.",
    effect: "Education output +25% for 2 turns. Active nations gain education immediately.",
    duration: 2,
    modifiers: [{ resource: "education", multiplier: 1.25 }],
    apply(game, rng) {
      return activeNations(game).map((nation) => {
        const education = randInt(rng, 16, 36);
        nation.resources.education = resourceCount(nation, "education") + education;
        return `${nation.name} gained ${education} education`;
      });
    },
  },
  {
    id: "flood_season",
    name: "Flood Season",
    description: "Coastal and water-adjacent lands flood temporarily.",
    effect: "Food output -15% for 1 turn. One coastal land tile may be flooded.",
    duration: 1,
    modifiers: [{ resource: "food", multiplier: 0.85 }],
    apply(game, rng) {
      const results: string[] = [];
      for (const nation of activeNations(game)) {
        const candidates = game.map.tiles.filter((tile) => tile.ownerId === nation.id && isLand(tile) && neighbors(game, tile).some(isWaterLike));
        if (!candidates.length) continue;
        const tile = candidates[randInt(rng, 0, candidates.length - 1)];
        tile.effects.floodedTurns = Math.max(tile.effects.floodedTurns || 0, 1);
        results.push(`${nation.name} had a coastal tile flooded`);
      }
      return results;
    },
  },
];

export function maybeTriggerEvent(
  game: ServerGameState,
  options: { force?: boolean; eventId?: string; chance?: number } = {},
) {
  expireEvents(game);
  if (game.gameOver) return null;
  const activeEvents = ensureActiveEvents(game);
  const history = ensureEventHistory(game);
  const rng = seededRng(`${game.settings.seed}:${game.turn}:${history.length}:events`);
  const chance = options.chance ?? 0.22;
  if (!options.force && rng() >= chance) return null;

  const definition = eventDefinition(options.eventId, rng);
  const activeEvent: ServerActiveEvent = {
    id: uniqueId("active-event"),
    eventId: definition.id,
    name: definition.name,
    label: definition.name,
    description: definition.description,
    effect: definition.effect,
    startedTurn: game.turn,
    expiresTurn: game.turn + Math.max(1, definition.duration) - 1,
    duration: Math.max(1, definition.duration),
    modifiers: definition.modifiers || [],
  };

  const results = definition.apply?.(game, rng) || [];
  activeEvents.push(activeEvent);
  history.push({ ...activeEvent, results, triggeredTurn: game.turn });
  addEvent(game, `${definition.name}: ${definition.description}`, { type: "global_event" });
  if (history.length > 80) history.shift();
  return { ...activeEvent, results };
}

export function expireEvents(game: ServerGameState) {
  const activeEvents = ensureActiveEvents(game);
  const before = activeEvents.length;
  const kept = activeEvents.filter((event) => Number(event.expiresTurn) >= game.turn);
  activeEvents.splice(0, activeEvents.length, ...kept);
  return before - kept.length;
}

export function tickEventTileEffects(game: ServerGameState) {
  for (const tile of game.map.tiles) {
    if (tile.effects.disabledTurns > 0) tile.effects.disabledTurns -= 1;
    if (tile.effects.floodedTurns > 0) tile.effects.floodedTurns -= 1;
    if (tile.effects.bountifulTurns > 0) tile.effects.bountifulTurns -= 1;
  }
}

export function applyEventModifiers(
  game: ServerGameState,
  resource: "food" | "materials" | "education" | "industry" | "money",
  value: number,
) {
  let modified = value;
  for (const event of ensureActiveEvents(game)) {
    for (const modifier of event.modifiers || []) {
      if (modifier.resource !== "all" && modifier.resource !== resource) continue;
      modified *= Number(modifier.multiplier) || 1;
    }
  }
  return Math.max(0, Math.ceil(modified));
}

function eventDefinition(eventId: string | undefined, rng: () => number) {
  const requested = eventId ? SERVER_EVENTS.find((event) => event.id === eventId) : null;
  return requested || SERVER_EVENTS[randInt(rng, 0, SERVER_EVENTS.length - 1)]!;
}

function ensureActiveEvents(game: ServerGameState) {
  const state = game as ServerGameState & { activeEvents?: ServerActiveEvent[] };
  if (!Array.isArray(state.activeEvents)) state.activeEvents = [];
  return state.activeEvents;
}

function ensureEventHistory(game: ServerGameState) {
  const state = game as ServerGameState & { eventHistory?: Array<Record<string, unknown>> };
  if (!Array.isArray(state.eventHistory)) state.eventHistory = [];
  return state.eventHistory;
}

function activeNations(game: ServerGameState) {
  return Object.values(game.nations).filter((nation) => nation.active);
}

function neighbors(game: ServerGameState, tile: Tile) {
  const ids = new Set([
    `${tile.q + 1}:${tile.r}`,
    `${tile.q - 1}:${tile.r}`,
    `${tile.q}:${tile.r + 1}`,
    `${tile.q}:${tile.r - 1}`,
    `${tile.q + 1}:${tile.r - 1}`,
    `${tile.q - 1}:${tile.r + 1}`,
  ]);
  return game.map.tiles.filter((candidate) => ids.has(candidate.id));
}

function isLand(tile?: Tile | null) {
  return tile && tile.terrain === "land" && !isWaterLike(tile) && tile.type !== TILE_TYPES.MOUNTAIN;
}

function isWaterLike(tile?: Tile | null) {
  return Boolean(tile && (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.FISHERY));
}

function resourceCount(nation: Nation, resource: string) {
  const numeric = Number(nation.resources?.[resource]);
  return Number.isFinite(numeric) ? numeric : 0;
}

function incrementStat(nation: Nation, key: string, amount: number) {
  const numeric = Number(nation.stats[key]);
  nation.stats[key] = (Number.isFinite(numeric) ? numeric : 0) + amount;
}

function addEvent(game: ServerGameState, message: string, options: { type?: string; nationId?: string | null; tileId?: string | null } = {}) {
  game.events.push({
    id: uniqueId("event"),
    turn: game.turn,
    era: game.era,
    phase: game.phase,
    nationId: options.nationId || null,
    type: options.type || "info",
    tileId: options.tileId || null,
    message,
    timestamp: Date.now(),
  });
  if (game.events.length > 140) game.events.shift();
}

function randInt(rng: () => number, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function seededRng(input: string) {
  let seed = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    seed ^= input.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
