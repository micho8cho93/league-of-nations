import { TILE_TYPES, tileId } from "./utils.js";
import { GAME_MODES } from "./balance.js";

// Scenario definitions
export const SCENARIOS = Object.freeze({
  OCEANIA_RESOURCE_FRONTIERS: "oceania-resource-frontiers",
  GLOBAL_RESOURCE_RIVALRY: "global-resource-rivalry",
});

// Scenario metadata
export const SCENARIO_METADATA = Object.freeze({
  [SCENARIOS.OCEANIA_RESOURCE_FRONTIERS]: {
    id: "oceania-resource-frontiers",
    name: "Oceania Resource Frontiers",
    description: "Control island territories and secure diverse resources across the Pacific.",
    mode: GAME_MODES.ADVANCED,
    maxPlayers: 4,
    minPlayers: 1,
    singlePlayerOnly: true,
  },
  [SCENARIOS.GLOBAL_RESOURCE_RIVALRY]: {
    id: "global-resource-rivalry",
    name: "Global Resource Rivalry",
    description: "Compete for continental control and monopolize critical resources worldwide.",
    mode: GAME_MODES.ADVANCED,
    maxPlayers: 4,
    minPlayers: 1,
    singlePlayerOnly: true,
  },
});

// Objective definitions for Oceania Resource Frontiers
export const OCEANIA_OBJECTIVES = Object.freeze([
  {
    id: "secure-growth",
    title: "Secure Growth",
    description: "Control 3 grassland tiles",
    type: "terrain",
    terrain: "grassland",
    target: 3,
    progress: 0,
    completed: false,
  },
  {
    id: "build-infrastructure",
    title: "Build Infrastructure",
    description: "Build 5 buildings (farms, fisheries, mines, schools, universities, or military)",
    type: "buildings",
    target: 5,
    progress: 0,
    completed: false,
  },
  {
    id: "industrialize",
    title: "Industrialize",
    description: "Construct 2 factories",
    type: "factories",
    target: 2,
    progress: 0,
    completed: false,
  },
  {
    id: "strategic-resource-control",
    title: "Strategic Resource Control",
    description: "Control at least 1 tile producing each resource: fruit, hardwood, iron, and oil",
    type: "resources",
    resources: ["fruit", "hardwood", "iron", "oil"],
    progress: [],
    completed: false,
  },
]);

// Objective definitions for Global Resource Rivalry
export const GLOBAL_OBJECTIVES = Object.freeze([
  {
    id: "grassland-control",
    title: "Grassland Dominance",
    description: "Control 15 grassland tiles across multiple continents",
    type: "terrain",
    terrain: "grassland",
    target: 15,
    progress: 0,
    completed: false,
  },
  {
    id: "desert-control",
    title: "Desert Mastery",
    description: "Control 10 desert tiles for oil and minerals",
    type: "terrain",
    terrain: "desert",
    target: 10,
    progress: 0,
    completed: false,
  },
  {
    id: "resource-diversity",
    title: "Resource Diversity",
    description: "Control at least 1 tile producing each resource: fruit, hardwood, iron, and oil",
    type: "resources",
    resources: ["fruit", "hardwood", "iron", "oil"],
    progress: [],
    completed: false,
  },
  {
    id: "industrial-power",
    title: "Industrial Power",
    description: "Construct 3 factories",
    type: "factories",
    target: 3,
    progress: 0,
    completed: false,
  },
]);

const SCENARIO_MAP_RADIUS = 32;
const WORLD_SCENARIO_SEED = 54321;
const OCEANIA_SCENARIO_SEED = 12345;
const SQRT3 = Math.sqrt(3);

