import type { ServerGameState } from "./initialGame.js";

type Nation = ServerGameState["nations"][string];
type Tile = ServerGameState["map"]["tiles"][number];

export const INFRASTRUCTURE_TYPES = {
  NONE: "none",
  ROAD: "road",
  RAIL: "rail",
  ADVANCED: "advanced",
} as const;

export const INFRASTRUCTURE_LABELS: Record<string, string> = {
  [INFRASTRUCTURE_TYPES.NONE]: "No infrastructure",
  [INFRASTRUCTURE_TYPES.ROAD]: "Road",
  [INFRASTRUCTURE_TYPES.RAIL]: "Rail",
  [INFRASTRUCTURE_TYPES.ADVANCED]: "Advanced Network",
};

export const INFRASTRUCTURE_BUILD_COSTS: Record<string, number> = {
  [INFRASTRUCTURE_TYPES.ROAD]: 90,
  [INFRASTRUCTURE_TYPES.RAIL]: 150,
  [INFRASTRUCTURE_TYPES.ADVANCED]: 240,
};

export const INFRASTRUCTURE_UNLOCKS = [
  { tier: 1, type: INFRASTRUCTURE_TYPES.ROAD, label: "Road", era: 1 },
  { tier: 2, type: INFRASTRUCTURE_TYPES.RAIL, label: "Rail", era: 2 },
  { tier: 3, type: INFRASTRUCTURE_TYPES.ADVANCED, label: "Advanced Network", era: 3 },
] as const;

const ROAD_TERRAINS = new Set(["land"]);
const ADVANCED_TERRAINS = new Set(["land", "water"]);

export function normalizeInfrastructureType(value: unknown) {
  const raw = String(value || INFRASTRUCTURE_TYPES.NONE).toLowerCase();
  return Object.values(INFRASTRUCTURE_TYPES).includes(raw as (typeof INFRASTRUCTURE_TYPES)[keyof typeof INFRASTRUCTURE_TYPES])
    ? raw
    : INFRASTRUCTURE_TYPES.NONE;
}

export function tileInfrastructureType(tile: Tile | null | undefined) {
  return normalizeInfrastructureType(tile?.infrastructure);
}

export function infrastructureRequiredTier(type: unknown) {
  const normalized = normalizeInfrastructureType(type);
  return INFRASTRUCTURE_UNLOCKS.find((item) => item.type === normalized)?.tier || 0;
}

export function transportUnlockForTier(tier: number) {
  return INFRASTRUCTURE_UNLOCKS.find((item) => item.tier === tier) || null;
}

export function unitInfrastructureType(unitType: string) {
  const normalized = String(unitType || "infantry").toLowerCase();
  if (normalized === "infantry") return INFRASTRUCTURE_TYPES.ROAD;
  if (normalized === "tanks" || normalized === "tank") return INFRASTRUCTURE_TYPES.RAIL;
  if (normalized === "air" || normalized === "plane" || normalized === "naval" || normalized === "navy") return INFRASTRUCTURE_TYPES.ADVANCED;
  return INFRASTRUCTURE_TYPES.NONE;
}

export function canTileHostInfrastructure(tile: Tile | null | undefined, type: unknown) {
  const normalized = normalizeInfrastructureType(type);
  if (!tile || normalized === INFRASTRUCTURE_TYPES.NONE) return false;
  if (normalized === INFRASTRUCTURE_TYPES.ADVANCED) return ADVANCED_TERRAINS.has(tile.terrain) && tile.type !== "mountain";
  return ROAD_TERRAINS.has(tile.terrain) && tile.type !== "mountain" && tile.type !== "water" && tile.type !== "fishery";
}

export function computeInfrastructureState(tiles: Tile[], nation: Nation | null | undefined) {
  const territoryTiles = tiles.filter((tile) => tile.ownerId === nation?.id);
  const capital = territoryTiles.find((tile) => tile.id === nation?.capitalTileId || tile.isCapital) || null;
  const index = new Map(tiles.map((tile) => [tile.id, tile]));
  const connectedByType = {
    [INFRASTRUCTURE_TYPES.ROAD]: connectedInfrastructureFromCapital(index, capital, nation?.id || "", INFRASTRUCTURE_TYPES.ROAD),
    [INFRASTRUCTURE_TYPES.RAIL]: connectedInfrastructureFromCapital(index, capital, nation?.id || "", INFRASTRUCTURE_TYPES.RAIL),
    [INFRASTRUCTURE_TYPES.ADVANCED]: connectedInfrastructureFromCapital(index, capital, nation?.id || "", INFRASTRUCTURE_TYPES.ADVANCED),
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
    index,
    territoryTiles,
    connectedByType,
    allConnected,
    counts,
  };
}

