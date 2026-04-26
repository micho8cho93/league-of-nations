import {
  BUILDING_TYPES,
  TILE_TYPES,
  WORKER_ROLES,
  isTileActive,
} from "./utils.js";
import { BALANCE } from "./balance.js";

export const PERSONALITIES = ["aggressive", "economic", "scientific", "balanced"];

// Distributes personalities across bot nations in a fixed rotation.
// For 5 bots: aggressive, economic, scientific, balanced, aggressive → 2/1/1/1
export function personalitySequence(botCount) {
  const rotation = ["aggressive", "economic", "scientific", "balanced"];
  return Array.from({ length: botCount }, (_, i) => rotation[i % rotation.length]);
}

export const BOT_NAMES = [
  "Arden Republic",
  "Vesper Union",
  "Meridian League",
  "Solenne Duchy",
  "Orun Free Cities",
  "Caldor Dominion",
  "Istrian Commonwealth",
  "Kestral Accord",
  "Namar Isles",
];

export const STARTING_PROFILES = BALANCE.startingProfiles;

export function profileSequence(nationCount) {
  const sequence = [];
  const order = ["small", "balanced", "large"];
  for (let i = 0; i < nationCount; i += 1) sequence.push(order[i % order.length]);
  return sequence;
}

export function createNation({
  id,
  name,
  color,
  isPlayer = false,
  profile = "balanced",
  personality = "balanced",
}) {
  const start = STARTING_PROFILES[profile] || STARTING_PROFILES.balanced;
  const population = start.population;
  return {
    id,
    name,
    color,
    isPlayer,
    profile,
    personality,
    active: true,
    capitalTileId: null,
    territory: [],
    warExhaustion: BALANCE.war.exhaustion.min,
    mobilizationLevel: BALANCE.war.mobilization.peacetimeLevel,
    population: {
      total: population,
      available: Math.max(0, population - 8),
    },
    money: start.money,
    resources: { ...start.resources },
    workers: {
      [WORKER_ROLES.FARMERS]: 2,
      [WORKER_ROLES.MINERS]: 0,
      [WORKER_ROLES.SCHOLARS]: 0,
      [WORKER_ROLES.ENGINEERS]: 0,
      [WORKER_ROLES.SOLDIERS]: 6,
    },
    diplomacy: {},
    military: {
      unitsTrained: 0,
      unitsLost: 0,
      battlesWon: 0,
      battlesLost: 0,
      capitalsCaptured: 0,
      branchFocus: null,
    },
    tech: {
      farming: 0,
      mining: 0,
      education: 0,
      military: 0,
      branches: {
        tanks: 0,
        air: 0,
        naval: 0,
      },
    },
    stats: {
      built: 0,
      destroyed: 0,
      tilesCaptured: 0,
      warsDeclared: 0,
      tradesAccepted: 0,
      alliancesFormed: 0,
      turnsAtWar: 0,
      peopleLost: 0,
      peopleGained: 0,
      moneyEarned: 0,
      moneySpent: 0,
      resourcesProduced: 0,
      techResearched: 0,
      eventsSuffered: 0,
      history: [],
    },
  };
}

export function addHistory(nation, turn, message, type = "action") {
  nation.stats.history.push({
    turn,
    type,
    message,
    timestamp: Date.now(),
  });
  if (nation.stats.history.length > 160) nation.stats.history.shift();
}

export function ownedTiles(nation, tiles) {
  if (!nation) return [];
  return tiles.filter((tile) => tile.ownerId === nation.id);
}

export function activeTiles(nation, tiles, type = null) {
  return ownedTiles(nation, tiles).filter((tile) => {
    if (type && tile.type !== type) return false;
    return isTileActive(tile);
  });
}

export function countTiles(nation, tiles, type = null) {
  return ownedTiles(nation, tiles).filter((tile) => !type || tile.type === type).length;
}

export function availableWorkers(nation) {
  return Math.max(0, nation.population.available);
}

export function spendMoney(nation, amount) {
  const cost = Math.max(0, Math.ceil(amount));
  if (nation.money < cost) return false;
  nation.money -= cost;
  nation.stats.moneySpent += cost;
  return true;
}

