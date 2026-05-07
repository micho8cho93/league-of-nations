import {
  TILE_TYPES,
  WORKER_MIN,
  formatNumber,
  isTileActive,
} from "./utils.js";
import { activeTiles, countTiles } from "./nation.js";
import { BALANCE } from "./balance.js";
import {
  INFRASTRUCTURE_UNLOCKS,
  transportUnlockForTier as infrastructureUnlockForTier,
} from "./infrastructure.js";
import { isAdvancedMode } from "./advanced.js";

export const ERAS = {
  1: {
    id: 1,
    label: "Era 1",
    name: "Foundations",
    unlocks: "Internal development only",
  },
  2: {
    id: 2,
    label: "Era 2",
    name: "Diplomacy",
    unlocks: "Trade agreements and alliances",
  },
  3: {
    id: 3,
    label: "Era 3",
    name: "Industrialization",
    unlocks: "Factories, higher costs, stronger scaling",
  },
  4: {
    id: 4,
    label: "Era 4",
    name: "Modern Strategy",
    unlocks: "Military branches: tanks, air, and naval",
  },
};

export const TECH_CATEGORIES = {
  farming: {
    label: "Farming",
    tileType: TILE_TYPES.FARM,
    tileTypes: [TILE_TYPES.FARM, TILE_TYPES.FISHERY],
    baseCost: BALANCE.tech.categories.farming.baseCost,
    resource: "food",
    description: "Improves farms, fisheries, and food-led population growth.",
  },
  mining: {
    label: "Mining",
    tileType: TILE_TYPES.MINE,
    tileTypes: [TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE],
    baseCost: BALANCE.tech.categories.mining.baseCost,
    resource: "materials",
    description: "Improves mines, mountain mines, and factory prerequisites.",
  },
  education: {
    label: "Education",
    tileType: TILE_TYPES.SCHOOL,
    tileTypes: [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY],
    baseCost: BALANCE.tech.categories.education.baseCost,
    resource: "education",
    description: "Improves schools, universities, and industrial readiness.",
  },
  infrastructure: {
    label: "Infrastructure",
    tileType: TILE_TYPES.ROAD,
    tileTypes: [],
    baseCost: BALANCE.tech.categories.infrastructure.baseCost,
    resource: "materials",
    description: "Unlocks road, rail, and advanced logistics networks for large empires.",
  },
  military: {
    label: "Military",
    tileType: TILE_TYPES.MILITARY,
    tileTypes: [TILE_TYPES.MILITARY],
    baseCost: BALANCE.tech.categories.military.baseCost,
    resource: "materials",
    description: "Improves training, defense, and late-era specialization.",
  },
};

export const MILITARY_BRANCHES = {
  tanks: {
    label: "Tanks",
    baseCost: BALANCE.tech.branches.tanks.baseCost,
    materialCost: BALANCE.tech.branches.tanks.materialCost,
    effect: "Heavy ground units gain attack power.",
  },
  air: {
    label: "Air",
    baseCost: BALANCE.tech.branches.air.baseCost,
    materialCost: BALANCE.tech.branches.air.materialCost,
    educationCost: BALANCE.tech.branches.air.educationCost,
    effect: "Air support adds combat strength across nearby fronts.",
  },
  naval: {
    label: "Naval",
    baseCost: BALANCE.tech.branches.naval.baseCost,
    materialCost: BALANCE.tech.branches.naval.materialCost,
    effect: "Units can cross water and fight over islands.",
  },
};

export const UNIT_TRAINING = {
  infantry: {
    label: "Infantry",
    action: "Train",
    branch: null,
    strengths: BALANCE.tech.training.infantryStrengths,
    description: "Reliable ground troops.",
  },
  tanks: {
    label: "Tank Column",
    action: "Deploy",
    branch: "tanks",
    baseStrength: BALANCE.tech.training.branchBaseStrength.tanks,
    description: "Heavy ground armor.",
  },
  air: {
    label: "Plane Wing",
    action: "Deploy",
    branch: "air",
    baseStrength: BALANCE.tech.training.branchBaseStrength.air,
    description: "Fast air support.",
  },
  naval: {
    label: "Naval Fleet",
    action: "Deploy",
    branch: "naval",
    baseStrength: BALANCE.tech.training.branchBaseStrength.naval,
    description: "Water-crossing forces.",
  },
};

