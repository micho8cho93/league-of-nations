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

const SCENARIO_MAP_RADIUS = 36;
const OCEANIA_SCENARIO_RADIUS = 26;
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

  const tileBounds = () => {
    let minQ = Infinity;
    let maxQ = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;
    for (const tile of tiles.values()) {
      minQ = Math.min(minQ, tile.q);
      maxQ = Math.max(maxQ, tile.q);
      minR = Math.min(minR, tile.r);
      maxR = Math.max(maxR, tile.r);
    }
    if (!Number.isFinite(minQ)) {
      return {
        minQ: 0,
        maxQ: 0,
        minR: 0,
        maxR: 0,
      };
    }
    return { minQ, maxQ, minR, maxR };
  };

  const finalize = (size, radius, seed, options = {}) => {
    const padding = Math.max(0, Math.round(options.waterPadding ?? 0));
    const bounds = tileBounds();
    const minQ = bounds.minQ - padding;
    const maxQ = bounds.maxQ + padding;
    const minR = bounds.minR - padding;
    const maxR = bounds.maxR + padding;

    for (let q = minQ; q <= maxQ; q += 1) {
      for (let r = minR; r <= maxR; r += 1) {
        if (!tiles.has(tileId(q, r))) setTile(q, r, "water", "water", TILE_TYPES.WATER);
      }
    }
    const list = [...tiles.values()];
    const effectiveRadius = list.reduce(
      (max, tile) => Math.max(max, Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r)),
      0,
    );
    return {
      size,
      radius: Math.max(radius, effectiveRadius),
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
      centerLon: 175,
      centerLat: -22,
      scaleX: 0.50,
      scaleY: 0.50,
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

  // Australia
  map.paintPath([
    worldProject(114, -22, 1),
    worldProject(124, -18, 1),
    worldProject(134, -14, 2),
    worldProject(143, -16, 2),
    worldProject(150, -22, 1),
    worldProject(153, -28, 1),
    worldProject(151, -34, 1),
  ], "land", "grassland");
  map.paintPath([
    worldProject(116, -32, 0),
    worldProject(126, -34, 1),
    worldProject(135, -34, 1),
    worldProject(140, -37, 1),
    worldProject(146, -38, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(124, -25, 1),
    worldProject(133, -26, 2),
    worldProject(141, -25, 1),
  ], "land", "desert");
  map.paintPath([
    worldProject(131, -14, 1),
    worldProject(141, -16, 1),
  ], "land", "jungle");
  // Tasmania
  map.paintPoints([
    worldProject(146, -41, 0),
    worldProject(147, -42, 0),
  ], "land", "grassland");

  // New Zealand - North Island
  map.paintPath([
    worldProject(173, -35, 0),
    worldProject(175, -38, 1),
    worldProject(177, -40, 0),
  ], "land", "grassland");
  // New Zealand - South Island
  map.paintPath([
    worldProject(169, -42, 0),
    worldProject(171, -44, 1),
    worldProject(173, -45, 0),
  ], "land", "grassland");

  // New Guinea
  map.paintPath([
    worldProject(133, -3, 1),
    worldProject(140, -5, 1),
    worldProject(146, -7, 1),
    worldProject(150, -10, 0),
  ], "land", "jungle");
  // Indonesian archipelago
  map.paintPath([
    worldProject(95, 4, 0),
    worldProject(99, 1, 1),
    worldProject(102, -3, 1),
    worldProject(106, -6, 1),
  ], "land", "jungle"); // Sumatra
  map.paintPath([
    worldProject(106, -6, 1),
    worldProject(112, -7, 1),
    worldProject(114, -8, 0),
  ], "land", "jungle"); // Java
  map.paintPath([
    worldProject(110, 1, 1),
    worldProject(114, -1, 1),
    worldProject(117, -3, 1),
  ], "land", "jungle"); // Borneo
  map.paintPoints([
    worldProject(120, -2, 0),
    worldProject(122, -4, 0),
    worldProject(125, -2, 0),
    worldProject(128, 0, 0),
    worldProject(125, -8, 0),
    worldProject(128, -9, 0),
  ], "land", "jungle"); // Sulawesi, Halmahera, Timor, lesser Sundas
  // Philippines
  map.paintPath([
    worldProject(121, 18, 0),
    worldProject(122, 14, 1),
    worldProject(124, 11, 0),
    worldProject(125, 7, 0),
  ], "land", "jungle");

  // Japan
  map.paintPath([
    worldProject(131, 32, 0),
    worldProject(135, 35, 1),
    worldProject(140, 37, 1),
    worldProject(142, 41, 0),
    worldProject(144, 44, 0),
  ], "land", "grassland");

  // British Isles
  map.paintPath([
    worldProject(-3, 51, 0),
    worldProject(-2, 55, 1),
    worldProject(-4, 58, 0),
  ], "land", "grassland");
  map.paintPath([
    worldProject(-9, 52, 0),
    worldProject(-7, 55, 0),
  ], "land", "grassland");
  // Iceland
  map.paintPoints([
    worldProject(-19, 65, 0),
    worldProject(-17, 65, 0),
  ], "land", "arctic");
  // Mediterranean islands
  map.paintPoints([
    worldProject(9, 40, 0),
    worldProject(15, 38, 0),
    worldProject(25, 35, 0),
  ], "land", "grassland");
  // Madagascar
  map.paintPath([
    worldProject(46, -16, 0),
    worldProject(47, -20, 1),
    worldProject(49, -24, 0),
  ], "land", "grassland");
  // Sri Lanka
  map.paintPoints([
    worldProject(81, 7, 0),
  ], "land", "jungle");
  // Caribbean
  map.paintPath([
    worldProject(-83, 22, 0),
    worldProject(-78, 21, 1),
    worldProject(-72, 20, 0),
  ], "land", "grassland");
  map.paintPoints([
    worldProject(-71, 19, 0),
    worldProject(-66, 18, 0),
    worldProject(-77, 18, 0),
  ], "land", "jungle");
  // Hawaiian Islands
  map.paintPoints([
    worldProject(-160, 22, 0),
    worldProject(-156, 20, 0),
  ], "land", "jungle");
  // Pacific island chains - Melanesia, Polynesia, Micronesia
  map.paintPoints([
    worldProject(160, -9, 0),
    worldProject(165, -11, 0),
    worldProject(168, -17, 0),
    worldProject(166, -22, 0),
    worldProject(178, -17, 0),
    worldProject(-172, -14, 0),
    worldProject(-175, -21, 0),
    worldProject(-149, -17, 0),
    worldProject(170, 7, 0),
    worldProject(158, 7, 0),
    worldProject(173, 1, 0),
  ], "land", "grassland");

  // Antarctica - thick polar block (multiple latitude bands)
  map.paintPath([
    worldProject(-150, -64, 1),
    worldProject(-120, -67, 2),
    worldProject(-90, -69, 2),
    worldProject(-50, -70, 2),
    worldProject(-10, -69, 2),
    worldProject(30, -67, 2),
    worldProject(70, -66, 2),
    worldProject(110, -65, 2),
    worldProject(145, -66, 1),
  ], "land", "arctic");
  map.paintPath([
    worldProject(-110, -73, 2),
    worldProject(-70, -75, 2),
    worldProject(-30, -75, 2),
    worldProject(10, -74, 2),
    worldProject(50, -73, 2),
    worldProject(90, -72, 2),
    worldProject(125, -71, 1),
  ], "land", "arctic");
  map.paintPath([
    worldProject(-70, -80, 1),
    worldProject(-30, -81, 2),
    worldProject(10, -81, 2),
    worldProject(50, -79, 1),
  ], "land", "arctic");
  map.paintPoints([
    worldProject(-20, -85, 0),
    worldProject(0, -86, 0),
    worldProject(20, -85, 0),
  ], "land", "arctic");

  return map.finalize("Large", SCENARIO_MAP_RADIUS, WORLD_SCENARIO_SEED, {
    waterPadding: 4,
  });
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

  // Australia - main body (north coast through east to south)
  map.paintPath([
    oceaniaProject(114, -22, 2),
    oceaniaProject(122, -18, 2),
    oceaniaProject(130, -13, 2),
    oceaniaProject(138, -14, 2),
    oceaniaProject(145, -16, 2),
    oceaniaProject(150, -22, 2),
    oceaniaProject(153, -28, 2),
    oceaniaProject(151, -34, 1),
  ], "land", "grassland");
  // Southern coast
  map.paintPath([
    oceaniaProject(115, -32, 1),
    oceaniaProject(122, -34, 1),
    oceaniaProject(130, -32, 1),
    oceaniaProject(138, -36, 1),
    oceaniaProject(145, -38, 1),
    oceaniaProject(149, -38, 1),
  ], "land", "grassland");
  // West coast filler
  map.paintPath([
    oceaniaProject(116, -28, 1),
    oceaniaProject(115, -22, 1),
    oceaniaProject(118, -18, 1),
  ], "land", "grassland");
  // Outback desert core
  map.paintPath([
    oceaniaProject(124, -25, 2),
    oceaniaProject(132, -26, 3),
    oceaniaProject(140, -25, 2),
    oceaniaProject(144, -28, 1),
  ], "land", "desert");
  // Northern tropics
  map.paintPath([
    oceaniaProject(130, -14, 1),
    oceaniaProject(136, -14, 1),
    oceaniaProject(143, -16, 1),
  ], "land", "jungle");
  // Tasmania
  map.paintPath([
    oceaniaProject(145, -41, 0),
    oceaniaProject(147, -42, 1),
    oceaniaProject(148, -43, 0),
  ], "land", "grassland");

  // New Guinea - large island
  map.paintPath([
    oceaniaProject(132, -3, 1),
    oceaniaProject(138, -5, 2),
    oceaniaProject(143, -6, 2),
    oceaniaProject(148, -7, 2),
    oceaniaProject(151, -10, 1),
  ], "land", "jungle");
  // Indonesian eastern islands (Halmahera, Sulawesi tips, Timor)
  map.paintPoints([
    oceaniaProject(128, 1, 0),
    oceaniaProject(126, -3, 0),
    oceaniaProject(124, -2, 0),
    oceaniaProject(120, -2, 0),
    oceaniaProject(125, -8, 0),
    oceaniaProject(128, -9, 0),
  ], "land", "jungle");

  // Solomon Islands
  map.paintPath([
    oceaniaProject(157, -8, 0),
    oceaniaProject(160, -9, 1),
    oceaniaProject(163, -10, 0),
    oceaniaProject(166, -11, 0),
  ], "land", "jungle");
  // Vanuatu
  map.paintPoints([
    oceaniaProject(167, -15, 0),
    oceaniaProject(168, -17, 0),
    oceaniaProject(169, -19, 0),
  ], "land", "jungle");
  // New Caledonia
  map.paintPath([
    oceaniaProject(164, -21, 0),
    oceaniaProject(167, -22, 1),
  ], "land", "grassland");
  // Fiji
  map.paintPoints([
    oceaniaProject(178, -17, 0),
    oceaniaProject(179, -18, 0),
    oceaniaProject(-179, -17, 0),
  ], "land", "jungle");
  // Samoa, Tonga, Cook
  map.paintPoints([
    oceaniaProject(-172, -14, 0),
    oceaniaProject(-170, -14, 0),
    oceaniaProject(-175, -21, 0),
    oceaniaProject(-174, -19, 0),
    oceaniaProject(-160, -21, 0),
    oceaniaProject(-158, -22, 0),
  ], "land", "grassland");
  // French Polynesia (Society, Tuamotu)
  map.paintPoints([
    oceaniaProject(-149, -17, 0),
    oceaniaProject(-145, -18, 0),
    oceaniaProject(-141, -17, 0),
  ], "land", "grassland");
  // Micronesia (Marshall, Caroline, Kiribati)
  map.paintPoints([
    oceaniaProject(165, 7, 0),
    oceaniaProject(170, 7, 0),
    oceaniaProject(173, 6, 0),
    oceaniaProject(172, 1, 0),
    oceaniaProject(176, 1, 0),
    oceaniaProject(-173, 0, 0),
  ], "land", "grassland");
  // Hawaiian Islands
  map.paintPath([
    oceaniaProject(-160, 22, 0),
    oceaniaProject(-156, 20, 1),
    oceaniaProject(-155, 19, 0),
  ], "land", "jungle");

  // New Zealand - North Island
  map.paintPath([
    oceaniaProject(173, -35, 1),
    oceaniaProject(175, -37, 2),
    oceaniaProject(177, -39, 1),
    oceaniaProject(178, -41, 1),
  ], "land", "grassland");
  // New Zealand - South Island
  map.paintPath([
    oceaniaProject(168, -42, 1),
    oceaniaProject(170, -43, 2),
    oceaniaProject(172, -44, 2),
    oceaniaProject(174, -46, 1),
  ], "land", "grassland");

  // Antarctica - thick block across the bottom (Pacific-facing sector)
  // Northernmost coastal band
  map.paintPath([
    oceaniaProject(132, -65, 2),
    oceaniaProject(145, -66, 2),
    oceaniaProject(160, -67, 2),
    oceaniaProject(175, -68, 2),
    oceaniaProject(-170, -72, 2),
    oceaniaProject(-150, -74, 2),
    oceaniaProject(-130, -73, 2),
    oceaniaProject(-110, -73, 2),
  ], "land", "arctic");
  // Middle band
  map.paintPath([
    oceaniaProject(135, -71, 2),
    oceaniaProject(150, -72, 2),
    oceaniaProject(170, -74, 2),
    oceaniaProject(-170, -77, 2),
    oceaniaProject(-145, -79, 2),
    oceaniaProject(-115, -78, 2),
  ], "land", "arctic");
  // Deep interior band
  map.paintPath([
    oceaniaProject(140, -77, 2),
    oceaniaProject(160, -79, 2),
    oceaniaProject(180, -82, 2),
    oceaniaProject(-160, -83, 2),
    oceaniaProject(-130, -82, 2),
  ], "land", "arctic");
  // Inner core for thickness
  map.paintPath([
    oceaniaProject(150, -82, 1),
    oceaniaProject(170, -85, 1),
    oceaniaProject(-160, -86, 1),
  ], "land", "arctic");

  return map.finalize("Large", OCEANIA_SCENARIO_RADIUS, OCEANIA_SCENARIO_SEED, {
    waterPadding: 3,
  });
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
