import { axialNeighbors, hexDistance, tileId } from "./utils.js";

export const INFRASTRUCTURE_TYPES = {
  NONE: "none",
  ROAD: "road",
  RAIL: "rail",
  ADVANCED: "advanced",
};

export const INFRASTRUCTURE_LABELS = {
  [INFRASTRUCTURE_TYPES.NONE]: "No infrastructure",
  [INFRASTRUCTURE_TYPES.ROAD]: "Road",
  [INFRASTRUCTURE_TYPES.RAIL]: "Rail",
  [INFRASTRUCTURE_TYPES.ADVANCED]: "Advanced Network",
};

export const INFRASTRUCTURE_BUILD_COSTS = {
  [INFRASTRUCTURE_TYPES.ROAD]: 90,
  [INFRASTRUCTURE_TYPES.RAIL]: 150,
  [INFRASTRUCTURE_TYPES.ADVANCED]: 240,
};

export const INFRASTRUCTURE_UNLOCKS = [
  { tier: 1, type: INFRASTRUCTURE_TYPES.ROAD, label: "Road", era: 1 },
  { tier: 2, type: INFRASTRUCTURE_TYPES.RAIL, label: "Rail", era: 2 },
  { tier: 3, type: INFRASTRUCTURE_TYPES.ADVANCED, label: "Advanced Network", era: 3 },
];

const INFRASTRUCTURE_WEIGHT = {
  [INFRASTRUCTURE_TYPES.NONE]: 0,
  [INFRASTRUCTURE_TYPES.ROAD]: 1,
  [INFRASTRUCTURE_TYPES.RAIL]: 1.6,
  [INFRASTRUCTURE_TYPES.ADVANCED]: 2.25,
};

const ROAD_TERRAINS = new Set(["land"]);
const ADVANCED_TERRAINS = new Set(["land", "water"]);

export function normalizeInfrastructureType(value) {
  const raw = String(value || INFRASTRUCTURE_TYPES.NONE).toLowerCase();
  return Object.values(INFRASTRUCTURE_TYPES).includes(raw) ? raw : INFRASTRUCTURE_TYPES.NONE;
}

export function infrastructureLabel(value) {
  return INFRASTRUCTURE_LABELS[normalizeInfrastructureType(value)] || INFRASTRUCTURE_LABELS.none;
}

export function infrastructureRequiredTier(type) {
  const normalized = normalizeInfrastructureType(type);
  return INFRASTRUCTURE_UNLOCKS.find((item) => item.type === normalized)?.tier || 0;
}

export function transportUnlockForTier(tier) {
  return INFRASTRUCTURE_UNLOCKS.find((item) => item.tier === tier) || null;
}

export function unitInfrastructureType(unitType) {
  const normalized = String(unitType || "infantry").toLowerCase();
  if (normalized === "infantry") return INFRASTRUCTURE_TYPES.ROAD;
  if (normalized === "tanks" || normalized === "tank") return INFRASTRUCTURE_TYPES.RAIL;
  if (normalized === "air" || normalized === "plane" || normalized === "naval" || normalized === "navy") return INFRASTRUCTURE_TYPES.ADVANCED;
  return INFRASTRUCTURE_TYPES.NONE;
}

export function tileInfrastructureType(tile) {
  return normalizeInfrastructureType(tile?.infrastructure);
}

export function canTileHostInfrastructure(tile, type) {
  const normalized = normalizeInfrastructureType(type);
  if (!tile || normalized === INFRASTRUCTURE_TYPES.NONE) return false;
  if (normalized === INFRASTRUCTURE_TYPES.ADVANCED) return ADVANCED_TERRAINS.has(tile.terrain) && tile.type !== "mountain";
  return ROAD_TERRAINS.has(tile.terrain) && tile.type !== "mountain" && tile.type !== "water" && tile.type !== "fishery";
}