export function earnMoney(nation, amount) {
  const gain = Math.max(0, Math.ceil(amount));
  nation.money += gain;
  nation.stats.moneyEarned += gain;
}

export function addPopulation(nation, amount) {
  const gain = Math.max(0, Math.floor(amount));
  nation.population.total += gain;
  nation.population.available += gain;
  nation.stats.peopleGained += gain;
}

export function removePopulation(nation, amount) {
  let remaining = Math.max(0, Math.floor(amount));
  const before = remaining;
  const fromAvailable = Math.min(nation.population.available, remaining);
  nation.population.available -= fromAvailable;
  nation.population.total -= fromAvailable;
  remaining -= fromAvailable;

  const roleOrder = [
    WORKER_ROLES.SOLDIERS,
    WORKER_ROLES.ENGINEERS,
    WORKER_ROLES.SCHOLARS,
    WORKER_ROLES.MINERS,
    WORKER_ROLES.FARMERS,
  ];
  for (const role of roleOrder) {
    if (remaining <= 0) break;
    const lost = Math.min(nation.workers[role] || 0, remaining);
    nation.workers[role] -= lost;
    nation.population.total -= lost;
    remaining -= lost;
  }

  const removed = before - remaining;
  nation.population.total = Math.max(0, nation.population.total);
  nation.population.available = Math.max(0, nation.population.available);
  nation.stats.peopleLost += removed;
  if (nation.population.total <= 0) nation.active = false;
  return removed;
}

export function militaryPower(nation, tiles = []) {
  if (!nation || !nation.active) return 0;
  const owned = tiles.length ? ownedTiles(nation, tiles) : [];
  const unitStrength = owned.reduce((sum, tile) => sum + (tile.unit?.strength || 0), 0);
  const staffedBases = owned.filter((tile) => tile.type === TILE_TYPES.MILITARY).reduce((sum, tile) => sum + (tile.workers || 0), 0);
  const power = BALANCE.militaryPower;
  const branchPower =
    nation.tech.branches.tanks * power.branch.tanks +
    nation.tech.branches.air * power.branch.air +
    nation.tech.branches.naval * power.branch.naval;
  return Math.round(staffedBases + unitStrength + nation.tech.military * power.militaryTech + branchPower);
}

export function computeScore(nation, tiles) {
  if (!nation || !nation.active) return -Infinity;
  const owned = ownedTiles(nation, tiles);
  const score = BALANCE.score;
  const resourceValue =
    nation.resources.food * score.resourceValues.food +
    nation.resources.materials * score.resourceValues.materials +
    nation.resources.education * score.resourceValues.education +
    nation.resources.industry * score.resourceValues.industry;
  const buildingValue = BUILDING_TYPES.reduce((sum, type) => {
    return sum + countTiles(nation, tiles, type) * (score.buildingValue[type] || score.buildingValue.default);
  }, 0);
  const techValue =
    (nation.tech.farming + nation.tech.mining + nation.tech.education + nation.tech.military) * score.techTierValue +
    Object.values(nation.tech.branches).reduce((sum, level) => sum + level * score.branchTierValue, 0);
  return Math.round(
    nation.money +
      resourceValue +
      nation.population.total * score.populationValue +
      owned.length * score.territoryValue +
      buildingValue +
      militaryPower(nation, tiles) * score.militaryValue +
      techValue
  );
}

export function serializeNation(nation) {
  return JSON.parse(JSON.stringify(nation));
}

export function restoreNation(data) {
  const nation = JSON.parse(JSON.stringify(data));
  return {
    ...nation,
    warExhaustion: normalizeWarExhaustion(nation.warExhaustion),
    mobilizationLevel: normalizeMobilizationLevel(nation.mobilizationLevel),
  };
}

function normalizeWarExhaustion(value) {
  const config = BALANCE.war.exhaustion;
  const numeric = Number.isFinite(value) ? value : config.min;
  return Math.max(config.min, Math.min(config.max, numeric));
}

function normalizeMobilizationLevel(value) {
  const config = BALANCE.war.mobilization;
  const numeric = Number.isFinite(value) ? Math.round(value) : config.peacetimeLevel;
  return Math.max(config.minLevel, Math.min(config.maxLevel, numeric));
}