function createScenarioTileBuilder() {
  const tiles = new Map();

  const setTile = (q, r, terrain, biome, type = terrain === "water" ? TILE_TYPES.WATER : TILE_TYPES.EMPTY) => {
    tiles.set(tileId(q, r), {
      id: tileId(q, r),
      q,
      r,
      terrain,
      landform: terrain === "land" ? "continent" : "sea",
      biome,
      type,
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
    });
  };

  const paintHex = (q, r, brush, terrain, biome) => {
    const radius = Math.max(0, Math.round(brush));
    for (let dq = -radius; dq <= radius; dq += 1) {
      const drMin = Math.max(-radius, -dq - radius);
      const drMax = Math.min(radius, -dq + radius);
      for (let dr = drMin; dr <= drMax; dr += 1) {
        setTile(q + dq, r + dr, terrain, biome);
      }
    }
  };

  const cubeRound = (x, y, z) => {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const xDiff = Math.abs(rx - x);
    const yDiff = Math.abs(ry - y);
    const zDiff = Math.abs(rz - z);
    if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
    else if (yDiff > zDiff) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  };

  const hexDistance = (a, b) => (
    Math.max(
      Math.abs(a.q - b.q),
      Math.abs(a.r - b.r),
      Math.abs((a.q + a.r) - (b.q + b.r)),
    )
  );

  const linePoints = (from, to) => {
    const distance = Math.max(1, hexDistance(from, to));
    const points = [];
    const a = { x: from.q, y: -from.q - from.r, z: from.r };
    const b = { x: to.q, y: -to.q - to.r, z: to.r };
    for (let step = 0; step <= distance; step += 1) {
      const t = step / distance;
      points.push(cubeRound(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      ));
    }
    return points;
  };

  const paintPath = (points, terrain, biome, defaultBrush = 1) => {
    const projected = points.map((point) => ({
      q: point.q,
      r: point.r,
      brush: point.brush ?? defaultBrush,
    }));
    for (let i = 0; i < projected.length; i += 1) {
      const point = projected[i];
      paintHex(point.q, point.r, point.brush, terrain, biome);
      const next = projected[i + 1];
      if (!next) continue;
      const segment = linePoints(point, next);
      for (let j = 0; j < segment.length; j += 1) {
        const segmentPoint = segment[j];
        const t = segment.length <= 1 ? 0 : j / (segment.length - 1);
        const brush = Math.round(point.brush + (next.brush - point.brush) * t);
        paintHex(segmentPoint.q, segmentPoint.r, brush, terrain, biome);
      }
    }
  };

  const paintPoints = (points, terrain, biome, defaultBrush = 0) => {
    for (const point of points) {
      paintHex(point.q, point.r, point.brush ?? defaultBrush, terrain, biome);
    }
  };

  const finalize = (size, radius, seed) => {
    for (let q = -radius; q <= radius; q += 1) {
      for (let r = -radius; r <= radius; r += 1) {
        if (!tiles.has(tileId(q, r))) setTile(q, r, "water", "water", TILE_TYPES.WATER);
      }
    }
    const list = [...tiles.values()];
    return {
      size,
      radius,
      seed,
      landRatio: list.filter((tile) => tile.terrain === "land").length / list.length,
      tiles: list,
    };
  };

  return {
    paintHex,
    paintPath,
    paintPoints,
    finalize,
  };
}

function projectToAxial(lon, lat, { centerLon, centerLat, scaleX, scaleY }) {
  const x = (lon - centerLon) * scaleX;
  const y = (centerLat - lat) * scaleY;
  const q = Math.round(x / 1.5);
  const r = Math.round(y / SQRT3 - q / 2);
  return { q, r };
}

function worldProject(lon, lat, brush = 0) {
  return {
    ...projectToAxial(lon, lat, {
      centerLon: 10,
      centerLat: 5,
      scaleX: 0.22,
      scaleY: 0.52,
    }),
    brush,
  };
}

function wrapPacificLongitude(lon) {
  return lon < 0 ? lon + 360 : lon;
}

function oceaniaProject(lon, lat, brush = 0) {
  return {
    ...projectToAxial(wrapPacificLongitude(lon), lat, {
      centerLon: 178,
      centerLat: -8,
      scaleX: 0.58,
      scaleY: 0.56,
    }),
    brush,
  };
}

