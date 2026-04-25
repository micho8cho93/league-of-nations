// Nation state, cost tables, worker rules. Phase 2.

const REGION_TYPES = {
  1: { name: "Abundant",   startTiles: 40, maxPerResource: Infinity, money: 1000, people: 40 },
  2: { name: "Moderate",   startTiles: 55, maxPerResource: 25,       money: 2000, people: 30 },
  3: { name: "Restricted", startTiles: 65, maxPerResource: 20,       money: 2500, people: 20 },
  4: { name: "Limited",    startTiles: 80, maxPerResource: 20,       money: 3500, people: 15 },
};

// Minimum workers required for a tile to be "active".
const WORKER_MIN = {
  farm: 2,
  mine: 3,
  school: 3,
  military: 4,
  factory: 5,
};

const TANK_STRENGTH = 5;
const TANK_FLEET_STRENGTH = TANK_STRENGTH * 4;

// Which population subfield a tile draws from.
const WORKER_FIELD = {
  farm: "farmers",
  mine: "miners",
  school: "scholars",
  military: "soldiers",
  factory: "scholars",
};

// Plural key on nation.tiles for a tile type.
const TILE_LIST_KEY = {
  farm: "farms",
  mine: "mines",
  school: "schools",
  military: "militaryBases",
  factory: "factories",
};

function createNation({ id, name, color, regionType }) {
  const r = REGION_TYPES[regionType];
  return {
    id,
    name,
    color,
    regionType,
    money: r.money,
    population: {
      total: r.people,
      available: r.people,
      farmers: 0,
      miners: 0,
      scholars: 0,
      soldiers: 0,
    },
    tiles: {
      farms: [],
      mines: [],
      schools: [],
      militaryBases: [],
      factories: [],
      empty: [],
    },
    technologies: {
      tractors: 0,
      excavators: 0,
      universities: 0,
      tanks: 0,
      navalShips: 0,
      tankFleets: 0,
      navalFleets: 0,
    },
    stage: STAGES.FOUNDATIONAL,
    stageUnlocks: { stage2: false, stage3: false, stage32: false, stage4: false },
    government: null,
    alliances: [],
    atWarWith: [],
    treaties: [],
    archives: [],
    awards: [],
  };
}

// Build cost by stage (1,2,3.1,3.2). Returns { money, people } — pay one or the other.
// `people` is null for tiles that cannot be paid for in people (factory).
function buildCost(stage, tileType) {
  const base = {
    farm:     { money: 100, people: 1 },
    mine:     { money: 200, people: 2 },
    school:   { money: 200, people: 2 },
    military: { money: 400, people: 4 },
    factory:  { money: 700, people: null },
  };
  if (stage >= STAGES.INDUSTRIAL_EXPANSION) {
    base.farm     = { money: 300,  people: 3 };
    base.mine     = { money: 400,  people: 4 };
    base.school   = { money: 400,  people: 4 };
    base.military = { money: 500,  people: 5 };
    base.factory  = { money: 1000, people: null };
  }
  return base[tileType];
}

function isTileActive(tile) {
  const min = WORKER_MIN[tile.type];
  if (min == null) return false;
  if ((tile.disabledTurns || 0) > 0 || (tile.floodedTurns || 0) > 0) return false;
  return (tile.workers || 0) >= min;
}

function tileFoodCapacity(tile) {
  if (!isTileActive(tile) || tile.type !== "farm") return 0;
  const baseFood = tile.hasTractor ? 40 : 10;
  return baseFood * ((tile.bountifulTurns || 0) > 0 ? 2 : 1);
}

function foodCapacity(nation) {
  return nation.tiles.farms.reduce((sum, farm) => sum + tileFoodCapacity(farm), 0);
}
