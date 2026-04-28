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
  // AUSTRALIA (~180 tiles) - dominant landmass
  // ============================================

  // Western Australia - desert and grassland (Perth region)
  const australiaWest = [
    [-12, 0], [-12, 1], [-12, 2], [-12, 3], [-11, -1], [-11, 0], [-11, 1],
    [-11, 2], [-11, 3], [-11, 4], [-10, -1], [-10, 0], [-10, 1], [-10, 2],
    [-10, 3], [-10, 4], [-9, -2], [-9, -1], [-9, 0], [-9, 1], [-9, 2],
    [-9, 3], [-9, 4], [-9, 5],
  ];
  for (const [q, r] of australiaWest) {
    addTile(q, r, "land", "desert");
  }

  // South Australia - desert interior (Outback)
  const australiaCentral = [
    [-8, -2], [-8, -1], [-8, 0], [-8, 1], [-8, 2], [-8, 3], [-8, 4],
    [-7, -3], [-7, -2], [-7, -1], [-7, 0], [-7, 1], [-7, 2], [-7, 3],
    [-7, 4], [-7, 5], [-6, -3], [-6, -2], [-6, -1], [-6, 0], [-6, 1],
    [-6, 2], [-6, 3], [-6, 4], [-6, 5], [-5, -3], [-5, -2], [-5, -1],
    [-5, 0], [-5, 1], [-5, 2], [-5, 3], [-5, 4], [-5, 5], [-4, -2],
    [-4, -1], [-4, 0], [-4, 1], [-4, 2], [-4, 3], [-4, 4],
  ];
  for (const [q, r] of australiaCentral) {
    addTile(q, r, "land", "desert");
  }

  // Northern Territory - grassland/jungle (Darwin region)
  const australiaNorthern = [
    [-7, -4], [-6, -5], [-6, -4], [-5, -5], [-5, -4], [-4, -5], [-4, -4],
    [-3, -5], [-3, -4], [-2, -5], [-2, -4], [-1, -5], [-1, -4], [0, -5],
    [0, -4],
  ];
  for (const [q, r] of australiaNorthern) {
    addTile(q, r, "land", "grassland");
  }

  // Far northeast - tropical region (Cape York)
  const australiaNortheast = [
    [1, -6], [2, -6], [2, -5], [3, -6], [3, -5], [4, -6], [4, -5],
  ];
  for (const [q, r] of australiaNortheast) {
    addTile(q, r, "land", "jungle");
  }

  // Queensland coast - grassland/jungle mix
  const australiaEastCoast = [
    [1, -3], [2, -3], [2, -2], [3, -3], [3, -2], [4, -3], [4, -2],
    [5, -3], [5, -2], [5, -1], [6, -2], [6, -1],
  ];
  for (const [q, r] of australiaEastCoast) {
    addTile(q, r, "land", "grassland");
  }

  // Eastern Australia inland - grassland (NSW, Queensland)
  const australiaEastInland = [
    [-1, -3], [-1, -2], [-1, -1], [0, -3], [0, -2], [0, -1], [1, -2],
    [1, -1], [1, 0], [2, -1], [2, 0], [2, 1], [3, -1], [3, 0], [3, 1],
    [4, 0], [4, 1], [5, 0], [5, 1],
  ];
  for (const [q, r] of australiaEastInland) {
    addTile(q, r, "land", "grassland");
  }

  // Southern Australia - grassland coast (Victoria, South coast)
  const australiaSouth = [
    [-8, 5], [-7, 6], [-6, 6], [-5, 6], [-4, 5], [-3, 5], [-2, 5], [-1, 5],
    [0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 4], [6, 4], [6, 5],
  ];
  for (const [q, r] of australiaSouth) {
    addTile(q, r, "land", "grassland");
  }

  // Southeast Australia - grassland (Melbourne, Sydney region)
  const australiaSoutheast = [
    [2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [4, 4],
    [5, 2], [5, 3], [6, 3],
  ];
  for (const [q, r] of australiaSoutheast) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // TASMANIA (~6 tiles) - south of Australia
  // ============================================
  const tasmania = [
    [4, 6], [5, 6], [5, 7],
  ];
  for (const [q, r] of tasmania) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // PAPUA NEW GUINEA (~55 tiles) - north of Australia
  // ============================================

  // PNG main body - jungle core
  const pngCore = [
    [0, -7], [1, -7], [2, -7], [2, -8], [3, -7], [3, -8], [4, -7], [4, -8],
    [5, -7], [5, -8], [6, -7], [6, -8],
  ];
  for (const [q, r] of pngCore) {
    addTile(q, r, "land", "jungle");
  }

  // PNG northern coast - grassland
  const pngNorth = [
    [-1, -7], [0, -8], [0, -9], [1, -8], [1, -9], [2, -9], [3, -9], [4, -9],
    [5, -9], [6, -9],
  ];
  for (const [q, r] of pngNorth) {
    addTile(q, r, "land", "grassland");
  }

  // PNG western region - grassland
  const pngWest = [
    [-1, -6], [-1, -8], [0, -6], [7, -8], [7, -7],
  ];
  for (const [q, r] of pngWest) {
    addTile(q, r, "land", "grassland");
  }

  // PNG eastern peninsula - jungle
  const pngEast = [
    [7, -6], [8, -6], [8, -5], [9, -6], [9, -5],
  ];
  for (const [q, r] of pngEast) {
    addTile(q, r, "land", "jungle");
  }

  // ============================================
  // INDONESIA EDGE (~15 tiles) - northwest
  // ============================================
  const indonesiaEdge = [
    [-14, -3], [-14, -2], [-13, -3], [-13, -2], [-12, -4], [-12, -3],
    [-11, -5], [-11, -4], [-10, -5], [-10, -4], [-10, 5], [-9, 5], [-8, 5],
  ];
  for (const [q, r] of indonesiaEdge) {
    addTile(q, r, "land", "jungle");
  }

  // ============================================
  // NEW ZEALAND (~45 tiles) - southeast ocean
  // ============================================

  // North Island - grassland with some jungle
  const nzNorth = [
    [3, 8], [4, 7], [4, 8], [4, 9], [5, 8], [5, 9], [5, 10],
    [6, 8], [6, 9], [6, 10], [7, 9],
  ];
  for (const [q, r] of nzNorth) {
    addTile(q, r, "land", "grassland");
  }

  // North Island - volcanic interior
  const nzNorthVolcanic = [
    [5, 11], [6, 11], [7, 10],
  ];
  for (const [q, r] of nzNorthVolcanic) {
    addTile(q, r, "land", "jungle");
  }

  // South Island - arctic/mountain (iron)
  const nzSouth = [
    [3, 10], [3, 11], [3, 12], [3, 13], [4, 10], [4, 11], [4, 12],
    [4, 13], [5, 12], [5, 13], [5, 14], [6, 12], [6, 13],
  ];
  for (const [q, r] of nzSouth) {
    addTile(q, r, "land", "arctic");
  }

  // ============================================
  // SOLOMON ISLANDS (~8 tiles)
  // ============================================
  const solomonIslands = [
    [10, -6], [11, -6], [11, -5], [12, -6], [12, -5], [13, -5],
  ];
  for (const [q, r] of solomonIslands) {
    addTile(q, r, "land", "jungle");
  }

  // ============================================
  // VANUATU (~6 tiles)
  // ============================================
  const vanuatu = [
    [13, -2], [13, -1], [14, -2], [14, -1], [14, 0],
  ];
  for (const [q, r] of vanuatu) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // NEW CALEDONIA (~8 tiles)
  // ============================================
  const newCaledonia = [
    [12, 2], [13, 1], [13, 2], [13, 3], [14, 2], [14, 3], [15, 3],
  ];
  for (const [q, r] of newCaledonia) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // FIJI (~7 tiles)
  // ============================================
  const fiji = [
    [15, 0], [16, 0], [16, 1], [16, 2], [17, 1], [17, 2],
  ];
  for (const [q, r] of fiji) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // SAMOA / AMERICAN SAMOA (~5 tiles)
  // ============================================
  const samoa = [
    [20, -2], [20, -1], [21, -1], [21, 0], [22, 0],
  ];
  for (const [q, r] of samoa) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // TONGA (~6 tiles)
  // ============================================
  const tonga = [
    [19, 2], [20, 2], [20, 3], [21, 3], [21, 4],
  ];
  for (const [q, r] of tonga) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // FRENCH POLYNESIA (~20 tiles) - scattered
  // ============================================

  // Society Islands
  const polynesiaSociety = [
    [24, -4], [25, -4], [25, -3], [26, -3],
  ];
  for (const [q, r] of polynesiaSociety) {
    addTile(q, r, "land", "grassland");
  }

  // Marquesas Islands
  const polynesiaMarquesas = [
    [27, -2], [28, -2], [28, -1], [29, -1],
  ];
  for (const [q, r] of polynesiaMarquesas) {
    addTile(q, r, "land", "jungle");
  }

  // Tuamotu Archipelago
  const polynesiaTuamotu = [
    [24, 2], [25, 2], [25, 3], [26, 3], [27, 4],
  ];
  for (const [q, r] of polynesiaTuamotu) {
    addTile(q, r, "land", "grassland");
  }

  // Cook Islands
  const polynesiaCooki = [
    [22, 5], [23, 5],
  ];
  for (const [q, r] of polynesiaCooki) {
    addTile(q, r, "land", "grassland");
  }

  // Easter Island (far southeast)
  const polynesiaEaster = [
    [29, 5], [30, 5],
  ];
  for (const [q, r] of polynesiaEaster) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // MICRONESIA (~25 tiles) - scattered north/northeast
  // ============================================

  // Guam / Mariana Islands
  const micronesiaMariana = [
    [18, -9], [19, -9], [19, -8], [20, -8],
  ];
  for (const [q, r] of micronesiaMariana) {
    addTile(q, r, "land", "jungle");
  }

  // Palau
  const micronesiaPalau = [
    [16, -8], [16, -7], [17, -8],
  ];
  for (const [q, r] of micronesiaPalau) {
    addTile(q, r, "land", "grassland");
  }

  // Federated States of Micronesia (Chuuk/Pohnpei)
  const micronesiaChuuk = [
    [22, -8], [23, -8], [23, -7], [24, -7],
  ];
  for (const [q, r] of micronesiaChuuk) {
    addTile(q, r, "land", "grassland");
  }

  // Marshall Islands
  const micronesiaMarshall = [
    [20, -6], [21, -6], [21, -5], [22, -6], [23, -5],
  ];
  for (const [q, r] of micronesiaMarshall) {
    addTile(q, r, "land", "grassland");
  }

  // Kiribati - scattered Line Islands
  const micronesiaKiribati = [
    [25, 6], [26, 6], [26, 7], [27, 7],
  ];
  for (const [q, r] of micronesiaKiribati) {
    addTile(q, r, "land", "grassland");
  }

  // ============================================
  // FILL REMAINING MAP WITH WATER
  // ============================================
  for (let q = -32; q <= 32; q++) {
    for (let r = -32; r <= 32; r++) {
      // Skip if tile already exists
      if (tiles.find((tile) => tile.q === q && tile.r === r)) continue;
      // Add water tile
      addTile(q, r, "water", "water", TILE_TYPES.WATER);
    }
  }

  return {
    size: "Large",
    radius: 32,
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
