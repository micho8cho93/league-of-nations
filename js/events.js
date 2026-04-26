import { TILE_TYPES, isLand, isWaterLike, randInt } from "./utils.js";
import { addPopulation, removePopulation } from "./nation.js";

export const GLOBAL_EVENTS = [
  {
    id: "economic_crisis",
    label: "Economic Crisis",
    description: "Markets contract and every active nation loses money.",
    apply(game, rng) {
      const results = [];
      for (const nation of Object.values(game.nations).filter((item) => item.active)) {
        const lost = Math.ceil(nation.money * (0.12 + rng() * 0.08));
        nation.money = Math.max(0, nation.money - lost);
        nation.stats.eventsSuffered += 1;
        results.push(`${nation.name} lost $${lost}`);
      }
      return results;
    },
  },
  {
    id: "resource_boom",
    label: "Resource Boom",
    description: "New deposits and harvests improve reserves.",
    apply(game, rng) {
      const results = [];
      for (const nation of Object.values(game.nations).filter((item) => item.active)) {
        const materials = randInt(rng, 18, 42);
        const food = randInt(rng, 25, 60);
        nation.resources.materials += materials;
        nation.resources.food += food;
        results.push(`${nation.name} gained ${materials} materials and ${food} food`);
      }
      return results;
    },
  },
  {
    id: "natural_disaster",
    label: "Natural Disaster",
    description: "A regional disaster disables or destroys developed tiles.",
    apply(game, rng) {
      const results = [];
      for (const nation of Object.values(game.nations).filter((item) => item.active)) {
        const targets = game.tiles.filter((tile) => {
          return tile.ownerId === nation.id && tile.type !== TILE_TYPES.EMPTY && tile.type !== TILE_TYPES.WATER && !tile.isCapital;
        });
        if (!targets.length) continue;
        const tile = targets[randInt(rng, 0, targets.length - 1)];
        if (rng() < 0.55) {
          tile.effects.disabledTurns = 2;
          results.push(`${nation.name} had a ${tile.type} disabled for 2 turns`);
        } else {
          game.releaseTileWorkers(tile);
          tile.type = tile.type === TILE_TYPES.FISHERY ? TILE_TYPES.WATER : tile.type === TILE_TYPES.MOUNTAIN_MINE ? TILE_TYPES.MOUNTAIN : TILE_TYPES.EMPTY;
          tile.workers = 0;
          tile.unit = null;
          results.push(`${nation.name} lost a developed tile`);
        }
        nation.stats.eventsSuffered += 1;
      }
      return results;
    },
  },
  {
    id: "knowledge_renaissance",
    label: "Knowledge Renaissance",
    description: "Education spreads quickly across the world.",
    apply(game, rng) {
      const results = [];
      for (const nation of Object.values(game.nations).filter((item) => item.active)) {
        const education = randInt(rng, 20, 55);
        nation.resources.education += education;
        addPopulation(nation, randInt(rng, 1, 3));
        results.push(`${nation.name} gained ${education} education`);
      }
      return results;
    },
  },
  {
    id: "flood_season",
    label: "Flood Season",
    description: "Coastal and river-adjacent land floods temporarily.",
    apply(game, rng) {
      const results = [];
      for (const nation of Object.values(game.nations).filter((item) => item.active)) {
        const candidates = game.tiles.filter((tile) => {
          if (tile.ownerId !== nation.id || !isLand(tile)) return false;
          return game.neighbors(tile.id).some((neighbor) => isWaterLike(neighbor));
        });
        if (!candidates.length) continue;
        const tile = candidates[randInt(rng, 0, candidates.length - 1)];
        tile.effects.floodedTurns = 1;
        const lost = removePopulation(nation, randInt(rng, 0, 2));
        results.push(`${nation.name} had a coastal tile flooded${lost ? ` and lost ${lost} people` : ""}`);
      }
      return results;
    },
  },
];

export function scheduleEraEvent(game, era) {
  if (!game.globalEvents[era]) {
    game.globalEvents[era] = {
      era,
      scheduledTurn: game.turn + randInt(game.rng, 1, era === 1 ? 4 : 5),
      fired: false,
      eventId: null,
    };
  }
}

export function maybeRunGlobalEvent(game, { force = false } = {}) {
  const slot = game.globalEvents[game.era];
  if (!slot || slot.fired || (!force && game.turn < slot.scheduledTurn)) return null;
  const event = GLOBAL_EVENTS[randInt(game.rng, 0, GLOBAL_EVENTS.length - 1)];
  slot.fired = true;
  slot.eventId = event.id;
  const results = event.apply(game, game.rng);
  return {
    id: event.id,
    label: event.label,
    description: event.description,
    results,
  };
}

export function tickTileEffects(game) {
  for (const tile of game.tiles) {
    if (tile.effects.disabledTurns > 0) tile.effects.disabledTurns -= 1;
    if (tile.effects.floodedTurns > 0) tile.effects.floodedTurns -= 1;
    if (tile.effects.bountifulTurns > 0) tile.effects.bountifulTurns -= 1;
  }
}