function projectCluster(project, points) {
  const seen = new Set();
  return points.map(([lon, lat]) => project(lon, lat)).filter((point) => {
    const key = `${point.q}:${point.r}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((point) => [point.q, point.r]);
}

// Global world map - projected from simplified real-world geography
function createWorldMap() {
  const map = createScenarioTileBuilder();

  // North America and Greenland
  map.paintPath([
    worldProject(-168, 65, 2),
    worldProject(-150, 61, 2),
    worldProject(-130, 56, 2),
    worldProject(-108, 53, 3),
    worldProject(-88, 51, 2),
    worldProject(-68, 48, 2),
  ], "land", "grassland");
  map.paintPath([
    worldProject(-125, 37, 2),
    worldProject(-111, 35, 2),
    worldProject(-97, 34, 2),
    worldProject(-84, 34, 2),
    worldProject(-75, 39, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(-108, 24, 1),
    worldProject(-98, 21, 1),
    worldProject(-90, 18, 1),
    worldProject(-84, 11, 0),
    worldProject(-79, 8, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(-52, 74, 2),
    worldProject(-42, 70, 2),
    worldProject(-39, 63, 1),
  ], "land", "arctic");
  map.paintPath([
    worldProject(-150, 69, 1),
    worldProject(-120, 65, 1),
    worldProject(-92, 62, 2),
    worldProject(-65, 58, 1),
  ], "land", "arctic");

  // South America
  map.paintPath([
    worldProject(-79, 8, 1),
    worldProject(-77, -2, 1),
    worldProject(-74, -13, 1),
    worldProject(-71, -24, 1),
    worldProject(-70, -35, 1),
    worldProject(-71, -46, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(-67, 6, 2),
    worldProject(-57, -4, 2),
    worldProject(-50, -15, 2),
    worldProject(-54, -26, 1),
    worldProject(-59, -36, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(-73, 3, 1),
    worldProject(-63, 1, 2),
    worldProject(-55, -3, 2),
    worldProject(-50, -8, 1),
  ], "land", "jungle");

  // Europe
  map.paintPath([
    worldProject(-10, 44, 1),
    worldProject(2, 47, 1),
    worldProject(16, 50, 1),
    worldProject(28, 52, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(-9, 55, 1),
    worldProject(2, 54, 1),
    worldProject(16, 55, 1),
    worldProject(28, 58, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(10, 60, 1),
    worldProject(18, 66, 1),
    worldProject(24, 70, 0),
  ], "land", "arctic");
  map.paintPoints([
    worldProject(-8, 53, 0),
    worldProject(-4, 57, 0),
    worldProject(-18, 65, 0),
  ], "land", "grassland");

  // Africa
  map.paintPath([
    worldProject(-17, 33, 1),
    worldProject(-8, 20, 2),
    worldProject(2, 8, 2),
    worldProject(10, -6, 1),
    worldProject(18, -20, 1),
    worldProject(20, -34, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(35, 31, 1),
    worldProject(40, 17, 1),
    worldProject(42, 3, 2),
    worldProject(39, -11, 1),
    worldProject(32, -24, 1),
    worldProject(28, -34, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(0, 26, 2),
    worldProject(15, 24, 2),
    worldProject(28, 20, 2),
  ], "land", "desert");
  map.paintPath([
    worldProject(12, 8, 1),
    worldProject(20, 2, 1),
    worldProject(27, -3, 1),
  ], "land", "jungle");
  map.paintPoints([
    worldProject(47, -19, 1),
    worldProject(49, -23, 0),
  ], "land", "grassland");

  // Asia, Middle East, and Indonesia
  map.paintPath([
    worldProject(32, 40, 1),
    worldProject(55, 44, 2),
    worldProject(80, 45, 2),
    worldProject(105, 42, 3),
    worldProject(125, 40, 2),
    worldProject(142, 46, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(40, 60, 2),
    worldProject(70, 61, 2),
    worldProject(100, 60, 3),
    worldProject(130, 58, 2),
    worldProject(155, 55, 1),
  ], "land", "arctic");
  map.paintPath([
    worldProject(44, 30, 1),
    worldProject(61, 29, 1),
    worldProject(78, 24, 1),
    worldProject(101, 24, 2),
    worldProject(116, 20, 2),
    worldProject(121, 14, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(45, 24, 1),
    worldProject(52, 20, 1),
    worldProject(56, 16, 1),
  ], "land", "desert");
  map.paintPath([
    worldProject(73, 22, 1),
    worldProject(79, 15, 1),
    worldProject(77, 9, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(96, 16, 1),
    worldProject(104, 11, 1),
    worldProject(109, 4, 1),
    worldProject(115, -2, 0),
    worldProject(122, -3, 0),
  ], "land", "jungle");
  map.paintPath([
    worldProject(111, 33, 1),
    worldProject(121, 30, 1),
    worldProject(131, 24, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(138, 36, 0),
    worldProject(141, 41, 0),
    worldProject(144, 44, 0),
  ], "land", "grassland");

  // Australia and New Zealand
  map.paintPath([
    worldProject(113, -22, 1),
    worldProject(124, -21, 1),
    worldProject(135, -23, 2),
    worldProject(146, -24, 1),
    worldProject(151, -30, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(116, -32, 0),
    worldProject(128, -35, 1),
    worldProject(140, -37, 1),
    worldProject(148, -39, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(123, -25, 1),
    worldProject(134, -26, 1),
    worldProject(141, -24, 1),
  ], "land", "desert");
  map.paintPoints([
    worldProject(147, -42, 0),
    worldProject(173, -39, 0),
    worldProject(171, -43, 0),
    worldProject(168, -46, 0),
  ], "land", "grassland");

  return map.finalize("Large", SCENARIO_MAP_RADIUS, WORLD_SCENARIO_SEED);
}

// Starting positions for Global Resource Rivalry
export const GLOBAL_STARTING_POSITIONS = [
  {
    nationIndex: 0,
    name: "North American Coalition",
    startTiles: projectCluster(worldProject, [[-104, 39], [-96, 41], [-88, 40]]),
    startingResources: { fruit: 4, hardwood: 1, iron: 1, oil: 0 },
  },
  {
    nationIndex: 1,
    name: "African Union",
    startTiles: projectCluster(worldProject, [[18, 9], [25, 4], [30, 0]]),
    startingResources: { fruit: 1, hardwood: 0, iron: 1, oil: 3 },
  },
  {
    nationIndex: 2,
    name: "South American Syndicate",
    startTiles: projectCluster(worldProject, [[-72, -12], [-62, -10], [-58, -22]]),
    startingResources: { fruit: 2, hardwood: 4, iron: 0, oil: 0 },
  },
  {
    nationIndex: 3,
    name: "Asian Federation",
    startTiles: projectCluster(worldProject, [[104, 35], [114, 34], [121, 24]]),
    startingResources: { fruit: 2, hardwood: 1, iron: 2, oil: 1 },
  },
];

// Oceania map - projected from the region's real-world layout
function createOceaniaMap() {
  const map = createScenarioTileBuilder();

  // Australia
  map.paintPath([
    oceaniaProject(113, -22, 2),
    oceaniaProject(123, -18, 2),
    oceaniaProject(134, -16, 3),
    oceaniaProject(145, -18, 2),
    oceaniaProject(153, -25, 1),
  ], "land", "grassland");
  map.paintPath([
    oceaniaProject(115, -32, 1),
    oceaniaProject(126, -35, 1),
    oceaniaProject(138, -36, 1),
    oceaniaProject(148, -38, 1),
  ], "land", "grassland");
  map.paintPath([
    oceaniaProject(118, -28, 1),
    oceaniaProject(120, -20, 1),
    oceaniaProject(125, -16, 1),
  ], "land", "grassland");
  map.paintPath([
    oceaniaProject(123, -25, 2),
    oceaniaProject(133, -26, 3),
    oceaniaProject(142, -24, 2),
  ], "land", "desert");
  map.paintPath([
    oceaniaProject(129, -14, 1),
    oceaniaProject(139, -15, 1),
    oceaniaProject(145, -16, 1),
  ], "land", "jungle");
  map.paintPath([
    oceaniaProject(147, -24, 1),
    oceaniaProject(151, -30, 1),
    oceaniaProject(147, -35, 1),
  ], "land", "grassland");
  map.paintPoints([
    oceaniaProject(146, -42, 0),
    oceaniaProject(147, -43, 0),
  ], "land", "grassland");

  // Near north of Australia
  map.paintPath([
    oceaniaProject(141, -1, 0),
    oceaniaProject(147, -2, 1),
    oceaniaProject(152, -1, 0),
    oceaniaProject(154, -3, 0),
  ], "land", "jungle");
  map.paintPoints([
    oceaniaProject(126, 0, 0),
    oceaniaProject(129, 1, 0),
    oceaniaProject(133, 2, 0),
    oceaniaProject(136, 1, 0),
    oceaniaProject(140, 0, 0),
  ], "land", "jungle");

  // Melanesia
  map.paintPath([
    oceaniaProject(160, -9, 0),
    oceaniaProject(163, -10, 0),
    oceaniaProject(166, -11, 0),
  ], "land", "jungle");
  map.paintPath([
    oceaniaProject(167, -16, 0),
    oceaniaProject(168, -18, 0),
  ], "land", "grassland");
  map.paintPoints([
    oceaniaProject(165, -21, 0),
    oceaniaProject(166, -22, 0),
  ], "land", "grassland");

  // New Zealand
  map.paintPath([
    oceaniaProject(174, -38, 1),
    oceaniaProject(176, -39, 1),
  ], "land", "grassland");
  map.paintPath([
    oceaniaProject(170, -43, 1),
    oceaniaProject(173, -44, 1),
    oceaniaProject(175, -45, 0),
  ], "land", "arctic");

  // Central Pacific
  map.paintPoints([
    oceaniaProject(178, -17, 0),
    oceaniaProject(-179, -16, 0),
    oceaniaProject(-178, -18, 0),
    oceaniaProject(-172, -14, 0),
    oceaniaProject(-171, -13, 0),
    oceaniaProject(-175, -21, 0),
    oceaniaProject(-173, -19, 0),
    oceaniaProject(-159, -21, 0),
  ], "land", "grassland");

  // French Polynesia and remote Pacific
  map.paintPoints([
    oceaniaProject(-149, -17, 0),
    oceaniaProject(-140, -9, 0),
    oceaniaProject(-145, -18, 0),
    oceaniaProject(-109, -27, 0),
  ], "land", "grassland");
  map.paintPoints([
    oceaniaProject(144, 15, 0),
    oceaniaProject(134, 7, 0),
    oceaniaProject(158, 7, 0),
    oceaniaProject(171, 7, 0),
    oceaniaProject(173, 1, 0),
    oceaniaProject(-157, 2, 0),
  ], "land", "grassland");

  return map.finalize("Large", SCENARIO_MAP_RADIUS, OCEANIA_SCENARIO_SEED);
}

// Starting positions for Oceania scenario
export const OCEANIA_STARTING_POSITIONS = [
  {
    nationIndex: 0,
    name: "Republic of Australia",
    startTiles: projectCluster(oceaniaProject, [[152, -27], [150, -33]]),
    startingResources: { fruit: 3, hardwood: 1, iron: 0, oil: 0 },
  },
  {
    nationIndex: 1,
    name: "Western Federation",
    startTiles: projectCluster(oceaniaProject, [[116, -31], [121, -27]]),
    startingResources: { fruit: 2, hardwood: 0, iron: 0, oil: 2 },
  },
  {
    nationIndex: 2,
    name: "New Zealand Union",
    startTiles: projectCluster(oceaniaProject, [[174, -39], [172, -42]]),
    startingResources: { fruit: 1, hardwood: 1, iron: 2, oil: 0 },
  },
  {
    nationIndex: 3,
    name: "Papua Collective",
    startTiles: projectCluster(oceaniaProject, [[145, -4], [149, -5]]),
    startingResources: { fruit: 1, hardwood: 3, iron: 0, oil: 0 },
  },
];

/**
 * Get scenario data by ID
 * @param {string} scenarioId - The scenario ID
 * @returns {object|null} - Scenario metadata or null if not found
 */
export function getScenario(scenarioId) {
  return SCENARIO_METADATA[scenarioId] || null;
}

/**
 * Get all available scenarios
 * @returns {array} - Array of scenario metadata
 */
export function getAllScenarios() {
  return Object.values(SCENARIO_METADATA);
}

/**
 * Get scenario map data
 * @param {string} scenarioId - The scenario ID
 * @returns {object|null} - Map data or null if not found
 */
export function getScenarioMap(scenarioId) {
  if (scenarioId === SCENARIOS.OCEANIA_RESOURCE_FRONTIERS) {
    return createOceaniaMap();
  }
  if (scenarioId === SCENARIOS.GLOBAL_RESOURCE_RIVALRY) {
    return createWorldMap();
  }
  return null;
}

/**
 * Get scenario objectives
 * @param {string} scenarioId - The scenario ID
 * @returns {array} - Array of objectives
 */
export function getScenarioObjectives(scenarioId) {
  if (scenarioId === SCENARIOS.OCEANIA_RESOURCE_FRONTIERS) {
    return JSON.parse(JSON.stringify(OCEANIA_OBJECTIVES)); // Deep clone
  }
  if (scenarioId === SCENARIOS.GLOBAL_RESOURCE_RIVALRY) {
    return JSON.parse(JSON.stringify(GLOBAL_OBJECTIVES)); // Deep clone
  }
  return [];
}

/**
 * Get scenario starting positions
 * @param {string} scenarioId - The scenario ID
 * @returns {array|null} - Starting positions or null if not found
 */
export function getScenarioStartingPositions(scenarioId) {
  if (scenarioId === SCENARIOS.OCEANIA_RESOURCE_FRONTIERS) {
    return OCEANIA_STARTING_POSITIONS;
  }
  if (scenarioId === SCENARIOS.GLOBAL_RESOURCE_RIVALRY) {
    return GLOBAL_STARTING_POSITIONS;
  }
  return null;
}
