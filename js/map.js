import {
  MAP_SIZES,
  BIOME_COLORS,
  HEX_DIRECTIONS,
  OWNER_COLORS,
  TILE_COLORS,
  TILE_TYPES,
  WORKER_MIN,
  axialNeighbors,
  axialToWorld,
  clamp,
  hash2d,
  hexDistance,
  hexMapCoords,
  isLand,
  isWaterLike,
  mulberry32,
  randInt,
  shuffle,
  tileId,
} from "./utils.js";
import { normalizeGameMode } from "./advanced.js";
import { STARTING_PROFILES, militaryPower } from "./nation.js";
import { createRenderer, setupScene, setupCamera } from "./rendering/renderer.js";
import { getTileMaterial, colorFromHex } from "./rendering/config.js";
import * as decorations from "./rendering/decorations.js";
import { preloadCommonMaterials } from "./rendering/materialPool.js";
import { getModelSync, hasGLB } from "./rendering/assetLoader.js";

const HEX_SIZE = 1.18;
const HEX_HEIGHT = 0.36;
const HEX_GAP = 0.045;
const LABEL_HIDE_RADIUS = 10;
const LABEL_FULL_RADIUS = 14;
const TAU = Math.PI * 2;
const FOG_COLOR = 0x13202a;
const FOG_EMISSIVE = 0x081018;

const UNIT_MODEL_KEYS = Object.freeze({
  infantry: "infantry",
  tanks: "tank",
  air: "plane",
  naval: "ship",
});

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}


export function createMapData(settings) {
  const sizeInfo = MAP_SIZES[settings.mapSize] || MAP_SIZES.Medium;
  const radius = sizeInfo.radius;
  const seed = Number(settings.seed || 1);
  const coords = hexMapCoords(radius);
  const rng = mulberry32(seed);
  const mode = normalizeGameMode(settings.mode);
  const nationCount = Math.max(2, Math.floor(Number(settings.nationCount) || 5));
  const waterRatio = targetWaterRatio(coords.length, nationCount, settings.waterLevel);
  const initialWaterRatio = Math.max(0.16, waterRatio - 0.045);
  const targetLandRatio = 1 - waterRatio;
  const initialLandRatio = 1 - initialWaterRatio;
  const continentCount = nationCount <= 4 ? randInt(rng, 1, 2) : nationCount <= 7 ? randInt(rng, 2, 3) : randInt(rng, 3, 4);
  const islandCount = Math.max(6, Math.floor(radius * 0.9) + randInt(rng, 0, 3));
  const archipelagoCount = Math.max(2, Math.floor(radius / 4));
  const channelCount = 2 + Math.floor(rng() * 3);

  const centers = [];
  for (let i = 0; i < continentCount; i += 1) {
    centers.push({
      q: randInt(rng, -Math.floor(radius * 0.62), Math.floor(radius * 0.62)),
      r: randInt(rng, -Math.floor(radius * 0.62), Math.floor(radius * 0.62)),
      radius: radius * (0.31 + rng() * 0.18),
      weight: 1.35 + rng() * 0.55,
      kind: "continent",
    });
  }
  for (let i = 0; i < islandCount; i += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * (0.22 + rng() * 0.7);
    centers.push({
      q: Math.round(Math.cos(angle) * distance),
      r: Math.round(Math.sin(angle) * distance * 0.6),
      radius: 1.1 + rng() * 2.7,
      weight: 0.72 + rng() * 0.62,
      kind: "island",
    });
  }
  for (let i = 0; i < archipelagoCount; i += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * (0.18 + rng() * 0.62);
    const baseQ = Math.round(Math.cos(angle) * distance);
    const baseR = Math.round(Math.sin(angle) * distance * 0.72);
    for (let j = 0; j < 3 + Math.floor(rng() * 3); j += 1) {
      centers.push({
        q: baseQ + randInt(rng, -2, 2),
        r: baseR + randInt(rng, -2, 2),
        radius: 0.9 + rng() * 1.6,
        weight: 0.58 + rng() * 0.48,
        kind: "island",
      });
    }
  }

  const channels = Array.from({ length: channelCount }, () => ({
    angle: rng() * Math.PI * 2,
    offset: (rng() - 0.5) * radius * 1.35,
    width: 0.6 + rng() * 1.25,
    strength: 0.8 + rng() * 0.75,
  }));

  const scored = coords.map((coord) => {
    const edge = Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r)) / radius;
    let score = 0.18 - edge * 0.14 + hash2d(coord.q, coord.r, seed) * 0.5;
    let nearestKind = "continent";
    let bestInfluence = 0;
    for (const center of centers) {
      const dist = hexDistance(coord, center);
      const influence = Math.max(0, 1 - dist / center.radius) * center.weight;
      if (influence > bestInfluence) {
        bestInfluence = influence;
        nearestKind = center.kind;
      }
      score += influence;
    }
    for (const channel of channels) {
      const x = coord.q + coord.r * 0.5;
      const y = coord.r * 0.866;
      const dist = Math.abs(x * Math.cos(channel.angle) + y * Math.sin(channel.angle) - channel.offset);
      score -= Math.max(0, 1 - dist / channel.width) * channel.strength;
    }
    score += hash2d(coord.q * 3 + 17, coord.r * 5 - 11, seed + 91) * 0.26;
    score += hash2d(Math.floor(coord.q / 2) + 31, Math.floor(coord.r / 2) - 19, seed + 313) * 0.18;
    return { ...coord, score, nearestKind };
  });

  const initialLandCount = Math.round(scored.length * initialLandRatio);
  const landIds = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, initialLandCount)
      .map((coord) => tileId(coord.q, coord.r))
  );

  const tiles = scored.map((coord) => {
    const land = landIds.has(tileId(coord.q, coord.r));
    return {
      id: tileId(coord.q, coord.r),
      q: coord.q,
      r: coord.r,
      terrain: land ? "land" : "water",
      landform: land ? coord.nearestKind : "sea",
      biome: land ? "grassland" : "water",
      type: land ? TILE_TYPES.EMPTY : TILE_TYPES.WATER,
      ownerId: null,
      workers: 0,
      unit: null,
      regionId: null,
      isCapital: false,
      effects: {
        disabledTurns: 0,
        floodedTurns: 0,
        bountifulTurns: 0,
      },
    };
  });

  carveWaterFeatures(tiles, radius, seed, Math.round(scored.length * targetLandRatio));
  if (mode === "advanced") assignAdvancedBiomes(tiles, radius, seed, settings.landscapeDiversity);
  else assignBiomes(tiles, radius, seed, settings.landscapeDiversity);
  addMountainRanges(tiles, radius, seed, nationCount);

  const map = {
    size: settings.mapSize,
    radius,
    seed,
    landRatio: tiles.filter((tile) => tile.terrain === "land").length / scored.length,
    tiles,
  };
  assignRegions(map);
  return map;
}

function targetWaterRatio(tileCount, nationCount, waterLevel = "Balanced") {
  const requested = {
    Low: 0.25,
    Balanced: 0.4,
    High: 0.55,
  }[waterLevel] || 0.4;
  const requiredBuildable = nationCount * 10 + 12;
  const maxByLandNeed = 1 - requiredBuildable / tileCount;
  return clamp(requested, 0.2, Math.max(0.2, Math.min(0.6, maxByLandNeed)));
}

function carveWaterFeatures(tiles, radius, seed, targetLandCount) {
  let landCount = tiles.filter((tile) => tile.terrain === "land").length;
  let budget = Math.max(0, landCount - targetLandCount);
  if (budget <= 0) return;
  const index = buildTileIndex(tiles);
  const candidates = tiles
    .filter((tile) => tile.terrain === "land")
    .map((tile) => {
      const neighbors = axialNeighbors(tile.q, tile.r).map((coord) => index.get(tileId(coord.q, coord.r))).filter(Boolean);
      const waterNeighbors = neighbors.filter((neighbor) => neighbor.terrain === "water").length;
      const landNeighbors = neighbors.filter((neighbor) => neighbor.terrain === "land").length;
      const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r)) / radius;
      const lakeNoise = 1 - hash2d(tile.q * 5 - 4, tile.r * 7 + 9, seed + 4242);
      const inletNoise = 1 - hash2d(tile.q * 13 + 2, tile.r * 11 - 5, seed + 9090);
      const lakeScore = landNeighbors >= 5 && edge < 0.82 ? lakeNoise * 1.35 : 0;
      const inletScore = waterNeighbors > 0 ? inletNoise * (0.7 + waterNeighbors * 0.22) : 0;
      return { tile, score: Math.max(lakeScore, inletScore) };
    })
    .filter((entry) => entry.score > 0.52)
    .sort((a, b) => b.score - a.score);

  for (const { tile } of candidates) {
    if (budget <= 0) break;
    const neighbors = axialNeighbors(tile.q, tile.r).map((coord) => index.get(tileId(coord.q, coord.r))).filter(Boolean);
    if (neighbors.filter((neighbor) => neighbor.terrain === "land").length < 3) continue;
    tile.terrain = "water";
    tile.landform = "sea";
    tile.biome = "water";
    tile.type = TILE_TYPES.WATER;
    budget -= 1;
    landCount -= 1;
  }
}

function assignBiomes(tiles, radius, seed, landscapeDiversity = "Balanced") {
  const config = {
    Low: { scale: 9, spread: 0.72, passes: 2 },
    Balanced: { scale: 5.5, spread: 1, passes: 1 },
    High: { scale: 3.3, spread: 1.22, passes: 1 },
  }[landscapeDiversity] || { scale: 5.5, spread: 1, passes: 1 };
  assignBiomesWithConfig(tiles, radius, seed, config);
}

function assignAdvancedBiomes(tiles, radius, seed, landscapeDiversity = "high") {
  const config = landscapeDiversity === "superHigh"
    ? { scale: 2.4, spread: 1.36, passes: 0, patchCount: 4, patchRadius: 1.75, fillChance: 0.72, minimumRatio: 0.07, mergePasses: 0 }
    : { scale: 4.1, spread: 1.18, passes: 1, patchCount: 2, patchRadius: 3.35, fillChance: 0.9, minimumRatio: 0.09, mergePasses: 2 };
  assignBiomesWithConfig(tiles, radius, seed, config);
  stampAdvancedBiomePatches(tiles, radius, seed, config);
  ensureAdvancedBiomeMinimums(tiles, radius, seed, config);
  smoothBiomeClusters(tiles, config.mergePasses || 0, config.patchCount > 2 ? 4 : 3);
}

function assignBiomesWithConfig(tiles, radius, seed, config) {
  for (const tile of tiles) {
    if (tile.terrain !== "land") {
      tile.biome = "water";
      continue;
    }
    tile.biome = biomeForTile(tile, radius, seed, config);
  }

  smoothBiomeClusters(tiles, config.passes || 0, 4);
}

function biomeForTile(tile, radius, seed, config) {
  const { temperature, moisture } = biomeClimate(tile, radius, seed, config);

  if (temperature < 0.28) return "arctic";
  if (moisture < 0.26 && temperature > 0.42) return "desert";
  if (moisture > 0.68 && temperature > 0.52) return "jungle";
  if (moisture > 0.48) return "woods";
  return "grassland";
}

function biomeClimate(tile, radius, seed, config) {
  const y = (tile.r + tile.q * 0.5) / Math.max(1, radius);
  const latitudeTemp = 1 - Math.min(1, Math.abs(y));
  let temperature = latitudeTemp * 0.78 + smoothNoise(tile.q, tile.r, config.scale * 1.35, seed + 7001) * 0.38;
  let moisture = smoothNoise(tile.q + 29, tile.r - 17, config.scale, seed + 7101);
  const local = smoothNoise(tile.q - 11, tile.r + 23, config.scale * 0.58, seed + 7201);
  temperature = clamp(0.5 + (temperature - 0.5) * config.spread, 0, 1);
  moisture = clamp(0.5 + (moisture * 0.8 + local * 0.2 - 0.5) * config.spread, 0, 1);
  return { temperature, moisture };
}

function stampAdvancedBiomePatches(tiles, radius, seed, config) {
  const landTiles = tiles.filter((tile) => tile.terrain === "land");
  const usedCenters = new Set();
  for (const biome of ["grassland", "jungle", "arctic", "desert"]) {
    for (let patchIndex = 0; patchIndex < config.patchCount; patchIndex += 1) {
      const center = pickAdvancedBiomeCenter(landTiles, radius, seed, biome, patchIndex, usedCenters, config);
      if (!center) continue;
      usedCenters.add(center.id);
      for (const tile of landTiles) {
        const dist = hexDistance(tile, center);
        if (dist > config.patchRadius + hash2d(center.q * 7 + tile.q, center.r * 11 + tile.r, seed + patchIndex * 97) * 1.1) continue;
        const fillRoll = hash2d(tile.q * 13 + patchIndex * 17, tile.r * 19 - patchIndex * 23, seed + biomeSeedOffset(biome));
        if (fillRoll <= config.fillChance) tile.biome = biome;
      }
    }
  }
}

function pickAdvancedBiomeCenter(landTiles, radius, seed, biome, patchIndex, usedCenters, config) {
  return landTiles
    .filter((tile) => !usedCenters.has(tile.id))
    .map((tile) => {
      const climate = biomeClimate(tile, radius, seed, config);
      const affinity = advancedBiomeAffinity(tile, climate, biome);
      const noise = hash2d(tile.q * 29 + patchIndex * 13, tile.r * 31 - patchIndex * 17, seed + biomeSeedOffset(biome) + 41);
      return { tile, score: affinity + noise * 0.12 };
    })
    .sort((a, b) => b.score - a.score)[0]?.tile || null;
}

function ensureAdvancedBiomeMinimums(tiles, radius, seed, config) {
  const landTiles = tiles.filter((tile) => tile.terrain === "land");
  const minimumCount = Math.max(6, Math.round(landTiles.length * config.minimumRatio));
  for (const biome of ["grassland", "jungle", "arctic", "desert"]) {
    const currentCount = landTiles.filter((tile) => tile.biome === biome).length;
    if (currentCount >= minimumCount) continue;
    const needed = minimumCount - currentCount;
    const candidates = landTiles
      .filter((tile) => tile.biome !== biome)
      .map((tile) => {
        const climate = biomeClimate(tile, radius, seed, config);
        const affinity = advancedBiomeAffinity(tile, climate, biome);
        return { tile, score: affinity + hash2d(tile.q * 5 - 7, tile.r * 7 + 11, seed + biomeSeedOffset(biome) + 101) * 0.04 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, needed);
    for (const entry of candidates) entry.tile.biome = biome;
  }
}

function smoothBiomeClusters(tiles, passes, dominantThreshold = 4) {
  if (!passes) return;
  const index = buildTileIndex(tiles);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Map();
    for (const tile of tiles) {
      if (tile.terrain !== "land") continue;
      const counts = {};
      for (const coord of axialNeighbors(tile.q, tile.r)) {
        const neighbor = index.get(tileId(coord.q, coord.r));
        if (!neighbor || neighbor.terrain !== "land") continue;
        counts[neighbor.biome] = (counts[neighbor.biome] || 0) + 1;
      }
      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const currentCount = counts[tile.biome] || 0;
      if (dominant && dominant[1] >= dominantThreshold && currentCount <= 1) next.set(tile.id, dominant[0]);
      else if (dominant && dominant[1] >= dominantThreshold - 1 && currentCount === 0) next.set(tile.id, dominant[0]);
    }
    for (const [id, biome] of next) index.get(id).biome = biome;
  }
}

function advancedBiomeAffinity(tile, climate, biome) {
  const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r));
  if (biome === "arctic") return (1 - climate.temperature) * 1.4 + edge * 0.015;
  if (biome === "desert") return (1 - climate.moisture) * 1.2 + climate.temperature * 0.6;
  if (biome === "jungle") return climate.moisture * 1.25 + climate.temperature * 0.55;
  return (1 - Math.abs(climate.moisture - 0.52)) + climate.temperature * 0.2;
}

