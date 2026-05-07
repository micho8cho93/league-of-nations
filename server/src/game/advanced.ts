import type { ServerGameState } from "./initialGame.js";
import { computeNationLogistics } from "./infrastructure.js";

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
  city: 3,
  capitalCity: 3,
};

export const FACTORY_HARDWOOD_COST = 2;
export const FACTORY_IRON_COST = 3;

export const ADVANCED_UNIT_IRON_COST = 2; // Iron cost per advanced unit
export const ADVANCED_UNIT_OIL_COSTS: Record<string, number> = {
  tanks: 2,
  air: 3,
  naval: 2,
};

export function normalizeGameMode(value: unknown) {
  return value === "advanced" || value === "scenario" ? value : "lite";
}

export function isAdvancedMode(game: Pick<ServerGameState, "settings"> | { settings?: { mode?: unknown } }) {
  const mode = normalizeGameMode(game?.settings?.mode);
  return mode === "advanced" || mode === "scenario";
}

export function normalizeAdvancedResources(nation: { resources?: Record<string, number> } | null | undefined) {
  if (!nation) return nation;
  nation.resources = nation.resources || {};
  for (const key of ADVANCED_RESOURCE_KEYS) {
    nation.resources[key] = Math.max(0, Math.floor(Number(nation.resources[key]) || 0));
  }
  (nation as { advancedResourceStatus?: unknown }).advancedResourceStatus = normalizeAdvancedResourceStatus((nation as { advancedResourceStatus?: unknown }).advancedResourceStatus);
  return nation;
}

export function normalizeAdvancedResourceStatus(status: unknown = null) {
  const normalized = status && typeof status === "object" ? status as Record<string, any> : {};
  return {
    upkeep: { fruit: 0, hardwood: 0, iron: 0, oil: 0, ...(normalized.upkeep || {}) },
    paid: { fruit: 0, hardwood: 0, iron: 0, oil: 0, ...(normalized.paid || {}) },
    deficit: { fruit: 0, hardwood: 0, iron: 0, oil: 0, ...(normalized.deficit || {}) },
    penalties: {
      populationGrowthModifier: 1,
      buildingEfficiencyModifier: 1,
      factoryEfficiencyModifier: 1,
      advancedUnitReadinessModifier: 1,
      ...(normalized.penalties || {}),
    },
  };
}

export function hardwoodCostForBuilding(type: string) {
  if (type === "factory") return FACTORY_HARDWOOD_COST;
  return BUILDING_HARDWOOD_COSTS[type] || 0;
}

export function ironCostForFactory(type: string) {
  return type === "factory" ? FACTORY_IRON_COST : 0;
}