export function computeInfrastructureState(tiles = [], nation = null) {
  const territoryTiles = (tiles || []).filter((tile) => tile.ownerId === nation?.id);
  const capital = territoryTiles.find((tile) => tile.id === nation?.capitalTileId || tile.isCapital) || null;
  const hubs = territoryTiles.filter((tile) => tile === capital || tile.type === "city" || tile.type === "capitalCity");
  if (capital && !hubs.includes(capital)) hubs.unshift(capital);
  const index = new Map((tiles || []).map((tile) => [tile.id, tile]));
  const connectedByType = {
    [INFRASTRUCTURE_TYPES.ROAD]: connectedInfrastructureFromHubs(index, hubs, nation?.id, INFRASTRUCTURE_TYPES.ROAD),
    [INFRASTRUCTURE_TYPES.RAIL]: connectedInfrastructureFromHubs(index, hubs, nation?.id, INFRASTRUCTURE_TYPES.RAIL),
    [INFRASTRUCTURE_TYPES.ADVANCED]: connectedInfrastructureFromHubs(index, hubs, nation?.id, INFRASTRUCTURE_TYPES.ADVANCED),
  };
  const allConnected = new Set([
    ...connectedByType[INFRASTRUCTURE_TYPES.ROAD],
    ...connectedByType[INFRASTRUCTURE_TYPES.RAIL],
    ...connectedByType[INFRASTRUCTURE_TYPES.ADVANCED],
  ]);
  const counts = {
    total: territoryTiles.length,
    road: territoryTiles.filter((tile) => tileInfrastructureType(tile) === INFRASTRUCTURE_TYPES.ROAD).length,
    rail: territoryTiles.filter((tile) => tileInfrastructureType(tile) === INFRASTRUCTURE_TYPES.RAIL).length,
    advanced: territoryTiles.filter((tile) => tileInfrastructureType(tile) === INFRASTRUCTURE_TYPES.ADVANCED).length,
    connectedRoad: connectedByType[INFRASTRUCTURE_TYPES.ROAD].size,
    connectedRail: connectedByType[INFRASTRUCTURE_TYPES.RAIL].size,
    connectedAdvanced: connectedByType[INFRASTRUCTURE_TYPES.ADVANCED].size,
    connectedTotal: allConnected.size,
  };
  return {
    capital,
    hubs,
    index,
    territoryTiles,
    connectedByType,
    allConnected,
    counts,
  };
}

export function computeNationLogistics(tiles = [], nation = null) {
  const infrastructure = computeInfrastructureState(tiles, nation);
  const total = Math.max(1, infrastructure.counts.total);
  const distances = infrastructure.territoryTiles
    .filter((tile) => !tile.isCapital && infrastructure.hubs?.length)
    .map((tile) => Math.min(...infrastructure.hubs.map((hub) => hexDistance(hub, tile))));
  const averageDistance = distances.length
    ? distances.reduce((sum, value) => sum + value, 0) / distances.length
    : 0;
  const remoteShare = distances.length
    ? distances.filter((value) => value >= 4).length / distances.length
    : 0;
  const roadCoverage = infrastructure.counts.connectedRoad / total;
  const railCoverage = infrastructure.counts.connectedRail / total;
  const advancedCoverage = infrastructure.counts.connectedAdvanced / total;
  const connectedCoverage = infrastructure.counts.connectedTotal / total;
  const territoryScale = Math.max(0, total - 8) / 12;
  const rawDistancePenalty = Math.min(
    0.34,
    territoryScale * 0.085 +
      Math.max(0, averageDistance - 2) * 0.028 +
      remoteShare * 0.075,
  );
  const relief =
    connectedCoverage * 0.11 +
    roadCoverage * 0.03 +
    railCoverage * 0.05 +
    advancedCoverage * 0.07 +
    Math.max(0, Math.min(4, Math.floor(Number(nation?.tech?.infrastructure) || 0))) * 0.018;
  const distancePenalty = Math.max(0, rawDistancePenalty - relief);
  const weightedCoverageScore = (roadCoverage + railCoverage * 1.4 + advancedCoverage * 1.8) / 4.2;
  const transportEfficiency = clampNumber(1 - distancePenalty + weightedCoverageScore * 0.35 + connectedCoverage * 0.1, 0.76, 1.4);
  const foodModifier = clampNumber(1 - distancePenalty * 0.7 + roadCoverage * 0.1 + connectedCoverage * 0.06, 0.84, 1.24);
  const materialsModifier = clampNumber(1 - distancePenalty * 0.78 + railCoverage * 0.16 + advancedCoverage * 0.05, 0.8, 1.3);
  const moneyModifier = clampNumber(1 - distancePenalty * 0.62 + connectedCoverage * 0.08 + advancedCoverage * 0.06, 0.84, 1.22);
  const educationModifier = clampNumber(1 - distancePenalty * 0.58 + connectedCoverage * 0.06 + advancedCoverage * 0.08, 0.85, 1.24);
  const industryModifier = clampNumber(1 - distancePenalty * 0.66 + railCoverage * 0.09 + advancedCoverage * 0.12, 0.82, 1.28);
  const upkeepModifier = clampNumber(1 + distancePenalty * 0.55 - connectedCoverage * 0.16 - railCoverage * 0.08 - advancedCoverage * 0.14, 0.72, 1.14);
  const diplomacyModifier = clampNumber(1 - distancePenalty * 0.22 + connectedCoverage * 0.08 + advancedCoverage * 0.06, 0.9, 1.22);
  const growthMultiplier = clampNumber(transportEfficiency + roadCoverage * 0.05, 0.82, 1.4);
  const happinessDelta = clampInt(Math.round(connectedCoverage * 5 + advancedCoverage * 3 - distancePenalty * 22 - territoryScale * 2), -7, 5);
  return {
    nation,
    infrastructure,
    territoryCount: infrastructure.counts.total,
    averageDistance,
    connectedCoverage,
    roadCoverage,
    railCoverage,
    advancedCoverage,
    distancePenalty,
    transportEfficiency,
    foodModifier,
    materialsModifier,
    moneyModifier,
    educationModifier,
    industryModifier,
    upkeepModifier,
    diplomacyModifier,
    growthMultiplier,
    happinessDelta,
  };
}