export function computeNationLogistics(tiles: Tile[], nation: Nation | null | undefined) {
  const infrastructure = computeInfrastructureState(tiles, nation);
  const total = Math.max(1, infrastructure.counts.total);
  const distances = infrastructure.territoryTiles
    .filter((tile) => !tile.isCapital && infrastructure.capital)
    .map((tile) => hexDistance(infrastructure.capital as Tile, tile));
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
    0.24,
    territoryScale * 0.07 +
      Math.max(0, averageDistance - 2) * 0.022 +
      remoteShare * 0.06,
  );
  const relief =
    connectedCoverage * 0.08 +
    roadCoverage * 0.02 +
    railCoverage * 0.035 +
    advancedCoverage * 0.05 +
    Math.max(0, Math.min(4, Math.floor(Number(nation?.tech?.infrastructure) || 0))) * 0.012;
  const distancePenalty = Math.max(0, rawDistancePenalty - relief);
  const weightedCoverageScore = (roadCoverage + railCoverage * 1.4 + advancedCoverage * 1.8) / 4.2;
  const transportEfficiency = clampNumber(1 - distancePenalty + weightedCoverageScore * 0.3 + connectedCoverage * 0.08, 0.84, 1.28);
  const foodModifier = clampNumber(1 - distancePenalty * 0.55 + roadCoverage * 0.08 + connectedCoverage * 0.05, 0.9, 1.18);
  const materialsModifier = clampNumber(1 - distancePenalty * 0.65 + railCoverage * 0.1 + advancedCoverage * 0.04, 0.88, 1.2);
  const growthMultiplier = clampNumber(transportEfficiency + roadCoverage * 0.04, 0.9, 1.3);
  const happinessDelta = clampInt(Math.round(connectedCoverage * 4 + advancedCoverage * 2 - distancePenalty * 18 - territoryScale * 1.5), -5, 4);
  return {
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
    growthMultiplier,
    happinessDelta,
  };
}

export function advancedNetworkSupport(logistics: ReturnType<typeof computeNationLogistics> | null | undefined, tileIdValue: string) {
  if (!logistics?.infrastructure) return false;
  if (logistics.infrastructure.connectedByType[INFRASTRUCTURE_TYPES.ADVANCED].has(tileIdValue)) return true;
  const tile = logistics.infrastructure.index.get(tileIdValue);
  if (!tile) return false;
  return axialNeighbors(tile.q, tile.r).some((coord) => (
    logistics.infrastructure.connectedByType[INFRASTRUCTURE_TYPES.ADVANCED].has(tileId(coord.q, coord.r))
  ));
}

export function canUseInfrastructureEdge(
  logistics: ReturnType<typeof computeNationLogistics> | null | undefined,
  fromTileId: string,
  toTileId: string,
  unitType: string,
) {
  const infrastructureType = unitInfrastructureType(unitType);
  if (!logistics?.infrastructure) return false;
  if (![INFRASTRUCTURE_TYPES.ROAD, INFRASTRUCTURE_TYPES.RAIL].includes(infrastructureType as "road" | "rail")) return false;
  const connected = logistics.infrastructure.connectedByType[infrastructureType as "road" | "rail"];
  return connected.has(fromTileId) && connected.has(toTileId);
}

function connectedInfrastructureFromCapital(index: Map<string, Tile>, capital: Tile | null, nationId: string, type: string) {
  const connected = new Set<string>();
  if (!capital || !nationId) return connected;
  if (tileInfrastructureType(capital) === type) connected.add(capital.id);
  const queue: Tile[] = [capital];
  const seen = new Set<string>([capital.id]);
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

function axialNeighbors(q: number, r: number) {
  return [
    { q: q + 1, r },
    { q: q - 1, r },
    { q, r: r + 1 },
    { q, r: r - 1 },
    { q: q + 1, r: r - 1 },
    { q: q - 1, r: r + 1 },
  ];
}

function tileId(q: number, r: number) {
  return `${q}:${r}`;
}

function hexDistance(a: Tile, b: Tile) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function clampInt(value: number, min: number, max: number) {
  const numeric = Math.round(Number(value) || 0);
  return Math.max(min, Math.min(max, numeric));
}