export function buildingCost(type, era) {
  const base = BALANCE.costs.build[type] || 0;
  if (type === TILE_TYPES.FACTORY) return era >= 4 ? BALANCE.costs.factoryEra4Build : BALANCE.costs.build[TILE_TYPES.FACTORY];
  if (era >= 4) return Math.ceil(base * BALANCE.costs.buildEraMultipliers.era4);
  if (era >= 3) return Math.ceil(base * BALANCE.costs.buildEraMultipliers.era3);
  return base;
}

export function destroyCost(type) {
  if (type === TILE_TYPES.EMPTY || type === TILE_TYPES.WATER) return 0;
  return BALANCE.costs.destroy[type] || BALANCE.costs.destroy.default;
}

export function workerAdminCost(amount) {
  return Math.max(0, Math.ceil(amount) * BALANCE.costs.workerAdminPerWorker);
}

export function trainingCost(strength, era, branch = "infantry", branchLevel = 0) {
  const config = BALANCE.tech.training;
  const scale = era >= 4 ? config.era4Scale : era >= 3 ? config.era3Scale : 1;
  const multiplier = config.branchMoneyMultiplier[branch] || config.branchMoneyMultiplier.infantry;
  const cost = {
    money: Math.ceil(strength * config.moneyPerStrength * scale),
    people: Math.ceil(strength / config.peopleDivisor),
    materials: Math.ceil(strength * (era >= 4 ? config.materialsPerStrength.era4 : config.materialsPerStrength.early)),
  };
  if (branch !== "infantry") {
    cost.money = Math.ceil(cost.money * multiplier);
    cost.materials = Math.ceil(cost.materials * (config.branchMaterialsMultiplier[branch] || config.branchMaterialsMultiplier.default));
    cost.industry = Math.ceil((config.industryBase + strength * config.industryPerStrength) * (1 + branchLevel * config.industryPerBranchLevel));
    if (branch === "air") cost.education = Math.ceil(config.airEducationBase + strength * config.airEducationPerStrength);
  }
  return cost;
}

export function trainingOptionsForNation(nation, era) {
  const options = UNIT_TRAINING.infantry.strengths.map((strength) => ({
    id: `infantry-${strength}`,
    branch: "infantry",
    label: `${UNIT_TRAINING.infantry.action} ${strength}`,
    strength,
    cost: trainingCost(strength, era),
    description: UNIT_TRAINING.infantry.description,
  }));
  if (era < 4) return options;
  for (const [branch, config] of Object.entries(UNIT_TRAINING)) {
    if (branch === "infantry") continue;
    const level = nation.tech?.branches?.[branch] || 0;
    if (level <= 0) continue;
    const strength = config.baseStrength + level * 2;
    options.push({
      id: branch,
      branch,
      label: `${config.action} ${config.label}`,
      strength,
      cost: trainingCost(strength, era, branch, level),
      description: config.description,
    });
  }
  return options;
}

export function factoryRequirements(nation, tiles) {
  const factories = countTiles(nation, tiles, TILE_TYPES.FACTORY);
  const config = BALANCE.tech.factoryRequirements;
  return {
    activeMines: config.activeMinesBase + factories * config.activePerFactory,
    activeSchools: config.activeSchoolsBase + factories * config.activePerFactory,
    population: config.populationBase + factories * config.populationPerFactory,
    miningTier: config.miningTier,
    educationTier: config.educationTier,
  };
}

export function canBuildFactory(nation, tiles, era) {
  if (era < 3) return { ok: false, reason: "Factories unlock in Era 3." };
  const req = factoryRequirements(nation, tiles);
  const mines = activeTileCount(nation, tiles, [TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE]);
  const schools = activeTileCount(nation, tiles, [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY]);
  if (nation.tech.mining < req.miningTier) return { ok: false, reason: `Requires Mining tier ${req.miningTier}.` };
  if (nation.tech.education < req.educationTier) return { ok: false, reason: `Requires Education tier ${req.educationTier}.` };
  if (mines < req.activeMines) return { ok: false, reason: `Requires ${req.activeMines} active mines.` };
  if (schools < req.activeSchools) return { ok: false, reason: `Requires ${req.activeSchools} active schools.` };
  if (nation.population.total < req.population) return { ok: false, reason: `Requires ${req.population} population.` };
  return { ok: true, reason: "Factory requirements met." };
}

