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
    description:
      "A geographically inspired Oceania scenario where players compete to secure fruit, hardwood, iron, and oil across Australia, New Zealand, Papua New Guinea, and nearby Pacific islands.",
    mode: GAME_MODES.ADVANCED,
    maxPlayers: 4,
    minPlayers: 1,
    singlePlayerOnly: true,
    geographicNote:
      "This scenario uses a simplified Oceania map inspired by Australia, New Zealand, Papua New Guinea, and nearby Pacific islands.",
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

// Handcrafted Oceania map - simplified geographic layout
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
    [-10, -10], [-10, -5], [-10, 0], [-10, 5], [-10, 10],
    [-5, -10], [-5, 10],
    [0, -10], [0, 10],
    [5, -10], [5, 10],
    [10, -10], [10, -5], [10, 0], [10, 5], [10, 10],
  ];
  for (const [q, r] of waterTiles) {
    addTile(q, r, "water", "water", TILE_TYPES.WATER);
  }

  // AUSTRALIA region (eastern, western, central)
  // Grassland (eastern Australia) - fruit
  const australiaEastGrassland = [
    [1, 2], [2, 2], [3, 2], [2, 3], [3, 3], [4, 2],
  ];
  for (const [q, r] of australiaEastGrassland) {
    addTile(q, r, "land", "grassland");
  }

  // Jungle (eastern Australia coast)
  const australiaJungle = [
    [2, 1], [3, 1], [4, 1],
  ];
  for (const [q, r] of australiaJungle) {
    addTile(q, r, "land", "jungle");
  }

  // Desert (central/western Australia) - oil
  const australiaDesert = [
    [-2, 2], [-1, 2], [0, 2], [-3, 2], [-2, 3], [-1, 3], [0, 3],
  ];
  for (const [q, r] of australiaDesert) {
    addTile(q, r, "land", "desert");
  }

  // Grassland (western Australia)
  const australiaWestGrassland = [
    [-4, 2], [-4, 3], [-3, 3],
  ];
  for (const [q, r] of australiaWestGrassland) {
    addTile(q, r, "land", "grassland");
  }

  // Tasmania (south of Australia) - mixed
  const tasmania = [
    [2, 5], [1, 5], [1, 6],
  ];
  for (const [q, r] of tasmania) {
    addTile(q, r, "land", "grassland");
  }

  // PAPUA NEW GUINEA region (north, mostly jungle)
  const pngJungle = [
    [2, -4], [3, -4], [2, -3], [3, -3], [1, -4], [4, -3],
  ];
  for (const [q, r] of pngJungle) {
    addTile(q, r, "land", "jungle");
  }

  // PNG sparse grassland
  const pngGrassland = [
    [4, -4], [3, -5],
  ];
  for (const [q, r] of pngGrassland) {
    addTile(q, r, "land", "grassland");
  }

  // NEW ZEALAND region (south, arctic/iron)
  const nzArctic = [
    [-1, 6], [-2, 6], [-1, 7], [-2, 7], [-3, 6],
  ];
  for (const [q, r] of nzArctic) {
    addTile(q, r, "land", "arctic");
  }

  // NZ grassland (north island)
  const nzGrassland = [
    [-1, 5], [-2, 5],
  ];
  for (const [q, r] of nzGrassland) {
    addTile(q, r, "land", "grassland");
  }

  // FIJI / PACIFIC ISLANDS (east of Oceania)
  const fijiGrassland = [
    [6, 0], [6, 1], [7, 0],
  ];
  for (const [q, r] of fijiGrassland) {
    addTile(q, r, "land", "grassland");
  }

  const fijiJungle = [
    [7, 1], [8, 0],
  ];
  for (const [q, r] of fijiJungle) {
    addTile(q, r, "land", "jungle");
  }

  // Fill remaining map with water
  for (let q = -10; q <= 10; q++) {
    for (let r = -10; r <= 10; r++) {
      if (tiles.find((tile) => tile.q === q && tile.r === r)) continue;
      addTile(q, r, "water", "water", TILE_TYPES.WATER);
    }
  }

  return {
    size: "Small",
    radius: 10,
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
    startTiles: [[2, 2], [3, 2]], // Eastern Australia
    startingResources: { fruit: 3, hardwood: 1, iron: 0, oil: 0 },
  },
  {
    nationIndex: 1, // Bot 1
    name: "Western Federation",
    startTiles: [[-3, 2], [-2, 2]], // Western Australia
    startingResources: { fruit: 2, hardwood: 0, iron: 0, oil: 2 },
  },
  {
    nationIndex: 2, // Bot 2
    name: "New Zealand Union",
    startTiles: [[-1, 6], [-2, 6]], // New Zealand
    startingResources: { fruit: 1, hardwood: 1, iron: 2, oil: 0 },
  },
  {
    nationIndex: 3, // Bot 3
    name: "Papua Collective",
    startTiles: [[2, -4], [3, -4]], // Papua New Guinea
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
