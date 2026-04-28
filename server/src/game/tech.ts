import type { ServerGameState } from "./initialGame.js";
import {
  INFRASTRUCTURE_UNLOCKS,
  transportUnlockForTier,
} from "./infrastructure.js";

type Nation = ServerGameState["nations"][string];
type Tile = ServerGameState["map"]["tiles"][number];
type TechCategory = "farming" | "mining" | "education" | "infrastructure" | "military";
type MilitaryBranch = "tanks" | "air" | "naval";

const TILE_TYPES = {
  FARM: "farm",
  FISHERY: "fishery",
  MINE: "mine",
  MOUNTAIN_MINE: "mountainMine",
  SCHOOL: "school",
  UNIVERSITY: "university",
  FACTORY: "factory",
  MILITARY: "military",
  ROAD: "road",
  RAILROAD: "railroad",
  HIGHWAY: "highway",
  AIRPORT: "airport",
} as const;

const WORKER_MIN: Record<string, number> = {
  [TILE_TYPES.FARM]: 2,
  [TILE_TYPES.FISHERY]: 2,
  [TILE_TYPES.MINE]: 3,
  [TILE_TYPES.MOUNTAIN_MINE]: 4,
  [TILE_TYPES.SCHOOL]: 3,
  [TILE_TYPES.UNIVERSITY]: 5,
  [TILE_TYPES.FACTORY]: 5,
  [TILE_TYPES.MILITARY]: 4,
};

export const TECH_CATEGORIES: Record<TechCategory, { label: string; tileTypes: string[]; baseCost: number; resource: string }> = {
  farming: { label: "Farming", tileTypes: [TILE_TYPES.FARM, TILE_TYPES.FISHERY], baseCost: 260, resource: "food" },
  mining: { label: "Mining", tileTypes: [TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE], baseCost: 320, resource: "materials" },
  education: { label: "Education", tileTypes: [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY], baseCost: 360, resource: "education" },
  infrastructure: { label: "Infrastructure", tileTypes: [], baseCost: 390, resource: "materials" },
  military: { label: "Military", tileTypes: [TILE_TYPES.MILITARY], baseCost: 420, resource: "materials" },
};

export const MILITARY_BRANCHES: Record<MilitaryBranch, { label: string; baseCost: number; materialCost: number; educationCost?: number }> = {
  tanks: { label: "Tanks", baseCost: 900, materialCost: 45 },
  air: { label: "Air", baseCost: 1050, materialCost: 35, educationCost: 35 },
  naval: { label: "Naval", baseCost: 1000, materialCost: 50 },
};

export const TECH_RESEARCH = {
  costExponent: 1.85,
  maxTier: 4,
  activeTilesPerTier: 2,
  resourceCostRate: 0.08,
  resourceCostExponent: 1.5,
};

export const BRANCH_RESEARCH = {
  moneyExponent: 1.9,
  materialsExponent: 1.45,
  educationExponent: 1.35,
  industryBase: 25,
  industryExponent: 1.35,
  fallbackEducationCost: 20,
  requiredMilitaryTier: 3,
  maxLevel: 3,
};

export function researchCost(category: string, currentTier: number) {
  const config = TECH_CATEGORIES[category as TechCategory];
  if (!config) return 0;
  return Math.ceil(config.baseCost * Math.pow(TECH_RESEARCH.costExponent, currentTier));
}

export function researchRequirement(category: string, nextTier: number) {
  const config = TECH_CATEGORIES[category as TechCategory];
  if (!config) return null;
  const resourceCost = Math.ceil(config.baseCost * TECH_RESEARCH.resourceCostRate * Math.pow(TECH_RESEARCH.resourceCostExponent, nextTier - 1));
  if (category === "infrastructure") {
    const unlock = transportUnlockForTier(nextTier);
    return {
      activeTiles: 0,
      resource: config.resource,
      resourceCost,
      starter: nextTier === 1,
      era: unlock?.era || 1,
      unlockLabel: unlock?.label || "Transport",
    };
  }
  return {
    activeTiles: Math.max(1, nextTier * TECH_RESEARCH.activeTilesPerTier),
    resource: config.resource,
    resourceCost,
    starter: false,
    era: 1,
    unlockLabel: "",
  };
}

export function canResearch(
  game: ServerGameState,
  nation: Nation,
  category: string,
): { ok: true; cost: number; requirement: NonNullable<ReturnType<typeof researchRequirement>>; nextTier: number } | { ok: false; reason: string } {
  const config = TECH_CATEGORIES[category as TechCategory];
  if (!config) return { ok: false, reason: "Unknown technology." };
  const current = numberValue((nation.tech as unknown as Record<string, unknown>)[category]);
  if (current >= TECH_RESEARCH.maxTier) return { ok: false, reason: "Maximum linear tier reached." };

  const nextTier = current + 1;
  const requirement = researchRequirement(category, nextTier);
  if (!requirement) return { ok: false, reason: "Unknown technology." };
  const cost = researchCost(category, current);

  if (category === "infrastructure" && game.era < requirement.era) {
    return { ok: false, reason: `${requirement.unlockLabel}s unlock in Era ${requirement.era}.` };
  }
  if (category === "infrastructure" && requirement.starter) {
    if (activeTileCount(game, nation.id, [TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE]) < 1) {
      return { ok: false, reason: "Requires one active mine or mountain mine." };
    }
    if (activeTileCount(game, nation.id, [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY]) < 1) {
      return { ok: false, reason: "Requires one active school or university." };
    }
  } else if (category !== "infrastructure") {
    const active = activeTileCount(game, nation.id, config.tileTypes);
    if (active < requirement.activeTiles) {
      return { ok: false, reason: `Requires ${requirement.activeTiles} active ${config.label.toLowerCase()} ${requirement.activeTiles === 1 ? "tile" : "tiles"}.` };
    }
  }

  if (nation.money < cost) return { ok: false, reason: `Requires $${cost}.` };
  if (resourceCount(nation, requirement.resource) < requirement.resourceCost) {
    return { ok: false, reason: `Requires ${requirement.resourceCost} ${requirement.resource}.` };
  }
  return { ok: true, cost, requirement, nextTier };
}