export function advancedNetworkSupport(logistics, tileIdValue) {
  if (!logistics?.infrastructure) return false;
  if (logistics.infrastructure.connectedByType[INFRASTRUCTURE_TYPES.ADVANCED].has(tileIdValue)) return true;
  const tile = logistics.infrastructure.index.get(tileIdValue);
  if (!tile) return false;
  return axialNeighbors(tile.q, tile.r).some((coord) => (
    logistics.infrastructure.connectedByType[INFRASTRUCTURE_TYPES.ADVANCED].has(tileId(coord.q, coord.r))
  ));
}

export function canUseInfrastructureEdge(logistics, fromTileId, toTileId, unitType) {
  const infrastructureType = unitInfrastructureType(unitType);
  if (!logistics?.infrastructure) return false;
  if (![INFRASTRUCTURE_TYPES.ROAD, INFRASTRUCTURE_TYPES.RAIL].includes(infrastructureType)) return false;
  const connected = logistics.infrastructure.connectedByType[infrastructureType];
  return connected.has(fromTileId) && connected.has(toTileId);
}

function connectedInfrastructureFromCapital(index, capital, nationId, type) {
  return connectedInfrastructureFromHubs(index, capital ? [capital] : [], nationId, type);
}

function connectedInfrastructureFromHubs(index, hubs, nationId, type) {
  const connected = new Set();
  if (!hubs?.length || !nationId) return connected;
  const queue = [];
  const seen = new Set();
  for (const hub of hubs) {
    if (!hub) continue;
    seen.add(hub.id);
    if (tileInfrastructureType(hub) === type) connected.add(hub.id);
    queue.push(hub);
  }
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    for (const coord of axialNeighbors(current.q, current.r)) {
      const neighbor = index.get(tileId(coord.q, coord.r));
      if (!neighbor || seen.has(neighbor.id) || neighbor.ownerId !== nationId) continue;
      seen.add(neighbor.id);
      if (tileInfrastructureType(neighbor) !== type) continue;
      connected.add(neighbor.id);
      queue.push(neighbor);
    }
  }
  return connected;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function clampInt(value, min, max) {
  const numeric = Math.round(Number(value) || 0);
  return Math.max(min, Math.min(max, numeric));
}

export function infrastructureWeight(type) {
  return INFRASTRUCTURE_WEIGHT[normalizeInfrastructureType(type)] || 0;
}