export function researchCost(category, currentTier) {
  const config = TECH_CATEGORIES[category];
  if (!config) return 0;
  return Math.ceil(config.baseCost * Math.pow(BALANCE.tech.research.costExponent, currentTier));
}

export function researchRequirement(category, nextTier) {
  const config = TECH_CATEGORIES[category];
  const research = BALANCE.tech.research;
  if (category === "infrastructure") {
    const unlock = transportUnlockForTier(nextTier);
    return {
      activeTiles: 0,
      activeTileTypes: [],
      activeLabel: "",
      resource: config?.resource,
      resourceCost: Math.ceil((config?.baseCost || 250) * research.resourceCostRate * Math.pow(research.resourceCostExponent, nextTier - 1)),
      starter: nextTier === 1,
      era: unlock?.era || 1,
      unlockLabel: unlock?.label || "Transport",
    };
  }
  const requiredActive = Math.max(1, nextTier * research.activeTilesPerTier);
  const resourceCost = Math.ceil((config?.baseCost || 250) * research.resourceCostRate * Math.pow(research.resourceCostExponent, nextTier - 1));
  return {
    activeTiles: requiredActive,
    resource: config?.resource,
    resourceCost,
  };
}

export function canResearch(game, nation, category) {
  const config = TECH_CATEGORIES[category];
  if (!config) return { ok: false, reason: "Unknown technology." };
  if (category === "infrastructure" && !isAdvancedMode(game)) {
    return { ok: false, reason: "Infrastructure research is only available in Advanced mode." };
  }
  const current = nation.tech[category] || 0;
  if (current >= BALANCE.tech.research.maxTier) return { ok: false, reason: "Maximum linear tier reached." };
  const nextTier = current + 1;
  const req = researchRequirement(category, nextTier);
  const active = category === "infrastructure"
    ? 0
    : activeTileCount(nation, game.tiles, config.tileTypes || [config.tileType]);
  const cost = researchCost(category, current);
  if (category === "infrastructure" && game.era < req.era) {
    return { ok: false, reason: `${req.unlockLabel}s unlock in Era ${req.era}.` };
  }
  if (category === "infrastructure" && req.starter) {
    if (activeTileCount(nation, game.tiles, [TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE]) < 1) {
      return { ok: false, reason: "Requires one active mine or mountain mine." };
    }
    if (activeTileCount(nation, game.tiles, [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY]) < 1) {
      return { ok: false, reason: "Requires one active school or university." };
    }
  } else if (category !== "infrastructure" && active < req.activeTiles) {
    return { ok: false, reason: `Requires ${req.activeTiles} active ${req.activeLabel || config.label.toLowerCase()} ${req.activeTiles === 1 ? "tile" : "tiles"}.` };
  }
  if (nation.money < cost) return { ok: false, reason: `Requires $${formatNumber(cost)}.` };
  if ((nation.resources[req.resource] || 0) < req.resourceCost) {
    return { ok: false, reason: `Requires ${formatNumber(req.resourceCost)} ${req.resource}.` };
  }
  return { ok: true, cost, requirement: req, nextTier };
}

export function branchCost(branch, currentLevel) {
  const config = MILITARY_BRANCHES[branch];
  if (!config) return null;
  const research = BALANCE.tech.branchResearch;
  return {
    money: Math.ceil(config.baseCost * Math.pow(research.moneyExponent, currentLevel)),
    materials: Math.ceil((config.materialCost || 0) * Math.pow(research.materialsExponent, currentLevel)),
    education: Math.ceil((config.educationCost || research.fallbackEducationCost) * Math.pow(research.educationExponent, currentLevel)),
    industry: Math.ceil(research.industryBase * Math.pow(research.industryExponent, currentLevel)),
  };
}