function biomeSeedOffset(biome) {
  return {
    grassland: 101,
    jungle: 211,
    arctic: 307,
    desert: 401,
  }[biome] || 0;
}

function smoothNoise(q, r, scale, seed) {
  const x = (q + r * 0.5) / scale;
  const y = (r * 0.866) / scale;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothStep(x - x0);
  const ty = smoothStep(y - y0);
  const a = hash2d(x0, y0, seed);
  const b = hash2d(x0 + 1, y0, seed);
  const c = hash2d(x0, y0 + 1, seed);
  const d = hash2d(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function addMountainRanges(tiles, radius, seed, nationCount) {
  const landTiles = tiles.filter((tile) => tile.terrain === "land");
  const requiredBuildable = nationCount * 9 + 8;
  const maxMountains = Math.max(0, landTiles.length - requiredBuildable);
  const targetMountains = Math.min(maxMountains, Math.round(landTiles.length * 0.13));
  if (targetMountains <= 0) return;

  const scored = landTiles
    .map((tile) => {
      const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r)) / radius;
      const ridgeA = 1 - Math.abs(hash2d(Math.floor(tile.q / 2) + 11, tile.r * 3 - 7, seed + 7777) - 0.52) * 2;
      const ridgeB = 1 - Math.abs(hash2d(tile.q * 2 + 2, Math.floor(tile.r / 2) + 3, seed + 8831) - 0.48) * 2;
      const peakNoise = hash2d(tile.q * 17 - 3, tile.r * 19 + 5, seed + 1234);
      return { tile, score: ridgeA * 0.48 + ridgeB * 0.34 + peakNoise * 0.28 - edge * 0.18 };
    })
    .filter((entry) => entry.score > 0.48)
    .sort((a, b) => b.score - a.score);

  for (const { tile } of scored.slice(0, targetMountains)) {
    tile.type = TILE_TYPES.MOUNTAIN;
  }
}

export function buildTileIndex(tiles) {
  return new Map(tiles.map((tile) => [tile.id, tile]));
}

export function getTile(map, id) {
  return buildTileIndex(map.tiles).get(id) || null;
}

export function assignRegions(map) {
  const index = buildTileIndex(map.tiles);
  let regionId = 1;
  for (const tile of map.tiles) tile.regionId = null;

  for (const start of map.tiles) {
    if (!isLand(start) || start.regionId) continue;
    const queue = [start];
    start.regionId = regionId;
    let size = 0;
    while (queue.length) {
      const current = queue.shift();
      size += 1;
      for (const coord of axialNeighbors(current.q, current.r)) {
        const neighbor = index.get(tileId(coord.q, coord.r));
        if (!neighbor || !isLand(neighbor) || neighbor.regionId) continue;
        neighbor.regionId = regionId;
        queue.push(neighbor);
      }
    }
    for (const tile of map.tiles) {
      if (tile.regionId === regionId && size <= 5) tile.landform = "island";
    }
    regionId += 1;
  }
}

export function assignStartingTerritories(map, nations, rng = mulberry32(map.seed + 101)) {
  const index = buildTileIndex(map.tiles);
  const land = map.tiles.filter((tile) => isLand(tile));
  const shuffledLand = shuffle(land, rng);
  const centers = [];
  const minSpacing = Math.max(4, Math.floor(map.radius * 0.55));

  for (const nation of nations) {
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of shuffledLand) {
      if (candidate.ownerId) continue;
      const nearbyLand = axialNeighbors(candidate.q, candidate.r)
        .map((coord) => index.get(tileId(coord.q, coord.r)))
        .filter((tile) => isLand(tile)).length;
      if (nearbyLand < 3) continue;
      const nearest = centers.length
        ? Math.min(...centers.map((center) => hexDistance(candidate, center)))
        : minSpacing;
      const centerBias = map.radius - Math.max(Math.abs(candidate.q), Math.abs(candidate.r), Math.abs(candidate.q + candidate.r));
      const score = nearest * 4 + centerBias + rng() * 3;
      if (nearest >= minSpacing && score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) {
      best = shuffledLand
        .filter((tile) => !tile.ownerId)
        .sort((a, b) => {
          const aDist = centers.length ? Math.min(...centers.map((center) => hexDistance(a, center))) : 0;
          const bDist = centers.length ? Math.min(...centers.map((center) => hexDistance(b, center))) : 0;
          return bDist - aDist;
        })[0];
    }
    if (!best) continue;
    centers.push(best);
    claimStartingCluster(map, nation, best, rng);
  }
}

function claimStartingCluster(map, nation, center, rng) {
  const index = buildTileIndex(map.tiles);
  const profile = STARTING_PROFILES[nation.profile] || STARTING_PROFILES.balanced;
  const target = profile.territoryTarget;
  const claimed = [];
  const queue = [center];
  const seen = new Set([center.id]);

  while (queue.length && claimed.length < target) {
    const tile = queue.shift();
    if (isLand(tile) && !tile.ownerId) {
      tile.ownerId = nation.id;
      claimed.push(tile);
    }
    const neighbors = shuffle(axialNeighbors(tile.q, tile.r), rng);
    for (const coord of neighbors) {
      const neighbor = index.get(tileId(coord.q, coord.r));
      if (!neighbor || seen.has(neighbor.id) || !isLand(neighbor)) continue;
      seen.add(neighbor.id);
      queue.push(neighbor);
    }
  }

  nation.territory = claimed.map((tile) => tile.id);
  const capital = claimed[0];
  if (capital) {
    capital.isCapital = true;
    capital.type = TILE_TYPES.MILITARY;
    capital.workers = WORKER_MIN[TILE_TYPES.MILITARY];
    capital.unit = {
      nationId: nation.id,
      strength: 4,
      branch: "infantry",
      movedTurn: 0,
    };
    nation.capitalTileId = capital.id;
  }

  const farm = claimed[1];
  if (farm) {
    farm.type = TILE_TYPES.FARM;
    farm.workers = WORKER_MIN[TILE_TYPES.FARM];
  }
  if (claimed[2]) claimed[2].type = TILE_TYPES.MINE;
  if (claimed[3]) claimed[3].type = TILE_TYPES.SCHOOL;
  if (claimed[4] && nation.profile !== "small") claimed[4].type = TILE_TYPES.FARM;
}

function terrainColor(tile) {
  if (tile.type === TILE_TYPES.EMPTY && tile.terrain === "land") return BIOME_COLORS[tile.biome] || BIOME_COLORS.grassland;
  return TILE_COLORS[tile.type] || TILE_COLORS[TILE_TYPES.EMPTY];
}

function tileSurfaceColor(tile, nations = {}) {
  if (tile?.ownerId && nations[tile.ownerId]?.color) return colorFromHex(nations[tile.ownerId].color);
  return terrainColor(tile);
}

function visualTierForTile(tile, nations) {
  const tech = nations[tile.ownerId]?.tech;
  if (!tech) return 0;
  if (tile.type === TILE_TYPES.FARM || tile.type === TILE_TYPES.FISHERY) return tech.farming || 0;
  if (tile.type === TILE_TYPES.MINE || tile.type === TILE_TYPES.MOUNTAIN_MINE) return tech.mining || 0;
  if (tile.type === TILE_TYPES.SCHOOL || tile.type === TILE_TYPES.UNIVERSITY) return tech.education || 0;
  if ([TILE_TYPES.ROAD, TILE_TYPES.RAILROAD, TILE_TYPES.HIGHWAY, TILE_TYPES.AIRPORT].includes(tile.type)) return tech.infrastructure || 0;
  if (tile.type === TILE_TYPES.MILITARY) return tech.military || 0;
  if (tile.type === TILE_TYPES.FACTORY) return Math.min(4, Math.max(tech.mining || 0, tech.education || 0));
  return 0;
}

function strongestBranchForTile(tile, nations) {
  if (tile.type !== TILE_TYPES.MILITARY) return { branch: tile.unit?.branch || "infantry", level: 0 };
  const nation = nations[tile.ownerId];
  const branches = nation?.tech?.branches || {};
  const focus = nation?.military?.branchFocus;
  if (focus && branches[focus] > 0) return { branch: focus, level: branches[focus] };
  return Object.entries(branches).reduce((best, [branch, level]) => {
    return level > best.level ? { branch, level } : best;
  }, { branch: tile.unit?.branch || "infantry", level: 0 });
}

function visualBranchesForUnit(unit) {
  if (!unit?.strength) return [];
  const branches = [];
  for (const branch of ["infantry", "tanks", "air", "naval"]) {
    const strength = Math.max(0, Number(unit.branches?.[branch] || 0));
    if (strength > 0) branches.push({ branch, strength });
  }
  if (!branches.length) branches.push({ branch: unit.branch || "infantry", strength: unit.strength });
  return branches;
}

function hexCorners(tile, radius = HEX_SIZE - HEX_GAP * 0.65) {
  const center = axialToWorld(tile.q, tile.r, HEX_SIZE);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    return {
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
    };
  });
}

function edgeCornersForDirection(direction) {
  if (direction.q === 1 && direction.r === 0) return [5, 0];
  if (direction.q === -1 && direction.r === 0) return [2, 3];
  if (direction.q === 0 && direction.r === 1) return [4, 5];
  if (direction.q === 0 && direction.r === -1) return [1, 2];
  if (direction.q === 1 && direction.r === -1) return [0, 1];
  return [3, 4];
}

function capitalScale(tile, nations, mapTiles = []) {
  const nation = nations[tile.ownerId];
  if (!nation) return 1;
  const territory = nation.territory?.length || mapTiles.filter((item) => item.ownerId === nation.id).length;
  const population = nation.population?.total || 0;
  const power = militaryPower(nation, mapTiles);
  return clamp(1 + territory * 0.012 + population / 900 + power * 0.006, 1, 1.68);
}

function targetIdFromAction(action) {
  if (!action) return null;
  if (typeof action === "string") return action;
  return action.toTileId || action.tileId || action.id || null;
}

function normalizeMilitaryHighlights(highlights = null) {
  return {
    sourceTileId: highlights?.sourceTileId || null,
    moveTargetIds: new Set((highlights?.moveTargets || []).map(targetIdFromAction).filter(Boolean)),
    attackTargetIds: new Set((highlights?.attackTargets || []).map(targetIdFromAction).filter(Boolean)),
  };
}

class MilitaryAnimationManager {
  constructor(mapRenderer) {
    this.mapRenderer = mapRenderer;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  }

  play(action) {
    try {
      if (!action || !this.mapRenderer.map) return;
      if (this.reducedMotion) {
        this.mapRenderer._flashTile(action.targetTileId);
        return;
      }
      if (action.action === "move") this.playMove(action);
      else if (action.action === "attack" || action.targetTileId) this.playAttack(action);
    } catch (error) {
      console.warn("Military animation failed", error);
    }
  }

  playMove(action) {
    const path = this.mapRenderer._tilePathToVectors(action.path || [action.fromTileId, action.targetTileId], action.unitType);
    if (path.length < 2) return;
    const unitVisual = this.mapRenderer._spawnTransientUnitVisual(action.unitType || "infantry", action.nationId, path[0]);
    if (!unitVisual) return;
    this.mapRenderer.playUnitMove(unitVisual, action.fromTileId, action.targetTileId, {
      path,
      duration: this.durationFor(action.unitType, path.length, false),
      targetTileId: action.targetTileId,
    });
  }

  playAttack(action) {
    const path = this.mapRenderer._tilePathToVectors(action.path || [action.fromTileId, action.targetTileId], action.unitType);
    if (!path.length) return;
    const unitType = action.unitType || "infantry";
    const attackerVisual = this.mapRenderer._spawnTransientUnitVisual(unitType, action.attackerId || action.nationId, path[0]);
    if (attackerVisual) {
      this.mapRenderer.playUnitAttack(attackerVisual, this.mapRenderer._getPrimaryUnitVisual(action.targetTileId), {
        targetTileId: action.targetTileId,
        path,
        unitType,
        disposeOnFinish: unitType !== "air",
      });
    }
    if (unitType === "air") {
      if (attackerVisual) {
        this.mapRenderer.playUnitMove(attackerVisual, action.fromTileId, action.targetTileId, {
          path,
          duration: this.durationFor(unitType, path.length, true),
          targetTileId: action.targetTileId,
          explodeAtEnd: true,
          delay: 170,
        });
      }
      return;
    }

    this.mapRenderer.playProjectileTravel({
      unitType,
      nationId: action.attackerId || action.nationId,
      path,
      duration: this.durationFor(unitType, path.length, true),
      targetTileId: action.targetTileId,
      delay: 170,
    });
  }

  durationFor(unitType, pathLength, attack) {
    const base = unitType === "air" ? 720 : unitType === "tanks" ? 820 : unitType === "naval" ? 960 : 760;
    return Math.max(460, base + Math.max(0, pathLength - 2) * (attack ? 110 : 180));
  }
}

