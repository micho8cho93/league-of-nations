import {
  ADVANCED_UNIT_OIL_COSTS,
  ADVANCED_UPKEEP_COSTS,
  BUILDING_HARDWOOD_COSTS,
  FACTORY_HARDWOOD_COST,
  FACTORY_IRON_COST,
  FRUIT_CONSUMPTION_PER_POPULATION,
  GAME_MODES,
  RESOURCE_BASE_YIELD_PER_TILE,
  RESOURCE_METADATA,
  SPECIAL_RESOURCES,
} from "./balance.js";
import { computeNationLogistics } from "./infrastructure.js";
import { TILE_TYPES, clamp } from "./utils.js";

export const ADVANCED_RESOURCE_KEYS = Object.freeze(["fruit", "hardwood", "iron", "oil"]);
export const ADVANCED_RESOURCE_BIOMES = Object.freeze(["grassland", "jungle", "arctic", "desert"]);
export const ADVANCED_DIVERSITY_LEVELS = Object.freeze(["high", "superHigh"]);

export function normalizeGameMode(value) {
  if (value === GAME_MODES.ADVANCED || value === GAME_MODES.SCENARIO) {
    return value;
  }
  return GAME_MODES.LITE;
}

export function isAdvancedMode(gameOrSettings) {
  const settings = gameOrSettings?.settings || gameOrSettings || {};
  const mode = normalizeGameMode(settings.mode || gameOrSettings?.mode);
  return mode === GAME_MODES.ADVANCED || mode === GAME_MODES.SCENARIO;
}

export function normalizeLandscapeDiversity(value, mode = GAME_MODES.LITE) {
  const normalizedMode = normalizeGameMode(mode);
  if (normalizedMode === GAME_MODES.ADVANCED || normalizedMode === GAME_MODES.SCENARIO) {
    return value === "superHigh" ? "superHigh" : "high";
  }
  if (value === "Low" || value === "Balanced" || value === "High") return value;
  return "Balanced";
}

