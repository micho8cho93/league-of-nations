import {
  TILE_TYPES,
  WORKER_MIN,
  formatNumber,
  isTileActive,
} from "./utils.js";
import { activeTiles, countTiles } from "./nation.js";

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
    baseCost: 260,
    resource: "food",
    description: "Improves food output and population growth.",
  },
  mining: {
    label: "Mining",
    tileType: TILE_TYPES.MINE,
    baseCost: 320,
    resource: "materials",
    description: "Improves material extraction and factory prerequisites.",
  },
  education: {
    label: "Education",
    tileType: TILE_TYPES.SCHOOL,
    baseCost: 360,
    resource: "education",
    description: "Improves research and industrial readiness.",
  },
  military: {
    label: "Military",
    tileType: TILE_TYPES.MILITARY,
    baseCost: 420,
    resource: "materials",
    description: "Improves training, defense, and late-era specialization.",
  },
};

export const MILITARY_BRANCHES = {
  tanks: {
    label: "Tanks",
    baseCost: 900,
    materialCost: 45,
    effect: "Heavy ground units gain attack power.",
  },
  air: {
    label: "Air",
    baseCost: 1050,
    materialCost: 35,
    educationCost: 35,
    effect: "Air support adds combat strength across nearby fronts.",
  },
  naval: {
    label: "Naval",
    baseCost: 1000,
    materialCost: 50,
    effect: "Units can cross water and fight over islands.",
  },
};

const BASE_BUILD_COSTS = {
  [TILE_TYPES.FARM]: 140,
  [TILE_TYPES.MINE]: 190,
  [TILE_TYPES.SCHOOL]: 230,
  [TILE_TYPES.MILITARY]: 330,
  [TILE_TYPES.FACTORY]: 780,
};

export function buildingCost(type, era) {
  const base = BASE_BUILD_COSTS[type] || 0;
  if (type === TILE_TYPES.FACTORY) return era >= 4 ? 1250 : 780;
  if (era >= 4) return Math.ceil(base * 2.35);
  if (era >= 3) return Math.ceil(base * 1.65);
  return base;
}

export function destroyCost(type) {
  if (type === TILE_TYPES.EMPTY || type === TILE_TYPES.WATER) return 0;
  return type === TILE_TYPES.FACTORY ? 160 : 70;
}

export function workerAdminCost(amount) {
  return Math.max(0, Math.ceil(amount) * 5);
}

export function trainingCost(strength, era) {
  const scale = era >= 4 ? 1.45 : era >= 3 ? 1.2 : 1;
  return {
    money: Math.ceil(strength * 35 * scale),
    people: Math.ceil(strength / 3),
    materials: Math.ceil(strength * (era >= 4 ? 0.85 : 0.55)),
  };
}

export function factoryRequirements(nation, tiles) {
  const factories = countTiles(nation, tiles, TILE_TYPES.FACTORY);
  return {
    activeMines: 3 + factories * 2,
    activeSchools: 2 + factories * 2,
    population: 35 + factories * 8,
    miningTier: 2,
    educationTier: 2,
  };
}

export function canBuildFactory(nation, tiles, era) {
  if (era < 3) return { ok: false, reason: "Factories unlock in Era 3." };
  const req = factoryRequirements(nation, tiles);
  const mines = activeTiles(nation, tiles, TILE_TYPES.MINE).length;
  const schools = activeTiles(nation, tiles, TILE_TYPES.SCHOOL).length;
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
  return Math.ceil(config.baseCost * Math.pow(1.85, currentTier));
}

export function researchRequirement(category, nextTier) {
  const config = TECH_CATEGORIES[category];
  const requiredActive = Math.max(1, nextTier * 2);
  const resourceCost = Math.ceil((config?.baseCost || 250) * 0.08 * Math.pow(1.5, nextTier - 1));
  return {
    activeTiles: requiredActive,
    resource: config?.resource,
    resourceCost,
  };
}