export function branchCost(branch: string, currentLevel: number) {
  const config = MILITARY_BRANCHES[branch as MilitaryBranch];
  if (!config) return null;
  return {
    money: Math.ceil(config.baseCost * Math.pow(BRANCH_RESEARCH.moneyExponent, currentLevel)),
    materials: Math.ceil((config.materialCost || 0) * Math.pow(BRANCH_RESEARCH.materialsExponent, currentLevel)),
    education: Math.ceil((config.educationCost || BRANCH_RESEARCH.fallbackEducationCost) * Math.pow(BRANCH_RESEARCH.educationExponent, currentLevel)),
    industry: Math.ceil(BRANCH_RESEARCH.industryBase * Math.pow(BRANCH_RESEARCH.industryExponent, currentLevel)),
  };
}

export function canResearchBranch(
  game: ServerGameState,
  nation: Nation,
  branch: string,
): { ok: true; cost: { money: number; materials: number; education: number; industry: number }; nextLevel: number } | { ok: false; reason: string } {
  if (!MILITARY_BRANCHES[branch as MilitaryBranch]) return { ok: false, reason: "Unknown branch." };
  if (game.era < 4) return { ok: false, reason: "Military branches unlock in Era 4." };
  if (numberValue(nation.tech.military) < BRANCH_RESEARCH.requiredMilitaryTier) {
    return { ok: false, reason: `Requires Military tier ${BRANCH_RESEARCH.requiredMilitaryTier}.` };
  }
  if (activeTileCount(game, nation.id, [TILE_TYPES.FACTORY]) < 1) return { ok: false, reason: "Requires one active factory." };

  const current = numberValue(nation.tech.branches?.[branch]);
  if (current >= BRANCH_RESEARCH.maxLevel) return { ok: false, reason: "Branch is fully specialized." };
  const cost = branchCost(branch, current);
  if (!cost) return { ok: false, reason: "Unknown branch." };
  if (nation.money < cost.money) return { ok: false, reason: `Requires $${cost.money}.` };
  for (const resource of ["materials", "education", "industry"] as const) {
    if (resourceCount(nation, resource) < cost[resource]) return { ok: false, reason: `Requires ${cost[resource]} ${resource}.` };
  }
  return { ok: true, cost, nextLevel: current + 1 };
}

export function buildingTechRequirement(type: string, nation: Nation, era: number): { ok: true } | { ok: false; reason: string } {
  if (type === TILE_TYPES.FISHERY && numberValue(nation.tech.farming) < 1) return { ok: false, reason: "Requires Farming tier 1." };
  if (type === TILE_TYPES.MOUNTAIN_MINE && numberValue(nation.tech.mining) < 2) return { ok: false, reason: "Requires Mining tier 2." };
  if (type === TILE_TYPES.UNIVERSITY && numberValue(nation.tech.education) < 3) return { ok: false, reason: "Requires Education tier 3." };
  const unlock = INFRASTRUCTURE_UNLOCKS.find((item) => item.type === type);
  if (unlock) {
    if (era < unlock.era) return { ok: false, reason: `${unlock.label}s unlock in Era ${unlock.era}.` };
    if (numberValue(nation.tech.infrastructure) < unlock.tier) return { ok: false, reason: `Requires Infrastructure tier ${unlock.tier}.` };
  }
  return { ok: true };
}

export function getUnlockedActions(game: ServerGameState, nation: Nation) {
  return {
    trade: game.era >= 2,
    diplomacy: game.era >= 2,
    war: game.era >= 3,
    transport: INFRASTRUCTURE_UNLOCKS.filter((unlock) => game.era >= unlock.era && numberValue(nation.tech.infrastructure) >= unlock.tier).map((unlock) => unlock.type),
    training: {
      infantry: true,
      tanks: game.era >= 4 && numberValue(nation.tech.branches?.tanks) > 0,
      air: game.era >= 4 && numberValue(nation.tech.branches?.air) > 0,
      naval: game.era >= 4 && numberValue(nation.tech.branches?.naval) > 0,
    },
  };
}

function activeTileCount(game: ServerGameState, nationId: string, types: string[]) {
  return types.reduce((sum, type) => sum + game.map.tiles.filter((tile) => tile.ownerId === nationId && tile.type === type && isTileActive(tile)).length, 0);
}

function isTileActive(tile: Tile) {
  if (!tile || !WORKER_MIN[tile.type]) return false;
  if (tile.effects?.disabledTurns > 0 || tile.effects?.floodedTurns > 0) return false;
  return (tile.workers || 0) >= WORKER_MIN[tile.type];
}

function resourceCount(nation: Nation, resource: string) {
  return numberValue(nation.resources?.[resource]);
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