export function landscapeDiversityLabel(value, mode = GAME_MODES.LITE) {
  const normalizedMode = normalizeGameMode(mode);
  if (normalizedMode === GAME_MODES.ADVANCED || normalizedMode === GAME_MODES.SCENARIO) {
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
  nation.advancedResourceStatus = normalizeAdvancedResourceStatus(nation.advancedResourceStatus);
  return nation;
}

export function normalizeAdvancedResourceStatus(status = null) {
  const normalized = status && typeof status === "object" ? status : {};
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

export function ironCostForBranch(branch) {
  // Each advanced unit (non-infantry) requires 2 iron
  return branch !== "infantry" ? 2 : 0;
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

// Calculate total upkeep costs for all buildings in a nation (Advanced mode only)
export function calculateBuildingUpkeepForNation(gameState, nationId) {
  const upkeep = { hardwood: 0, iron: 0, oil: 0 };
  if (!isAdvancedMode(gameState)) return upkeep;
  const costs = ADVANCED_UPKEEP_COSTS.buildings;
  for (const tile of gameState.tiles || gameState.map?.tiles || []) {
    if (tile.ownerId !== nationId) continue;
    const tileCosts = costs[tile.type];
    if (tileCosts) {
      if (tileCosts.hardwood) upkeep.hardwood += tileCosts.hardwood;
      if (tileCosts.iron) upkeep.iron += tileCosts.iron;
      if (tileCosts.oil) upkeep.oil += tileCosts.oil;
    }
  }
  return upkeep;
}

// Calculate total upkeep costs for all units in a nation (Advanced mode only)
export function calculateUnitUpkeepForNation(gameState, nationId) {
  const upkeep = { hardwood: 0, iron: 0, oil: 0 };
  if (!isAdvancedMode(gameState)) return upkeep;
  const costs = ADVANCED_UPKEEP_COSTS.units;
  for (const tile of gameState.tiles || gameState.map?.tiles || []) {
    if (!tile.unit || tile.unit.nationId !== nationId) continue;
    const unit = tile.unit;
    // Calculate upkeep per strength point for each branch
    for (const [branch, strength] of Object.entries(unit.branches || {})) {
      const branchCosts = costs[branch];
      if (branchCosts && strength > 0) {
        if (branchCosts.iron) upkeep.iron += branchCosts.iron * strength;
        if (branchCosts.oil) upkeep.oil += branchCosts.oil * strength;
      }
    }
  }
  return upkeep;
}

// Calculate total resource upkeep for a nation in Advanced mode
export function calculateTotalUpkeepForNation(gameState, nationId) {
  const building = calculateBuildingUpkeepForNation(gameState, nationId);
  const units = calculateUnitUpkeepForNation(gameState, nationId);
  return {
    hardwood: Math.ceil(building.hardwood + units.hardwood),
    iron: Math.ceil(building.iron + units.iron),
    oil: Math.ceil(building.oil + units.oil),
  };
}

// Check if a nation has enough resources to pay upkeep this turn
export function canAffordUpkeep(gameState, nationId) {
  if (!isAdvancedMode(gameState)) return { ok: true };
  const nation = gameState.nations[nationId];
  if (!nation?.active) return { ok: true };
  normalizeAdvancedResources(nation);
  const required = calculateTotalUpkeepForNation(gameState, nationId);
  const deficits = {};
  let hasDeficit = false;
  for (const resource of ["hardwood", "iron", "oil"]) {
    const current = nation.resources[resource] || 0;
    if (current < required[resource]) {
      deficits[resource] = required[resource] - current;
      hasDeficit = true;
    }
  }
  return { ok: !hasDeficit, required, actual: nation.resources, deficits };
}

// Get readable description of resource deficit and consequences
export function describeUpkeepDeficit(deficits) {
  const items = [];
  if (deficits.hardwood > 0) items.push(`${deficits.hardwood} hardwood`);
  if (deficits.iron > 0) items.push(`${deficits.iron} iron`);
  if (deficits.oil > 0) items.push(`${deficits.oil} oil`);
  if (items.length === 0) return "";
  return `Missing: ${items.join(", ")}. Production and combat effectiveness reduced.`;
}

// Comprehensive resource upkeep calculation for Advanced mode
// Returns detailed upkeep requirements, available resources, and deficits
export function calculateAdvancedResourceUpkeep(gameState, nationId) {
  const emptyResult = {
    required: { fruit: 0, hardwood: 0, iron: 0, oil: 0 },
    available: { fruit: 0, hardwood: 0, iron: 0, oil: 0 },
    deficit: { fruit: 0, hardwood: 0, iron: 0, oil: 0 },
    penalties: normalizeAdvancedResourceStatus().penalties,
    details: { population: 0, buildingCount: 0, factoryCount: 0, advancedUnitCount: 0, upkeepModifier: 1 },
  };
  if (!isAdvancedMode(gameState)) {
    return emptyResult;
  }

  const nation = gameState.nations[nationId];
  if (!nation?.active) {
    return emptyResult;
  }

  normalizeAdvancedResources(nation);
  const tiles = gameState.tiles || gameState.map?.tiles || [];
  const logistics = computeNationLogistics(tiles, nation);

  // Count buildings and units
  let buildingCount = 0;
  let factoryCount = 0;
  let advancedUnitCount = 0;

  for (const tile of tiles) {
    if (tile.ownerId !== nationId) continue;
    if (tile.type && tile.type !== "EMPTY" && tile.type !== "CAPITAL") {
      buildingCount += 1;
      if (tile.type === "FACTORY") factoryCount += 1;
    }
    if (tile.unit?.nationId === nationId) {
      for (const [branch, strength] of Object.entries(tile.unit.branches || {})) {
        if (branch !== "infantry" && strength > 0) advancedUnitCount += strength;
      }
    }
  }

  const population = nation.population?.total || 0;
  const upkeepModifier = Number(logistics.upkeepModifier) || 1;
  const buildingUpkeep = calculateBuildingUpkeepForNation(gameState, nationId);
  const unitUpkeep = calculateUnitUpkeepForNation(gameState, nationId);

  // Calculate required upkeep
  const required = {
    fruit: Math.ceil(population * FRUIT_CONSUMPTION_PER_POPULATION),
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
  const penalties = deriveAdvancedPenaltyModifiers(deficit);

  return {
    required,
    available,
    deficit,
    penalties,
    details: { population, buildingCount, factoryCount, advancedUnitCount, upkeepModifier },
  };
}

// Apply resource upkeep deductions and record deficit state
export function applyAdvancedResourceUpkeep(gameState, nationId) {
  if (!isAdvancedMode(gameState)) return null;

  const nation = gameState.nations[nationId];
  if (!nation?.active) return null;

  normalizeAdvancedResources(nation);
  const upkeep = calculateAdvancedResourceUpkeep(gameState, nationId);

  // Subtract what can be paid, record deficit
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

  // Store upkeep status for UI/event display
  nation.advancedResourceStatus = normalizeAdvancedResourceStatus({
    upkeep: upkeep.required,
    paid,
    deficit: upkeep.deficit,
    penalties: upkeep.penalties,
  });

  return { upkeep, paid, deficit: upkeep.deficit, penalties: upkeep.penalties };
}

// Apply consequences of resource deficits
// Modifies nation stats but does not delete buildings/units
export function applyAdvancedResourceDeficits(gameState, nationId) {
  if (!isAdvancedMode(gameState)) return null;

  const nation = gameState.nations[nationId];
  if (!nation?.active) return null;

  const status = nation.advancedResourceStatus;
  if (!status) return null;

  const { deficit } = status;
  const penalties = deriveAdvancedPenaltyModifiers(deficit);

  nation.advancedResourceStatus.penalties = penalties;
  return penalties;
}

export function advancedPenaltyStateForNation(nation) {
  return normalizeAdvancedResourceStatus(nation?.advancedResourceStatus).penalties;
}

function deriveAdvancedPenaltyModifiers(deficit = {}) {
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