export function canResearchBranch(game, nation, branch) {
  const config = MILITARY_BRANCHES[branch];
  if (!config) return { ok: false, reason: "Unknown branch." };
  if (game.era < 4) return { ok: false, reason: "Military branches unlock in Era 4." };
  if (nation.tech.military < BALANCE.tech.branchResearch.requiredMilitaryTier) return { ok: false, reason: `Requires Military tier ${BALANCE.tech.branchResearch.requiredMilitaryTier}.` };
  if (activeTiles(nation, game.tiles, TILE_TYPES.FACTORY).length < 1) {
    return { ok: false, reason: "Requires one active factory." };
  }
  const current = nation.tech.branches[branch] || 0;
  if (current >= BALANCE.tech.branchResearch.maxLevel) return { ok: false, reason: "Branch is fully specialized." };
  const cost = branchCost(branch, current);
  if (nation.money < cost.money) return { ok: false, reason: `Requires $${formatNumber(cost.money)}.` };
  for (const resource of ["materials", "education", "industry"]) {
    if ((nation.resources[resource] || 0) < cost[resource]) {
      return { ok: false, reason: `Requires ${formatNumber(cost[resource])} ${resource}.` };
    }
  }
  return { ok: true, cost, nextLevel: current + 1 };
}

export function productionForTile(nation, tile, era) {
  if (!isTileActive(tile)) return null;
  const farming = nation.tech.farming || 0;
  const mining = nation.tech.mining || 0;
  const education = nation.tech.education || 0;
  const military = nation.tech.military || 0;
  const eraScale = 1 + (era - 1) * BALANCE.production.eraScalePerEra;
  if (tile.type === TILE_TYPES.FARM) {
    const config = BALANCE.production[TILE_TYPES.FARM];
    const bonus = tile.effects?.bountifulTurns > 0 ? config.bountifulMultiplier : 1;
    return {
      food: Math.ceil((config.foodBase + farming * config.foodPerTech) * bonus * eraScale),
      money: Math.ceil(config.moneyBase + farming * config.moneyPerTech),
      people: farming >= config.peopleTechTier ? config.people : 0,
    };
  }
  if (tile.type === TILE_TYPES.MINE) {
    const config = BALANCE.production[TILE_TYPES.MINE];
    return {
      materials: Math.ceil((config.materialsBase + mining * config.materialsPerTech) * eraScale),
      money: Math.ceil(config.moneyBase + mining * config.moneyPerTech),
      people: mining >= config.peopleTechTier ? config.people : 0,
    };
  }
  if (tile.type === TILE_TYPES.FISHERY) {
    const config = BALANCE.production[TILE_TYPES.FISHERY];
    return {
      food: Math.ceil((config.foodBase + farming * config.foodPerTech) * eraScale),
      money: Math.ceil(config.moneyBase + farming * config.moneyPerTech),
      people: farming >= config.peopleTechTier ? config.people : 0,
    };
  }
  if (tile.type === TILE_TYPES.MOUNTAIN_MINE) {
    const config = BALANCE.production[TILE_TYPES.MOUNTAIN_MINE];
    return {
      materials: Math.ceil((config.materialsBase + mining * config.materialsPerTech) * eraScale),
      money: Math.ceil(config.moneyBase + mining * config.moneyPerTech),
      people: mining >= config.peopleTechTier ? config.people : 0,
    };
  }
  if (tile.type === TILE_TYPES.SCHOOL) {
    const config = BALANCE.production[TILE_TYPES.SCHOOL];
    return {
      education: Math.ceil((config.educationBase + education * config.educationPerTech) * eraScale),
      money: Math.ceil(config.moneyBase + education * config.moneyPerTech),
      people: education >= config.peopleTechTier ? config.people : 0,
    };
  }
  if (tile.type === TILE_TYPES.UNIVERSITY) {
    const config = BALANCE.production[TILE_TYPES.UNIVERSITY];
    return {
      education: Math.ceil((config.educationBase + education * config.educationPerTech) * eraScale),
      money: Math.ceil(config.moneyBase + education * config.moneyPerTech),
      people: education >= config.peopleTechTier ? config.people : 0,
    };
  }
  if (tile.type === TILE_TYPES.FACTORY) {
    const config = BALANCE.production[TILE_TYPES.FACTORY];
    return {
      industry: Math.ceil(config.industryBase + Math.min(nation.tech.mining, nation.tech.education) * config.industryPerTech),
      money: Math.ceil(config.moneyBase * eraScale),
      materialsCost: config.materialsCostBase + era,
      educationCost: config.educationCostBase + Math.floor(era / config.educationCostEraDivisor),
      people: era >= config.peopleEra ? config.people : 0,
    };
  }
  if (tile.type === TILE_TYPES.MILITARY) {
    const config = BALANCE.production[TILE_TYPES.MILITARY];
    return {
      money: Math.ceil(config.moneyBase + military * config.moneyPerTech),
      materials: military >= config.materialsTechTier ? config.materials : 0,
    };
  }
  if (tile.type === TILE_TYPES.CITY || tile.type === TILE_TYPES.CAPITAL_CITY) {
    const config = BALANCE.production[tile.type];
    const techDividend = (farming + mining + education + military) * (config.techDividend || 0);
    return {
      money: Math.ceil((config.moneyBase + techDividend * 5) * eraScale),
      food: Math.ceil((config.foodBase + farming) * eraScale),
      materials: Math.ceil((config.materialsBase + mining) * eraScale),
      education: Math.ceil((config.educationBase + education) * eraScale),
      industry: Math.ceil((config.industryBase + Math.floor(Math.min(mining, education) / 2)) * eraScale),
    };
  }
  return null;
}

