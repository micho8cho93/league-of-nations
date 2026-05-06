import { TILE_TYPES, tileId } from "./utils.js";
import { GAME_MODES } from "./balance.js";

// Scenario definitions
export const SCENARIOS = Object.freeze({
  OCEANIA_RESOURCE_FRONTIERS: "oceania-resource-frontiers",
  GLOBAL_RESOURCE_RIVALRY: "global-resource-rivalry",
  WW2_GLOBAL: "ww2_global",
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
  [SCENARIOS.WW2_GLOBAL]: {
    id: "ww2_global",
    name: "World War II – Global Conflict",
    subtitle: "Industrial warfare, alliances, and global conquest",
    description: "A focused 1939 theater scenario across Europe, North Africa, the Middle East, East Asia, and the Pacific.",
    mode: GAME_MODES.ADVANCED,
    maxPlayers: 7,
    minPlayers: 1,
    singlePlayerOnly: true,
    difficulty: "Hard",
    estimatedLength: "60 turns (~60-90 min)",
    objectiveSummary: "Axis: capture Allied capitals or dominate world territory. Allies: defeat Axis capitals or survive until the turn limit.",
    introTitle: "Europe, August 31, 1939",
    introBody: "The world stands on the brink. Germany is poised at Poland's border, Italy and Japan hold expansionist positions, and the United Kingdom and France prepare to honor their guarantees. Neutral states are labeled and locked; the scenario begins in Era 3 so war can start immediately.",
    startingEra: 3,
    turnLimit: 60,
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

// =====================================================================
// World War II – Global Conflict
// Modular scenario data: objectives, faction definitions, starting
// alliances, rule overrides, and event hooks. The map uses a dedicated
// theater projection so Europe and the Pacific get more playable detail
// than the generic full-world scenario map.
// =====================================================================

const WW2_THEATER_SCENARIO_RADIUS = 44;
const WW2_THEATER_SCENARIO_SEED = 19390831;
const WW2_NEUTRAL_COLOR = "#8f928d";

function ww2Project(lon, lat, brush = 0) {
  return {
    ...projectToAxial(lon, lat, {
      centerLon: 52,
      centerLat: 18,
      scaleX: 0.32,
      scaleY: 0.62,
    }),
    brush,
  };
}

function projectAreas(project, areas = []) {
  return areas.map(([lon, lat, brush = 1]) => project(lon, lat, brush));
}

function createWW2TheaterMap() {
  const map = createScenarioTileBuilder();

  // North America. The continental USA is fully present and playable;
  // Canada, Mexico, and Central America are painted as locked theater edges.
  map.paintPath([
    ww2Project(-141, 62, 1),
    ww2Project(-128, 58, 2),
    ww2Project(-112, 56, 3),
    ww2Project(-96, 55, 3),
    ww2Project(-80, 54, 2),
    ww2Project(-63, 49, 1),
  ], "land", "arctic");
  map.paintPath([
    ww2Project(-134, 52, 1),
    ww2Project(-120, 49, 2),
    ww2Project(-106, 48, 2),
    ww2Project(-92, 48, 2),
    ww2Project(-78, 47, 1),
    ww2Project(-66, 45, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-124, 49, 1),
    ww2Project(-112, 45, 2),
    ww2Project(-98, 41, 2),
    ww2Project(-86, 39, 2),
    ww2Project(-75, 41, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-122, 36, 1),
    ww2Project(-110, 34, 2),
    ww2Project(-96, 32, 2),
    ww2Project(-82, 31, 1),
    ww2Project(-77, 36, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-117, 32, 1),
    ww2Project(-110, 29, 1),
    ww2Project(-103, 25, 1),
    ww2Project(-97, 22, 1),
    ww2Project(-90, 18, 1),
    ww2Project(-84, 14, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-82, 22, 0),
    ww2Project(-77, 21, 1),
    ww2Project(-72, 20, 0),
  ], "land", "jungle");
  map.paintPath([
    ww2Project(-54, 73, 2),
    ww2Project(-45, 70, 2),
    ww2Project(-40, 64, 1),
  ], "land", "arctic");
  map.paintPath([
    ww2Project(-160, 22, 0),
    ww2Project(-156, 20, 0),
  ], "land", "jungle");

  // South America is visible but locked out of play.
  map.paintPath([
    ww2Project(-79, 9, 1),
    ww2Project(-76, 1, 1),
    ww2Project(-73, -9, 1),
    ww2Project(-70, -20, 1),
    ww2Project(-70, -32, 1),
    ww2Project(-72, -45, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-67, 6, 2),
    ww2Project(-58, -3, 2),
    ww2Project(-50, -12, 2),
    ww2Project(-53, -24, 1),
    ww2Project(-59, -36, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-73, 3, 1),
    ww2Project(-63, 0, 2),
    ww2Project(-55, -4, 2),
    ww2Project(-49, -8, 1),
  ], "land", "jungle");

  // Europe.
  map.paintPath([
    ww2Project(-10, 44, 1),
    ww2Project(-4, 47, 2),
    ww2Project(4, 49, 2),
    ww2Project(13, 51, 2),
    ww2Project(23, 52, 2),
    ww2Project(32, 54, 2),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-9, 55, 1),
    ww2Project(0, 54, 1),
    ww2Project(10, 55, 1),
    ww2Project(20, 57, 1),
    ww2Project(31, 60, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-9, 42, 2),
    ww2Project(-4, 40, 2),
    ww2Project(0, 40, 1),
    ww2Project(3, 42, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(9, 45, 1),
    ww2Project(12, 43, 1),
    ww2Project(14, 40, 1),
    ww2Project(16, 38, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(15, 45, 1),
    ww2Project(21, 44, 2),
    ww2Project(26, 42, 2),
    ww2Project(30, 39, 1),
  ], "land", "grassland");
  map.paintPoints([
    ww2Project(4, 51, 0),
    ww2Project(19, 47, 0),
    ww2Project(25, 43, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(6, 58, 1),
    ww2Project(12, 62, 2),
    ww2Project(18, 66, 2),
    ww2Project(24, 69, 1),
  ], "land", "arctic");
  map.paintPath([
    ww2Project(-5, 51, 1),
    ww2Project(-2, 55, 1),
    ww2Project(-4, 58, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(-10, 52, 0),
    ww2Project(-8, 54, 0),
  ], "land", "grassland");
  map.paintPoints([
    ww2Project(9, 40, 0),
    ww2Project(14, 37, 0),
    ww2Project(25, 35, 0),
  ], "land", "grassland");

  // North Africa, East Africa, and the Middle East.
  map.paintPath([
    ww2Project(-10, 34, 1),
    ww2Project(0, 33, 2),
    ww2Project(12, 31, 2),
    ww2Project(24, 30, 2),
    ww2Project(35, 31, 1),
  ], "land", "desert");
  map.paintPath([
    ww2Project(-8, 25, 2),
    ww2Project(8, 23, 2),
    ww2Project(22, 20, 2),
    ww2Project(35, 18, 1),
  ], "land", "desert");
  map.paintPath([
    ww2Project(29, 31, 1),
    ww2Project(35, 25, 1),
    ww2Project(40, 18, 1),
    ww2Project(43, 10, 1),
    ww2Project(40, 1, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(34, 32, 1),
    ww2Project(43, 34, 1),
    ww2Project(51, 32, 1),
    ww2Project(58, 28, 1),
  ], "land", "desert");
  map.paintPath([
    ww2Project(45, 24, 1),
    ww2Project(53, 22, 2),
    ww2Project(58, 18, 1),
  ], "land", "desert");
  map.paintPath([
    ww2Project(-17, 15, 1),
    ww2Project(-8, 8, 2),
    ww2Project(4, 2, 2),
    ww2Project(14, -6, 2),
    ww2Project(20, -18, 1),
    ww2Project(20, -34, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(28, 8, 2),
    ww2Project(35, 0, 2),
    ww2Project(39, -10, 2),
    ww2Project(34, -22, 1),
    ww2Project(28, -34, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(10, 5, 1),
    ww2Project(18, 0, 2),
    ww2Project(26, -4, 1),
  ], "land", "jungle");
  map.paintPath([
    ww2Project(46, -16, 0),
    ww2Project(48, -21, 1),
    ww2Project(49, -25, 0),
  ], "land", "grassland");

  // USSR, Central Asia, India, China, Southeast Asia.
  map.paintPath([
    ww2Project(33, 55, 2),
    ww2Project(52, 56, 3),
    ww2Project(75, 56, 3),
    ww2Project(100, 55, 3),
    ww2Project(125, 53, 2),
    ww2Project(145, 50, 1),
  ], "land", "arctic");
  map.paintPath([
    ww2Project(40, 45, 2),
    ww2Project(58, 45, 2),
    ww2Project(78, 43, 2),
    ww2Project(98, 41, 3),
    ww2Project(118, 39, 2),
    ww2Project(132, 42, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(61, 34, 1),
    ww2Project(72, 30, 1),
    ww2Project(84, 27, 1),
    ww2Project(98, 28, 2),
    ww2Project(112, 30, 2),
    ww2Project(123, 32, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(72, 22, 1),
    ww2Project(78, 16, 1),
    ww2Project(78, 9, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(96, 18, 1),
    ww2Project(103, 13, 1),
    ww2Project(108, 8, 1),
    ww2Project(106, 2, 1),
    ww2Project(112, -2, 0),
  ], "land", "jungle");
  map.paintPath([
    ww2Project(110, 35, 1),
    ww2Project(119, 32, 1),
    ww2Project(126, 27, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(126, 39, 1),
    ww2Project(131, 42, 1),
    ww2Project(138, 45, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(138, 35, 0),
    ww2Project(141, 39, 1),
    ww2Project(143, 43, 0),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(121, 18, 0),
    ww2Project(122, 14, 1),
    ww2Project(124, 10, 0),
  ], "land", "jungle");
  map.paintPoints([
    ww2Project(114, 22, 0),
    ww2Project(121, 24, 0),
    ww2Project(122, 7, 0),
  ], "land", "jungle");

  // Indonesia, Oceania, and Pacific islands.
  map.paintPath([
    ww2Project(96, 4, 0),
    ww2Project(101, 0, 1),
    ww2Project(106, -5, 1),
    ww2Project(113, -7, 0),
  ], "land", "jungle");
  map.paintPath([
    ww2Project(110, 1, 1),
    ww2Project(115, -2, 1),
    ww2Project(121, -3, 0),
  ], "land", "jungle");
  map.paintPath([
    ww2Project(134, -3, 1),
    ww2Project(142, -5, 1),
    ww2Project(150, -8, 1),
  ], "land", "jungle");
  map.paintPath([
    ww2Project(114, -23, 1),
    ww2Project(124, -18, 2),
    ww2Project(134, -16, 2),
    ww2Project(145, -20, 2),
    ww2Project(151, -31, 1),
  ], "land", "grassland");
  map.paintPath([
    ww2Project(116, -32, 0),
    ww2Project(129, -34, 1),
    ww2Project(142, -37, 1),
  ], "land", "desert");
  map.paintPath([
    ww2Project(170, -42, 0),
    ww2Project(174, -45, 1),
    ww2Project(178, -39, 0),
  ], "land", "grassland");
  map.paintPoints([
    ww2Project(144, 13, 0),
    ww2Project(145, 15, 0),
    ww2Project(156, 7, 0),
    ww2Project(167, 7, 0),
    ww2Project(160, -9, 0),
    ww2Project(178, -17, 0),
  ], "land", "grassland");

  // Antarctica is a disabled reference continent.
  map.paintPath([
    ww2Project(-150, -64, 1),
    ww2Project(-110, -68, 2),
    ww2Project(-70, -70, 2),
    ww2Project(-30, -70, 2),
    ww2Project(10, -69, 2),
    ww2Project(50, -67, 2),
    ww2Project(90, -66, 2),
    ww2Project(130, -66, 1),
  ], "land", "arctic");
  map.paintPath([
    ww2Project(-120, -74, 1),
    ww2Project(-70, -76, 2),
    ww2Project(-20, -76, 2),
    ww2Project(30, -74, 2),
    ww2Project(80, -72, 1),
  ], "land", "arctic");

  return map.finalize("Large", WW2_THEATER_SCENARIO_RADIUS, WW2_THEATER_SCENARIO_SEED, {
    waterPadding: 4,
  });
}

export const WW2_OBJECTIVES = Object.freeze([
  {
    id: "ww2-capitals",
    title: "Strike at Capitals",
    description: "Capture enemy capital tiles to break their war effort.",
    type: "capitals",
    target: 3,
    progress: 0,
    completed: false,
  },
  {
    id: "ww2-industrial",
    title: "Industrial Mobilization",
    description: "Construct 3 factories to fuel the war machine.",
    type: "factories",
    target: 3,
    progress: 0,
    completed: false,
  },
  {
    id: "ww2-oil",
    title: "Secure Oil",
    description: "Control desert tiles to keep mechanized forces fueled.",
    type: "terrain",
    terrain: "desert",
    target: 4,
    progress: 0,
    completed: false,
  },
  {
    id: "ww2-territory",
    title: "Project Power",
    description: "Hold 25 tiles across multiple continents.",
    type: "territory",
    target: 25,
    progress: 0,
    completed: false,
  },
]);

// Faction definitions. nationIndex 0 is the human player by convention
// (matches existing scenario starting-position pattern). Capital coords
// are lat/lon; runtime resolves to nearest existing land tile.
export const WW2_FACTIONS = Object.freeze([
  {
    nationIndex: 0,
    factionId: "germany",
    name: "Germany",
    bloc: "axis",
    color: "#4b4f54",
    capital: { lon: 13, lat: 52 },         // Berlin
    startTiles: [[13, 52], [10, 51], [11, 49], [13, 49], [15, 51], [16, 50], [20, 54]],
    controlAreas: [[13, 52, 2], [10, 51, 1], [16, 50, 1], [20, 54, 0]],
    industrialSites: [[13, 52], [8, 51], [12, 49]],
    militarySites: [[16, 52], [19, 52]],
    startingResources: { fruit: 8, hardwood: 12, iron: 14, oil: 5, food: 110, materials: 130, education: 70, industry: 35 },
    startingTech: { farming: 2, mining: 3, education: 2, infrastructure: 2, military: 3, branches: { tanks: 1, air: 1, naval: 0 } },
    startingPopulation: 58,
    startingUnitStrength: 9,
    personality: "aggressive",
    note: "Strong land forces, industrial heartland.",
  },
  {
    nationIndex: 1,
    factionId: "italy",
    name: "Italy",
    bloc: "axis",
    color: "#6b7f43",
    capital: { lon: 12, lat: 44 },         // Rome (nearest painted Mediterranean tile)
    startTiles: [[12, 44], [15, 38], [18, 41], [13, 32], [39, 9]],
    controlAreas: [[12, 44, 1], [15, 38, 0], [18, 41, 0], [13, 32, 2], [39, 9, 1]],
    industrialSites: [[12, 44], [9, 45]],
    militarySites: [[15, 38], [13, 32]],
    startingResources: { fruit: 7, hardwood: 8, iron: 9, oil: 5, food: 95, materials: 95, education: 48, industry: 18 },
    startingTech: { farming: 2, mining: 2, education: 2, infrastructure: 2, military: 2, branches: { tanks: 0, air: 1, naval: 1 } },
    startingPopulation: 44,
    startingUnitStrength: 6,
    personality: "aggressive",
    note: "Mediterranean foothold for the Axis.",
  },
  {
    nationIndex: 2,
    factionId: "japan",
    name: "Japan",
    bloc: "axis",
    color: "#b8463a",
    capital: { lon: 140, lat: 36 },        // Tokyo
    startTiles: [[140, 37], [135, 35], [142, 41], [127, 38], [121, 24], [122, 7], [129, 43]],
    controlAreas: [[140, 37, 1], [142, 41, 0], [127, 38, 1], [121, 24, 0], [122, 7, 0], [129, 43, 1]],
    industrialSites: [[140, 37], [135, 35], [127, 38]],
    militarySites: [[140, 37], [121, 24], [129, 43]],
    startingResources: { fruit: 5, hardwood: 9, iron: 12, oil: 3, food: 105, materials: 120, education: 70, industry: 28 },
    startingTech: { farming: 2, mining: 3, education: 2, infrastructure: 2, military: 3, branches: { tanks: 0, air: 1, naval: 2 } },
    startingPopulation: 56,
    startingUnitStrength: 8,
    personality: "aggressive",
    note: "Naval/expansion advantage; oil-poor — must conquer to fuel.",
  },
  {
    nationIndex: 3,
    factionId: "uk",
    name: "United Kingdom",
    bloc: "allies",
    color: "#2f6fb2",
    capital: { lon: -1, lat: 52 },         // London
    startTiles: [[-1, 52], [-4, 56], [31, 30], [35, 32], [77, 22], [103, 2], [115, 4], [145, -25], [174, -42], [114, 22]],
    controlAreas: [[-1, 52, 1], [31, 30, 1], [35, 32, 0], [77, 22, 2], [103, 2, 1], [115, 4, 1], [145, -25, 2], [174, -42, 1], [114, 22, 0], [144, 13, 0]],
    industrialSites: [[-1, 52], [-3, 55], [77, 22], [145, -25]],
    militarySites: [[-1, 52], [31, 30], [103, 2], [144, 13]],
    startingResources: { fruit: 12, hardwood: 14, iron: 14, oil: 10, food: 150, materials: 135, education: 80, industry: 32 },
    startingTech: { farming: 2, mining: 3, education: 2, infrastructure: 2, military: 3, branches: { tanks: 0, air: 1, naval: 2 } },
    startingPopulation: 60,
    startingUnitStrength: 7,
    personality: "balanced",
    note: "Naval/trade strength, global colonies.",
  },
  {
    nationIndex: 4,
    factionId: "france",
    name: "France",
    bloc: "allies",
    color: "#4b8ad8",
    capital: { lon: 2, lat: 47 },          // Paris
    startTiles: [[2, 47], [-3, 47], [5, 45], [-6, 34], [3, 32], [106, 16]],
    controlAreas: [[2, 47, 2], [-3, 47, 1], [5, 45, 1], [-6, 34, 1], [3, 32, 2], [106, 16, 1]],
    industrialSites: [[2, 47], [5, 45]],
    militarySites: [[2, 47], [7, 49], [3, 32]],
    startingResources: { fruit: 10, hardwood: 11, iron: 12, oil: 7, food: 130, materials: 115, education: 68, industry: 25 },
    startingTech: { farming: 2, mining: 3, education: 2, infrastructure: 2, military: 2, branches: { tanks: 1, air: 0, naval: 1 } },
    startingPopulation: 52,
    startingUnitStrength: 7,
    personality: "balanced",
    note: "Continental Allied power.",
  },
  {
    nationIndex: 5,
    factionId: "ussr",
    name: "Soviet Union",
    bloc: "comintern", // structurally neutral; conditional Allies via events
    color: "#9e2f2f",
    capital: { lon: 40, lat: 60 },         // Moscow (on painted arctic band)
    startTiles: [[40, 56], [55, 44], [70, 56], [90, 55], [32, 54], [58, 28]],
    controlAreas: [[40, 56, 3], [55, 44, 2], [70, 56, 3], [90, 55, 3], [110, 53, 2], [32, 54, 1], [58, 28, 1]],
    industrialSites: [[40, 56], [55, 44], [75, 55]],
    militarySites: [[32, 54], [55, 44], [70, 56]],
    startingResources: { fruit: 11, hardwood: 15, iron: 16, oil: 13, food: 160, materials: 140, education: 58, industry: 28 },
    startingTech: { farming: 2, mining: 3, education: 2, infrastructure: 2, military: 2, branches: { tanks: 1, air: 0, naval: 0 } },
    startingPopulation: 70,
    startingUnitStrength: 8,
    personality: "balanced",
    note: "Vast manpower and territory; slower early mobility.",
  },
  {
    nationIndex: 6,
    factionId: "usa",
    name: "United States",
    bloc: "neutral", // joins Allies via Pearl Harbor event (stubbed)
    color: "#3d7fba",
    capital: { lon: -77, lat: 39 },        // Washington, D.C.
    startTiles: [[-150, 64], [-124, 48], [-122, 37], [-118, 34], [-112, 45], [-105, 39], [-96, 38], [-90, 44], [-86, 39], [-82, 31], [-77, 39], [-75, 41], [-156, 20], [121, 14], [144, 13]],
    controlAreas: [[-150, 64, 1], [-124, 48, 2], [-122, 37, 2], [-118, 34, 2], [-112, 45, 3], [-105, 39, 3], [-96, 38, 3], [-90, 44, 2], [-86, 39, 2], [-82, 31, 2], [-77, 39, 2], [-75, 41, 2], [-156, 20, 0], [121, 14, 1], [144, 13, 0]],
    finalControlAreas: [[-150, 64, 1], [-124, 48, 2], [-122, 37, 2], [-118, 34, 2], [-112, 45, 3], [-105, 39, 3], [-96, 38, 3], [-90, 44, 2], [-86, 39, 2], [-82, 31, 2], [-77, 39, 2], [-75, 41, 2], [-156, 20, 0], [121, 14, 1], [144, 13, 0]],
    industrialSites: [[-77, 39], [-96, 38], [-122, 37]],
    militarySites: [[-77, 39], [-156, 20], [121, 14]],
    startingResources: { fruit: 14, hardwood: 16, iron: 18, oil: 18, food: 180, materials: 160, education: 90, industry: 45 },
    startingTech: { farming: 2, mining: 3, education: 3, infrastructure: 2, military: 2, branches: { tanks: 0, air: 1, naval: 2 } },
    startingPopulation: 74,
    startingUnitStrength: 6,
    personality: "economic",
    note: "Industrial powerhouse; ramps up via Lend-Lease and entry events.",
  },
]);

export const WW2_NEUTRAL_NATIONS = Object.freeze([
  { id: "ww2-neutral-canada", factionId: "canada", name: "Canada", capital: { lon: -75, lat: 45 }, controlAreas: [[-134, 52, 1], [-120, 51, 1], [-105, 51, 2], [-90, 51, 2], [-75, 48, 1], [-63, 49, 1], [-45, 70, 2]] },
  { id: "ww2-neutral-mexico-central-america", factionId: "mexico_central_america", name: "Mexico and Central America", capital: { lon: -99, lat: 20 }, controlAreas: [[-110, 29, 1], [-102, 24, 1], [-97, 21, 1], [-90, 18, 1], [-84, 14, 0], [-78, 21, 1]] },
  { id: "ww2-neutral-south-america", factionId: "south_america", name: "South America", capital: { lon: -58, lat: -15 }, controlAreas: [[-79, 9, 1], [-73, -8, 1], [-70, -24, 1], [-71, -43, 0], [-63, 0, 2], [-55, -10, 2], [-53, -25, 1], [-59, -36, 1]] },
  { id: "ww2-neutral-poland", factionId: "poland", name: "Poland", capital: { lon: 21, lat: 52 }, controlAreas: [[19, 52, 1], [23, 52, 2], [21, 50, 1]] },
  { id: "ww2-neutral-belgium", factionId: "belgium", name: "Belgium", capital: { lon: 2, lat: 49 }, controlAreas: [[2, 49, 0]] },
  { id: "ww2-neutral-netherlands", factionId: "netherlands", name: "Netherlands", capital: { lon: 5, lat: 52 }, controlAreas: [[5, 52, 0]] },
  { id: "ww2-neutral-luxembourg", factionId: "luxembourg", name: "Luxembourg", capital: { lon: 6, lat: 50 }, controlAreas: [[6, 50, 0]] },
  { id: "ww2-neutral-denmark", factionId: "denmark", name: "Denmark", capital: { lon: 10, lat: 56 }, controlAreas: [[10, 56, 0]] },
  { id: "ww2-neutral-norway", factionId: "norway", name: "Norway", capital: { lon: 10, lat: 60 }, controlAreas: [[8, 60, 1], [13, 64, 1], [18, 68, 0]] },
  { id: "ww2-neutral-sweden", factionId: "sweden", name: "Sweden", capital: { lon: 16, lat: 61 }, controlAreas: [[16, 61, 1], [20, 65, 1]] },
  { id: "ww2-neutral-finland", factionId: "finland", name: "Finland", capital: { lon: 25, lat: 62 }, controlAreas: [[25, 62, 1], [28, 66, 1]] },
  { id: "ww2-neutral-switzerland", factionId: "switzerland", name: "Switzerland", capital: { lon: 8, lat: 47 }, controlAreas: [[8, 47, 0]] },
  { id: "ww2-neutral-spain", factionId: "spain", name: "Spain", capital: { lon: -4, lat: 40 }, controlAreas: [[-4, 40, 2], [-8, 43, 1]] },
  { id: "ww2-neutral-portugal", factionId: "portugal", name: "Portugal", capital: { lon: -8, lat: 40 }, controlAreas: [[-8, 40, 0]] },
  { id: "ww2-neutral-ireland", factionId: "ireland", name: "Ireland", capital: { lon: -8, lat: 53 }, controlAreas: [[-8, 53, 0]] },
  { id: "ww2-neutral-yugoslavia", factionId: "yugoslavia", name: "Yugoslavia", capital: { lon: 20, lat: 44 }, controlAreas: [[20, 44, 1], [18, 43, 0]] },
  { id: "ww2-neutral-greece", factionId: "greece", name: "Greece", capital: { lon: 23, lat: 39 }, controlAreas: [[23, 39, 1], [25, 35, 0]] },
  { id: "ww2-neutral-romania", factionId: "romania", name: "Romania", capital: { lon: 25, lat: 45 }, controlAreas: [[25, 45, 1]] },
  { id: "ww2-neutral-hungary", factionId: "hungary", name: "Hungary", capital: { lon: 19, lat: 47 }, controlAreas: [[19, 47, 0]] },
  { id: "ww2-neutral-bulgaria", factionId: "bulgaria", name: "Bulgaria", capital: { lon: 25, lat: 43 }, controlAreas: [[25, 43, 0]] },
  { id: "ww2-neutral-turkey", factionId: "turkey", name: "Turkey", capital: { lon: 35, lat: 39 }, controlAreas: [[35, 39, 1], [42, 39, 0]] },
  { id: "ww2-neutral-iran", factionId: "iran", name: "Iran", capital: { lon: 53, lat: 32 }, controlAreas: [[53, 32, 2], [58, 28, 1]] },
  { id: "ww2-neutral-afghanistan", factionId: "afghanistan", name: "Afghanistan", capital: { lon: 66, lat: 34 }, controlAreas: [[66, 34, 1]] },
  { id: "ww2-neutral-saudi", factionId: "saudi_arabia", name: "Saudi Arabia", capital: { lon: 45, lat: 24 }, controlAreas: [[45, 24, 2], [52, 21, 1]] },
  { id: "ww2-neutral-sub-saharan-africa", factionId: "sub_saharan_africa", name: "Sub-Saharan Africa", capital: { lon: 18, lat: -8 }, controlAreas: [[-8, 8, 2], [4, 2, 2], [14, -6, 2], [20, -18, 1], [20, -34, 0], [28, 8, 2], [35, 0, 2], [39, -10, 2], [34, -22, 1], [28, -34, 0], [18, 0, 2], [48, -21, 1]] },
  { id: "ww2-neutral-thailand", factionId: "thailand", name: "Thailand", capital: { lon: 101, lat: 14 }, controlAreas: [[101, 14, 1]] },
  { id: "ww2-neutral-china", factionId: "china", name: "China", capital: { lon: 105, lat: 31 }, controlAreas: [[105, 31, 2], [112, 30, 1], [100, 28, 1]] },
  { id: "ww2-neutral-indonesia", factionId: "dutch_east_indies", name: "Dutch East Indies", capital: { lon: 106, lat: -6 }, controlAreas: [[101, 0, 1], [106, -5, 1], [115, -2, 1]] },
  { id: "ww2-neutral-antarctica", factionId: "antarctica", name: "Antarctica", capital: { lon: 10, lat: -74 }, controlAreas: [[-120, -68, 2], [-70, -70, 2], [-30, -70, 2], [10, -69, 2], [50, -67, 2], [90, -66, 2], [130, -66, 1], [-70, -76, 2], [-20, -76, 2], [30, -74, 2]] },
]);

// Starting positions in the shape the existing newGame loop expects.
// Capital is the first start tile; full coord resolution happens in game.js.
export const WW2_STARTING_POSITIONS = WW2_FACTIONS.map((faction) => ({
  nationIndex: faction.nationIndex,
  name: faction.name,
  factionId: faction.factionId,
  bloc: faction.bloc,
  color: faction.color,
  capital: faction.capital,
  startTiles: projectCluster(ww2Project, faction.startTiles),
  controlAreas: projectAreas(ww2Project, faction.controlAreas),
  finalControlAreas: projectAreas(ww2Project, faction.finalControlAreas || []),
  industrialSites: projectCluster(ww2Project, faction.industrialSites || []),
  militarySites: projectCluster(ww2Project, faction.militarySites || []),
  startingResources: { ...faction.startingResources },
  startingTech: faction.startingTech ? { ...faction.startingTech, branches: { ...(faction.startingTech.branches || {}) } } : null,
  startingPopulation: faction.startingPopulation || null,
  startingUnitStrength: faction.startingUnitStrength || 4,
  personality: faction.personality || null,
}));

export const WW2_NEUTRAL_STARTING_POSITIONS = WW2_NEUTRAL_NATIONS.map((nation) => ({
  id: nation.id,
  name: nation.name,
  factionId: nation.factionId,
  bloc: "neutral",
  color: WW2_NEUTRAL_COLOR,
  capital: nation.capital,
  startTiles: projectCluster(ww2Project, [[nation.capital.lon, nation.capital.lat]]),
  controlAreas: projectAreas(ww2Project, nation.controlAreas),
  scenarioNeutral: true,
  lockedNeutral: true,
}));

// Pre-formed alliance blocs at game start.
// Soviet Union and United States start unaligned (per spec) so events can
// promote them into the Allies later.
export const WW2_STARTING_ALLIANCES = Object.freeze([
  {
    id: "ww2-axis",
    label: "Axis Powers",
    type: "military",
    factionIds: ["germany", "italy", "japan"],
  },
  {
    id: "ww2-allies",
    label: "Allied Powers",
    type: "military",
    factionIds: ["uk", "france"],
  },
]);

// Rule overrides applied to the game when the WW2 scenario starts.
// Stored on game.settings.scenarioOverrides; consumed where applicable.
// Unused multipliers are retained as data for future systems (TODO).
export const WW2_RULE_OVERRIDES = Object.freeze({
  societyEnabled: false,          // WW2 uses political blocs only; no religion/culture layer.
  unitCostMultiplier: 1.4,        // applied in game.js training cost path
  unitUpkeepMultiplier: 1.25,     // TODO: thread into upkeep paths
  factoryProductionMultiplier: 1.5, // TODO: apply in productionForTile factory yield
  growthRateMultiplier: 0.7,      // applied to fruit-surplus population growth
  industrialRegionBonus: ["germany", "uk", "usa", "ussr", "japan"],
  oilRegionBoost: ["middle_east", "usa", "ussr", "southeast_asia"],
});

// Custom victory rules for WW2.
export const WW2_VICTORY_RULES = Object.freeze({
  axisFactions: ["germany", "italy", "japan"],
  alliedFactions: ["uk", "france", "ussr", "usa"],
  axisCapitalCaptureTarget: 3,    // any 3 of London, Moscow, Paris, Washington
  axisTerritoryThreshold: 0.6,    // 60% of all land tiles
  alliedRequiredCapitals: ["germany", "italy", "japan"], // Berlin, Rome, Tokyo
});

function ww2NationIdForFaction(game, factionId) {
  return Object.values(game?.nations || {}).find((nation) => nation?.factionId === factionId)?.id || null;
}

function ww2TileNear(game, lon, lat, radius = 3) {
  const point = ww2Project(lon, lat);
  const direct = game?.map?.tiles?.find((tile) => tile.q === point.q && tile.r === point.r && tile.terrain === "land");
  if (direct) return direct;
  let best = null;
  let bestDist = Infinity;
  for (const tile of game?.map?.tiles || []) {
    if (tile.terrain !== "land") continue;
    const dist = Math.max(
      Math.abs(tile.q - point.q),
      Math.abs(tile.r - point.r),
      Math.abs((tile.q + tile.r) - (point.q + point.r)),
    );
    if (dist <= radius && dist < bestDist) {
      best = tile;
      bestDist = dist;
    }
  }
  return best;
}

function ww2TransferAreas(game, ownerFactionId, areas) {
  const ownerId = ww2NationIdForFaction(game, ownerFactionId);
  if (!ownerId) return 0;
  let changed = 0;
  for (const [lon, lat, brush = 0] of areas) {
    const center = ww2TileNear(game, lon, lat, Math.max(4, brush + 2));
    if (!center) continue;
    for (const tile of game.map?.tiles || []) {
      if (tile.terrain !== "land") continue;
      const dist = Math.max(
        Math.abs(tile.q - center.q),
        Math.abs(tile.r - center.r),
        Math.abs((tile.q + tile.r) - (center.q + center.r)),
      );
      if (dist > brush) continue;
      if (tile.ownerId === ownerId) continue;
      tile.ownerId = ownerId;
      changed += 1;
    }
  }
  if (changed) game.recomputeTerritories?.();
  return changed;
}

function ww2ActivateMajorWar(game, attackerFactionId, defenderFactionId, reason) {
  const attackerId = ww2NationIdForFaction(game, attackerFactionId);
  const defenderId = ww2NationIdForFaction(game, defenderFactionId);
  if (!attackerId || !defenderId) return false;
  const attacker = game.nations?.[attackerId];
  const defender = game.nations?.[defenderId];
  if (!attacker?.active || !defender?.active) return false;
  const key = [attackerId, defenderId].sort().join("|");
  if (!game.wars?.[key]?.active) {
    game.wars[key] = {
      key,
      attackerId,
      defenderId,
      reason,
      active: true,
      startedTurn: game.turn,
      battles: 0,
      scenario: true,
    };
  }
  game.establishDiplomaticContact?.(attackerId, defenderId);
  const diplomacy = game.diplomacy?.[key] || null;
  if (diplomacy) {
    diplomacy.atWar = true;
    diplomacy.wars = (diplomacy.wars || 0) + 1;
    diplomacy.relation = Math.min(diplomacy.relation || 0, 8);
  }
  return true;
}

function ww2AddFactionToAlliance(game, allianceId, factionId) {
  const nationId = ww2NationIdForFaction(game, factionId);
  const alliance = game?.alliances?.find((item) => item.id === allianceId && item.active);
  if (!nationId || !alliance) return false;
  if (!alliance.members.includes(nationId)) alliance.members.push(nationId);
  const nation = game.nations?.[nationId];
  if (nation) nation.bloc = "allies";
  return true;
}

// Historical event data. Active events are executed by the offline
// scenario round loop and guarded so they only fire once.
export const WW2_EVENTS = Object.freeze([
  {
    id: "germany_invades_poland",
    label: "Germany Invades Poland",
    description: "The Wehrmacht crosses the Polish border. War begins.",
    triggerTurn: 1,
    active: true,
    apply(game) {
      const captured = ww2TransferAreas(game, "germany", [[18, 52, 0], [20, 51, 0]]);
      game.addEvent?.(`Germany invades Poland; ${captured || "border"} tiles fall under German control.`, { type: "scenario" });
    },
  },
  {
    id: "poland_campaign_continues",
    label: "Polish Campaign Continues",
    description: "German forces push toward Warsaw while Poland remains locked as scripted scenario territory.",
    triggerTurn: 2,
    active: true,
    apply(game) {
      const captured = ww2TransferAreas(game, "germany", [[21, 52, 0], [23, 51, 0]]);
      game.addEvent?.(`German forces continue the Polish campaign; ${captured || "additional"} Polish tiles are contested.`, { type: "scenario" });
    },
  },
  {
    id: "fall_of_france",
    label: "Fall of France",
    description: "If France's capital falls, Allied morale is shaken.",
    triggerTurn: null, // condition-based; TODO: hook capture detection
    active: false,
    apply() { /* TODO: implement when capital-capture events exist. */ },
  },
  {
    id: "operation_barbarossa",
    label: "Operation Barbarossa",
    description: "Germany turns east. The USSR is drawn into the war.",
    triggerTurn: 12,
    active: true,
    apply(game) {
      const ussr = game.nations?.[ww2NationIdForFaction(game, "ussr")];
      if (!ussr || ussr.bloc === "allies") return;
      if (ww2ActivateMajorWar(game, "germany", "ussr", "Operation Barbarossa")) {
        ww2AddFactionToAlliance(game, "ww2-allies", "ussr");
        game.addEvent?.("Operation Barbarossa begins; the Soviet Union joins the Allied war effort.", { type: "scenario" });
      }
    },
  },
  {
    id: "pearl_harbor",
    label: "Pearl Harbor",
    description: "Japan strikes the U.S. Pacific Fleet.",
    triggerTurn: 18,
    active: true,
    apply(game) {
      const usa = game.nations?.[ww2NationIdForFaction(game, "usa")];
      if (!usa || usa.bloc === "allies") return;
      if (ww2ActivateMajorWar(game, "japan", "usa", "Pearl Harbor")) {
        ww2AddFactionToAlliance(game, "ww2-allies", "usa");
        game.addEvent?.("Pearl Harbor brings the United States into the Allied war effort.", { type: "scenario" });
      }
    },
  },
  {
    id: "us_enters_war",
    label: "United States Enters the War",
    description: "American industry mobilizes for global conflict.",
    triggerTurn: 19,
    active: true,
    apply(game) {
      const usa = game.nations?.[ww2NationIdForFaction(game, "usa")];
      if (!usa || usa.bloc !== "allies") return;
      usa.resources.industry = (usa.resources.industry || 0) + 35;
      usa.resources.materials = (usa.resources.materials || 0) + 60;
      game.addEvent?.("United States industry mobilizes for global conflict.", { type: "scenario" });
    },
  },
  {
    id: "d_day",
    label: "D-Day",
    description: "Allied forces land in Normandy.",
    triggerTurn: 40,
    active: false,
    apply() { /* TODO: spawn Allied unit on French coast if Axis-held. */ },
  },
]);

/**
 * Evaluate WW2-specific victory conditions.
 * Called from victory.js before the generic turn-limit fallback.
 * @returns {object|null} { winnerFactionId, label, reason } or null.
 */
export function evaluateWW2Victory(game) {
  const factionByNationId = nationToFactionMap(game);
  if (!factionByNationId) return null;

  const axisIds = nationIdsForBloc(factionByNationId, WW2_VICTORY_RULES.axisFactions);
  const alliedIds = nationIdsForBloc(factionByNationId, WW2_VICTORY_RULES.alliedFactions);
  const alliedKeyCapitalFactionIds = WW2_VICTORY_RULES.alliedFactions; // any of these capitals counts
  const axisKeyCapitalFactionIds = WW2_VICTORY_RULES.alliedRequiredCapitals; // {germany,italy,japan} for Allies

  // --- Axis victory: capture N Allied capitals OR control >X% of land ---
  // "Captured" = capital tile is currently owned by an Axis nation.
  const alliedCapitalCount = countCapitalsHeldByAttackers(
    game,
    factionByNationId,
    alliedKeyCapitalFactionIds,
    axisIds,
  );
  if (alliedCapitalCount >= WW2_VICTORY_RULES.axisCapitalCaptureTarget) {
    return {
      winnerBloc: "axis",
      label: "Axis Victory — Capitals Fallen",
      reason: `The Axis captured ${alliedCapitalCount} Allied capitals.`,
    };
  }
  const axisLandShare = blocLandShare(game, axisIds);
  if (axisLandShare >= WW2_VICTORY_RULES.axisTerritoryThreshold) {
    return {
      winnerBloc: "axis",
      label: "Axis Victory — World Domination",
      reason: `Axis powers control ${(axisLandShare * 100).toFixed(0)}% of the world.`,
    };
  }

  // --- Allied victory: capture all of Berlin, Rome, Tokyo ---
  // A capital is "captured" by Allies if its current owner is NOT in the Axis bloc.
  const allAxisCapitalsTaken = axisKeyCapitalFactionIds.every((factionId) => {
    return capitalLostByDefenderBloc(game, factionByNationId, factionId, axisIds);
  });
  if (allAxisCapitalsTaken) {
    return {
      winnerBloc: "allies",
      label: "Allied Victory — Axis Capitals Liberated",
      reason: "Berlin, Rome, and Tokyo have all fallen.",
    };
  }

  // --- Allied survival victory: turn limit reached without Axis victory ---
  const maxTurns = Number(game.settings?.maxTurns) || 0;
  if (maxTurns > 0 && game.turn >= maxTurns) {
    return {
      winnerBloc: "allies",
      label: "Allied Victory — Axis Contained",
      reason: "The Allies prevented Axis victory until the turn limit.",
    };
  }

  return null;
}

function nationToFactionMap(game) {
  if (!game?.settings?.scenarioId || game.settings.scenarioId !== SCENARIOS.WW2_GLOBAL) return null;
  const map = {};
  for (const nation of Object.values(game.nations || {})) {
    if (nation?.factionId) map[nation.id] = nation.factionId;
  }
  return Object.keys(map).length ? map : null;
}

function nationIdsForBloc(factionByNationId, factionIds) {
  const set = new Set(factionIds);
  return Object.entries(factionByNationId)
    .filter(([, factionId]) => set.has(factionId))
    .map(([nationId]) => nationId);
}

function countCapitalsHeldByAttackers(game, factionByNationId, defenderFactionIds, attackerNationIds) {
  let count = 0;
  for (const factionId of defenderFactionIds) {
    if (capitalHeldByAttackers(game, factionByNationId, factionId, attackerNationIds)) count += 1;
  }
  return count;
}

function capitalHeldByAttackers(game, factionByNationId, defenderFactionId, attackerNationIds) {
  const tile = capitalTileForFaction(game, factionByNationId, defenderFactionId);
  if (!tile) return false;
  return attackerNationIds.includes(tile.ownerId);
}

// Capital is considered "lost" by the defending bloc when its current owner
// is set and is not part of the defending bloc's nation ids.
function capitalLostByDefenderBloc(game, factionByNationId, defenderFactionId, defenderBlocNationIds) {
  const tile = capitalTileForFaction(game, factionByNationId, defenderFactionId);
  if (!tile || !tile.ownerId) return false;
  return !defenderBlocNationIds.includes(tile.ownerId);
}

function capitalTileForFaction(game, factionByNationId, factionId) {
  const nationId = Object.entries(factionByNationId)
    .find(([, fId]) => fId === factionId)?.[0];
  if (!nationId) return null;
  const nation = game.nations?.[nationId];
  if (!nation?.capitalTileId) return null;
  return game.map?.tiles?.find((t) => t.id === nation.capitalTileId) || null;
}

function blocLandShare(game, blocNationIds) {
  if (!blocNationIds.length) return 0;
  const set = new Set(blocNationIds);
  let owned = 0;
  let total = 0;
  for (const tile of game.map?.tiles || []) {
    if (tile.terrain !== "land") continue;
    total += 1;
    if (set.has(tile.ownerId)) owned += 1;
  }
  return total > 0 ? owned / total : 0;
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
  if (scenarioId === SCENARIOS.WW2_GLOBAL) {
    return createWW2TheaterMap();
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
  if (scenarioId === SCENARIOS.WW2_GLOBAL) {
    return JSON.parse(JSON.stringify(WW2_OBJECTIVES));
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
  if (scenarioId === SCENARIOS.WW2_GLOBAL) {
    return WW2_STARTING_POSITIONS;
  }
  return null;
}

export function getScenarioNeutralStartingPositions(scenarioId) {
  if (scenarioId === SCENARIOS.WW2_GLOBAL) {
    return WW2_NEUTRAL_STARTING_POSITIONS;
  }
  return [];
}

/**
 * Scenario-wide rule overrides applied to game.settings.scenarioOverrides.
 * Returns null when no overrides are defined.
 */
export function getScenarioRuleOverrides(scenarioId) {
  if (scenarioId === SCENARIOS.WW2_GLOBAL) return WW2_RULE_OVERRIDES;
  return null;
}

/**
 * Pre-formed alliance blocs the scenario starts with.
 * Each entry: { id, label, type, factionIds: [...] }
 */
export function getScenarioStartingAlliances(scenarioId) {
  if (scenarioId === SCENARIOS.WW2_GLOBAL) return WW2_STARTING_ALLIANCES;
  return [];
}

/** Scenario turn limit (overrides settings.maxTurns). 0/null = no override. */
export function getScenarioTurnLimit(scenarioId) {
  if (scenarioId === SCENARIOS.WW2_GLOBAL) return SCENARIO_METADATA[SCENARIOS.WW2_GLOBAL].turnLimit;
  return null;
}

export function getScenarioStartingEra(scenarioId) {
  return SCENARIO_METADATA[scenarioId]?.startingEra || null;
}

/** Scenario event list (deep cloned to allow per-game mutation). */
export function getScenarioEvents(scenarioId) {
  if (scenarioId === SCENARIOS.WW2_GLOBAL) {
    return WW2_EVENTS.map((event) => ({ ...event, fired: false }));
  }
  return [];
}

/**
 * Run scenario victory checks. Returns null if no scenario-specific
 * victory triggered. Caller (victory.js) should fall through to generic
 * checks (turn limit etc.) when null.
 */
export function evaluateScenarioVictory(game) {
  const scenarioId = game?.settings?.scenarioId;
  if (!scenarioId) return null;
  if (scenarioId === SCENARIOS.WW2_GLOBAL) return evaluateWW2Victory(game);
  return null;
}
