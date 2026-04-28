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

  // Fill surrounding water
  const waterTiles = [
    // Perimeter water tiles form the surrounding sea
    [-12, -12], [-12, -8], [-12, -4], [-12, 0], [-12, 4], [-12, 8], [-12, 12],
    [-8, -12], [-8, 12],
    [-4, -12], [-4, 12],
    [0, -12], [0, 12],
    [4, -12], [4, 12],
    [8, -12], [8, 12],
    [12, -12], [12, -8], [12, -4], [12, 0], [12, 4], [12, 8], [12, 12],
  ];
  for (const [q, r] of waterTiles) {
    addTile(q, r, "water", "water", TILE_TYPES.WATER);
  }

  // AUSTRALIA (large continent) - ~28 tiles
  // Western Australia - desert/grassland
  const australiaWest = [
    [-6, 3], [-5, 2], [-5, 3], [-5, 4], [-4, 2], [-4, 3], [-4, 4], [-3, 3],
  ];
  for (const [q, r] of australiaWest) {
    addTile(q, r, "land", "desert");
  }

  // Central Australia - desert (oil resource)
  const australiaCentral = [
    [-3, 2], [-2, 2], [-2, 3], [-2, 4], [-1, 3], [-1, 4],
  ];
  for (const [q, r] of australiaCentral) {
    addTile(q, r, "land", "desert");
  }

  // Northern Territory - grassland
  const australiaNorhtern = [
    [-3, 1], [-2, 1], [-1, 1], [-1, 2],
  ];
  for (const [q, r] of australiaNorhtern) {
    addTile(q, r, "land", "grassland");
  }

  // Eastern Australia - grassland/jungle
  const australiaEastGrass = [
    [1, 2], [2, 2], [2, 3], [3, 2], [3, 3], [3, 4],
  ];
  for (const [q, r] of australiaEastGrass) {
    addTile(q, r, "land", "grassland");
  }

  // Queensland coast - jungle
  const australiaEastJungle = [
    [1, 1], [2, 1], [3, 1],
  ];
  for (const [q, r] of australiaEastJungle) {
    addTile(q, r, "land", "jungle");
  }

  // Tasmania - grassland
  const tasmania = [
    [2, 5], [2, 6], [3, 5],
  ];
  for (const [q, r] of tasmania) {
    addTile(q, r, "land", "grassland");
  }

  // PAPUA NEW GUINEA (northeast) - ~10 tiles
  const pngJungle = [
    [1, -3], [2, -3], [3, -3], [2, -4], [3, -4], [4, -3],
  ];
  for (const [q, r] of pngJungle) {
    addTile(q, r, "land", "jungle");
  }

  const pngGrassland = [
    [1, -2], [2, -2], [4, -4], [5, -3],
  ];
  for (const [q, r] of pngGrassland) {
    addTile(q, r, "land", "grassland");
  }

  // NEW ZEALAND - two islands
  // North Island (larger) - grassland/forest
  const nzNorthIsland = [
    [-2, 6], [-1, 5], [-1, 6], [0, 5], [0, 6],
  ];
  for (const [q, r] of nzNorthIsland) {
    addTile(q, r, "land", "grassland");
  }

  // South Island (smaller) - arctic/mountain
  const nzSouthIsland = [
    [-2, 7], [-1, 7], [0, 7],
  ];
  for (const [q, r] of nzSouthIsland) {
    addTile(q, r, "land", "arctic");
  }

  // PACIFIC ISLANDS (scattered east/northeast)
  // Fiji region
  const fiji = [
    [6, 0], [6, 1], [7, 1],
  ];
  for (const [q, r] of fiji) {
    addTile(q, r, "land", "grassland");
  }

  // Samoa/Tonga region
  const samoa = [
    [8, 0], [8, 1],
  ];
  for (const [q, r] of samoa) {
    addTile(q, r, "land", "grassland");
  }

  // Solomon Islands
  const solomonIslands = [
    [5, -1], [5, 0], [6, -1],
  ];
  for (const [q, r] of solomonIslands) {
    addTile(q, r, "land", "jungle");
  }

  // Vanuatu
  const vanuatu = [
    [5, 2], [6, 2],
  ];
  for (const [q, r] of vanuatu) {
    addTile(q, r, "land", "grassland");
  }

  // Fill remaining map with water
  for (let q = -12; q <= 12; q++) {
    for (let r = -12; r <= 12; r++) {
      if (tiles.find((tile) => tile.q === q && tile.r === r)) continue;
      addTile(q, r, "water", "water", TILE_TYPES.WATER);
    }
  }

  return {
    size: "Small",
    radius: 12,
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
    startTiles: [[2, 2], [3, 2]], // Eastern Australia grassland
    startingResources: { fruit: 3, hardwood: 1, iron: 0, oil: 0 },
  },
  {
    nationIndex: 1, // Bot 1
    name: "Western Federation",
    startTiles: [[-5, 3], [-4, 3]], // Western Australia desert
    startingResources: { fruit: 2, hardwood: 0, iron: 0, oil: 2 },
  },
  {
    nationIndex: 2, // Bot 2
    name: "New Zealand Union",
    startTiles: [[-1, 6], [0, 6]], // New Zealand North Island
    startingResources: { fruit: 1, hardwood: 1, iron: 2, oil: 0 },
  },
  {
    nationIndex: 3, // Bot 3
    name: "Papua Collective",
    startTiles: [[2, -3], [3, -3]], // Papua New Guinea jungle
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