export function infrastructureTier(nation) {
  return Math.max(0, Math.min(4, Math.floor(Number(nation?.tech?.infrastructure) || 0)));
}

export function transportGrowthMultiplier(nation) {
  const tier = infrastructureTier(nation);
  return BALANCE.population.growth.transportMultipliers[tier] || 1;
}

export function transportHappinessBonus(nation) {
  const tier = infrastructureTier(nation);
  return BALANCE.population.growth.transportHappinessBonus[tier] || 0;
}

export function transportUnlockForTier(tier) {
  return infrastructureUnlockForTier(tier);
}

export function checkEraAdvancement(game) {
  const nation = game.player;
  if (!nation || game.pendingEraReport || game.pendingEducationReflection) return null;
  const farms = activeTileCount(nation, game.tiles, [TILE_TYPES.FARM, TILE_TYPES.FISHERY]);
  const mines = activeTileCount(nation, game.tiles, [TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE]);
  const schools = activeTileCount(nation, game.tiles, [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY]);
  const factories = activeTiles(nation, game.tiles, TILE_TYPES.FACTORY).length;
  const techSum = nation.tech.farming + nation.tech.mining + nation.tech.education + (nation.tech.infrastructure || 0) + nation.tech.military;

  if (game.era === 1) {
    if ((game.turn >= 5 && farms >= 2 && techSum >= 2) || game.turn >= 7) return 2;
  }
  if (game.era === 2) {
    if (
      (game.turn >= 9 && mines >= 3 && schools >= 2 && nation.tech.mining >= 2 && nation.tech.education >= 2) ||
      game.turn >= 12
    ) return 3;
  }
  if (game.era === 3) {
    if ((game.turn >= 14 && factories >= 2 && nation.tech.military >= 2) || game.turn >= 18) return 4;
  }
  return null;
}

export function eraLabel(era) {
  const info = ERAS[era] || ERAS[1];
  return `${info.label}: ${info.name}`;
}

export function tileTypeUnlocked(type, era) {
  if (type === TILE_TYPES.FACTORY) return era >= 3;
  return type !== TILE_TYPES.WATER;
}

export function buildingTechRequirement(type, nation, era) {
  if (type === TILE_TYPES.FISHERY && (nation.tech.farming || 0) < 1) return { ok: false, reason: "Requires Farming tier 1." };
  if (type === TILE_TYPES.MOUNTAIN_MINE && (nation.tech.mining || 0) < 2) return { ok: false, reason: "Requires Mining tier 2." };
  if (type === TILE_TYPES.UNIVERSITY && (nation.tech.education || 0) < 3) return { ok: false, reason: "Requires Education tier 3." };
  const unlock = INFRASTRUCTURE_UNLOCKS.find((item) => item.type === type);
  if (unlock) {
    if (era < unlock.era) return { ok: false, reason: `${unlock.label}s unlock in Era ${unlock.era}.` };
    if ((nation.tech.infrastructure || 0) < unlock.tier) return { ok: false, reason: `Requires Infrastructure tier ${unlock.tier}.` };
  }
  return { ok: true };
}

export function activeTileCount(nation, tiles, types) {
  return types.reduce((sum, type) => sum + activeTiles(nation, tiles, type).length, 0);
}