export function ironCostForBranch(branch: string) {
  return branch !== "infantry" ? ADVANCED_UNIT_IRON_COST : 0;
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

export function calculateBuildingUpkeepForNation(game: ServerGameState, nationId: string) {
  const upkeep = { hardwood: 0, iron: 0, oil: 0 };
  if (!isAdvancedMode(game)) return upkeep;
  const costs = {
    farm: { hardwood: 0.05 },
    fishery: { hardwood: 0.05 },
    mine: { hardwood: 0.08, iron: 0.02 },
    mountainMine: { hardwood: 0.1, iron: 0.03 },
    school: { hardwood: 0.06, iron: 0.04 },
    university: { hardwood: 0.08, iron: 0.06 },
    military: { hardwood: 0.1, iron: 0.08, oil: 0.05 },
    factory: { hardwood: 0.15, iron: 0.2, oil: 0.1 },
    city: { hardwood: 0.08 },
    capitalCity: { hardwood: 0.1, iron: 0.04 },
  } as Record<string, { hardwood?: number; iron?: number; oil?: number }>;
  for (const tile of game.map.tiles) {
    if (tile.ownerId !== nationId) continue;
    const tileCosts = costs[tile.type];
    if (!tileCosts) continue;
    if (tileCosts.hardwood) upkeep.hardwood += tileCosts.hardwood;
    if (tileCosts.iron) upkeep.iron += tileCosts.iron;
    if (tileCosts.oil) upkeep.oil += tileCosts.oil;
  }
  return upkeep;
}

export function calculateUnitUpkeepForNation(game: ServerGameState, nationId: string) {
  const upkeep = { hardwood: 0, iron: 0, oil: 0 };
  if (!isAdvancedMode(game)) return upkeep;
  const costs = {
    infantry: { iron: 0 },
    tanks: { iron: 0.1, oil: 0.08 },
    air: { iron: 0.08, oil: 0.15 },
    naval: { iron: 0.07, oil: 0.1 },
  } as Record<string, { iron?: number; oil?: number }>;
  for (const tile of game.map.tiles) {
    if (!tile.unit || tile.unit.nationId !== nationId) continue;
    for (const [branch, strength] of Object.entries(tile.unit.branches || {})) {
      const branchCosts = costs[branch];
      if (!branchCosts || !(Number(strength) > 0)) continue;
      if (branchCosts.iron) upkeep.iron += branchCosts.iron * Number(strength);
      if (branchCosts.oil) upkeep.oil += branchCosts.oil * Number(strength);
    }
  }
  return upkeep;
}

export function calculateAdvancedResourceUpkeep(game: ServerGameState, nationId: string) {
  const emptyResult = {
    required: { fruit: 0, hardwood: 0, iron: 0, oil: 0 },
    available: { fruit: 0, hardwood: 0, iron: 0, oil: 0 },
    deficit: { fruit: 0, hardwood: 0, iron: 0, oil: 0 },
    penalties: normalizeAdvancedResourceStatus().penalties,
    details: { population: 0, buildingCount: 0, factoryCount: 0, advancedUnitCount: 0, upkeepModifier: 1 },
  };
  if (!isAdvancedMode(game)) return emptyResult;
  const nation = game.nations[nationId];
  if (!nation?.active) return emptyResult;
  normalizeAdvancedResources(nation);
  const logistics = computeNationLogistics(game.map.tiles, nation);
  let buildingCount = 0;
  let factoryCount = 0;
  let advancedUnitCount = 0;
  for (const tile of game.map.tiles) {
    if (tile.ownerId !== nationId) continue;
    if (tile.type && tile.type !== "empty" && tile.type !== "water" && tile.type !== "mountain") {
      buildingCount += 1;
      if (tile.type === "factory") factoryCount += 1;
    }
    if (tile.unit?.nationId === nationId) {
      for (const [branch, strength] of Object.entries(tile.unit.branches || {})) {
        if (branch !== "infantry" && Number(strength) > 0) advancedUnitCount += Number(strength);
      }
    }
  }
  const buildingUpkeep = calculateBuildingUpkeepForNation(game, nationId);
  const unitUpkeep = calculateUnitUpkeepForNation(game, nationId);
  const upkeepModifier = Number(logistics.upkeepModifier) || 1;
  const required = {
    fruit: advancedFruitDemand(nation),
    hardwood: Math.ceil((buildingUpkeep.hardwood || 0) * upkeepModifier),
    iron: Math.ceil(((buildingUpkeep.iron || 0) + (unitUpkeep.iron || 0)) * upkeepModifier),
    oil: Math.ceil(((buildingUpkeep.oil || 0) + (unitUpkeep.oil || 0)) * upkeepModifier),
  };
  const available = {
    fruit: nation.resources.fruit || 0,
    hardwood: nation.resources.hardwood || 0,
    iron: nation.resources.iron || 0,
    oil: nation.resources.oil || 0,
  };
  const deficit = {
    fruit: Math.max(0, required.fruit - available.fruit),
    hardwood: Math.max(0, required.hardwood - available.hardwood),
    iron: Math.max(0, required.iron - available.iron),
    oil: Math.max(0, required.oil - available.oil),
  };
  return {
    required,
    available,
    deficit,
    penalties: deriveAdvancedPenaltyModifiers(deficit),
    details: {
      population: Number(nation.population?.total) || 0,
      buildingCount,
      factoryCount,
      advancedUnitCount,
      upkeepModifier,
    },
  };
}

export function applyAdvancedResourceUpkeep(game: ServerGameState, nationId: string) {
  if (!isAdvancedMode(game)) return null;
  const nation = game.nations[nationId];
  if (!nation?.active) return null;
  normalizeAdvancedResources(nation);
  const upkeep = calculateAdvancedResourceUpkeep(game, nationId);
  const paid = {
    fruit: Math.min(upkeep.available.fruit, upkeep.required.fruit),
    hardwood: Math.min(upkeep.available.hardwood, upkeep.required.hardwood),
    iron: Math.min(upkeep.available.iron, upkeep.required.iron),
    oil: Math.min(upkeep.available.oil, upkeep.required.oil),
  };
  nation.resources.fruit = (nation.resources.fruit || 0) - paid.fruit;
  nation.resources.hardwood = (nation.resources.hardwood || 0) - paid.hardwood;
  nation.resources.iron = (nation.resources.iron || 0) - paid.iron;
  nation.resources.oil = (nation.resources.oil || 0) - paid.oil;
  (nation as { advancedResourceStatus?: unknown }).advancedResourceStatus = normalizeAdvancedResourceStatus({
    upkeep: upkeep.required,
    paid,
    deficit: upkeep.deficit,
    penalties: upkeep.penalties,
  });
  return { upkeep, paid, deficit: upkeep.deficit, penalties: upkeep.penalties };
}

export function applyAdvancedResourceDeficits(game: ServerGameState, nationId: string) {
  if (!isAdvancedMode(game)) return null;
  const nation = game.nations[nationId];
  if (!nation?.active) return null;
  const status = normalizeAdvancedResourceStatus((nation as { advancedResourceStatus?: unknown }).advancedResourceStatus);
  status.penalties = deriveAdvancedPenaltyModifiers(status.deficit);
  (nation as { advancedResourceStatus?: unknown }).advancedResourceStatus = status;
  return status.penalties;
}

export function advancedPenaltyStateForNation(nation: { advancedResourceStatus?: unknown } | null | undefined) {
  return normalizeAdvancedResourceStatus(nation?.advancedResourceStatus).penalties;
}

function deriveAdvancedPenaltyModifiers(deficit: Record<string, number>) {
  const penalties = {
    populationGrowthModifier: 1,
    buildingEfficiencyModifier: 1,
    factoryEfficiencyModifier: 1,
    advancedUnitReadinessModifier: 1,
  };
  if ((deficit.fruit || 0) > 0) penalties.populationGrowthModifier *= Math.max(0.3, 1 - (deficit.fruit * 0.15));
  if ((deficit.hardwood || 0) > 0) penalties.buildingEfficiencyModifier *= Math.max(0.42, 1 - (deficit.hardwood * 0.11));
  if ((deficit.iron || 0) > 0) penalties.factoryEfficiencyModifier *= Math.max(0.28, 1 - (deficit.iron * 0.13));
  if ((deficit.oil || 0) > 0) penalties.advancedUnitReadinessModifier *= Math.max(0.38, 1 - (deficit.oil * 0.16));
  return penalties;
}