export class HexMapRenderer {
  constructor(canvas, { onSelect = null, onHover = null } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.tileMeshes = new Map();
    this.decorations = new Map();
    this.decorationSignatures = new Map();
    this.territoryBorderSignature = "";
    this.transportSignature = "";
    this.nationLabels = new Map();
    this.nationLabelSignature = "";
    this.animated = [];
    this.effects = [];
    this.unitVisualsByTile = new Map();
    this.transientUnitVisuals = new Set();
    this.activeMixers = new Set();
    this.lastRenderTileState = new Map();
    this.lastRenderVisibleTileIds = null;
    this.lastAnimationFrameAt = 0;
    this.animationManager = new MilitaryAnimationManager(this);
    this.selectedTileId = null;
    this.militaryHighlights = normalizeMilitaryHighlights();
    this.hoveredTileId = null;
    this.visibility = null;
    this.map = null;
    this.nations = {};
    this.minCamRadius = 8.5;
    this.maxCamRadius = 78;
    this._initThree();
    this._bindInput();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _initThree() {
    const THREE = window.THREE;

    // Initialize rendering system using new modules
    const { renderer, scene, camera } = createRenderer(this.canvas, THREE);
    setupScene(scene, renderer, THREE);
    setupCamera(camera, THREE);

    // Preload common materials to avoid creation stalls during gameplay
    preloadCommonMaterials(THREE);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.target = new THREE.Vector3(0, 0, 0);
    this.camRadius = 24;
    this.camAzimuth = Math.PI / 4;
    this.camPolar = Math.PI / 3.1;
    this._updateCamera();

    this.tileGroup = new THREE.Group();
    this.territoryBorderGroup = new THREE.Group();
    this.transportGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.decorationGroup = new THREE.Group();
    this.effectGroup = new THREE.Group();
    this.scene.add(this.tileGroup);
    this.scene.add(this.territoryBorderGroup);
    this.scene.add(this.transportGroup);
    this.scene.add(this.highlightGroup);
    this.scene.add(this.decorationGroup);
    this.scene.add(this.effectGroup);

    this.hexGeometry = new THREE.CylinderGeometry(HEX_SIZE - HEX_GAP, HEX_SIZE - HEX_GAP, HEX_HEIGHT, 6);
    this.hexGeometry.rotateY(Math.PI / 6);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "map-label-layer";
    this.canvas.parentElement?.append(this.labelLayer);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  setMap(map) {
    this.map = map;
    this.visibility = null;
    this.hoveredTileId = null;
    this.target.set(0, 0, 0);
    this._setZoomBoundsForMap(map);
    this.camRadius = this.maxCamRadius;
    this._updateCamera();
    this._clearGroups();

    const THREE = window.THREE;
    for (const tile of map.tiles) {
      const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
      const isWaterTile = isWaterLike(tile);
      const material = getTileMaterial(tile, THREE);
      const mesh = new THREE.Mesh(this.hexGeometry, material);
      const heightScale = isWaterTile ? 0.34 : 1;
      mesh.scale.y = heightScale;
      mesh.position.set(x, isWaterTile ? -0.1 : HEX_HEIGHT / 2, z);
      mesh.userData.tileId = tile.id;
      this.tileGroup.add(mesh);
      this.tileMeshes.set(tile.id, mesh);
    }
  }

  renderState(map, nations, selectedTileId = null, militaryHighlights = null, visibility = null) {
    this.map = map;
    this.nations = nations || {};
    this.selectedTileId = selectedTileId;
    this.militaryHighlights = normalizeMilitaryHighlights(militaryHighlights);
    this.visibility = visibility?.enabled ? visibility : null;
    this._queueStateDrivenPresentation(map);
    for (const tile of map.tiles) {
      this._updateTileMesh(tile);
      this._updateDecoration(tile);
    }
    this.lastRenderTileState = this._snapshotTilePresentationState(map.tiles);
    this.lastRenderVisibleTileIds = this.visibility?.enabled ? new Set(this.visibility.visibleTileIds || []) : null;
    this._renderTerritoryBorders();
    this._renderTransportOverlay();
    this._renderNationLabels();
    this._renderMilitaryHighlights();
  }

  focusTile(tileIdValue) {
    if (!this.map) return;
    const tile = this.map.tiles.find((item) => item.id === tileIdValue);
    if (!tile || !this._isTileVisible(tile.id)) return;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    this.target.set(x, 0, z);
    this._updateCamera();
  }

  playBattle(report) {
    this.playMilitaryAction({ ...report, action: "attack", nationId: report.attackerId });
  }

  playMilitaryAction(action) {
    this.animationManager.play(action);
  }

  showBattleDelta(report) {
    if (!this.labelLayer || !this.map) return;
    const { losses, fromTileId, targetTileId } = report;
    if (fromTileId) {
      const text = losses.attacker > 0 ? `-${losses.attacker}` : "✦";
      this._spawnDeltaLabel(fromTileId, text, losses.attacker > 0 ? "#ff6b6b" : "#7ecfff", 80);
    }
    if (targetTileId) {
      const text = losses.defender > 0 ? `-${losses.defender}` : "✦";
      this._spawnDeltaLabel(targetTileId, text, losses.defender > 0 ? "#ff6b6b" : "#7ecfff", 0);
    }
  }

  showTileResourceDeltas(tileId, items) {
    items.forEach(({ text, color }, index) => {
      this._spawnResourceDelta(tileId, text, color, index);
    });
  }

  _spawnResourceDelta(tileId, text, color, stackIndex = 0) {
    const tile = this.map?.tiles.find((t) => t.id === tileId);
    if (!tile || !this.labelLayer || !this.camera) return;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const vector = new THREE.Vector3(x, 1.82, z).project(this.camera);
    if (vector.z >= 1) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = (vector.x * 0.5 + 0.5) * rect.width;
    const screenY = (-vector.y * 0.5 + 0.5) * rect.height;
    const label = document.createElement("div");
    label.className = "resource-delta-tile";
    label.textContent = text;
    label.style.left = `${screenX}px`;
    label.style.top = `${screenY - stackIndex * 22}px`;
    label.style.color = color;
    this.labelLayer.append(label);
    label.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: "translate(-50%, -320%) scale(1.05)", opacity: 0 },
      ],
      { duration: 1500, easing: "ease-out", fill: "forwards" }
    ).onfinish = () => label.remove();
  }

  _spawnDeltaLabel(tileId, text, color, delayMs = 0) {
    const tile = this.map?.tiles.find((t) => t.id === tileId);
    if (!tile || !this.labelLayer || !this.camera) return;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const vector = new THREE.Vector3(x, 1.82, z).project(this.camera);
    if (vector.z >= 1) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = (vector.x * 0.5 + 0.5) * rect.width;
    const screenY = (-vector.y * 0.5 + 0.5) * rect.height;
    const label = document.createElement("div");
    label.className = "battle-delta";
    label.textContent = text;
    label.style.cssText = `left:${screenX}px;top:${screenY}px;color:${color}`;
    this.labelLayer.append(label);
    const anim = () => {
      label.animate(
        [
          { transform: "translate(-50%, -50%) scale(1.1)", opacity: 1 },
          { transform: "translate(-50%, -220%) scale(1.4)", opacity: 0 },
        ],
        { duration: 1700, easing: "ease-out", fill: "forwards" }
      ).onfinish = () => label.remove();
    };
    if (delayMs > 0) window.setTimeout(anim, delayMs);
    else anim();
  }

  _updateTileMesh(tile) {
    const THREE = window.THREE;
    const mesh = this.tileMeshes.get(tile.id);
    if (!mesh) return;
    const highlight = this._highlightKind(tile.id);
    const isWaterTile = isWaterLike(tile);
    mesh.scale.y = isWaterTile ? 0.34 : 1;
    const baseY = isWaterTile ? -0.1 : HEX_HEIGHT / 2;
    if (!this._isTileVisible(tile.id)) {
      mesh.material.color.setHex(FOG_COLOR);
      mesh.material.emissive.setHex(FOG_EMISSIVE);
      mesh.material.roughness = 1;
      mesh.material.metalness = 0;
      mesh.material.transparent = false;
      mesh.material.opacity = 1;
      mesh.material.needsUpdate = true;
      mesh.position.y = baseY;
      return;
    }

    const ownerColor = tile.ownerId && this.nations[tile.ownerId]
      ? new THREE.Color(this.nations[tile.ownerId].color)
      : null;
    const base = ownerColor ? ownerColor.clone() : new THREE.Color(tileSurfaceColor(tile, this.nations));
    if (tile.effects?.floodedTurns > 0 && !ownerColor) base.lerp(new THREE.Color(0x3d9dcc), 0.5);
    mesh.material.color.copy(base);
    mesh.material.roughness = isWaterTile ? 0.45 : 0.86;
    mesh.material.metalness = isWaterTile ? 0.12 : 0.04;
    mesh.material.transparent = false;
    mesh.material.opacity = 1;
    const emissive = (ownerColor ? ownerColor.clone() : new THREE.Color(terrainColor(tile)))
      .multiplyScalar(ownerColor ? (isWaterTile ? 0.12 : 0.055) : (isWaterTile ? 0.14 : 0.05));
    if (highlight === "move") emissive.add(new THREE.Color(0x39d9a3).multiplyScalar(0.42));
    if (highlight === "attack") emissive.add(new THREE.Color(0xff7142).multiplyScalar(0.5));
    if (highlight === "source") emissive.add(new THREE.Color(0xffdf7a).multiplyScalar(0.58));
    if (tile.id === this.selectedTileId) emissive.add(new THREE.Color(0xd8bd6a).multiplyScalar(0.38));
    if (tile.id === this.hoveredTileId) emissive.add(new THREE.Color(0xffffff).multiplyScalar(0.12));
    if (tile.isCapital) emissive.add(new THREE.Color(0xffd700).multiplyScalar(0.28));
    mesh.material.emissive.copy(emissive);
    mesh.material.needsUpdate = true;

    const selectedLift = highlight ? 0.09 : tile.id === this.selectedTileId ? 0.08 : tile.id === this.hoveredTileId ? 0.05 : 0;
    mesh.position.y = baseY + selectedLift;
  }

  _isTileVisible(tileIdValue) {
    return !this.visibility?.enabled || this.visibility.visibleTileIds?.has(tileIdValue);
  }

  _visibilitySignature() {
    return this.visibility?.enabled ? this.visibility.signature || "" : "all";
  }

  _highlightKind(tileIdValue) {
    if (this.militaryHighlights.sourceTileId === tileIdValue) return "source";
    if (this.militaryHighlights.attackTargetIds.has(tileIdValue)) return "attack";
    if (this.militaryHighlights.moveTargetIds.has(tileIdValue)) return "move";
    return null;
  }

  _renderMilitaryHighlights() {
    this._clearHighlightGroup();
    if (!this.map) return;
    const source = this.militaryHighlights.sourceTileId && this._isTileVisible(this.militaryHighlights.sourceTileId)
      ? this.map.tiles.find((tile) => tile.id === this.militaryHighlights.sourceTileId)
      : null;
    if (source) this._addHighlightRing(source, 0xffd166, { radius: 0.96, tube: 0.046, opacity: 0.96, yOffset: 0.12 });
    for (const tileIdValue of this.militaryHighlights.moveTargetIds) {
      if (!this._isTileVisible(tileIdValue)) continue;
      const tile = this.map.tiles.find((item) => item.id === tileIdValue);
      if (tile) this._addHighlightRing(tile, 0x3ce0aa, { radius: 0.86, tube: 0.04, opacity: 0.78, yOffset: 0.1 });
    }
    for (const tileIdValue of this.militaryHighlights.attackTargetIds) {
      if (!this._isTileVisible(tileIdValue)) continue;
      const tile = this.map.tiles.find((item) => item.id === tileIdValue);
      if (tile) this._addHighlightRing(tile, 0xff6a38, { radius: 0.88, tube: 0.052, opacity: 0.88, yOffset: 0.13 });
    }
  }

  _renderTerritoryBorders() {
    this.territoryBorderSignature = "disabled";
    if (this.territoryBorderGroup?.children.length) this._clearObjectGroup(this.territoryBorderGroup);
  }

  _renderTransportOverlay() {
    if (!this.map) return;
    const activeNations = Object.values(this.nations).filter((nation) => nation?.active !== false && (nation.tech?.infrastructure || 0) > 0);
    const signature = [
      this._visibilitySignature(),
      activeNations.map((nation) => `${nation.id}:${nation.tech?.infrastructure || 0}:${nation.capitalTileId || ""}:${nation.color}`).sort().join("|"),
      this.map.tiles.filter((tile) => tile.ownerId && this._isTileVisible(tile.id)).map((tile) => `${tile.id}:${tile.ownerId}`).sort().join("|"),
    ].join("::");
    if (signature === this.transportSignature) return;
    this.transportSignature = signature;
    this._clearObjectGroup(this.transportGroup);

    const segmentsByNation = this._transportSegmentsByNation();
    for (const nation of activeNations) {
      const tier = Math.max(0, Math.min(4, Math.floor(Number(nation.tech?.infrastructure) || 0)));
      const segments = segmentsByNation.get(nation.id) || [];
      if (!segments.length) {
        if (tier >= 4) this._addAirportOverlay(nation);
        continue;
      }

      const roadSegments = [];
      const railSegments = [];
      for (const segment of segments) {
        const rail = tier >= 2 && hash2d(segment.tile.q + segment.neighbor.q * 3, segment.tile.r + segment.neighbor.r * 5, (this.map?.seed || 1) + 5501) > 0.5;
        if (rail) railSegments.push(segment);
        else roadSegments.push(segment);
      }

      for (const segment of roadSegments) this._addRoadSegment(segment, nation, tier);
      for (const segment of railSegments) this._addRailSegment(segment, nation);
      if (!this.animationManager.reducedMotion) {
        this._addTrafficOverlays(roadSegments, nation, tier);
        this._addTrainOverlay(railSegments, nation);
      }
      if (tier >= 4) this._addAirportOverlay(nation);
    }
  }

  _transportSegmentsByNation() {
    const index = buildTileIndex(this.map.tiles);
    const segmentsByNation = new Map();
    for (const tile of this.map.tiles) {
      if (!tile.ownerId || !isLand(tile) || !this._isTileVisible(tile.id)) continue;
      const nation = this.nations[tile.ownerId];
      if (!nation || (nation.tech?.infrastructure || 0) <= 0) continue;
      const corners = hexCorners(tile);
      for (const direction of HEX_DIRECTIONS) {
        const neighbor = index.get(tileId(tile.q + direction.q, tile.r + direction.r));
        if (!neighbor || neighbor.ownerId !== tile.ownerId || !isLand(neighbor) || tile.id > neighbor.id || !this._isTileVisible(neighbor.id)) continue;
        const [fromIndex, toIndex] = edgeCornersForDirection(direction);
        const from = corners[fromIndex];
        const to = corners[toIndex];
        const segment = { tile, neighbor, from, to };
        if (!segmentsByNation.has(tile.ownerId)) segmentsByNation.set(tile.ownerId, []);
        segmentsByNation.get(tile.ownerId).push(segment);
      }
    }
    for (const segments of segmentsByNation.values()) {
      segments.sort((a, b) => `${a.tile.id}:${a.neighbor.id}`.localeCompare(`${b.tile.id}:${b.neighbor.id}`));
    }
    return segmentsByNation;
  }

  _addRoadSegment(segment, nation, tier) {
    const THREE = window.THREE;
    const dx = segment.to.x - segment.from.x;
    const dz = segment.to.z - segment.from.z;
    const length = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const midX = (segment.from.x + segment.to.x) / 2;
    const midZ = (segment.from.z + segment.to.z) / 2;
    const highway = tier >= 3;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(length + 0.02, 0.012, highway ? 0.105 : 0.064),
      new THREE.MeshBasicMaterial({ color: highway ? 0x2f3740 : 0x5c5147, transparent: true, opacity: highway ? 0.78 : 0.68, depthWrite: false })
    );
    base.position.set(midX, HEX_HEIGHT + 0.035, midZ);
    base.rotation.y = -angle;
    base.renderOrder = 2;
    this.transportGroup.add(base);
    if (highway) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(length * 0.72, 0.014, 0.014),
        new THREE.MeshBasicMaterial({ color: 0xf4e7a0, transparent: true, opacity: 0.72, depthWrite: false })
      );
      stripe.position.set(midX, HEX_HEIGHT + 0.045, midZ);
      stripe.rotation.y = -angle;
      stripe.renderOrder = 3;
      this.transportGroup.add(stripe);
    }
  }

  _addRailSegment(segment, nation) {
    const THREE = window.THREE;
    const dx = segment.to.x - segment.from.x;
    const dz = segment.to.z - segment.from.z;
    const length = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const midX = (segment.from.x + segment.to.x) / 2;
    const midZ = (segment.from.z + segment.to.z) / 2;
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(length + 0.03, 0.012, 0.088),
      new THREE.MeshBasicMaterial({ color: 0x4a423c, transparent: true, opacity: 0.62, depthWrite: false })
    );
    bed.position.set(midX, HEX_HEIGHT + 0.035, midZ);
    bed.rotation.y = -angle;
    bed.renderOrder = 2;
    this.transportGroup.add(bed);
    for (const offset of [-0.026, 0.026]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(length + 0.01, 0.016, 0.012),
        new THREE.MeshBasicMaterial({ color: 0xc9c3b8, transparent: true, opacity: 0.82, depthWrite: false })
      );
      rail.position.set(midX + Math.sin(angle) * offset, HEX_HEIGHT + 0.048, midZ - Math.cos(angle) * offset);
      rail.rotation.y = -angle;
      rail.renderOrder = 3;
      this.transportGroup.add(rail);
    }
  }

  _addTrafficOverlays(segments, nation, tier) {
    const count = tier >= 3 ? 3 : 1;
    for (let i = 0; i < Math.min(count, segments.length); i += 1) {
      const segment = segments[(i * 7) % segments.length];
      this._addVehicleOnSegment(segment, nation, i % 2 === 0 ? "truck" : "car", 9 + i * 2.3, i * 1.7);
    }
  }

  _addTrainOverlay(segments, nation) {
    if (!segments.length) return;
    const segment = segments[Math.floor(segments.length / 2)];
    this._addVehicleOnSegment(segment, nation, "train", 13.5, 2.2);
  }

  _addVehicleOnSegment(segment, nation, kind, duration, phaseOffset = 0) {
    const THREE = window.THREE;
    const color = kind === "car" ? 0xd9e6f2 : kind === "train" ? 0xc94e4e : 0xd8aa54;
    const vehicle = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(kind === "train" ? 0.22 : kind === "truck" ? 0.15 : 0.11, kind === "train" ? 0.07 : 0.055, kind === "train" ? 0.075 : 0.06),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
    );
    vehicle.add(body);
    if (kind === "train") {
      const car = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.06, 0.07),
        new THREE.MeshBasicMaterial({ color: 0x36424c, transparent: true, opacity: 0.88, depthWrite: false })
      );
      car.position.x = -0.2;
      vehicle.add(car);
    }
    vehicle.renderOrder = 4;
    this.transportGroup.add(vehicle);
    const from = new THREE.Vector3(segment.from.x, HEX_HEIGHT + 0.095, segment.from.z);
    const to = new THREE.Vector3(segment.to.x, HEX_HEIGHT + 0.095, segment.to.z);
    this._registerAnimation(this.transportGroup, vehicle, kind === "train" ? "transportTrain" : "transportVehicle", {
      from,
      to,
      phase: this._phaseForTile(segment.tile, kind === "train" ? 202 : 200 + phaseOffset),
      duration,
      offset: phaseOffset * 0.07,
    });
  }

  _addAirportOverlay(nation) {
    const capital = this.map?.tiles.find((tile) => tile.id === nation.capitalTileId || (tile.ownerId === nation.id && tile.isCapital));
    if (!capital || !this._isTileVisible(capital.id)) return;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(capital.q, capital.r, HEX_SIZE);
    const group = new THREE.Group();
    group.position.set(x, HEX_HEIGHT + 0.075, z);
    const runway = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.014, 0.105),
      new THREE.MeshBasicMaterial({ color: 0xdce5ec, transparent: true, opacity: 0.62, depthWrite: false })
    );
    runway.rotation.y = Math.PI / 6;
    group.add(runway);
    const terminal = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.06, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x82a9c8, transparent: true, opacity: 0.72, depthWrite: false })
    );
    terminal.position.set(-0.28, 0.05, -0.16);
    group.add(terminal);
    this.transportGroup.add(group);
    if (!this.animationManager.reducedMotion) this._addAirportPlane(capital, nation);
  }

  _addAirportPlane(capital, nation) {
    const THREE = window.THREE;
    const { x, z } = axialToWorld(capital.q, capital.r, HEX_SIZE);
    const plane = this._createUnitEffectMesh("air", nation.id);
    plane.scale.setScalar(0.42);
    plane.renderOrder = 5;
    this.transportGroup.add(plane);
    this._registerAnimation(this.transportGroup, plane, "airportPlane", {
      from: new THREE.Vector3(x - 1.25, HEX_HEIGHT + 0.82, z - 0.9),
      to: new THREE.Vector3(x + 1.3, HEX_HEIGHT + 0.98, z + 0.86),
      phase: this._phaseForTile(capital, 240),
      duration: 15,
    });
  }

  _renderNationLabels() {
    if (!this.map || !this.labelLayer) return;
    const activeNations = Object.values(this.nations).filter((nation) => nation?.active !== false);
    const signature = activeNations
      .map((nation) => `${nation.id}:${nation.name}:${nation.color}:${nation.capitalTileId}:${nation.territory?.length || 0}`)
      .sort()
      .join("|");
    if (signature !== this.nationLabelSignature) {
      this.nationLabelSignature = signature;
      const activeIds = new Set(activeNations.map((nation) => nation.id));
      for (const [id, label] of this.nationLabels.entries()) {
        if (activeIds.has(id)) continue;
        label.remove();
        this.nationLabels.delete(id);
      }
      for (const nation of activeNations) {
        if (this.nationLabels.has(nation.id)) continue;
        const label = document.createElement("div");
        label.className = "nation-label";
        label.style.setProperty("--nation-color", nation.color);
        label.textContent = nation.name;
        this.labelLayer.append(label);
        this.nationLabels.set(nation.id, label);
      }
      for (const nation of activeNations) {
        const label = this.nationLabels.get(nation.id);
        if (!label) continue;
        label.textContent = nation.name;
        label.style.setProperty("--nation-color", nation.color);
      }
    }
    this._updateNationLabels();
  }

  _labelAnchorTile(nation) {
    if (!nation || !this.map) return null;
    const owned = this.map.tiles.filter((tile) => tile.ownerId === nation.id);
    if (!owned.length) return null;
    const visibleOwned = owned.filter((tile) => this._isTileVisible(tile.id));
    if (!visibleOwned.length) return null;
    const capital = visibleOwned.find((tile) => tile.id === nation.capitalTileId || tile.isCapital);
    if (capital) return capital;
    const center = visibleOwned.reduce((sum, tile) => ({ q: sum.q + tile.q, r: sum.r + tile.r }), { q: 0, r: 0 });
    center.q /= visibleOwned.length;
    center.r /= visibleOwned.length;
    return visibleOwned.reduce((best, tile) => {
      const bestDistance = Math.hypot(best.q - center.q, best.r - center.r);
      const tileDistance = Math.hypot(tile.q - center.q, tile.r - center.r);
      return tileDistance < bestDistance ? tile : best;
    }, visibleOwned[0]);
  }

  _nationLabelVisibility() {
    if (this.camRadius <= LABEL_HIDE_RADIUS) return 0;
    if (this.camRadius >= LABEL_FULL_RADIUS) return 1;
    return (this.camRadius - LABEL_HIDE_RADIUS) / (LABEL_FULL_RADIUS - LABEL_HIDE_RADIUS);
  }

  _updateNationLabels() {
    if (!this.labelLayer || !this.map || !this.camera) return;
    const THREE = window.THREE;
    const rect = this.canvas.getBoundingClientRect();
    const opacity = this._nationLabelVisibility();
    for (const [nationId, label] of this.nationLabels.entries()) {
      const nation = this.nations[nationId];
      const anchor = this._labelAnchorTile(nation);
      if (!anchor || opacity <= 0.02) {
        label.hidden = true;
        continue;
      }
      const { x, z } = axialToWorld(anchor.q, anchor.r, HEX_SIZE);
      const scale = anchor.isCapital ? capitalScale(anchor, this.nations, this.map.tiles) : 1;
      const vector = new THREE.Vector3(x, 1.45 + scale * 0.24, z).project(this.camera);
      const visible = vector.z < 1 && vector.x > -1.16 && vector.x < 1.16 && vector.y > -1.18 && vector.y < 1.18;
      label.hidden = !visible;
      if (!visible) continue;
      const screenX = (vector.x * 0.5 + 0.5) * rect.width;
      const screenY = (-vector.y * 0.5 + 0.5) * rect.height;
      label.style.left = `${screenX}px`;
      label.style.top = `${screenY}px`;
      label.style.opacity = String(opacity);
    }
  }

  _addHighlightRing(tile, color, { radius, tube, opacity, yOffset }) {
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 8, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 6;
    ring.position.set(x, (isWaterLike(tile) ? 0.08 : HEX_HEIGHT + 0.02) + yOffset, z);
    this.highlightGroup.add(ring);
  }

  _clearHighlightGroup() {
    if (!this.highlightGroup) return;
    this._clearObjectGroup(this.highlightGroup);
  }

  _clearObjectGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children[group.children.length - 1];
      group.remove(child);
      child.traverse?.((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((material) => material.dispose());
        else if (obj.material) obj.material.dispose();
      });
    }
  }

  _updateDecoration(tile) {
    if (!this._isTileVisible(tile.id)) {
      const existing = this.decorations.get(tile.id);
      if (existing) {
        this._clearTileUnitVisuals(tile.id);
        this.decorationGroup.remove(existing);
        this.decorations.delete(tile.id);
        existing.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
      this.decorationSignatures.set(tile.id, `fog:${this._visibilitySignature()}`);
      return;
    }
    const visualTier = visualTierForTile(tile, this.nations);
    const branch = strongestBranchForTile(tile, this.nations);
    const signature = JSON.stringify({
      type: tile.type,
      ownerId: tile.ownerId,
      workers: tile.workers,
      unit: tile.unit?.strength || 0,
      unitBranch: tile.unit?.branch || "infantry",
      unitBranches: tile.unit?.branches || null,
      visualTier,
      branch: branch.branch,
      branchLevel: branch.level,
      capital: tile.isCapital,
      disabled: tile.effects?.disabledTurns || 0,
      flooded: tile.effects?.floodedTurns || 0,
    });
    if (this.decorationSignatures.get(tile.id) === signature) return;
    this.decorationSignatures.set(tile.id, signature);
    const existing = this.decorations.get(tile.id);
    if (existing) {
      this._clearTileUnitVisuals(tile.id);
      this.decorationGroup.remove(existing);
      this.decorations.delete(tile.id);
      existing.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    const group = this._createDecoration(tile);
    if (group) {
      this.decorations.set(tile.id, group);
      this.decorationGroup.add(group);
    }
  }

  _createDecoration(tile) {
    const hasUnit = tile.unit?.strength > 0;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);

    if (tile.type === TILE_TYPES.MOUNTAIN) {
      const group = new THREE.Group();
      group.position.set(x, HEX_HEIGHT + 0.02, z);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.96, metalness: 0 });
      const snowMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.88 });
      const peak = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.78, 7), rockMat);
      peak.position.set(-0.08, 0.4, 0.04);
      group.add(peak);
      const peak2 = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.54, 6), rockMat);
      peak2.position.set(0.36, 0.29, -0.23);
      group.add(peak2);
      const snow = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.25, 7), snowMat);
      snow.position.set(-0.08, 0.78, 0.04);
      group.add(snow);
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xf2efe5, transparent: true, opacity: 0.44, depthWrite: false })
      );
      cloud.position.set(0.2, 0.8, 0.32);
      cloud.scale.set(1.45, 0.45, 0.65);
      group.add(cloud);
      this._registerAnimation(group, cloud, "cloud", { phase: this._phaseForTile(tile, 9), duration: 14 });
      return group;
    }

    const group = new THREE.Group();
    group.position.set(x, isWaterLike(tile) ? 0.08 : HEX_HEIGHT + 0.02, z);
    const ownerColor = colorFromHex(this.nations[tile.ownerId]?.color || "#e2dcc8");

    if (tile.isCapital) {
      this._addCapitalMarker(group, tile, ownerColor);
    }

    if (isWaterLike(tile)) {
      this._addWave(group, { x: -0.24, z: -0.18, radius: 0.28, phase: this._phaseForTile(tile, 2) });
      this._addWave(group, { x: 0.26, z: 0.2, radius: 0.2, phase: this._phaseForTile(tile, 3) });
      if (hash2d(tile.q * 7 + 3, tile.r * 5 - 9, this.map?.seed || 1) > 0.68) {
        this._addWaterNature(group, tile);
      }
      if (tile.type === TILE_TYPES.FISHERY) {
        // Try port.glb for the dock structure; fishing boat is always added.
        if (!this._tryBuildingModel(group, "port", { scale: 1 })) {
          const dock = new THREE.Mesh(
            new THREE.BoxGeometry(0.62, 0.055, 0.16),
            new THREE.MeshStandardMaterial({ color: 0x8b6240, roughness: 0.72 })
          );
          dock.position.set(-0.08, 0.08, 0.1);
          dock.rotation.y = -0.35;
          group.add(dock);
        }
        this._addShipUnit(group, { x: 0.28, y: 0.16, z: -0.16, scale: 0.62, color: 0xc58b57, phase: this._phaseForTile(tile, 80) });
      }
      this._addUnitFigure(group, tile, ownerColor, { x: 0, y: 0.2, z: 0, scale: 1.08 });
      return group.children.length ? group : null;
    }

    // Empty owned tiles still get props and troops, but the tile surface now carries ownership.
    if (tile.type === TILE_TYPES.EMPTY) {
      this._addLandNature(group, tile);
      if (tile.ownerId && this.nations[tile.ownerId]) {
        this._addFlag(group, { x: -0.24, y: 0.04, z: -0.18, color: ownerColor, phase: this._phaseForTile(tile, 4), scale: 0.72 });
        this._addCrate(group, 0.18, 0.1, 0.22, 0xa8784a);
      }
      this._addUnitFigure(group, tile, ownerColor, { x: 0, y: 0.22, z: 0, scale: 1.08 });
      return group.children.length ? group : null;
    }

    const visualTier = visualTierForTile(tile, this.nations);
    const branch = strongestBranchForTile(tile, this.nations);
    const scale = 1 + visualTier * 0.055;

    if (tile.type === TILE_TYPES.FARM && !this._tryBuildingModel(group, "farm", { scale, ownerColor })) {
      const plotCount = 4 + Math.min(2, Math.floor(visualTier / 2));
      for (let i = 0; i < plotCount; i += 1) {
        const plot = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.035, 0.78 + visualTier * 0.045),
          new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0x7fc66c : 0x5fb15b })
        );
        plot.position.set((i - (plotCount - 1) / 2) * 0.18, 0.03, 0);
        group.add(plot);
        this._registerAnimation(group, plot, "cropSway", { phase: this._phaseForTile(tile, 10 + i), duration: 8.5 + i * 0.7, amplitude: 0.45 });
      }
      const farmerCount = Math.min(3, Math.max(1, Math.ceil((tile.workers || 0) / 3)));
      const farmerPositions = [
        [-0.42, 0.06, 0.28],
        [0.08, 0.06, -0.34],
        [0.44, 0.06, 0.16],
      ];
      for (let i = 0; i < farmerCount; i += 1) {
        const [fx, fy, fz] = farmerPositions[i];
        const farmer = this._addLowPolyPerson(group, {
          x: fx,
          y: fy,
          z: fz,
          scale: 0.95,
          shirt: i % 2 === 0 ? 0xf0cc70 : 0x8fcf72,
          tool: i === 1 ? "shovel" : null,
          kind: i === 1 ? "toolCarry" : "harvest",
          phase: this._phaseForTile(tile, 20 + i),
          duration: 7.5 + i * 1.2,
        });
        farmer.rotation.y = i === 1 ? -0.8 : 0.55 - i * 0.42;
      }
      const basket = this._addCrate(group, -0.12, 0.1, 0.36, 0xc79252);
      basket.scale.set(1.2, 0.8, 0.8);
      this._registerAnimation(group, basket, "toolCarry", { phase: this._phaseForTile(tile, 24), duration: 10, amplitude: 0.22 });
      if (visualTier >= 2) {
        const silo = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.1, 0.34 + visualTier * 0.04, 12),
          new THREE.MeshStandardMaterial({ color: 0xded5a8, roughness: 0.62 })
        );
        silo.position.set(0.38, 0.2 + visualTier * 0.02, 0.22);
        group.add(silo);
      }
      if (visualTier >= 4) {
        const greenhouse = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.2, 0.3),
          new THREE.MeshStandardMaterial({ color: 0xb7e4d8, transparent: true, opacity: 0.76 })
        );
        greenhouse.position.set(-0.44, 0.17, -0.24);
        group.add(greenhouse);
      }
    }

    if ((tile.type === TILE_TYPES.MINE || tile.type === TILE_TYPES.MOUNTAIN_MINE) && !this._tryBuildingModel(group, "mine", { scale })) {
      const rock = new THREE.Mesh(
        new THREE.ConeGeometry(0.42 * scale, 0.52 + visualTier * 0.08, 5),
        new THREE.MeshStandardMaterial({ color: 0x4f4037, roughness: 0.9 })
      );
      rock.position.set(-0.06, 0.27 + visualTier * 0.04, 0.02);
      group.add(rock);
      for (const zOffset of [-0.24, -0.15]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.74, 0.018, 0.018),
          new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.78 })
        );
        rail.position.set(0.14, 0.055, zOffset);
        group.add(rail);
      }
      const cart = new THREE.Mesh(
        new THREE.BoxGeometry(0.34 + visualTier * 0.025, 0.17, 0.25),
        new THREE.MeshStandardMaterial({ color: 0xb98852 })
      );
      cart.position.set(0.38, 0.14, -0.195);
      group.add(cart);
      this._registerAnimation(group, cart, "mineCart", { phase: this._phaseForTile(tile, 30), duration: 9.5 });
      const minerPositions = [
        [-0.44, 0.06, 0.22],
        [0.22, 0.06, 0.34],
        [-0.12, 0.06, -0.38],
      ];
      const minerCount = Math.min(3, Math.max(1, Math.ceil((tile.workers || 0) / 3)));
      for (let i = 0; i < minerCount; i += 1) {
        const [mx, my, mz] = minerPositions[i];
        const miner = this._addLowPolyPerson(group, {
          x: mx,
          y: my,
          z: mz,
          scale: 0.92,
          shirt: 0xc58b57,
          accent: 0x3f332b,
          tool: i === 2 ? "shovel" : "pickaxe",
          kind: i === 2 ? "toolCarry" : "pickaxe",
          phase: this._phaseForTile(tile, 31 + i),
          duration: 6.8 + i * 1.1,
        });
        miner.rotation.y = i === 0 ? -0.45 : i === 1 ? 2.4 : 0.15;
      }
      if (visualTier >= 2) {
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.58, 0.08),
          new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.8 })
        );
        beam.position.set(-0.36, 0.34, 0.18);
        group.add(beam);
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.62, 0.06, 0.06),
          new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.8 })
        );
        arm.position.set(-0.18, 0.62, 0.18);
        arm.rotation.z = -0.35;
        group.add(arm);
        this._registerAnimation(group, arm, "crane", { phase: this._phaseForTile(tile, 35), duration: 12, amplitude: 0.45 });
      }
      if (visualTier >= 4) {
        const drill = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.07, 0.42, 10),
          new THREE.MeshStandardMaterial({ color: 0xc8c2b8, metalness: 0.32, roughness: 0.45 })
        );
        drill.position.set(0.18, 0.34, 0.34);
        drill.rotation.z = 0.35;
        group.add(drill);
        this._registerAnimation(group, drill, "drill", { phase: this._phaseForTile(tile, 36), duration: 6.5 });
      }
    }

    if ((tile.type === TILE_TYPES.SCHOOL || tile.type === TILE_TYPES.UNIVERSITY) && !this._tryBuildingModel(group, "university", { scale })) {
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(0.66 + visualTier * 0.05, 0.38 + visualTier * 0.06, 0.46 + visualTier * 0.025),
        new THREE.MeshStandardMaterial({ color: 0x7aa2d8 })
      );
      building.position.set(0, 0.22 + visualTier * 0.03, 0);
      group.add(building);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 0.2, 4),
        new THREE.MeshStandardMaterial({ color: 0xe4d6a5 })
      );
      roof.position.set(0, 0.52 + visualTier * 0.06, 0);
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
      if (visualTier >= 2) {
        for (const xOffset of [-0.38, 0.38]) {
          const wing = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.24 + visualTier * 0.035, 0.28),
            new THREE.MeshStandardMaterial({ color: 0x557fb8 })
          );
          wing.position.set(xOffset, 0.2 + visualTier * 0.025, -0.02);
          group.add(wing);
        }
      }
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.16, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x2f5d58, roughness: 0.72 })
      );
      board.position.set(0, 0.45, 0.26);
      group.add(board);
      const scholarPositions = [
        [-0.36, 0.05, -0.34],
        [0.32, 0.05, -0.32],
        [0.0, 0.05, 0.38],
      ];
      const scholarCount = Math.min(3, Math.max(1, Math.ceil((tile.workers || 0) / 3)));
      for (let i = 0; i < scholarCount; i += 1) {
        const [sx, sy, sz] = scholarPositions[i];
        const desk = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.045, 0.11),
          new THREE.MeshStandardMaterial({ color: 0x9c6f45, roughness: 0.74 })
        );
        desk.position.set(sx, 0.1, sz + 0.045);
        group.add(desk);
        const scholar = this._addLowPolyPerson(group, {
          x: sx,
          y: sy,
          z: sz,
          scale: 0.86,
          shirt: i % 2 === 0 ? 0xd9ecff : 0xe7d6ff,
          tool: "book",
          kind: "study",
          phase: this._phaseForTile(tile, 42 + i),
          duration: 8.5 + i * 1.5,
        });
        scholar.rotation.y = i === 2 ? Math.PI : 0;
      }
      if (visualTier >= 4) {
        const observatory = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0xd9ecff, metalness: 0.12 })
        );
        observatory.position.set(0.02, 0.82, 0.04);
        group.add(observatory);
        const telescope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.035, 0.24, 8),
          new THREE.MeshStandardMaterial({ color: 0xd6d3ca, metalness: 0.18, roughness: 0.42 })
        );
        telescope.position.set(0.12, 0.9, 0.08);
        telescope.rotation.z = Math.PI / 2.7;
        group.add(telescope);
        this._registerAnimation(group, telescope, "telescope", { phase: this._phaseForTile(tile, 47), duration: 14 });
      }
    }

    if ([TILE_TYPES.ROAD, TILE_TYPES.RAILROAD, TILE_TYPES.HIGHWAY, TILE_TYPES.AIRPORT].includes(tile.type)) {
      // Choose the registry key for the tile's infrastructure type.
      const _infraKey = tile.type === TILE_TYPES.RAILROAD ? "rail"
        : tile.type === TILE_TYPES.AIRPORT ? "airport"
        : "road"; // covers ROAD and HIGHWAY

      if (!this._tryBuildingModel(group, _infraKey, { scale })) {
        // Procedural fallback: flat path + optional rail tracks.
        const pathMat = new THREE.MeshStandardMaterial({
          color: tile.type === TILE_TYPES.HIGHWAY ? 0x303942 : 0x5d4e42,
          roughness: 0.82,
        });
        const path = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.035, 0.2), pathMat);
        path.position.set(0, 0.055, 0);
        path.rotation.y = Math.PI / 6;
        group.add(path);
        if (tile.type === TILE_TYPES.RAILROAD || tile.type === TILE_TYPES.AIRPORT) {
          for (const zOffset of [-0.06, 0.06]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.02, 0.018), new THREE.MeshStandardMaterial({ color: 0x2a2826 }));
            rail.position.set(0, 0.088, zOffset);
            rail.rotation.y = Math.PI / 6;
            group.add(rail);
          }
        }
      }
      // Parked plane is always shown for airport tiles, regardless of GLB.
      if (tile.type === TILE_TYPES.AIRPORT) {
        this._addPlaneUnit(group, { x: 0.24, y: 0.22, z: 0.22, scale: 0.62, color: 0xc6d1dc, phase: this._phaseForTile(tile, 84) });
      }
    }

    if (tile.type === TILE_TYPES.FACTORY && !this._tryBuildingModel(group, "factory", { scale })) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.8 + visualTier * 0.055, 0.4 + visualTier * 0.06, 0.52 + visualTier * 0.035),
        new THREE.MeshStandardMaterial({ color: 0x383d46, roughness: 0.7 })
      );
      body.position.set(0, 0.25 + visualTier * 0.03, 0);
      group.add(body);
      const stackCount = visualTier >= 3 ? 3 : visualTier >= 1 ? 2 : 1;
      for (let i = 0; i < stackCount; i += 1) {
        const stack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.1, 0.48 + visualTier * 0.08, 12),
          new THREE.MeshStandardMaterial({ color: 0x707783 })
        );
        stack.position.set(0.12 + i * 0.17, 0.66 + visualTier * 0.07, -0.12 + (i % 2) * 0.18);
        group.add(stack);
        this._addSmokePuff(group, {
          x: stack.position.x,
          y: stack.position.y + 0.32 + visualTier * 0.03,
          z: stack.position.z,
          phase: this._phaseForTile(tile, 50 + i),
          scale: 1 + i * 0.15,
        });
      }
      const belt = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.045, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.68 })
      );
      belt.position.set(-0.06, 0.13, 0.38);
      group.add(belt);
      this._registerAnimation(group, belt, "conveyor", { phase: this._phaseForTile(tile, 54), duration: 6.8 });
      for (let i = 0; i < 3; i += 1) {
        const box = this._addCrate(group, -0.28 + i * 0.22, 0.19, 0.38, i % 2 ? 0xc78a4d : 0x7b8794);
        box.scale.set(0.75, 0.6, 0.65);
        this._registerAnimation(group, box, "conveyorBox", { phase: this._phaseForTile(tile, 55), duration: 6.8, offset: i / 3 });
      }
      const gear = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.035, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xd6a84c, metalness: 0.15 })
      );
      gear.position.set(-0.24, 0.43, 0.26);
      gear.rotation.x = Math.PI / 2;
      group.add(gear);
      this._registerAnimation(group, gear, "gear", { phase: this._phaseForTile(tile, 58), duration: 7.2, speed: 1.2 });
      const engineerCount = Math.min(2, Math.max(1, Math.ceil((tile.workers || 0) / 4)));
      for (let i = 0; i < engineerCount; i += 1) {
        const engineer = this._addLowPolyPerson(group, {
          x: i === 0 ? -0.5 : 0.48,
          y: 0.06,
          z: i === 0 ? 0.26 : -0.28,
          scale: 0.82,
          shirt: 0xf1c45d,
          accent: 0x2a2f38,
          tool: i === 0 ? "shovel" : null,
          kind: i === 0 ? "toolCarry" : "study",
          phase: this._phaseForTile(tile, 60 + i),
          duration: 8 + i,
        });
        engineer.rotation.y = i === 0 ? -0.8 : 2.2;
      }
    }

    if (tile.type === TILE_TYPES.MILITARY) {
      // Try city.glb for the main structure (base, tower, hangar).
      // Flag, garrisoned units, and drill soldiers always render on top.
      if (!this._tryBuildingModel(group, "city", { scale, ownerColor })) {
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5 * scale, 0.56 * scale, 0.16 + visualTier * 0.02, 6),
          new THREE.MeshStandardMaterial({ color: 0x733838 })
        );
        base.position.set(0, 0.1, 0);
        group.add(base);
        const tower = new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.2, 0.48 + visualTier * 0.08, 6),
          new THREE.MeshStandardMaterial({ color: 0xb55151 })
        );
        tower.position.set(0, 0.42 + visualTier * 0.04, 0);
        group.add(tower);
        if (branch.level > 0 || visualTier >= 3) {
          const hangar = new THREE.Mesh(
            new THREE.BoxGeometry(0.38, 0.2, 0.28),
            new THREE.MeshStandardMaterial({ color: 0x5f3437, roughness: 0.7 })
          );
          hangar.position.set(-0.34, 0.17, -0.16);
          group.add(hangar);
        }
      }
      this._addFlag(group, { x: -0.42, y: 0.08, z: 0.3, color: ownerColor, phase: this._phaseForTile(tile, 70), scale: 0.92 });
      if (branch.branch === "tanks" && branch.level > 0) {
        this._addTankUnit(group, { x: 0.42, y: 0.23, z: 0.3, scale: 0.88, color: 0x53664f, phase: this._phaseForTile(tile, 71) });
      }
      if (branch.branch === "air" && branch.level > 0) {
        this._addPlaneUnit(group, { x: 0.44, y: 0.72, z: 0.2, scale: 0.86, color: 0xb8c6d8, phase: this._phaseForTile(tile, 72) });
      }
      if (branch.branch === "naval" && branch.level > 0) {
        this._addShipUnit(group, { x: 0.4, y: 0.2, z: -0.34, scale: 0.85, color: 0x3f6f82, phase: this._phaseForTile(tile, 73) });
      }
      const drillCount = Math.min(3, Math.max(1, Math.ceil((tile.workers || 0) / 3)));
      const drillPositions = [
        [-0.34, 0.07, -0.34],
        [0.0, 0.07, -0.42],
        [0.34, 0.07, -0.28],
      ];
      for (let i = 0; i < drillCount; i += 1) {
        const [sx, sy, sz] = drillPositions[i];
        const soldier = this._addLowPolyPerson(group, {
          x: sx,
          y: sy,
          z: sz,
          scale: 0.88,
          shirt: ownerColor,
          accent: 0x242820,
          kind: "drillMarch",
          phase: this._phaseForTile(tile, 74 + i),
          duration: 8.5 + i,
        });
        soldier.rotation.y = 0.15 + i * 0.28;
      }
    }

    this._addUnitFigure(group, tile, ownerColor, { x: 0.42, y: 0.62, z: 0.32, scale: 1 });

    if (tile.effects?.disabledTurns > 0 || tile.effects?.floodedTurns > 0) {
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.54, 0.025, 8, 32),
        new THREE.MeshBasicMaterial({ color: tile.effects.floodedTurns > 0 ? 0x5ec8ff : 0xffd166 })
      );
      marker.position.set(0, 0.08, 0);
      marker.rotation.x = Math.PI / 2;
      group.add(marker);
    }

    return group;
  }

  _phaseForTile(tile, salt = 0) {
    const seed = (this.map?.seed || 1) + salt * 997;
    return hash2d(tile.q * 17 + salt * 11, tile.r * 19 - salt * 13, seed) * TAU;
  }

  _snapshotTilePresentationState(tiles = []) {
    const snapshot = new Map();
    for (const tile of tiles) {
      snapshot.set(tile.id, {
        ownerId: tile.ownerId || null,
        unitStrength: tile.unit?.strength || 0,
        unitType: visualBranchesForUnit(tile.unit)[0]?.branch || tile.unit?.branch || "infantry",
      });
    }
    return snapshot;
  }

  _queueStateDrivenPresentation(map) {
    if (!this.lastRenderTileState.size) return;
    const currentVisibleIds = this.visibility?.enabled ? this.visibility.visibleTileIds : null;
    const previousVisibleIds = this.lastRenderVisibleTileIds;
    for (const tile of map.tiles) {
      if (!this._isTileVisible(tile.id)) continue;
      if (currentVisibleIds && (!previousVisibleIds || !previousVisibleIds.has(tile.id))) continue;
      const previous = this.lastRenderTileState.get(tile.id);
      if (!previous) continue;
      const nextOwnerId = tile.ownerId || null;
      const nextUnitStrength = tile.unit?.strength || 0;
      if (previous.ownerId !== nextOwnerId && nextOwnerId) this.playCaptureEffect(tile.id);
      if (previous.unitStrength > 0 && nextUnitStrength <= 0) {
        const deathVisual = this._spawnTransientUnitVisual(previous.unitType, previous.ownerId, this._tileCenterVector(tile.id, previous.unitType), { autoIdle: false });
        if (deathVisual) this.playUnitDespawn(deathVisual, { tileId: tile.id });
      }
    }
  }

  _tileCenterVector(tileIdValue, unitType = "infantry") {
    return this._tilePathToVectors([tileIdValue], unitType)[0] || null;
  }

  _clearTileUnitVisuals(tileIdValue) {
    const visuals = this.unitVisualsByTile.get(tileIdValue);
    if (!visuals) return;
    for (const visual of visuals) this._detachUnitVisual(visual);
    this.unitVisualsByTile.delete(tileIdValue);
  }

  _attachUnitVisual(tileIdValue, root, unitType, nationId) {
    if (!tileIdValue || !root) return null;
    const visual = this._createUnitVisual(root, unitType, nationId, { tileId: tileIdValue, autoIdle: true });
    if (!visual) return null;
    if (!this.unitVisualsByTile.has(tileIdValue)) this.unitVisualsByTile.set(tileIdValue, []);
    this.unitVisualsByTile.get(tileIdValue).push(visual);
    return visual;
  }

  _getPrimaryUnitVisual(tileIdValue) {
    return this.unitVisualsByTile.get(tileIdValue)?.[0] || null;
  }

  _createUnitVisual(root, unitType = "infantry", nationId = null, { tileId = null, transient = false, autoIdle = true } = {}) {
    if (!root) return null;
    const THREE = window.THREE;
    if (transient) this._ensureUniqueMaterials(root);
    const visual = {
      root,
      unitType,
      nationId,
      tileId,
      transient,
      state: "idle",
      mixer: null,
      clips: new Map(),
      action: null,
      basePosition: root.position.clone(),
      baseRotation: new THREE.Vector3(root.rotation.x, root.rotation.y, root.rotation.z),
      baseScale: root.scale.clone(),
    };
    const animations = root.userData?.animations || [];
    if (animations.length && THREE?.AnimationMixer) {
      visual.mixer = new THREE.AnimationMixer(root);
      animations.forEach((clip) => visual.clips.set(clip.name, clip));
      this.activeMixers.add(visual);
    }
    if (transient) this.transientUnitVisuals.add(visual);
    if (autoIdle) this.playUnitIdle(visual);
    return visual;
  }

  _ensureUniqueMaterials(object) {
    object.traverse?.((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) child.material = child.material.map((material) => material.clone());
      else child.material = child.material.clone();
    });
  }

  _detachUnitVisual(visual) {
    if (!visual) return;
    if (visual.mixer) {
      visual.mixer.stopAllAction();
      visual.mixer.uncacheRoot(visual.root);
      this.activeMixers.delete(visual);
    }
    this.transientUnitVisuals.delete(visual);
  }

  _playVisualClip(visual, clipName, { loop = true, timeScale = 1, clampWhenFinished = false } = {}) {
    if (!visual?.mixer || !visual.clips.has(clipName)) return false;
    const THREE = window.THREE;
    visual.action?.fadeOut?.(0.14);
    const action = visual.mixer.clipAction(visual.clips.get(clipName));
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = clampWhenFinished;
    action.enabled = true;
    action.timeScale = timeScale;
    action.fadeIn(0.12).play();
    visual.action = action;
    return true;
  }

  _registerAnimation(root, object, kind, options = {}) {
    if (!object) return;
    this.animated.push({
      root,
      object,
      kind,
      baseX: object.position.x,
      baseY: object.position.y,
      baseZ: object.position.z,
      baseRotX: object.rotation.x,
      baseRotY: object.rotation.y,
      baseRotZ: object.rotation.z,
      baseScaleX: object.scale.x,
      baseScaleY: object.scale.y,
      baseScaleZ: object.scale.z,
      baseOpacity: object.material?.opacity ?? options.baseOpacity,
      parts: object.userData?.parts || {},
      phase: options.phase || 0,
      duration: options.duration || 9,
      amplitude: options.amplitude ?? 1,
      speed: options.speed || 1,
      offset: options.offset || 0,
      from: options.from || null,
      to: options.to || null,
    });
  }

  _addLowPolyPerson(group, options = {}) {
    return decorations.addLowPolyPerson(this, group, options);
  }

  // Wrapper methods that delegate to the decoration module
  _addCrate(group, x, y, z, color = 0xb88755) {
    return decorations.addCrate(this, group, x, y, z, color);
  }

  _addFlag(group, options = {}) {
    return decorations.addFlag(this, group, options);
  }

  _addWave(group, options = {}) {
    return decorations.addWave(this, group, options);
  }

  _addSmokePuff(group, options = {}) {
    return decorations.addSmokePuff(this, group, options);
  }

  _addLandNature(group, tile) {
    return decorations.addLandNature(this, group, tile);
  }

  _addWaterNature(group, tile) {
    return decorations.addWaterNature(this, group, tile);
  }

  _addTinyTree(group, x, y, z, scale = 1, crownColor = 0x2f8a55) {
    return decorations.addTinyTree(this, group, x, y, z, scale, crownColor);
  }

  _addGrassTuft(group, x, y, z, scale = 1, color = 0x5aa65a) {
    return decorations.addGrassTuft(this, group, x, y, z, scale, color);
  }

  _addCactus(group, x, y, z, scale = 1) {
    return decorations.addCactus(this, group, x, y, z, scale);
  }

  _addPebble(group, x, y, z, scale = 1, color = 0x8b8578) {
    return decorations.addPebble(this, group, x, y, z, scale, color);
  }

  _addReeds(group, x, y, z) {
    return decorations.addReeds(this, group, x, y, z);
  }

  _addCapitalMarker(group, tile, ownerColor) {
    const THREE = window.THREE;
    const scale = capitalScale(tile, this.nations, this.map?.tiles || []);
    const capitalColor = new THREE.Color(0xffe066);
    const owner = new THREE.Color(ownerColor);

    const baseGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.74 * scale, 0.07, 8, 48),
      new THREE.MeshBasicMaterial({ color: ownerColor, transparent: true, opacity: 0.78, depthWrite: false })
    );
    baseGlow.rotation.x = Math.PI / 2;
    baseGlow.rotation.z = Math.PI / 6;
    baseGlow.position.set(0, 0.075, 0);
    group.add(baseGlow);
    this._registerAnimation(group, baseGlow, "civicPulse", { baseOpacity: 0.78, phase: this._phaseForTile(tile, 90), duration: 10.5 });

    const goldRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.5 * scale, 0.055, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.96, depthWrite: false })
    );
    goldRing.rotation.x = Math.PI / 2;
    goldRing.position.set(0, 0.12, 0);
    group.add(goldRing);

    // Try capital.glb for the central structure (plinth + crown).
    // Glow rings and flag always render on top regardless of GLB.
    if (!this._tryBuildingModel(group, "capital", { scale, ownerColor })) {
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26 * scale, 0.36 * scale, 0.24 * scale, 6),
        new THREE.MeshStandardMaterial({
          color: owner.lerp(capitalColor, 0.32),
          metalness: 0.18,
          roughness: 0.42,
          emissive: new THREE.Color(ownerColor).multiplyScalar(0.22),
        })
      );
      plinth.position.set(0, 0.25 * scale, 0);
      group.add(plinth);

      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17 * scale, 0.3 * scale, 0.28 * scale, 5),
        new THREE.MeshStandardMaterial({
          color: 0xffd166,
          metalness: 0.5,
          roughness: 0.28,
          emissive: new THREE.Color(0xffd166).multiplyScalar(0.36),
        })
      );
      crown.position.set(0, 0.58 * scale, 0);
      group.add(crown);
    }
    this._addFlag(group, { x: 0.34 * scale, y: 0.18 * scale, z: -0.28 * scale, color: ownerColor, phase: this._phaseForTile(tile, 91), scale: 0.72 * scale });
  }

  _addUnitFigure(group, tile, ownerColor, position) {
    if (!tile.unit?.strength) return;
    const branches = visualBranchesForUnit(tile.unit);
    const multiple = branches.length > 1;
    const offsets = {
      infantry: [-0.16, 0.12],
      tanks: [0.16, 0.1],
      air: [0.02, -0.14],
      naval: [0.18, -0.16],
    };
    for (const entry of branches) {
      const [xOffset, zOffset] = multiple ? (offsets[entry.branch] || [0, 0]) : [0, 0];
      const strengthScale = 0.9 + Math.min(0.32, entry.strength * 0.018);
      const options = {
        ...position,
        x: position.x + xOffset,
        z: position.z + zOffset,
        scale: (position.scale || 1) * strengthScale,
        phase: this._phaseForTile(tile, 80 + branches.indexOf(entry)),
        tileId: tile.id,
        nationId: tile.ownerId,
      };
      if (entry.branch === "tanks") {
        this._addTankUnit(group, { ...options, color: 0x53664f });
      } else if (entry.branch === "air") {
        this._addPlaneUnit(group, { ...options, color: 0xb8c6d8 });
      } else if (entry.branch === "naval") {
        this._addShipUnit(group, { ...options, color: 0x3f6f82 });
      } else {
        this._addInfantryUnit(group, { ...options, color: ownerColor });
      }
    }
  }

  _addTankUnit(group, options = {}) {
    const before = group.children.length;
    const result = decorations.addTankUnit(this, group, options);
    this._registerAddedUnitVisuals(group, before, "tanks", options);
    return result;
  }

  _addPlaneUnit(group, options = {}) {
    const before = group.children.length;
    const result = decorations.addPlaneUnit(this, group, options);
    this._registerAddedUnitVisuals(group, before, "air", options);
    return result;
  }

  _addShipUnit(group, options = {}) {
    const before = group.children.length;
    const result = decorations.addShipUnit(this, group, options);
    this._registerAddedUnitVisuals(group, before, "naval", options);
    return result;
  }

  _addInfantryUnit(group, options = {}) {
    const before = group.children.length;
    const result = decorations.addInfantryUnit(this, group, options);
    this._registerAddedUnitVisuals(group, before, "infantry", options);
    return result;
  }

  _registerAddedUnitVisuals(group, beforeCount, unitType, options = {}) {
    if (!options.tileId) return;
    for (const child of group.children.slice(beforeCount)) {
      this._attachUnitVisual(options.tileId, child, unitType, options.nationId || null);
    }
  }

  /**
   * Attempt to place a registered GLB model for a building/infrastructure tile.
   * Returns true when a GLB was placed (caller should skip inline procedural rendering).
   * Returns false when no GLB is loaded for this key (caller runs its own rendering).
   *
   * Usage in _buildTileDecoration:
   *   if (!this._tryBuildingModel(group, 'farm', { scale, ownerColor })) {
   *     // inline procedural farm code — only runs when farm.glb is absent
   *   }
   *
   * @param {THREE.Group} group   - Parent group to add the model to.
   * @param {string}      key     - Registry key (e.g. "farm", "mine", "city").
   * @param {Object}      options - Forwarded to getModelSync (scale, ownerColor, etc.).
   * @returns {boolean}
   */
  _tryBuildingModel(group, key, options = {}) {
    if (!hasGLB(key)) return false;
    const model = getModelSync(key, options);
    if (!model) return false;
    group.add(model);
    return true;
  }

  _bindInput() {
    this.dragMode = null;
    this.lastPointer = { x: 0, y: 0 };
    this.dragDistance = 0;
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.dragMode = event.button === 2 ? "pan" : "orbit";
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.dragDistance = 0;
    });
    this.canvas.addEventListener("pointerup", (event) => {
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch (_) {}
      const clicked = this.dragDistance < 5 && event.button === 0;
      this.dragMode = null;
      if (clicked) this._handleSelect(event);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (this.dragMode === "orbit") {
        this.dragDistance += Math.hypot(dx, dy);
        this.camAzimuth -= dx * 0.008;
        this.camPolar = clamp(this.camPolar - dy * 0.006, 0.18, Math.PI / 2 - 0.08);
        this._updateCamera();
      } else if (this.dragMode === "pan") {
        this.dragDistance += Math.hypot(dx, dy);
        const forward = new window.THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new window.THREE.Vector3().crossVectors(forward, new window.THREE.Vector3(0, 1, 0)).normalize();
        const scale = this.camRadius * 0.0018;
        this.target.addScaledVector(right, -dx * scale);
        this.target.addScaledVector(forward, dy * scale);
        this._updateCamera();
      } else {
        const tileIdValue = this._pickTile(event);
        if (tileIdValue !== this.hoveredTileId) {
          this.hoveredTileId = tileIdValue;
          if (this.onHover) this.onHover(tileIdValue, event);
        }
      }
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
	        event.preventDefault();
	        this.camRadius = clamp(this.camRadius * Math.exp(event.deltaY * 0.0014), this.minCamRadius, this.maxCamRadius);
	        this._updateCamera();
	      },
      { passive: false }
    );
    this.canvas.addEventListener("pointerleave", () => {
      this.hoveredTileId = null;
      if (this.onHover) this.onHover(null, null);
    });
  }

  _handleSelect(event) {
    const id = this._pickTile(event);
    if (this.onSelect) this.onSelect(id);
  }

  _pickTile(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.tileGroup.children, false);
    for (const hit of hits) {
      const tileIdValue = hit?.object?.userData?.tileId || null;
      if (!tileIdValue || !this._isTileVisible(tileIdValue)) continue;
      return tileIdValue;
    }
    return null;
  }

	  _resize() {
	    const wasAtFit = !this.maxCamRadius || Math.abs(this.camRadius - this.maxCamRadius) < 0.5;
	    const width = Math.max(1, this.canvas.clientWidth);
	    const height = Math.max(1, this.canvas.clientHeight);
	    this.renderer.setSize(width, height, false);
	    this.camera.aspect = width / height;
	    this.camera.updateProjectionMatrix();
	    if (this.map) {
	      this._setZoomBoundsForMap(this.map);
	      if (wasAtFit || this.camRadius > this.maxCamRadius) this.camRadius = this.maxCamRadius;
	      if (this.camRadius < this.minCamRadius) this.camRadius = this.minCamRadius;
	      this._updateCamera();
	      return;
	    }
	    this._updateNationLabels();
	  }
	
	  _updateCamera() {
	    this._positionCamera(this.camRadius);
	    this._updateNationLabels();
	  }
	
	  _positionCamera(radius) {
	    const THREE = window.THREE;
	    const sinP = Math.sin(this.camPolar);
	    const x = this.target.x + radius * sinP * Math.cos(this.camAzimuth);
	    const z = this.target.z + radius * sinP * Math.sin(this.camAzimuth);
	    const y = this.target.y + radius * Math.cos(this.camPolar);
	    this.camera.position.set(x, y, z);
	    this.camera.lookAt(this.target);
	    this.camera.updateMatrixWorld();
	  }
	
	  _setZoomBoundsForMap(map) {
	    const fitRadius = this._fitCameraRadiusToMap(map);
	    this.maxCamRadius = fitRadius;
	    this.minCamRadius = Math.max(6.5, Math.min(18, fitRadius * 0.22));
	  }
	
	  _fitCameraRadiusToMap(map) {
	    const points = this._mapFitPoints(map);
	    if (!points.length) return 24;
	    let low = 6;
	    let high = Math.max(24, map.radius * HEX_SIZE * 7);
	    while (!this._cameraRadiusFits(high, points)) high *= 1.35;
	    for (let i = 0; i < 24; i += 1) {
	      const mid = (low + high) / 2;
	      if (this._cameraRadiusFits(mid, points)) high = mid;
	      else low = mid;
	    }
	    return high;
	  }
	
	  _mapFitPoints(map) {
	    if (!map?.tiles?.length) return [];
	    let minX = Infinity;
	    let maxX = -Infinity;
	    let minZ = Infinity;
	    let maxZ = -Infinity;
	    for (const tile of map.tiles) {
	      const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
	      minX = Math.min(minX, x - HEX_SIZE);
	      maxX = Math.max(maxX, x + HEX_SIZE);
	      minZ = Math.min(minZ, z - HEX_SIZE);
	      maxZ = Math.max(maxZ, z + HEX_SIZE);
	    }
	    const THREE = window.THREE;
	    return [
	      new THREE.Vector3(minX, 0, minZ),
	      new THREE.Vector3(minX, 0, maxZ),
	      new THREE.Vector3(maxX, 0, minZ),
	      new THREE.Vector3(maxX, 0, maxZ),
	      new THREE.Vector3((minX + maxX) / 2, 0, minZ),
	      new THREE.Vector3((minX + maxX) / 2, 0, maxZ),
	      new THREE.Vector3(minX, 0, (minZ + maxZ) / 2),
	      new THREE.Vector3(maxX, 0, (minZ + maxZ) / 2),
	    ];
	  }
	
	  _cameraRadiusFits(radius, points) {
	    this._positionCamera(radius);
	    const margin = 0.9;
	    for (const point of points) {
	      const projected = point.clone().project(this.camera);
	      if (projected.z >= 1 || Math.abs(projected.x) > margin || Math.abs(projected.y) > margin) return false;
	    }
	    return true;
	  }

  _clearGroups() {
    for (const visuals of this.unitVisualsByTile.values()) {
      for (const visual of visuals) this._detachUnitVisual(visual);
    }
    for (const visual of this.transientUnitVisuals) this._detachUnitVisual(visual);
    const groups = [this.tileGroup, this.territoryBorderGroup, this.transportGroup, this.highlightGroup, this.decorationGroup, this.effectGroup];
    for (const group of groups) {
      while (group.children.length) {
        const child = group.children[group.children.length - 1];
        group.remove(child);
        child.traverse?.((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((material) => material.dispose());
          else if (obj.material) obj.material.dispose();
        });
      }
    }
    this.tileMeshes.clear();
    this.decorations.clear();
    this.decorationSignatures.clear();
    this.territoryBorderSignature = "";
    this.transportSignature = "";
    this.nationLabelSignature = "";
    this.nationLabels.forEach((label) => label.remove());
    this.nationLabels.clear();
    this.animated = [];
    this.effects = [];
    this.unitVisualsByTile.clear();
    this.transientUnitVisuals.clear();
    this.activeMixers.clear();
    this.lastRenderTileState.clear();
    this.lastRenderVisibleTileIds = null;
    this.lastAnimationFrameAt = 0;
  }

  _animate(now) {
    requestAnimationFrame(this._animate);
    const time = now * 0.001;
    const deltaSeconds = this.lastAnimationFrameAt ? Math.min(0.05, Math.max(0, (now - this.lastAnimationFrameAt) * 0.001)) : 0.016;
    this.lastAnimationFrameAt = now;
    for (let i = this.animated.length - 1; i >= 0; i -= 1) {
      const item = this.animated[i];
      if (!item.object.parent || (item.root && !item.root.parent)) {
        this.animated.splice(i, 1);
        continue;
      }
      const duration = Math.max(0.1, item.duration || 8);
      const phaseTime = time / duration * TAU + item.phase;
      const wave = Math.sin(phaseTime);
      const soft = (wave + 1) / 2;

      if (item.kind === "spin") item.object.rotation.z += 0.03 * (item.speed || 1);
      if (item.kind === "gear") item.object.rotation.z = item.baseRotZ + phaseTime * (item.speed || 1);
      if (item.kind === "pulse" || item.kind === "civicPulse") {
        item.object.material.opacity = (item.baseOpacity || 0.7) * (0.62 + 0.38 * soft);
      }
      if (item.kind === "bob") item.object.position.y = item.baseY + wave * 0.035;
      if (item.kind === "slide") item.object.position.x = item.baseX + wave * 0.12;
      if (item.kind === "cropSway") {
        item.object.rotation.z = item.baseRotZ + wave * 0.035 * item.amplitude;
        item.object.scale.y = item.baseScaleY + soft * 0.08 * item.amplitude;
      }
      if (item.kind === "harvest") {
        item.object.position.y = item.baseY + soft * 0.025;
        item.object.rotation.x = item.baseRotX + soft * 0.24;
        if (item.parts.leftArm) item.parts.leftArm.rotation.z = 0.35 + wave * 0.35;
        if (item.parts.rightArm) item.parts.rightArm.rotation.z = -0.45 - soft * 0.7;
      }
      if (item.kind === "pickaxe") {
        item.object.rotation.x = item.baseRotX + soft * 0.16;
        if (item.parts.rightArm) {
          item.parts.rightArm.rotation.z = -0.25 - soft * 1.45;
          item.parts.rightArm.rotation.x = -0.35 - soft * 0.6;
        }
        if (item.parts.leftArm) item.parts.leftArm.rotation.z = 0.28 + soft * 0.52;
      }
      if (item.kind === "toolCarry") {
        item.object.position.x = item.baseX + Math.sin(phaseTime * 0.5) * 0.045 * item.amplitude;
        item.object.position.z = item.baseZ + Math.cos(phaseTime * 0.5) * 0.026 * item.amplitude;
        if (item.parts.rightArm) item.parts.rightArm.rotation.z = -0.65 + wave * 0.22;
      }
      if (item.kind === "study") {
        item.object.rotation.x = item.baseRotX + soft * 0.1;
        if (item.parts.head) item.parts.head.rotation.x = -0.12 + wave * 0.1;
        if (item.parts.rightArm) item.parts.rightArm.rotation.z = -0.62 + wave * 0.18;
      }
      if (item.kind === "drillMarch" || item.kind === "march") {
        item.object.position.x = item.baseX + Math.sin(phaseTime * 1.4) * 0.035;
        item.object.position.z = item.baseZ + Math.cos(phaseTime * 1.4) * 0.035;
        item.object.position.y = item.baseY + soft * 0.018;
        if (item.parts.leftArm) item.parts.leftArm.rotation.z = 0.42 + wave * 0.36;
        if (item.parts.rightArm) item.parts.rightArm.rotation.z = -0.42 - wave * 0.36;
      }
      if (item.kind === "mineCart") {
        item.object.position.x = item.baseX + Math.sin(phaseTime) * 0.28;
        item.object.rotation.z = item.baseRotZ + Math.sin(phaseTime * 2) * 0.025;
      }
      if (item.kind === "crane") item.object.rotation.z = item.baseRotZ + wave * 0.12 * item.amplitude;
      if (item.kind === "drill") {
        item.object.position.y = item.baseY + soft * 0.055;
        item.object.rotation.y = item.baseRotY + phaseTime * 1.6;
      }
      if (item.kind === "conveyor") {
        item.object.material.emissive.set(0x222833).multiplyScalar(0.18 + soft * 0.1);
      }
      if (item.kind === "conveyorBox") {
        const t = (time / duration + item.offset + item.phase / TAU) % 1;
        item.object.position.x = -0.35 + t * 0.7;
        item.object.position.y = item.baseY + Math.sin(t * TAU) * 0.01;
      }
      if (item.kind === "flag") {
        item.object.rotation.y = item.baseRotY + wave * 0.2 * item.amplitude;
        item.object.scale.x = item.baseScaleX * (1 + soft * 0.08 * item.amplitude);
      }
      if (item.kind === "wave") {
        const t = (time / duration + item.phase / TAU) % 1;
        const s = 0.78 + t * 0.7;
        item.object.scale.set(s, s, s);
        item.object.material.opacity = Math.max(0, 0.46 * (1 - t));
      }
      if (item.kind === "smoke") {
        const t = (time / duration + item.phase / TAU) % 1;
        const s = (0.65 + t * 1.25) * item.amplitude;
        item.object.position.y = item.baseY + t * 0.42;
        item.object.position.x = item.baseX + Math.sin(t * TAU) * 0.04;
        item.object.scale.set(s, s * 0.8, s);
        item.object.material.opacity = Math.max(0, 0.36 * (1 - t));
      }
      if (item.kind === "cloud") {
        item.object.position.x = item.baseX + wave * 0.16;
        item.object.material.opacity = 0.32 + soft * 0.18;
      }
      if (item.kind === "telescope") item.object.rotation.y = item.baseRotY + wave * 0.5;
      if (item.kind === "turretScan") item.object.rotation.y = item.baseRotY + wave * 0.42 * item.amplitude;
      if (item.kind === "patrol") {
        item.object.position.x = item.baseX + Math.sin(phaseTime) * 0.08;
        item.object.position.z = item.baseZ + Math.cos(phaseTime) * 0.035;
        item.object.rotation.y = item.baseRotY + Math.sin(phaseTime) * 0.16;
      }
      if (item.kind === "fly") {
        item.object.position.x = item.baseX + Math.sin(phaseTime) * 0.12;
        item.object.position.y = item.baseY + Math.sin(phaseTime * 1.35) * 0.07;
        item.object.position.z = item.baseZ + Math.cos(phaseTime) * 0.12;
        item.object.rotation.y = item.baseRotY + Math.sin(phaseTime) * 0.35;
      }
      if (item.kind === "sail") {
        item.object.position.y = item.baseY + wave * 0.035;
        item.object.rotation.z = item.baseRotZ + Math.sin(phaseTime * 1.2) * 0.08;
      }
      if (item.kind === "transportVehicle" || item.kind === "transportTrain") {
        const loop = (time / duration + item.phase / TAU + item.offset) % 1;
        const visible = item.kind === "transportTrain" ? loop < 0.46 : loop < 0.58;
        const t = visible ? loop / (item.kind === "transportTrain" ? 0.46 : 0.58) : 0;
        if (item.from && item.to) {
          item.object.position.lerpVectors(item.from, item.to, t);
          const dx = item.to.x - item.from.x;
          const dz = item.to.z - item.from.z;
          item.object.rotation.y = -Math.atan2(dz, dx);
        }
        this._setObjectOpacity(item.object, visible ? 0.9 : 0);
      }
      if (item.kind === "airportPlane") {
        const loop = (time / duration + item.phase / TAU) % 1;
        const visible = loop < 0.62;
        const t = visible ? loop / 0.62 : 0;
        if (item.from && item.to) {
          item.object.position.lerpVectors(item.from, item.to, t);
          const dx = item.to.x - item.from.x;
          const dz = item.to.z - item.from.z;
          item.object.rotation.y = -Math.atan2(dz, dx);
          item.object.rotation.z = -0.35 + Math.sin(t * Math.PI) * 0.18;
          item.object.position.y += Math.sin(t * Math.PI) * 0.38;
        }
        this._setObjectOpacity(item.object, visible ? 0.86 : 0);
      }
      if (item.kind === "orbit") {
        const angle = time * 0.8 + item.phase;
        const radius = Math.hypot(item.baseX, item.baseZ) || 0.35;
        item.object.position.x = Math.cos(angle) * radius;
        item.object.position.z = Math.sin(angle) * radius;
      }
    }
    for (const visual of [...this.activeMixers]) {
      if (!visual.root?.parent) {
        this._detachUnitVisual(visual);
        continue;
      }
      visual.mixer?.update(deltaSeconds);
    }
    this._updateEffects(now);
    this._updateNationLabels();
    this.renderer.render(this.scene, this.camera);
  }

  _setObjectOpacity(object, opacity) {
    object.traverse?.((child) => {
      if (!child.material) return;
      if (Array.isArray(child.material)) {
        for (const material of child.material) {
          material.transparent = true;
          material.opacity = opacity;
        }
      } else {
        child.material.transparent = true;
        child.material.opacity = opacity;
      }
    });
  }

  _updateEffects(now) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      const start = effect.start + (effect.delay || 0);
      if (now < start) continue;
      const t = clamp((now - start) / Math.max(1, effect.duration || 1), 0, 1);
      effect.update?.(effect, t, now);
      if (t < 1) continue;
      try {
        effect.finish?.(effect);
      } finally {
        this.effects.splice(i, 1);
      }
    }
  }

  _tilePathToVectors(tileIds, unitType = "infantry") {
    const THREE = window.THREE;
    const height = unitType === "air" ? 1.32 : unitType === "naval" ? 0.38 : 0.92;
    return (tileIds || [])
      .map((id) => this.map?.tiles.find((tile) => tile.id === id))
      .filter(Boolean)
      .map((tile) => {
        const pos = axialToWorld(tile.q, tile.r, HEX_SIZE);
        return new THREE.Vector3(pos.x, height, pos.z);
      });
  }

  _createProceduralUnitEffectMesh(unitType = "infantry", nationId = null) {
    const THREE = window.THREE;
    const color = colorFromHex(this.nations[nationId]?.color || OWNER_COLORS[0]);
    const group = new THREE.Group();
    if (unitType === "tanks") {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0x566850 }));
      const turret = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.17), new THREE.MeshBasicMaterial({ color: 0x6d8064 }));
      turret.position.set(0.04, 0.14, 0);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), new THREE.MeshBasicMaterial({ color: 0x1f241f }));
      barrel.position.set(0.22, 0.15, 0);
      barrel.rotation.z = Math.PI / 2;
      group.add(hull, turret, barrel);
      return group;
    }
    if (unitType === "naval") {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.15, 0.22), new THREE.MeshBasicMaterial({ color: 0x3f6f82 }));
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 4), new THREE.MeshBasicMaterial({ color: 0x4c8294 }));
      bow.position.set(0.34, 0, 0);
      bow.rotation.z = -Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xd7e7ef }));
      mast.position.set(-0.1, 0.22, 0);
      group.add(hull, bow, mast);
      return group;
    }
    if (unitType === "air") {
      const material = new THREE.MeshBasicMaterial({ color: 0xc9d7e8 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.66, 3), material);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.58), material);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.26), material);
      tail.position.set(-0.22, 0.02, 0);
      body.rotation.z = -Math.PI / 2;
      group.add(body, wing, tail);
      return group;
    }
    for (const [offset, zOffset] of [[-0.14, -0.06], [0, 0.1], [0.14, -0.02]]) {
      const soldier = new THREE.Group();
      soldier.position.set(offset, 0, zOffset);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.17, 6), new THREE.MeshBasicMaterial({ color }));
      body.position.y = 0.08;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color }));
      head.position.y = 0.19;
      const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.18), new THREE.MeshBasicMaterial({ color: 0x1f241f }));
      rifle.position.set(0.05, 0.12, 0.04);
      rifle.rotation.y = 0.7;
      soldier.add(body, head, rifle);
      group.add(soldier);
    }
    return group;
  }

  _createUnitEffectMesh(unitType = "infantry", nationId = null) {
    const modelKey = UNIT_MODEL_KEYS[unitType];
    const ownerColor = this.nations[nationId]?.color || OWNER_COLORS[0];
    if (modelKey && hasGLB(modelKey)) {
      const model = getModelSync(modelKey, {
        color: colorFromHex(ownerColor),
        ownerColor: colorFromHex(ownerColor),
      });
      if (model) return model;
    }
    return this._createProceduralUnitEffectMesh(unitType, nationId);
  }

  _createTimedEffect(effect) {
    this.effects.push({ start: performance.now(), duration: 300, delay: 0, ...effect });
    return this.effects[this.effects.length - 1];
  }

  _spawnTransientUnitVisual(unitType = "infantry", nationId = null, position = null, { autoIdle = true } = {}) {
    const root = this._createUnitEffectMesh(unitType, nationId);
    if (!root) return null;
    if (position) root.position.copy(position);
    this.effectGroup.add(root);
    return this._createUnitVisual(root, unitType, nationId, { transient: true, autoIdle });
  }

  playUnitIdle(unitVisual) {
    if (!unitVisual?.root) return;
    unitVisual.state = "idle";
    unitVisual.root.position.copy(unitVisual.basePosition);
    unitVisual.root.rotation.set(unitVisual.baseRotation.x, unitVisual.baseRotation.y, unitVisual.baseRotation.z);
    unitVisual.root.scale.copy(unitVisual.baseScale);
    this._setObjectOpacity(unitVisual.root, 1);
    this._playVisualClip(unitVisual, "Idle");
  }

  playUnitMove(unitVisual, _fromTile, _toTile, { path = [], duration = 700, targetTileId = null, explodeAtEnd = false, delay = 0 } = {}) {
    if (!unitVisual?.root || path.length < 2) return;
    this._playVisualClip(unitVisual, "Move");
    this._createTimedEffect({
      type: "unitMove",
      unitVisual,
      path,
      duration,
      delay,
      unitType: unitVisual.unitType,
      targetTileId,
      explodeAtEnd,
      update: (effect, t) => {
        const eased = easeInOutCubic(t);
        const segmentCount = Math.max(1, effect.path.length - 1);
        const exact = eased * segmentCount;
        const index = Math.min(segmentCount - 1, Math.floor(exact));
        const local = exact - index;
        const from = effect.path[index];
        const to = effect.path[Math.min(effect.path.length - 1, index + 1)];
        effect.unitVisual.root.position.lerpVectors(from, to, local);
        const arcHeight = effect.unitType === "air" ? 1.35 : effect.unitType === "infantry" ? 0.14 : effect.unitType === "naval" ? 0.2 : 0.18;
        effect.unitVisual.root.position.y += Math.sin(eased * Math.PI) * arcHeight;
        this._orientVisualAlongPath(effect.unitVisual.root, from, to, effect.unitType);
      },
      finish: (effect) => {
        if (effect.unitVisual.transient) this._disposeUnitVisual(effect.unitVisual);
        if (effect.explodeAtEnd) this._explodeTile(effect.targetTileId, effect.unitType);
        else this._flashTile(effect.targetTileId);
      },
    });
  }

  playUnitAttack(attackerVisual, targetVisual, { targetTileId = null, path = [], unitType = "infantry", disposeOnFinish = false } = {}) {
    if (!attackerVisual?.root) return;
    const anchor = attackerVisual.root.position.clone();
    const target = path[1] || this._tileCenterVector(targetTileId, unitType) || anchor.clone();
    const direction = target.clone().sub(anchor);
    this._orientVisualAlongPath(attackerVisual.root, anchor, target, unitType);
    this._playVisualClip(attackerVisual, "Attack", { loop: false, clampWhenFinished: true, timeScale: 1.2 });
    this._createTimedEffect({
      type: "attackWindup",
      unitVisual: attackerVisual,
      duration: 220,
      update: (effect, t) => {
        const anticipation = t < 0.45 ? -easeOutCubic(t / 0.45) : easeOutBack((t - 0.45) / 0.55);
        effect.unitVisual.root.position.copy(anchor);
        if (direction.lengthSq() > 0) effect.unitVisual.root.position.addScaledVector(direction.clone().normalize(), anticipation * 0.18);
        effect.unitVisual.root.position.y += Math.sin(t * Math.PI) * (unitType === "air" ? 0.1 : 0.04);
      },
      finish: () => {
        if (targetVisual) this.playHitReaction(targetVisual);
        if (disposeOnFinish && attackerVisual.transient) this._disposeUnitVisual(attackerVisual);
      },
    });
  }

  playProjectileTravel({ unitType = "infantry", nationId = null, path = [], duration = 700, targetTileId = null, delay = 0 } = {}) {
    if (path.length < 2) return;
    const projectile = this._createProjectileMesh(unitType, nationId);
    projectile.position.copy(path[0]);
    this.effectGroup.add(projectile);
    this._createTimedEffect({
      type: "projectile",
      mesh: projectile,
      path,
      duration,
      delay,
      unitType,
      targetTileId,
      update: (effect, t) => {
        const eased = easeOutCubic(t);
        const segmentCount = Math.max(1, effect.path.length - 1);
        const exact = eased * segmentCount;
        const index = Math.min(segmentCount - 1, Math.floor(exact));
        const local = exact - index;
        const from = effect.path[index];
        const to = effect.path[Math.min(effect.path.length - 1, index + 1)];
        effect.mesh.position.lerpVectors(from, to, local);
        effect.mesh.position.y += Math.sin(eased * Math.PI) * 0.72;
        this._orientVisualAlongPath(effect.mesh, from, to, unitType);
      },
      finish: (effect) => {
        this._disposeEffectMesh(effect.mesh);
        this.playHitEffect(effect.targetTileId, { unitType: effect.unitType });
      },
    });
  }

  playHitReaction(unitVisual) {
    if (!unitVisual?.root) return;
    const baseScale = unitVisual.baseScale.clone();
    const basePosition = unitVisual.basePosition.clone();
    this._playVisualClip(unitVisual, "Hit", { loop: false, clampWhenFinished: true, timeScale: 1.35 });
    this._createTimedEffect({
      type: "hitReaction",
      unitVisual,
      duration: 180,
      update: (effect, t) => {
        const kick = Math.sin(t * Math.PI);
        effect.unitVisual.root.scale.set(
          baseScale.x * (1 + kick * 0.08),
          baseScale.y * (1 - kick * 0.16),
          baseScale.z * (1 + kick * 0.08)
        );
        effect.unitVisual.root.position.y = basePosition.y + kick * 0.05;
      },
      finish: (effect) => this.playUnitIdle(effect.unitVisual),
    });
  }

  playHitEffect(tileIdValue, { unitType = "infantry" } = {}) {
    this._explodeTile(tileIdValue, unitType);
  }

  playUnitDespawn(unitVisual, { tileId = null } = {}) {
    if (!unitVisual?.root) return;
    this._playVisualClip(unitVisual, "Death", { loop: false, clampWhenFinished: true, timeScale: 1.1 });
    this._createTimedEffect({
      type: "death",
      unitVisual,
      duration: 320,
      update: (effect, t) => {
        const fade = 1 - easeOutCubic(t);
        effect.unitVisual.root.position.y = effect.unitVisual.basePosition.y - t * 0.3;
        effect.unitVisual.root.rotation.z = effect.unitVisual.baseRotation.z + t * 0.6;
        effect.unitVisual.root.scale.setScalar(Math.max(0.01, 1 - t * 0.22));
        this._setObjectOpacity(effect.unitVisual.root, fade);
      },
      finish: (effect) => {
        this._disposeUnitVisual(effect.unitVisual);
        if (tileId) this.playHitEffect(tileId, { unitType: effect.unitVisual.unitType });
      },
    });
  }

  playCaptureEffect(tileIdValue) {
    if (!tileIdValue || !this.map) return;
    const THREE = window.THREE;
    const tile = this.map.tiles.find((item) => item.id === tileIdValue);
    if (!tile) return;
    const ownerColor = colorFromHex(this.nations[tile.ownerId]?.color || "#ffd166");
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.76, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({ color: ownerColor, transparent: true, opacity: 0.92, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, isWaterLike(tile) ? 0.34 : 0.78, z);
    this.effectGroup.add(ring);
    this._createTimedEffect({
      type: "capture",
      mesh: ring,
      duration: 420,
      update: (effect, t) => {
        effect.mesh.material.opacity = 0.92 * (1 - t);
        effect.mesh.scale.setScalar(0.85 + easeOutBack(t) * 0.9);
      },
      finish: (effect) => this._disposeEffectMesh(effect.mesh),
    });
  }

  _orientVisualAlongPath(object, from, to, unitType = "infantry") {
    if (!object || !from || !to) return;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx || dz) object.rotation.y = -Math.atan2(dz, dx);
    if (unitType === "air") object.rotation.z = -0.35;
    if (unitType === "naval") object.rotation.z = Math.sin(performance.now() * 0.01) * 0.04;
  }

  _disposeUnitVisual(unitVisual) {
    if (!unitVisual?.root) return;
    this._detachUnitVisual(unitVisual);
    this._disposeEffectMesh(unitVisual.root);
  }

  _createProjectileMesh(unitType = "infantry", nationId = null) {
    const THREE = window.THREE;
    const group = new THREE.Group();
    if (unitType === "tanks" || unitType === "naval") {
      const color = unitType === "tanks" ? 0xffb347 : 0xd7e7ef;
      const shell = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 8), new THREE.MeshBasicMaterial({ color }));
      shell.rotation.z = -Math.PI / 2;
      const trail = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.28, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.46, depthWrite: false })
      );
      trail.position.set(-0.18, 0, 0);
      trail.rotation.z = Math.PI / 2;
      group.add(shell, trail);
      return group;
    }
    const color = colorFromHex(this.nations[nationId]?.color || OWNER_COLORS[0]);
    for (const zOffset of [-0.07, 0.02, 0.1]) {
      const shot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.026, 0.026), new THREE.MeshBasicMaterial({ color: zOffset === 0.02 ? 0xfff1a8 : color }));
      shot.position.set(0, 0, zOffset);
      group.add(shot);
    }
    return group;
  }

  _explodeTile(tileIdValue, unitType = "infantry") {
    if (!tileIdValue || !this.map) return;
    const THREE = window.THREE;
    const tile = this.map.tiles.find((item) => item.id === tileIdValue);
    if (!tile) return;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const group = new THREE.Group();
    group.position.set(x, isWaterLike(tile) ? 0.36 : 0.88, z);
    const colors = unitType === "infantry" ? [0xffd166, 0xffffff] : [0xff7a2f, 0xffd166, 0x3b2218];
    colors.forEach((color, index) => {
      const burst = new THREE.Mesh(
        new THREE.SphereGeometry(0.22 + index * 0.08, 16, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 - index * 0.12, depthWrite: false })
      );
      group.add(burst);
    });
    this.effectGroup.add(group);
    this._createTimedEffect({
      type: "explosion",
      mesh: group,
      duration: unitType === "infantry" ? 320 : 480,
      update: (effect, t) => {
        effect.mesh.children.forEach((child, index) => {
          child.material.opacity = Math.max(0, 1 - t);
          child.scale.setScalar(1 + easeOutBack(t) * (1.1 + index * 0.18));
        });
      },
      finish: (effect) => this._disposeEffectMesh(effect.mesh),
    });
  }

  _disposeEffectMesh(mesh) {
    if (!mesh) return;
    this.effectGroup.remove(mesh);
    mesh.traverse?.((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((material) => material.dispose());
      else if (obj.material) obj.material.dispose();
    });
  }

  _flashTile(tileIdValue) {
    if (!tileIdValue || !this.map) return;
    const THREE = window.THREE;
    const tile = this.map.tiles.find((item) => item.id === tileIdValue);
    if (!tile) return;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.04, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 1 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.72, z);
    this.effectGroup.add(ring);
    this._createTimedEffect({
      type: "flash",
      mesh: ring,
      duration: 340,
      update: (effect, t) => {
        effect.mesh.material.opacity = 1 - t;
        effect.mesh.scale.setScalar(1 + easeOutBack(t) * 0.65);
      },
      finish: (effect) => this._disposeEffectMesh(effect.mesh),
    });
  }
}
