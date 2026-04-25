// Phase 6: stage progression. Phase 7: Industrial Era. Phase 8: Modern Era.


const STAGES = {
  FOUNDATIONAL: 1,
  TRADE: 2,
  INDUSTRIAL: 3,
  INDUSTRIAL_EXPANSION: 3.2,
  MODERN: 4,
};

const STAGE_UNLOCKS = {
  tradeTurn: 5,
  tradeResourceTiles: 4,
  industrialTurn: 12,
  industrialMines: 4,
  industrialSchools: 4,
  industrialExpansionTurn: 16,
  industrialExpansionFactories: 1,
  modernTurn: 20,
  modernFactories: 3,
};

const TECHNOLOGIES = {
  tractor: {
    id: "tractor",
    label: "Tractor",
    cost: 500,
    effect: "One farm feeds 40 people instead of 10. Cannot be moved.",
    field: "tractors",
  },
  excavator: {
    id: "excavator",
    label: "Excavator",
    cost: 750,
    effect: "+50% effective mine count for population growth.",
    field: "excavators",
  },
  university: {
    id: "university",
    label: "University",
    cost: 750,
    effect: "+50% effective school count for population growth.",
    field: "universities",
  },
  tank: {
    id: "tank",
    label: "Tank",
    cost: 1000,
    effect: "1 tank = 5 soldiers in combat. Mobile military unit.",
    field: "tanks",
  },
  navalShip: {
    id: "navalShip",
    label: "Naval Ship",
    cost: 1000,
    effect: "Prerequisite for Naval Fleets (Stage 4). No combat effect until a Stage 4 fleet is assembled; then fleets enable coastal cross-water attacks.",
    field: "navalShips",
  },
};

const GOVERNMENTS = {
  democracy: {
    id: "democracy",
    label: "Democracy",
    summary: "Advisor votes guide major decisions. One veto is available this stage.",
  },
  dictatorship: {
    id: "dictatorship",
    label: "Dictatorship",
    summary: "Decisions execute immediately. Rivals tend to fear direct rule.",
  },
  monarchy: {
    id: "monarchy",
    label: "Monarchy",
    summary: "Advisor votes may appear, with the ruler breaking ties.",
  },
};

const ALLIANCE_TYPES = {
  trade: "Trade",
  military: "Military",
  political: "Political",
};

const ALLIANCE_TERMS = {
  shareResources: "Share resources",
  mutualDefense: "Mutual defense",
  tradeExclusivity: "Trade exclusivity",
};

function qualifiesForTradeEra(state, nation) {
  if (state.turn >= STAGE_UNLOCKS.tradeTurn) return true;
  const tiles = nation.tiles;
  return [
    tiles.farms.filter(isTileActive).length,
    tiles.mines.filter(isTileActive).length,
    tiles.schools.filter(isTileActive).length,
    tiles.militaryBases.filter(isTileActive).length,
  ].some((count) => count >= STAGE_UNLOCKS.tradeResourceTiles);
}

function qualifiesForIndustrialEra(state, nation) {
  if (nation.stage < STAGES.TRADE) return false;
  if (state.turn >= STAGE_UNLOCKS.industrialTurn) return true;
  const t = nation.tiles;
  const activeMines = t.mines.filter(isTileActive).length;
  const activeSchools = t.schools.filter(isTileActive).length;
  return activeMines >= STAGE_UNLOCKS.industrialMines && activeSchools >= STAGE_UNLOCKS.industrialSchools;
}

function qualifiesForModernEra(state, nation) {
  if (nation.stage < STAGES.INDUSTRIAL_EXPANSION) return false;
  const activeFactories = nation.tiles.factories.filter(isTileActive).length;
  if (state.turn >= STAGE_UNLOCKS.modernTurn && activeFactories >= 1) return true;
  return activeFactories >= STAGE_UNLOCKS.modernFactories;
}

function qualifiesForIndustrialExpansionEra(state, nation) {
  if (nation.stage < STAGES.INDUSTRIAL) return false;
  if (state.turn >= STAGE_UNLOCKS.industrialExpansionTurn) return true;
  const activeFactories = nation.tiles.factories.filter(isTileActive).length;
  return activeFactories >= STAGE_UNLOCKS.industrialExpansionFactories;
}

const FLEET_TYPES = {
  tankFleet: {
    id: "tankFleet",
    label: "Tank Fleet",
    cost: 1000,
    effect: "Unified force of 4 tanks. Adds 20 soldier-equivalents to all military operations. Requires 1 excavator + 1 university.",
    requires: { excavators: 1, universities: 1 },
    field: "tankFleets",
  },
  navalFleet: {
    id: "navalFleet",
    label: "Naval Fleet",
    cost: 1000,
    effect: "4 naval ships unified. Enables coastal bombardment: your coastal military bases can attack enemy coastal tiles within 4 hexes across water. Requires 4 naval ships + 1 excavator + 1 university.",
    requires: { navalShips: 4, excavators: 1, universities: 1 },
    field: "navalFleets",
  },
};

const AWARD_DEFS = [
  {
    id: "ambassador",
    label: "Global Ambassador",
    emoji: "🌍",
    desc: "Most treaties created",
    stat: (n) => n.treaties.length,
  },
  {
    id: "military",
    label: "Military Machine",
    emoji: "⚔️",
    desc: "Most military power",
    stat: (n) =>
      n.tiles.militaryBases.reduce((sum, base) => sum + (base.workers || 0), 0) +
      (n.technologies.tanks || 0) * TANK_STRENGTH +
      (n.technologies.tankFleets || 0) * TANK_FLEET_STRENGTH,
  },
  {
    id: "economic",
    label: "Economic Engine",
    emoji: "💰",
    desc: "Most money at game end",
    stat: (n) => n.money,
  },
  {
    id: "farming",
    label: "Farming Fanatic",
    emoji: "🌾",
    desc: "Most farms",
    stat: (n) => n.tiles.farms.length,
  },
  {
    id: "scholars",
    label: "World Scholars",
    emoji: "📚",
    desc: "Most schools",
    stat: (n) => n.tiles.schools.length,
  },
  {
    id: "mining",
    label: "Excavating Experts",
    emoji: "⛏️",
    desc: "Most mines",
    stat: (n) => n.tiles.mines.length,
  },
  {
    id: "allaround",
    label: "All-Arounder",
    emoji: "🏆",
    desc: "Most combined resources",
    stat: (n) =>
      n.tiles.farms.length +
      n.tiles.mines.length +
      n.tiles.schools.length +
      n.tiles.militaryBases.length +
      n.tiles.factories.length,
  },
];

function computeAwards(nations) {
  const all = Object.values(nations);
  return AWARD_DEFS.map((def) => {
    const scored = all.map((n) => ({ nation: n, score: def.stat(n) }));
    scored.sort((a, b) => b.score - a.score);
    return { ...def, winner: scored[0].nation, winnerScore: scored[0].score };
  });
}

function factorySlots(nation) {
  const total = nation.tiles.factories.filter((f) => (f.workers || 0) >= 5).length;
  const SLOT_TECHS = ["tractors", "excavators", "universities", "tanks", "navalShips", "tankFleets", "navalFleets"];
  const used = SLOT_TECHS.reduce((sum, key) => sum + (nation.technologies[key] || 0), 0);
  return { total, used, available: Math.max(0, total - used) };
}

function governmentLabel(id) {
  return GOVERNMENTS[id] ? GOVERNMENTS[id].label : "None";
}