export function canResearch(game, nation, category) {
  const config = TECH_CATEGORIES[category];
  if (!config) return { ok: false, reason: "Unknown technology." };
  const current = nation.tech[category] || 0;
  if (current >= 4) return { ok: false, reason: "Maximum linear tier reached." };
  const nextTier = current + 1;
  const req = researchRequirement(category, nextTier);
  const active = activeTiles(nation, game.tiles, config.tileType).length;
  const cost = researchCost(category, current);
  if (active < req.activeTiles) return { ok: false, reason: `Requires ${req.activeTiles} active ${config.label.toLowerCase()} tiles.` };
  if (nation.money < cost) return { ok: false, reason: `Requires $${formatNumber(cost)}.` };
  if ((nation.resources[req.resource] || 0) < req.resourceCost) {
    return { ok: false, reason: `Requires ${formatNumber(req.resourceCost)} ${req.resource}.` };
  }
  return { ok: true, cost, requirement: req, nextTier };
}

export function branchCost(branch, currentLevel) {
  const config = MILITARY_BRANCHES[branch];
  if (!config) return null;
  return {
    money: Math.ceil(config.baseCost * Math.pow(1.9, currentLevel)),
    materials: Math.ceil((config.materialCost || 0) * Math.pow(1.45, currentLevel)),
    education: Math.ceil((config.educationCost || 20) * Math.pow(1.35, currentLevel)),
    industry: Math.ceil(25 * Math.pow(1.35, currentLevel)),
  };
}

export function canResearchBranch(game, nation, branch) {
  const config = MILITARY_BRANCHES[branch];
  if (!config) return { ok: false, reason: "Unknown branch." };
  if (game.era < 4) return { ok: false, reason: "Military branches unlock in Era 4." };
  if (nation.tech.military < 3) return { ok: false, reason: "Requires Military tier 3." };
  if (activeTiles(nation, game.tiles, TILE_TYPES.FACTORY).length < 1) {
    return { ok: false, reason: "Requires one active factory." };
  }
  const current = nation.tech.branches[branch] || 0;
  if (current >= 3) return { ok: false, reason: "Branch is fully specialized." };
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
  const eraScale = 1 + (era - 1) * 0.2;
  if (tile.type === TILE_TYPES.FARM) {
    const bonus = tile.effects?.bountifulTurns > 0 ? 2 : 1;
    return {
      food: Math.ceil((16 + farming * 8) * bonus * eraScale),
      money: Math.ceil(28 + farming * 12),
      people: farming >= 2 ? 1 : 0,
    };
  }
  if (tile.type === TILE_TYPES.MINE) {
    return {
      materials: Math.ceil((9 + mining * 6) * eraScale),
      money: Math.ceil(45 + mining * 18),
      people: mining >= 3 ? 1 : 0,
    };
  }
  if (tile.type === TILE_TYPES.SCHOOL) {
    return {
      education: Math.ceil((7 + education * 6) * eraScale),
      money: Math.ceil(32 + education * 14),
      people: education >= 3 ? 1 : 0,
    };
  }
  if (tile.type === TILE_TYPES.FACTORY) {
    return {
      industry: Math.ceil(8 + Math.min(nation.tech.mining, nation.tech.education) * 4),
      money: Math.ceil(130 * eraScale),
      materialsCost: 4 + era,
      educationCost: 3 + Math.floor(era / 2),
      people: era >= 4 ? 1 : 0,
    };
  }
  if (tile.type === TILE_TYPES.MILITARY) {
    return {
      money: Math.ceil(20 + military * 9),
      materials: military >= 2 ? 2 : 0,
    };
  }
  return null;
}

export function checkEraAdvancement(game) {
  const nation = game.player;
  if (!nation || game.pendingEraReport) return null;
  const farms = activeTiles(nation, game.tiles, TILE_TYPES.FARM).length;
  const mines = activeTiles(nation, game.tiles, TILE_TYPES.MINE).length;
  const schools = activeTiles(nation, game.tiles, TILE_TYPES.SCHOOL).length;
  const factories = activeTiles(nation, game.tiles, TILE_TYPES.FACTORY).length;
  const techSum = nation.tech.farming + nation.tech.mining + nation.tech.education + nation.tech.military;

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
