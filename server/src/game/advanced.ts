import type { ServerGameState } from "./initialGame.js";

export const ADVANCED_RESOURCE_KEYS = ["fruit", "hardwood", "iron", "oil"] as const;
export const RESOURCE_BASE_YIELD_PER_TILE = 1;
export const FRUIT_CONSUMPTION_PER_POPULATION = 0.08;
export const FRUIT_SURPLUS_GROWTH_RATE = 0.18;
export const FRUIT_DEFICIT_STABILITY_PENALTY = 3;

export const BUILDING_HARDWOOD_COSTS: Record<string, number> = {
  farm: 1,
  fishery: 1,
  mine: 1,
  mountainMine: 2,
  school: 2,
  university: 3,
  military: 2,
};

export const FACTORY_HARDWOOD_COST = 2;
export const FACTORY_IRON_COST = 3;

export const ADVANCED_UNIT_OIL_COSTS: Record<string, number> = {
  tanks: 2,
  air: 3,
  naval: 2,
};

export function normalizeGameMode(value: unknown) {
  return value === "advanced" ? "advanced" : "lite";
}

export function isAdvancedMode(game: Pick<ServerGameState, "settings"> | { settings?: { mode?: unknown } }) {
  return normalizeGameMode(game?.settings?.mode) === "advanced";
}

export function normalizeAdvancedResources(nation: { resources?: Record<string, number> } | null | undefined) {
  if (!nation) return nation;
  nation.resources = nation.resources || {};
  for (const key of ADVANCED_RESOURCE_KEYS) {
    nation.resources[key] = Math.max(0, Math.floor(Number(nation.resources[key]) || 0));
  }
  return nation;
}

export function hardwoodCostForBuilding(type: string) {
  if (type === "factory") return FACTORY_HARDWOOD_COST;
  return BUILDING_HARDWOOD_COSTS[type] || 0;
}

export function ironCostForFactory(type: string) {
  return type === "factory" ? FACTORY_IRON_COST : 0;
}

export function oilCostForBranch(branch: string) {
  return ADVANCED_UNIT_OIL_COSTS[branch] || 0;
}

export function advancedFruitDemand(nation: { population?: { total?: number } }) {
  return Math.max(0, Math.ceil((Number(nation?.population?.total) || 0) * FRUIT_CONSUMPTION_PER_POPULATION));
}

export function advancedResourceForTile(tile: { terrain?: string; biome?: string }) {
  if (tile?.terrain !== "land") return null;
  return {
    grassland: "fruit",
    jungle: "hardwood",
    arctic: "iron",
    desert: "oil",
  }[String(tile.biome)] || null;
}

export function collectAdvancedResourcesForNation(game: ServerGameState, nationId: string) {
  const gained = { fruit: 0, hardwood: 0, iron: 0, oil: 0 };
  const sourceTiles = { grassland: 0, jungle: 0, arctic: 0, desert: 0 };
  if (!isAdvancedMode(game)) return { gained, sourceTiles };
  const nation = game.nations[nationId];
  if (!nation?.active) return { gained, sourceTiles };
  normalizeAdvancedResources(nation);
  for (const tile of game.map.tiles) {
    if (tile.ownerId !== nationId) continue;
    const resource = advancedResourceForTile(tile) as (typeof ADVANCED_RESOURCE_KEYS)[number] | null;
    if (!resource) continue;
    gained[resource] += RESOURCE_BASE_YIELD_PER_TILE;
    sourceTiles[String(tile.biome) as keyof typeof sourceTiles] += 1;
  }
  for (const key of ADVANCED_RESOURCE_KEYS) nation.resources[key] += gained[key];
  return { gained, sourceTiles };
}
