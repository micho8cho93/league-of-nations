import { TILE_TYPES, tileId } from "./utils.js";
import { GAME_MODES } from "./balance.js";

// Scenario definitions
export const SCENARIOS = Object.freeze({
  OCEANIA_RESOURCE_FRONTIERS: "oceania-resource-frontiers",
});

// Scenario metadata
export const SCENARIO_METADATA = Object.freeze({
  [SCENARIOS.OCEANIA_RESOURCE_FRONTIERS]: {
    id: "oceania-resource-frontiers",
    name: "Oceania Resource Frontiers",
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

// Handcrafted Oceania map - geographically accurate layout
function createOceaniaMap() {
  const tiles = [];

  // Helper function to add a tile
  const addTile = (q, r, terrain, biome, type = TILE_TYPES.EMPTY) => {
    tiles.push({
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

  // ============================================
  // AUSTRALIA (~140 tiles) - central landmass
  // ============================================

  // Western Australia - desert and grassland
  const australiaWest = [
    // Far west - desert
    [-10, 2], [-10, 3], [-10, 4], [-9, 1], [-9, 2], [-9, 3], [-9, 4], [-9, 5],
    [-8, 1], [-8, 2], [-8, 3], [-8, 4], [-8, 5], [-7, 0], [-7, 1], [-7, 2],
    [-7, 3], [-7, 4], [-7, 5],
    // Mid-west - desert/grassland transition
    [-6, 0], [-6, 1], [-6, 2], [-6, 3], [-6, 4], [-5, 0], [-5, 1], [-5, 2],
    [-5, 3], [-5, 4], [-5, 5], [-4, 0], [-4, 1], [-4, 2], [-4, 3], [-4, 4],
  ];
  for (const [q, r] of australiaWest) {
    addTile(q, r, "land", "desert");
  }

  // Central Australia - desert interior
  const australiaCentral = [
    [-4, 5], [-3, 0], [-3, 1], [-3, 2], [-3, 3], [-3, 4], [-3, 5], [-2, 0],
    [-2, 1], [-2, 2], [-2, 3], [-2, 4], [-2, 5], [-1, 0], [-1, 1], [-1, 2],
    [-1, 3], [-1, 4], [-1, 5],
  ];
  for (const [q, r] of australiaCentral) {
    addTile(q, r, "land", "desert");
  }

  // Northern Territory - grassland/jungle
  const australiaNorthern = [
    [-7, -1], [-6, -2], [-6, -1], [-5, -2], [-5, -1], [-4, -2], [-4, -1],
    [-3, -2], [-3, -1], [-2, -2], [-2, -1], [-1, -2], [-1, -1], [0, -2],
    [0, -1], [1, -2], [1, -1],
  ];
  for (const [q, r] of australiaNorthern) {
    addTile(q, r, "land", "grassland");
  }

  // Northeast tropical region - jungle/grassland
  const australiaNortheast = [
    [1, -3], [2, -3], [2, -2], [3, -3], [3, -2], [4, -3], [4, -2], [4, -1],
  ];
  for (const [q, r] of australiaNortheast) {
    addTile(q, r, "land", "jungle");
  }

  // Eastern Australia - mixed grassland/jungle (Queensland, NSW, Victoria)
  const australiaEast = [
    [0, 0], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2],
    [4, 0], [4, 1], [4, 2], [5, 0], [5, 1], [5, 2], [5, 3],
  ];
  for (const [q, r] of australiaEast) {
    addTile(q, r, "land", "grassland");
  }

  // Southern Australia - grassland (South Australia, Victoria coast)
  const australiaSouth = [
    [-5, 6], [-4, 6], [-3, 6], [-2, 6], [-1, 6], [0, 6], [1, 6], [2, 6],
    [3, 6], [3, 5], [4, 5], [5, 4], [5, 5],
  ];
  for (const [q, r] of australiaSouth) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // TASMANIA (~8 tiles) - south of Australia
  // ============================================
  const tasmania = [
    [3, 7], [4, 7], [4, 8], [5, 8],
  ];
  for (const [q, r] of tasmania) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // PAPUA NEW GUINEA (~32 tiles) - north of Australia
  // ============================================

  // PNG central - jungle core
  const pngCore = [
    [0, -4], [1, -4], [2, -4], [2, -5], [3, -4], [3, -5], [4, -4], [4, -5],
    [5, -4], [5, -5],
  ];
  for (const [q, r] of pngCore) {
    addTile(q, r, "land", "jungle");
  }

  // PNG northern extension - grassland
  const pngNorth = [
    [0, -5], [0, -6], [1, -5], [1, -6], [2, -6], [3, -6], [4, -6],
  ];
  for (const [q, r] of pngNorth) {
    addTile(q, r, "land", "grassland");
  }

  // PNG eastern peninsula - mixed
  const pngEast = [
    [6, -4], [6, -3], [6, -2], [7, -4], [7, -3],
  ];
  for (const [q, r] of pngEast) {
    addTile(q, r, "land", "jungle");
  }

  // ============================================
  // INDONESIA EDGE (~12 tiles) - northwest fragments
  // ============================================
  const indonesiaEdge = [
    [-12, -2], [-12, -1], [-11, -2], [-11, -1], [-10, -2], [-10, -1],
    [-9, -2], [-9, -1], [-8, 0], [-7, 6], [-6, 6],
  ];
  for (const [q, r] of indonesiaEdge) {
    addTile(q, r, "land", "jungle");
  }

  // ============================================
  // NEW ZEALAND (~52 tiles) - southeast of Australia
  // ============================================

  // North Island - grassland/forest
  const nzNorth = [
    [2, 9], [3, 8], [3, 9], [3, 10], [4, 9], [4, 10],
    [5, 9], [5, 10], [6, 9], [6, 10],
  ];
  for (const [q, r] of nzNorth) {
    addTile(q, r, "land", "grassland");
  }

  // North Island - inner jungle
  const nzNorthJungle = [
    [4, 11], [5, 11], [6, 11],
  ];
  for (const [q, r] of nzNorthJungle) {
    addTile(q, r, "land", "jungle");
  }

  // South Island - arctic/mountain (iron resource)
  const nzSouth = [
    [2, 11], [2, 12], [3, 11], [3, 12], [3, 13], [4, 12], [4, 13],
    [5, 12], [5, 13], [6, 12], [6, 13],
  ];
  for (const [q, r] of nzSouth) {
    addTile(q, r, "land", "arctic");
  }

  // ============================================
  // SOLOMON ISLANDS (~8 tiles) - northeast scattered
  // ============================================
  const solomonIslands = [
    [9, -5], [10, -5], [10, -4], [11, -5], [11, -4], [11, -3],
  ];
  for (const [q, r] of solomonIslands) {
    addTile(q, r, "land", "jungle");
  }

  // ============================================
  // VANUATU (~5 tiles) - east of Solomon Islands
  // ============================================
  const vanuatu = [
    [12, -1], [12, 0], [13, 0], [13, 1],
  ];
  for (const [q, r] of vanuatu) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // NEW CALEDONIA (~8 tiles) - south of Vanuatu
  // ============================================
  const newCaledonia = [
    [11, 3], [12, 2], [12, 3], [12, 4], [13, 2], [13, 3], [13, 4],
  ];
  for (const [q, r] of newCaledonia) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // FIJI (~6 tiles) - central Pacific
  // ============================================
  const fiji = [
    [14, 0], [15, 0], [15, 1], [16, 1],
  ];
  for (const [q, r] of fiji) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // SAMOA / AMERICAN SAMOA (~4 tiles) - east of Fiji
  // ============================================
  const samoa = [
    [18, -1], [18, 0], [19, 0],
  ];
  for (const [q, r] of samoa) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // TONGA (~5 tiles) - south of Samoa
  // ============================================
  const tonga = [
    [17, 3], [18, 3], [18, 4], [19, 4],
  ];
  for (const [q, r] of tonga) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // FRENCH POLYNESIA (~18 tiles) - scattered far east
  // ============================================

  // Society Islands cluster
  const polynesiaSociety = [
    [22, -3], [23, -3], [23, -2], [24, -2],
  ];
  for (const [q, r] of polynesiaSociety) {
    addTile(q, r, "land", "grassland");
  }

  // Marquesas Islands cluster
  const polynesiaMarquesas = [
    [24, 1], [25, 1], [25, 2],
  ];
  for (const [q, r] of polynesiaMarquesas) {
    addTile(q, r, "land", "jungle");
  }

  // Tuamotu Archipelago cluster (scattered)
  const polynesiaTuamotu = [
    [22, 4], [23, 5], [24, 6], [25, 5],
  ];
  for (const [q, r] of polynesiaTuamotu) {
    addTile(q, r, "land", "grassland");
  }

  // Cook Islands
  const polynesiaCooki = [
    [20, 5], [21, 5],
  ];
  for (const [q, r] of polynesiaCooki) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // MICRONESIA (~18 tiles) - far north/northeast scattered
  // ============================================

  // Guam/Mariana Islands
  const micronesiaMariana = [
    [16, -8], [17, -8], [17, -7],
  ];
  for (const [q, r] of micronesiaMariana) {
    addTile(q, r, "land", "jungle");
  }

  // Palau
  const micronesiaPalau = [
    [14, -6], [14, -5], [15, -6],
  ];
  for (const [q, r] of micronesiaPalau) {
    addTile(q, r, "land", "grassland");
  }

  // Chuuk/Truk Islands
  const micronesiaFarEast = [
    [20, -6], [21, -6], [21, -5], [22, -5],
  ];
  for (const [q, r] of micronesiaFarEast) {
    addTile(q, r, "land", "grassland");
  }

  // Marshall Islands scattered
  const micronesiaMarshall = [
    [18, -6], [19, -6], [19, -5], [20, -4],
  ];
  for (const [q, r] of micronesiaMarshall) {
    addTile(q, r, "land", "grassland");
  }

  // Kiribati - scattered micro islands
  const micronesiaKiribati = [
    [22, 7], [23, 7], [24, 8],
  ];
  for (const [q, r] of micronesiaKiribati) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // FILL REMAINING MAP WITH WATER
  // ============================================
  for (let q = -28; q <= 28; q++) {
    for (let r = -28; r <= 28; r++) {
      // Skip if tile already exists
      if (tiles.find((tile) => tile.q === q && tile.r === r)) continue;
      // Add water tile
      addTile(q, r, "water", "water", TILE_TYPES.WATER);
    }
  }

  return {
    size: "Large",
    radius: 28,
    seed: 12345, // Fixed seed for consistency
    landRatio: tiles.filter((t) => t.terrain === "land").length / tiles.length,
    tiles,
  };
}

// Starting positions for Oceania scenario
export const OCEANIA_STARTING_POSITIONS = [
  {
    nationIndex: 0, // Player
    name: "Republic of Australia",
    startTiles: [[2, 1], [3, 1]], // Eastern Australia grassland (Queensland)
    startingResources: { fruit: 3, hardwood: 1, iron: 0, oil: 0 },
  },
  {
    nationIndex: 1, // Bot 1
    name: "Western Federation",
    startTiles: [[-8, 3], [-7, 3]], // Western Australia desert
    startingResources: { fruit: 2, hardwood: 0, iron: 0, oil: 2 },
  },
  {
    nationIndex: 2, // Bot 2
    name: "New Zealand Union",
    startTiles: [[4, 10], [5, 10]], // New Zealand North Island
    startingResources: { fruit: 1, hardwood: 1, iron: 2, oil: 0 },
  },
  {
    nationIndex: 3, // Bot 3
    name: "Papua Collective",
    startTiles: [[2, -4], [3, -4]], // Papua New Guinea jungle
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
  return null;
}
