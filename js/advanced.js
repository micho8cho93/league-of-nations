import {
  ADVANCED_UNIT_OIL_COSTS,
  BUILDING_HARDWOOD_COSTS,
  FACTORY_HARDWOOD_COST,
  FACTORY_IRON_COST,
  FRUIT_CONSUMPTION_PER_POPULATION,
  GAME_MODES,
  RESOURCE_BASE_YIELD_PER_TILE,
  RESOURCE_METADATA,
  SPECIAL_RESOURCES,
} from "./balance.js";
import { TILE_TYPES, clamp } from "./utils.js";

export const ADVANCED_RESOURCE_KEYS = Object.freeze(["fruit", "hardwood", "iron", "oil"]);
export const ADVANCED_RESOURCE_BIOMES = Object.freeze(["grassland", "jungle", "arctic", "desert"]);
export const ADVANCED_DIVERSITY_LEVELS = Object.freeze(["high", "superHigh"]);

export function normalizeGameMode(value) {
  return value === GAME_MODES.ADVANCED ? GAME_MODES.ADVANCED : GAME_MODES.LITE;
}

export function isAdvancedMode(gameOrSettings) {
  const settings = gameOrSettings?.settings || gameOrSettings || {};
  return normalizeGameMode(settings.mode || gameOrSettings?.mode) === GAME_MODES.ADVANCED;
}

export function normalizeLandscapeDiversity(value, mode = GAME_MODES.LITE) {
  if (normalizeGameMode(mode) === GAME_MODES.ADVANCED) {
    return value === "superHigh" ? "superHigh" : "high";
  }
  if (value === "Low" || value === "Balanced" || value === "High") return value;
  return "Balanced";
}

export function landscapeDiversityLabel(value, mode = GAME_MODES.LITE) {
  if (normalizeGameMode(mode) === GAME_MODES.ADVANCED) {
    return value === "superHigh" ? "Super High" : "High";
  }
  return String(value || "Balanced");
}

export function normalizeAdvancedResources(nation) {
  if (!nation) return nation;
  nation.resources = nation.resources || {};
  for (const key of ADVANCED_RESOURCE_KEYS) {
    nation.resources[key] = Math.max(0, Math.floor(Number(nation.resources[key]) || 0));
  }
  return nation;
}

export function emptyAdvancedResourceBundle() {
  return { fruit: 0, hardwood: 0, iron: 0, oil: 0 };
}

export function emptyAdvancedSourceTiles() {
  return { grassland: 0, jungle: 0, arctic: 0, desert: 0 };
}

export function advancedResourceForTile(tile) {
  if (!tile || tile.terrain !== "land") return null;
  return SPECIAL_RESOURCES[tile.biome] || null;
}

export function collectAdvancedResourcesForNation(gameState, nationId) {
  const gained = emptyAdvancedResourceBundle();
  const sourceTiles = emptyAdvancedSourceTiles();
  if (!isAdvancedMode(gameState)) return { gained, sourceTiles };
  const nation = gameState?.nations?.[nationId];
  if (!nation?.active) return { gained, sourceTiles };
  normalizeAdvancedResources(nation);
  for (const tile of gameState.tiles || gameState.map?.tiles || []) {
    if (tile.ownerId !== nationId) continue;
    const resource = advancedResourceForTile(tile);
    if (!resource) continue;
    gained[resource] += RESOURCE_BASE_YIELD_PER_TILE;
    sourceTiles[tile.biome] += 1;
  }
  for (const key of ADVANCED_RESOURCE_KEYS) {
    nation.resources[key] += gained[key];
  }
  return { gained, sourceTiles };
}

export function advancedFruitDemand(nation) {
  return Math.max(0, Math.ceil((Number(nation?.population?.total) || 0) * FRUIT_CONSUMPTION_PER_POPULATION));
}

export function hardwoodCostForBuilding(type) {
  if (type === TILE_TYPES.FACTORY) return FACTORY_HARDWOOD_COST;
  return BUILDING_HARDWOOD_COSTS[type] || 0;
}

export function ironCostForFactory(type) {
  return type === TILE_TYPES.FACTORY ? FACTORY_IRON_COST : 0;
}

export function oilCostForBranch(branch) {
  return ADVANCED_UNIT_OIL_COSTS[branch] || 0;
}

export function advancedResourceTooltip(resource) {
  const meta = RESOURCE_METADATA[resource];
  if (!meta) return "";
  return `${meta.label} comes from ${meta.terrain} and supports ${meta.purpose.toLowerCase()}.`;
}

export function applyAdvancedResourceDelta(nation, resource, delta) {
  normalizeAdvancedResources(nation);
  nation.resources[resource] = clamp((nation.resources[resource] || 0) + delta, 0, Number.MAX_SAFE_INTEGER);
  return nation.resources[resource];
}
