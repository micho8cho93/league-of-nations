import { DEFAULT_ACTION_POINTS_PER_TURN, type ServerGameState } from "./initialGame.js";
import {
  ADVANCED_RESOURCE_KEYS,
  FRUIT_DEFICIT_STABILITY_PENALTY,
  FRUIT_SURPLUS_GROWTH_RATE,
  advancedFruitDemand,
  collectAdvancedResourcesForNation,
  hardwoodCostForBuilding,
  ironCostForFactory,
  isAdvancedMode,
  normalizeAdvancedResources,
  oilCostForBranch,
} from "./advanced.js";
import {
  buildingTechRequirement as validateBuildingTechRequirement,
  canResearch as validateResearchTech,
  canResearchBranch as validateResearchBranch,
} from "./tech.js";
import { applyEventModifiers, tickEventTileEffects } from "./events.js";

type Tile = ServerGameState["map"]["tiles"][number];
type Nation = ServerGameState["nations"][string];

type ResourceBundle = Partial<Record<"money" | "food" | "materials" | "education" | "industry" | "people", number>>;

type PlayerActionPayload = {
  nationId?: unknown;
  tileId?: unknown;
  fromTileId?: unknown;
  toTileId?: unknown;
  targetId?: unknown;
  partnerId?: unknown;
  allianceId?: unknown;
  buildingType?: unknown;
  amount?: unknown;
  strength?: unknown;
  category?: unknown;
  branch?: unknown;
  allianceType?: unknown;
  offer?: unknown;
  request?: unknown;
  proposalId?: unknown;
  id?: unknown;
  reason?: unknown;
  text?: unknown;
  typeId?: unknown;
  actionPoints?: unknown;
  maxActionPoints?: unknown;
  actionsRemaining?: unknown;
  actionsUsedThisTurn?: unknown;
  tech?: unknown;
  cost?: unknown;
};

type ActionResult = { ok: true; [key: string]: unknown } | { ok: false; reason: string; code?: string; message?: string };

export const SERVER_GAME_ACTION_TYPES = {
  ASSIGN_WORKERS: "ASSIGN_WORKERS",
  BUILD_TILE: "BUILD_TILE",
  DESTROY_TILE: "DESTROY_TILE",
  TRAIN_UNIT: "TRAIN_UNIT",
  MOVE_OR_ATTACK_UNIT: "MOVE_OR_ATTACK_UNIT",
  DECLARE_WAR: "DECLARE_WAR",
  TRADE: "TRADE",
  PROPOSE_TRADE: "PROPOSE_TRADE",
  ACCEPT_TRADE: "ACCEPT_TRADE",
  REJECT_TRADE: "REJECT_TRADE",
  ATTACK: "ATTACK",
  PROPOSE_ALLIANCE: "PROPOSE_ALLIANCE",
  BREAK_ALLIANCE: "BREAK_ALLIANCE",
  EMBARGO: "EMBARGO",
  RESEARCH: "RESEARCH",
  RESEARCH_TECH: "RESEARCH_TECH",
  RESEARCH_BRANCH: "RESEARCH_BRANCH",
  SUBMIT_ERA_REFLECTION: "SUBMIT_ERA_REFLECTION",
  END_TURN: "END_TURN",
} as const;

export const SERVER_PLAYER_ACTION_TYPES = [
  "assignWorkers",
  "destroyTile",
  "trainUnit",
  "moveOrAttackUnit",
  "declareWar",
  "trade",
  "proposeAlliance",
  "breakAlliance",
  "embargo",
  "research",
  "researchTech",
  "researchBranch",
  "submitEraReflection",
  "buildTile",
] as const;

export const SERVER_ACTION_ALIASES: Record<string, string> = {
  assignWorkers: SERVER_GAME_ACTION_TYPES.ASSIGN_WORKERS,
  destroyTile: SERVER_GAME_ACTION_TYPES.DESTROY_TILE,
  trainUnit: SERVER_GAME_ACTION_TYPES.TRAIN_UNIT,
  moveOrAttackUnit: SERVER_GAME_ACTION_TYPES.MOVE_OR_ATTACK_UNIT,
  declareWar: SERVER_GAME_ACTION_TYPES.DECLARE_WAR,
  trade: SERVER_GAME_ACTION_TYPES.TRADE,
  proposeTrade: SERVER_GAME_ACTION_TYPES.PROPOSE_TRADE,
  acceptTrade: SERVER_GAME_ACTION_TYPES.ACCEPT_TRADE,
  rejectTrade: SERVER_GAME_ACTION_TYPES.REJECT_TRADE,
  attack: SERVER_GAME_ACTION_TYPES.ATTACK,
  proposeAlliance: SERVER_GAME_ACTION_TYPES.PROPOSE_ALLIANCE,
  breakAlliance: SERVER_GAME_ACTION_TYPES.BREAK_ALLIANCE,
  embargo: SERVER_GAME_ACTION_TYPES.EMBARGO,
  research: SERVER_GAME_ACTION_TYPES.RESEARCH,
  researchTech: SERVER_GAME_ACTION_TYPES.RESEARCH_TECH,
  researchBranch: SERVER_GAME_ACTION_TYPES.RESEARCH_BRANCH,
  submitEraReflection: SERVER_GAME_ACTION_TYPES.SUBMIT_ERA_REFLECTION,
  buildTile: SERVER_GAME_ACTION_TYPES.BUILD_TILE,
  endTurn: SERVER_GAME_ACTION_TYPES.END_TURN,
  ASSIGN_WORKERS: SERVER_GAME_ACTION_TYPES.ASSIGN_WORKERS,
  DESTROY_TILE: SERVER_GAME_ACTION_TYPES.DESTROY_TILE,
  TRAIN_UNIT: SERVER_GAME_ACTION_TYPES.TRAIN_UNIT,
  MOVE_OR_ATTACK_UNIT: SERVER_GAME_ACTION_TYPES.MOVE_OR_ATTACK_UNIT,
  DECLARE_WAR: SERVER_GAME_ACTION_TYPES.DECLARE_WAR,
  TRADE: SERVER_GAME_ACTION_TYPES.TRADE,
  PROPOSE_TRADE: SERVER_GAME_ACTION_TYPES.PROPOSE_TRADE,
  ACCEPT_TRADE: SERVER_GAME_ACTION_TYPES.ACCEPT_TRADE,
  REJECT_TRADE: SERVER_GAME_ACTION_TYPES.REJECT_TRADE,
  ATTACK: SERVER_GAME_ACTION_TYPES.ATTACK,
  PROPOSE_ALLIANCE: SERVER_GAME_ACTION_TYPES.PROPOSE_ALLIANCE,
  BREAK_ALLIANCE: SERVER_GAME_ACTION_TYPES.BREAK_ALLIANCE,
  EMBARGO: SERVER_GAME_ACTION_TYPES.EMBARGO,
  RESEARCH: SERVER_GAME_ACTION_TYPES.RESEARCH,
  RESEARCH_TECH: SERVER_GAME_ACTION_TYPES.RESEARCH_TECH,
  RESEARCH_BRANCH: SERVER_GAME_ACTION_TYPES.RESEARCH_BRANCH,
  SUBMIT_ERA_REFLECTION: SERVER_GAME_ACTION_TYPES.SUBMIT_ERA_REFLECTION,
  BUILD_TILE: SERVER_GAME_ACTION_TYPES.BUILD_TILE,
  END_TURN: SERVER_GAME_ACTION_TYPES.END_TURN,
};

export const DEFAULT_VICTORY_CONFIG = {
  economicGoldThreshold: 20000,
} as const;

export const ACTION_COSTS: Record<string, number> = {
  [SERVER_GAME_ACTION_TYPES.ASSIGN_WORKERS]: 1,
  [SERVER_GAME_ACTION_TYPES.BUILD_TILE]: 1,
  [SERVER_GAME_ACTION_TYPES.DESTROY_TILE]: 1,
  [SERVER_GAME_ACTION_TYPES.TRAIN_UNIT]: 1,
  [SERVER_GAME_ACTION_TYPES.MOVE_OR_ATTACK_UNIT]: 1,
  [SERVER_GAME_ACTION_TYPES.DECLARE_WAR]: 1,
  [SERVER_GAME_ACTION_TYPES.TRADE]: 1,
  [SERVER_GAME_ACTION_TYPES.PROPOSE_TRADE]: 1,
  [SERVER_GAME_ACTION_TYPES.ACCEPT_TRADE]: 1,
  [SERVER_GAME_ACTION_TYPES.REJECT_TRADE]: 0,
  [SERVER_GAME_ACTION_TYPES.ATTACK]: 1,
  [SERVER_GAME_ACTION_TYPES.PROPOSE_ALLIANCE]: 1,
  [SERVER_GAME_ACTION_TYPES.BREAK_ALLIANCE]: 1,
  [SERVER_GAME_ACTION_TYPES.EMBARGO]: 1,
  [SERVER_GAME_ACTION_TYPES.RESEARCH]: 1,
  [SERVER_GAME_ACTION_TYPES.RESEARCH_TECH]: 1,
  [SERVER_GAME_ACTION_TYPES.RESEARCH_BRANCH]: 1,
  [SERVER_GAME_ACTION_TYPES.SUBMIT_ERA_REFLECTION]: 1,
  [SERVER_GAME_ACTION_TYPES.END_TURN]: 0,
};

const DEFAULT_HAPPINESS = 65;

const HAPPINESS_BANDS = [
  { min: 80, label: "Thriving", workRate: 1.08, stoppageChance: 0, militaryRefusalChance: 0 },
  { min: 65, label: "Content", workRate: 1, stoppageChance: 0, militaryRefusalChance: 0 },
  { min: 45, label: "Uneasy", workRate: 0.9, stoppageChance: 0, militaryRefusalChance: 0 },
  { min: 25, label: "Unhappy", workRate: 0.75, stoppageChance: 0.2, militaryRefusalChance: 0.15 },
  { min: 0, label: "Unrest", workRate: 0.55, stoppageChance: 0.4, militaryRefusalChance: 0.35 },
];

const TILE_TYPES = {
  EMPTY: "empty",
  FARM: "farm",
  FISHERY: "fishery",
  MINE: "mine",
  MOUNTAIN_MINE: "mountainMine",
  SCHOOL: "school",
  UNIVERSITY: "university",
  FACTORY: "factory",
  MILITARY: "military",
  ROAD: "road",
  RAILROAD: "railroad",
  HIGHWAY: "highway",
  AIRPORT: "airport",
  WATER: "water",
  MOUNTAIN: "mountain",
} as const;

const BUILDING_TYPES = [
  TILE_TYPES.FARM,
  TILE_TYPES.FISHERY,
  TILE_TYPES.MINE,
  TILE_TYPES.MOUNTAIN_MINE,
  TILE_TYPES.SCHOOL,
  TILE_TYPES.UNIVERSITY,
  TILE_TYPES.FACTORY,
  TILE_TYPES.MILITARY,
];

const WORKER_MIN: Record<string, number> = {
  [TILE_TYPES.FARM]: 2,
  [TILE_TYPES.FISHERY]: 2,
  [TILE_TYPES.MINE]: 3,
  [TILE_TYPES.MOUNTAIN_MINE]: 4,
  [TILE_TYPES.SCHOOL]: 3,
  [TILE_TYPES.UNIVERSITY]: 5,
  [TILE_TYPES.FACTORY]: 5,
  [TILE_TYPES.MILITARY]: 4,
};

const WORKER_ROLES = {
  FARMERS: "farmers",
  FISHERS: "fishers",
  MINERS: "miners",
  SCHOLARS: "scholars",
  ENGINEERS: "engineers",
  SOLDIERS: "soldiers",
} as const;

const WORKER_ROLE_BY_TILE: Record<string, string> = {
  [TILE_TYPES.FARM]: WORKER_ROLES.FARMERS,
  [TILE_TYPES.FISHERY]: WORKER_ROLES.FISHERS,
  [TILE_TYPES.MINE]: WORKER_ROLES.MINERS,
  [TILE_TYPES.MOUNTAIN_MINE]: WORKER_ROLES.MINERS,
  [TILE_TYPES.SCHOOL]: WORKER_ROLES.SCHOLARS,
  [TILE_TYPES.UNIVERSITY]: WORKER_ROLES.SCHOLARS,
  [TILE_TYPES.FACTORY]: WORKER_ROLES.ENGINEERS,
  [TILE_TYPES.MILITARY]: WORKER_ROLES.SOLDIERS,
};

const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
];

const BUILD_COST: Record<string, number> = {
  [TILE_TYPES.FARM]: 140,
  [TILE_TYPES.FISHERY]: 170,
  [TILE_TYPES.MINE]: 190,
  [TILE_TYPES.MOUNTAIN_MINE]: 310,
  [TILE_TYPES.SCHOOL]: 230,
  [TILE_TYPES.UNIVERSITY]: 560,
  [TILE_TYPES.MILITARY]: 330,
  [TILE_TYPES.FACTORY]: 780,
};

const DESTROY_COST: Record<string, number> = {
  default: 70,
  [TILE_TYPES.FACTORY]: 160,
};

const BUILD_ERA_MULTIPLIERS = {
  era3: 1.65,
  era4: 2.35,
};

const FACTORY_ERA_4_BUILD_COST = 1250;
const WORKER_ADMIN_COST_PER_WORKER = 5;

const TRAINING = {
  infantryStrengths: [3, 6],
  branchBaseStrength: { tanks: 8, air: 7, naval: 7 } as Record<string, number>,
  era3Scale: 1.2,
  era4Scale: 1.45,
  moneyPerStrength: 35,
  peopleDivisor: 3,
  materialsPerStrength: { early: 0.55, era4: 0.85 },
  branchMoneyMultiplier: { tanks: 1.85, air: 1.75, naval: 1.7, infantry: 1 } as Record<string, number>,
  branchMaterialsMultiplier: { default: 2.15, air: 1.4 } as Record<string, number>,
  industryBase: 10,
  industryPerStrength: 1.6,
  industryPerBranchLevel: 0.18,
  airEducationBase: 8,
  airEducationPerStrength: 1.25,
};

const UNIT_TYPES = {
  infantry: {
    label: "Infantry",
    moveRange: 1,
    attackRange: 1,
    attackMultiplier: 1,
    canEnterWater: false,
    coastalOnly: false,
    ignoresTerrainForMovement: false,
    capturesTerritory: true,
  },
  tanks: {
    label: "Tanks",
    moveRange: 2,
    attackRange: 1,
    attackMultiplier: 1.35,
    canEnterWater: false,
    coastalOnly: false,
    ignoresTerrainForMovement: false,
    capturesTerritory: true,
  },
  naval: {
    label: "Naval Fleet",
    moveRange: 3,
    attackRange: 2,
    attackMultiplier: 1.2,
    canEnterWater: true,
    coastalOnly: true,
    ignoresTerrainForMovement: false,
    capturesTerritory: true,
  },
  air: {
    label: "Aircraft",
    moveRange: 4,
    attackRange: 4,
    attackMultiplier: 1.5,
    canEnterWater: false,
    coastalOnly: false,
    ignoresTerrainForMovement: true,
    capturesTerritory: false,
  },
} as const;

const UNIT_TYPE_PRIORITY = ["air", "tanks", "naval", "infantry"];

const TROOP_MOVEMENT_COST = {
  land: 30,
  water: 60,
};

const WAR = {
  declarationCost: 220,
  declarationRelationPenalty: 28,
  globalTrustPenalty: 3,
  formerTradePartnerPenalty: 10,
  formerAlliancePenalty: 8,
  globalFormerTradePartnerPenalty: 5,
  globalFormerAlliancePenalty: 4,
  combat: {
    attackerTankPower: 5,
    attackerAirPower: 4,
    defenderTankPower: 4,
    defenderAirPower: 3,
    militaryTechPower: 2,
    winnerLossRate: 0.35,
    loserLossRate: 0.8,
  },
  defense: {
    capital: { flatBonus: 4, multiplierBonus: 0.18 },
    developed: {
      types: [
        TILE_TYPES.FARM,
        TILE_TYPES.FISHERY,
        TILE_TYPES.MINE,
        TILE_TYPES.MOUNTAIN_MINE,
        TILE_TYPES.SCHOOL,
        TILE_TYPES.UNIVERSITY,
        TILE_TYPES.FACTORY,
        TILE_TYPES.MILITARY,
      ],
      flatBonus: 1,
      multiplierBonus: 0.04,
    },
    highValue: {
      types: [TILE_TYPES.FACTORY, TILE_TYPES.MILITARY],
      flatBonus: 2,
      multiplierBonus: 0.08,
    },
  },
  siege: {
    progressPerVictory: 1,
    capitalRequiredProgress: 3,
    highValueRequiredProgress: 2,
    highValueTypes: [TILE_TYPES.FACTORY, TILE_TYPES.MILITARY],
  },
  exhaustion: {
    max: 100,
    battleLossPerUnit: 1.1,
    winnerLossMultiplier: 0.8,
    loserLossMultiplier: 1.25,
    productionPenaltyThreshold: 45,
    productionMaxPenalty: 0.3,
  },
};

const TRADE = {
  alliances: {
    trade: { label: "Trade Alliance", cost: 120, relationBoost: 10 },
    military: { label: "Military Alliance", cost: 180, relationBoost: 8 },
    research: { label: "Research Pact", cost: 160, relationBoost: 12 },
  } as Record<string, { label: string; cost: number; relationBoost: number }>,
  bundleValues: { money: 1, food: 1.4, materials: 5, education: 7, industry: 10, people: 135 },
  pricing: { resources: ["food", "materials", "education", "industry"] },
  routes: {
    creationMinimumValue: 65,
    relationMinimum: 35,
    disruptionTurns: 3,
  },
  dependency: {
    gainPerTrade: 4,
    max: 100,
  },
  embargo: {
    cost: 90,
    durationTurns: 4,
    relationPenalty: 16,
    globalTrustPenalty: 2,
    retaliationRelationPenalty: 4,
  },
  thresholds: {
    economic: 0.88,
    scientific: 0.95,
    balanced: 1,
    aggressive: 1.1,
    default: 1,
  } as Record<string, number>,
  relationFactorDivisor: 420,
  trustBonusPerTrade: 0.025,
  maxTrustBonus: 0.16,
  minimumRequiredFactor: 0.68,
  acceptedRelationGain: 7,
  rejectedRelationPenalty: 4,
  allianceScoreThreshold: 54,
  allianceDurationTurns: 6,
  brokenAgreementPenalty: 12,
  failedAlliancePenalty: 5,
  personalityAllianceBonus: {
    economic: 14,
    scientificResearch: 12,
    aggressiveMilitary: 8,
  },
};

const PRODUCTION: Record<string, Partial<Record<"money" | "food" | "materials" | "education" | "industry", number>>> = {
  [TILE_TYPES.FARM]: { food: 16, money: 28 },
  [TILE_TYPES.FISHERY]: { food: 12, money: 34 },
  [TILE_TYPES.MINE]: { materials: 9, money: 45 },
  [TILE_TYPES.MOUNTAIN_MINE]: { materials: 15, money: 58 },
  [TILE_TYPES.SCHOOL]: { education: 7, money: 32 },
  [TILE_TYPES.UNIVERSITY]: { education: 14, money: 52 },
  [TILE_TYPES.FACTORY]: { industry: 8, money: 130 },
  [TILE_TYPES.MILITARY]: { money: 20 },
};

export function applyServerPlayerAction(
  game: ServerGameState,
  type: string,
  nationId: string,
  payload: PlayerActionPayload,
): ActionResult {
  const actionType = normalizeServerActionType(type);
  let result: ActionResult;
  switch (actionType) {
    case SERVER_GAME_ACTION_TYPES.BUILD_TILE:
      result = buildTile(game, stringValue(payload.tileId), stringValue(payload.buildingType ?? payload.typeId), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.ASSIGN_WORKERS:
      result = assignWorkers(game, stringValue(payload.tileId), payload.amount, nationId, payload.category);
      break;
    case SERVER_GAME_ACTION_TYPES.DESTROY_TILE:
      result = destroyTile(game, stringValue(payload.tileId), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.TRAIN_UNIT:
      result = trainUnit(game, stringValue(payload.tileId), payload.strength ?? payload.amount, nationId, stringValue(payload.branch || "infantry"));
      break;
    case SERVER_GAME_ACTION_TYPES.MOVE_OR_ATTACK_UNIT:
      result = moveOrAttackUnit(game, stringValue(payload.fromTileId), stringValue(payload.toTileId), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.ATTACK:
      result = handleAttack(game, game.nations[nationId], { ...payload, nationId });
      break;
    case SERVER_GAME_ACTION_TYPES.DECLARE_WAR:
      result = declareWarAction(game, stringValue(payload.targetId), nationId, stringValue(payload.reason || "Player declaration"));
      break;
    case SERVER_GAME_ACTION_TYPES.TRADE:
      result = tradeAction(game, stringValue(payload.partnerId || payload.targetId), payload.offer, payload.request, nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.PROPOSE_TRADE:
      result = handleProposeTrade(game, game.nations[nationId], { ...payload, nationId });
      break;
    case SERVER_GAME_ACTION_TYPES.ACCEPT_TRADE:
      result = handleAcceptTrade(game, game.nations[nationId], { ...payload, nationId });
      break;
    case SERVER_GAME_ACTION_TYPES.REJECT_TRADE:
      result = handleRejectTrade(game, game.nations[nationId], { ...payload, nationId });
      break;
    case SERVER_GAME_ACTION_TYPES.PROPOSE_ALLIANCE:
      result = proposeAllianceAction(game, stringValue(payload.partnerId || payload.targetId), stringValue(payload.allianceType || "trade"), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.BREAK_ALLIANCE:
      result = breakAllianceAction(game, stringValue(payload.allianceId), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.EMBARGO:
      result = embargoAction(game, stringValue(payload.targetId), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.RESEARCH:
    case SERVER_GAME_ACTION_TYPES.RESEARCH_TECH:
      result = research(game, stringValue(payload.category), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.RESEARCH_BRANCH:
      result = researchBranch(game, stringValue(payload.branch), nationId);
      break;
    case SERVER_GAME_ACTION_TYPES.SUBMIT_ERA_REFLECTION:
      result = submitEraReflection(game, stringValue(payload.text), nationId);
      break;
    default:
      return reject("UNSUPPORTED_ACTION", `Unsupported multiplayer action: ${type}.`);
  }

  if (result.ok) checkServerVictory(game);
  return normalizeActionResult(result, actionType);
}

export function normalizeServerActionType(type: unknown) {
  const raw = String(type ?? "").trim();
  return SERVER_ACTION_ALIASES[raw] || raw;
}

export function processServerRound(game: ServerGameState) {
  const summary = {
    turn: game.turn,
    money: 0,
    food: 0,
    materials: 0,
    education: 0,
    industry: 0,
    fruit: 0,
    hardwood: 0,
    iron: 0,
    oil: 0,
    population: 0,
    notes: [] as string[],
  };

  for (const nation of Object.values(game.nations)) {
    if (!nation.active) continue;
    if (isAdvancedMode(game)) {
      const resourceCollection = collectAdvancedResourcesForNation(game, nation.id);
      for (const resource of ADVANCED_RESOURCE_KEYS) summary[resource] += resourceCollection.gained[resource];
    }
    for (const tile of game.map.tiles) {
      if (tile.ownerId !== nation.id || !isTileActive(tile)) continue;
      const production = PRODUCTION[tile.type];
      if (!production) continue;
      const multiplier = 1 + Math.max(0, game.era - 1) * 0.2;
      for (const resource of ["food", "materials", "education", "industry"] as const) {
        const baseAmount = Math.ceil((production[resource] || 0) * multiplier);
        const eventAmount = applyEventModifiers(game, resource, baseAmount);
        const amount = applyWarExhaustionProduction(nation, eventAmount);
        if (!amount) continue;
        nation.resources[resource] = resourceCount(nation, resource) + amount;
        incrementStat(nation, "resourcesProduced", amount);
        summary[resource] += amount;
      }
      const money = applyWarExhaustionProduction(nation, applyEventModifiers(game, "money", Math.ceil(production.money || 0)));
      if (money > 0) {
        nation.money += money;
        incrementStat(nation, "moneyEarned", money);
        summary.money += money;
      }
    }
    if (isAdvancedMode(game)) applyAdvancedFruitEffects(game, nation, summary);
  }

  game.lastSummary = summary;
  tickEventTileEffects(game);
  addEvent(game, `Turn ${game.turn} production resolved by the server.`, { type: "resource" });
  checkServerVictory(game);
  return summary;
}

export function checkServerVictory(game: ServerGameState, config = DEFAULT_VICTORY_CONFIG) {
  if (game.gameOver) return game.gameOver;

  recomputeTerritories(game);
  const active = Object.values(game.nations).filter((nation) => nation.active);
  const economicWinner = active.find((nation) => numberValue(nation.money) >= config.economicGoldThreshold);
  if (economicWinner) {
    game.gameOver = createVictoryState(game, economicWinner.id, "economic", "Economic Victory", `${economicWinner.name} reached $${config.economicGoldThreshold}.`);
    addEvent(game, `${economicWinner.name} won by Economic Victory.`, { nationId: economicWinner.id, type: "victory" });
    return game.gameOver;
  }

  const capturableTiles = game.map.tiles.filter((tile) => tile.terrain === "land" && tile.type !== TILE_TYPES.MOUNTAIN);
  const capturableOwners = new Set(capturableTiles.map((tile) => tile.ownerId));
  if (capturableTiles.length > 0 && !capturableOwners.has(null) && capturableOwners.size === 1) {
    const [winnerId] = [...capturableOwners];
    if (winnerId && game.nations[winnerId]?.active) {
      game.gameOver = createVictoryState(game, winnerId, "military", "Military Victory", `${game.nations[winnerId].name} controls every capturable tile.`);
      addEvent(game, `${game.nations[winnerId].name} won by Military Victory.`, { nationId: winnerId, type: "victory" });
      return game.gameOver;
    }
  }

  if (active.length <= 1) {
    const winnerId = active[0]?.id || Object.keys(game.nations)[0] || "";
    game.gameOver = createVictoryState(game, winnerId, "military", "Military Victory", `${game.nations[winnerId]?.name || "A nation"} is the last active nation.`);
    addEvent(game, `${game.nations[winnerId]?.name || "A nation"} won by Military Victory.`, { nationId: winnerId, type: "victory" });
    return game.gameOver;
  }

  if (!game.settings.unlimitedMode && game.settings.maxTurns > 0 && game.turn >= game.settings.maxTurns) {
    const scores = scoreboard(game);
    const winnerId = scores[0]?.id || active[0]?.id || "";
    game.gameOver = {
      isGameOver: true,
      type: "turn_limit",
      victoryType: "turn_limit",
      label: "Turn Limit Reached",
      winnerId,
      winnerNationId: winnerId,
      winnerPlayerId: game.nations[winnerId]?.sessionId || null,
      turn: game.turn,
      turnNumber: game.turnNumber || game.turn,
      reason: "The configured turn limit was reached.",
      scores,
    } as any;
    addEvent(game, `${game.nations[winnerId]?.name || "A nation"} won by Turn Limit Reached.`, { nationId: winnerId, type: "victory" });
  }

  return game.gameOver;
}

export function handleProposeTrade(state: ServerGameState, player: Nation | null | undefined, payload: PlayerActionPayload = {}): ActionResult {
  if (!player?.active) return reject("INACTIVE_NATION", "Nation is inactive.");
  const fromId = player.id;
  const toId = stringValue(payload.partnerId || payload.targetId || (payload as Record<string, unknown>).toId);
  const gate = canUseDiplomacy(state, fromId, toId);
  if (!gate.ok) return gate;
  if (hasNegativeBundle(payload.offer) || hasNegativeBundle(payload.request)) return reject("INVALID_PAYLOAD", "Trade values must be positive.");

  const offer = normalizeBundle(payload.offer);
  const request = normalizeBundle(payload.request);
  if (bundleTotal(offer) <= 0 && bundleTotal(request) <= 0) return reject("INVALID_PAYLOAD", "Trade proposal must include a positive offer or request.");
  if (!canPayBundle(player, offer)) return reject("INSUFFICIENT_RESOURCES", `${player.name} cannot afford that offer.`);

  const action = spendAction(state, fromId, SERVER_GAME_ACTION_TYPES.PROPOSE_TRADE);
  if (!action.ok) return action;

  const proposal = {
    id: uniqueId("trade-proposal"),
    turn: state.turn,
    fromId,
    toId,
    offer,
    request,
    status: "pending",
    createdAt: Date.now(),
  };
  const proposals = ensureTradeProposals(state);
  proposals.push(proposal);
  addEvent(state, `${player.name} proposed a trade to ${state.nations[toId].name}.`, { nationId: fromId, type: "trade" });
  return { ok: true, proposal };
}

export function handleAcceptTrade(state: ServerGameState, player: Nation | null | undefined, payload: PlayerActionPayload = {}): ActionResult {
  if (!player?.active) return reject("INACTIVE_NATION", "Nation is inactive.");
  const proposal = findTradeProposal(state, payload);
  if (!proposal) return reject("INVALID_PAYLOAD", "Trade proposal not found.");
  if (proposal.toId !== player.id) return reject("OWNERSHIP_MISMATCH", "Only the target nation can accept this trade.");

  const from = state.nations[String(proposal.fromId)];
  const to = state.nations[String(proposal.toId)];
  if (!from?.active || !to?.active) return reject("INVALID_NATION", "Nation unavailable.");
  const offer = normalizeBundle(proposal.offer);
  const request = normalizeBundle(proposal.request);
  if (!canPayBundle(from, offer)) return reject("INSUFFICIENT_RESOURCES", `${from.name} cannot afford that offer.`);
  if (!canPayBundle(to, request)) return reject("INSUFFICIENT_RESOURCES", `${to.name} cannot afford the request.`);

  const action = spendAction(state, player.id, SERVER_GAME_ACTION_TYPES.ACCEPT_TRADE);
  if (!action.ok) return action;

  transferBundle(from, to, offer);
  transferBundle(to, from, request);
  const record = getDiplomacy(state, from.id, to.id);
  record.trades = numberValue(record.trades) + 1;
  increaseDependency(record, from.id, TRADE.dependency.gainPerTrade);
  increaseDependency(record, to.id, TRADE.dependency.gainPerTrade);
  record.relation = Math.min(100, numberValue(record.relation) + TRADE.acceptedRelationGain);
  incrementStat(from, "tradesAccepted", 1);
  incrementStat(to, "tradesAccepted", 1);
  const trade = {
    id: uniqueId("trade"),
    turn: state.turn,
    fromId: from.id,
    toId: to.id,
    offer,
    request,
  };
  state.trades.push(trade);
  ensureTradeRoute(state, from.id, to.id, { source: "trade", tradeValue: bundleValue(offer) + bundleValue(request) });
  removeTradeProposal(state, String(proposal.id));
  addEvent(state, `${from.name} traded with ${to.name}.`, { nationId: to.id, type: "trade" });
  return { ok: true, trade };
}

export function handleRejectTrade(state: ServerGameState, player: Nation | null | undefined, payload: PlayerActionPayload = {}): ActionResult {
  if (!player?.active) return reject("INACTIVE_NATION", "Nation is inactive.");
  const proposal = findTradeProposal(state, payload);
  if (!proposal) return reject("INVALID_PAYLOAD", "Trade proposal not found.");
  if (proposal.toId !== player.id && proposal.fromId !== player.id) return reject("OWNERSHIP_MISMATCH", "Only a trade participant can reject this proposal.");
  removeTradeProposal(state, String(proposal.id));
  addEvent(state, `${player.name} rejected a trade proposal.`, { nationId: player.id, type: "trade" });
  return { ok: true, proposalId: proposal.id };
}

export function handleAttack(state: ServerGameState, player: Nation | null | undefined, payload: PlayerActionPayload = {}): ActionResult {
  if (!player?.active) return reject("INACTIVE_NATION", "Nation is inactive.");
  const fromTileId = stringValue(payload.fromTileId || (payload as Record<string, unknown>).sourceTileId);
  const toTileId = stringValue(payload.toTileId || (payload as Record<string, unknown>).targetTileId);
  if (!fromTileId || !toTileId) return reject("INVALID_PAYLOAD", "Attack requires source and target tiles.");
  return moveOrAttackUnit(state, fromTileId, toTileId, player.id, {
    requireAction: "attack",
    spendActionType: SERVER_GAME_ACTION_TYPES.ATTACK,
  });
}

function buildTile(game: ServerGameState, tileId: string, type: string, nationId: string): ActionResult {
  const check = canBuild(game, tileId, type, nationId);
  if (!check.ok) return check;

  const action = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.BUILD_TILE);
  if (!action.ok) return action;

  const nation = game.nations[nationId];
  const tile = tileById(game, tileId);
  if (!nation || !tile) return { ok: false, reason: "Build target is unavailable." };
  if (!spendMoney(nation, check.cost)) return { ok: false, reason: "Not enough money." };
  if (check.advancedCost?.hardwood) nation.resources.hardwood = resourceCount(nation, "hardwood") - check.advancedCost.hardwood;
  if (check.advancedCost?.iron) nation.resources.iron = resourceCount(nation, "iron") - check.advancedCost.iron;

  tile.ownerId = nationId;
  tile.type = type;
  tile.workers = 0;
  tile.unit = null;
  incrementStat(nation, "built", 1);
  recomputeTerritories(game);
  addEvent(game, `${nation.name} built a ${typeLabel(type)} for $${check.cost}.`, {
    nationId,
    type: "build",
    tileId: tile.id,
  });

  return { ok: true, cost: check.cost, advancedCost: check.advancedCost || null };
}

function destroyTile(game: ServerGameState, tileId: string, nationId: string): ActionResult {
  const tile = tileById(game, tileId);
  const nation = game.nations[nationId];
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  if (!tile || tile.ownerId !== nationId) return { ok: false, reason: "You only control your own tiles." };
  if (tile.isCapital) return { ok: false, reason: "Capital tiles cannot be voluntarily destroyed." };
  if (tile.type === TILE_TYPES.EMPTY) return { ok: false, reason: "Tile is already empty." };

  const cost = destroyCost(tile.type);
  if (nation.money < cost) return { ok: false, reason: `Requires $${cost}.` };
  const action = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.DESTROY_TILE);
  if (!action.ok) return action;

  spendMoney(nation, cost);
  releaseTileWorkers(game, tile);
  tile.type = destroyedFallbackType(tile.type);
  tile.unit = null;
  incrementStat(nation, "destroyed", 1);
  addEvent(game, `${nation.name} cleared a tile for $${cost}.`, {
    nationId,
    type: "build",
    tileId: tile.id,
  });

  return { ok: true, cost };
}

function assignWorkers(
  game: ServerGameState,
  tileId: string,
  rawAmount: unknown,
  nationId: string,
  category?: unknown,
): ActionResult {
  const tile = tileById(game, tileId);
  const nation = game.nations[nationId];
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  if (!tile) return { ok: false, reason: "Worker target is unavailable." };
  if (tile.ownerId !== nationId) return { ok: false, reason: "Workers can only be assigned to owned tiles." };

  const role = WORKER_ROLE_BY_TILE[tile.type];
  if (!role) return { ok: false, reason: "This tile has no worker role." };
  const requestedCategory = String(category ?? "").trim();
  if (requestedCategory && requestedCategory !== role && requestedCategory !== tile.type) {
    return { ok: false, reason: "Worker category is invalid for this tile." };
  }

  const delta = Math.floor(Number(rawAmount));
  if (!Number.isFinite(delta)) return { ok: false, reason: "Worker count must be a valid number." };
  if (delta === 0) return { ok: false, reason: "No worker change requested." };

  const currentTileWorkers = Math.max(0, Math.floor(Number(tile.workers) || 0));
  const availablePopulation = Math.max(0, Math.floor(Number(nation.population.available) || 0));

  if (delta > 0) {
    if (delta > availablePopulation) return { ok: false, reason: "Not enough available population." };
    const cost = workerAdminCost(delta);
    if (nation.money < cost) return { ok: false, reason: `Requires $${cost} to organize workers.` };

    const action = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.ASSIGN_WORKERS);
    if (!action.ok) return action;

    spendMoney(nation, cost);
    nation.population.available = availablePopulation - delta;
    nation.workers[role] = workerCount(nation, role) + delta;
    tile.workers = currentTileWorkers + delta;
    addEvent(game, `${nation.name} assigned ${delta} workers to a ${typeLabel(tile.type)}.`, {
      nationId,
      type: "workers",
      tileId: tile.id,
    });

    return { ok: true, changed: delta, cost };
  }

  const removed = Math.abs(delta);
  if (removed > currentTileWorkers) return { ok: false, reason: "Cannot remove more workers than are assigned to this tile." };

  const action = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.ASSIGN_WORKERS);
  if (!action.ok) return action;

  tile.workers = currentTileWorkers - removed;
  nation.workers[role] = Math.max(0, workerCount(nation, role) - removed);
  nation.population.available = availablePopulation + removed;
  addEvent(game, `${nation.name} removed ${removed} workers from a ${typeLabel(tile.type)}.`, {
    nationId,
    type: "workers",
    tileId: tile.id,
  });

  return { ok: true, changed: -removed, cost: 0 };
}

function trainUnit(game: ServerGameState, tileId: string, rawStrength: unknown, nationId: string, rawBranch = "infantry"): ActionResult {
  const tile = tileById(game, tileId);
  const nation = game.nations[nationId];
  const requestedStrength = Math.floor(Number(rawStrength));
  if (!Number.isFinite(requestedStrength) || requestedStrength <= 0) return reject("INVALID_PAYLOAD", "Training strength must be a positive number.");
  const strength = requestedStrength;
  const branch = normalizeUnitType(rawBranch);
  if (!isKnownUnitType(rawBranch)) return reject("INVALID_PAYLOAD", "Unknown unit branch.");
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  if (!tile || tile.ownerId !== nationId || tile.type !== TILE_TYPES.MILITARY) {
    return { ok: false, reason: "Training requires an owned military base." };
  }
  if (branch !== "infantry" && (game.era < 4 || (techBranchLevel(nation, branch) || 0) <= 0)) {
    return { ok: false, reason: "Research this military branch before deploying it." };
  }

  const cost = trainingCost(strength, game.era, branch, techBranchLevel(nation, branch));
  if (nation.money < cost.money) return { ok: false, reason: `Requires $${cost.money}.` };
  if (nation.population.available < cost.people) return { ok: false, reason: `Requires ${cost.people} available population.` };
  for (const resource of ["materials", "education", "industry"] as const) {
    const required = cost[resource] || 0;
    if (required && resourceCount(nation, resource) < required) return { ok: false, reason: `Requires ${required} ${resource}.` };
  }
  const oilCost = isAdvancedMode(game) && branch !== "infantry" ? oilCostForBranch(branch) : 0;
  if (oilCost > 0) {
    normalizeAdvancedResources(nation);
    if (resourceCount(nation, "oil") < oilCost) return { ok: false, reason: `Requires ${oilCost} oil.` };
  }

  const action = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.TRAIN_UNIT);
  if (!action.ok) return action;

  spendMoney(nation, cost.money);
  nation.population.available -= cost.people;
  for (const resource of ["materials", "education", "industry"] as const) {
    nation.resources[resource] = resourceCount(nation, resource) - (cost[resource] || 0);
  }
  if (oilCost) nation.resources.oil = resourceCount(nation, "oil") - oilCost;
  nation.workers.soldiers = workerCount(nation, WORKER_ROLES.SOLDIERS) + cost.people;
  nation.military.unitsTrained = numberValue(nation.military.unitsTrained) + strength;
  tile.unit = tile.unit || { nationId, strength: 0, branch, movedTurn: 0, branches: {} };
  tile.unit.nationId = nationId;
  addUnitBranch(tile.unit, branch, strength);
  addEvent(game, `${nation.name} ${branch === "infantry" ? "trained" : "deployed"} ${strength} ${branch} strength.`, {
    nationId,
    type: "military",
    tileId: tile.id,
  });

  return { ok: true, cost, advancedCost: oilCost ? { oil: oilCost } : null };
}

function moveOrAttackUnit(
  game: ServerGameState,
  fromTileId: string,
  toTileId: string,
  nationId: string,
  options: { requireAction?: "move" | "attack"; spendActionType?: string } = {},
): ActionResult {
  cleanupSieges(game);
  const from = tileById(game, fromTileId);
  const to = tileById(game, toTileId);
  const nation = game.nations[nationId];
  if (!from || !to || !nation?.active) return { ok: false, reason: "Invalid movement." };
  if (from.ownerId !== nationId || !from.unit?.strength) return { ok: false, reason: "Select a tile with your troops." };
  if (from.unit.movedTurn === game.turn) return { ok: false, reason: "This unit has already acted this turn." };

  const validActions = getValidMilitaryActionsFromTile(game, from.id, nationId).actions;
  const selectedAction = validActions.find((action) => action.toTileId === to.id);
  if (!selectedAction) return { ok: false, reason: "That target is out of range for this unit type." };
  if (options.requireAction && selectedAction.action !== options.requireAction) {
    return { ok: false, reason: options.requireAction === "attack" ? "That target is not a valid attack." : "That target is not a valid move." };
  }

  const movementCost = selectedAction.cost;
  if (nation.money < movementCost) return { ok: false, reason: `Requires $${movementCost} to move troops.` };
  const refusal = checkMilitaryRefusal(game, nation, from.id, to.id);
  if (!refusal.ok) return refusal;
  const action = spendAction(game, nationId, options.spendActionType || SERVER_GAME_ACTION_TYPES.MOVE_OR_ATTACK_UNIT);
  if (!action.ok) return action;
  spendMoney(nation, movementCost);

  if (selectedAction.action === "move") {
    const wasUnowned = !to.ownerId;
    const moving = from.unit;
    clearSiegesFromTile(game, from.id, nationId);
    from.unit = null;
    to.ownerId = nationId;
    to.unit = mergeUnitInto(to.unit, moving, nationId, game.turn);
    if (wasUnowned) incrementStat(nation, "tilesCaptured", 1);
    recomputeTerritories(game);
    addEvent(game, `${nation.name} moved troops to a new tile.`, { nationId, type: "war", tileId: to.id });
    return { ok: true, action: "move", unitType: selectedAction.unitType, cost: movementCost, fromTileId: from.id, targetTileId: to.id, path: selectedAction.path };
  }

  const defenderId = String(to.ownerId || "");
  if (!areAtWar(game, nationId, defenderId)) return { ok: false, reason: "Declare war before attacking." };
  const defender = game.nations[defenderId];
  if (!defender?.active) return { ok: false, reason: "Target is unavailable." };

  const unitType = selectedAction.unitType;
  const unitConfig = unitTypeConfig(unitType);
  const path = selectedAction.path;

  if (unitType !== "infantry") {
    from.unit.movedTurn = game.turn;
    applyBattleWarExhaustion(game, nationId, defenderId, { attacker: 1, defender: 0 }, false);
    const strikeReport = {
      id: uniqueId("battle"),
      turn: game.turn,
      attackerId: nationId,
      defenderId,
      attackerName: nation.name,
      defenderName: defender.name,
      fromTileId: from.id,
      targetTileId: to.id,
      path,
      unitType,
      unitTypeLabel: unitConfig.label,
      captureAttempt: false,
      attackerWins: false,
      attack: 0,
      defense: 0,
      modifiers: {},
      losses: { attacker: 0, defender: 0 },
      capitalCaptured: false,
      territoryChanged: false,
      siege: null,
      advancedStrike: true,
    };
    addEvent(game, `${nation.name} launched a ${unitConfig.label.toLowerCase()} strike on ${defender.name}.`, {
      nationId,
      type: "war",
      tileId: to.id,
    });
    recordWarLog(game, strikeReport);
    return { ok: true, action: "battle", cost: movementCost, report: strikeReport };
  }

  const outcome = resolveCombat(game, nationId, defenderId, from.unit.strength, defenderStrength(to), to, unitType);
  const report = {
    id: uniqueId("battle"),
    turn: game.turn,
    attackerId: nationId,
    defenderId,
    attackerName: nation.name,
    defenderName: defender.name,
    fromTileId: from.id,
    targetTileId: to.id,
    path,
    targetType: to.type,
    unitType,
    unitTypeLabel: unitConfig.label,
    captureAttempt: Boolean(selectedAction.captureOnWin),
    attackerWins: outcome.attackerWins,
    attack: outcome.attack,
    defense: outcome.defense,
    modifiers: outcome.modifiers,
    losses: outcome.losses,
    capitalCaptured: false,
    territoryChanged: false,
    siege: null as null | Record<string, unknown>,
  };

  if (report.captureAttempt) {
    applyCombatOutcome(game, from, to, outcome, nationId, defenderId, report);
  } else {
    applyStrikeOutcome(game, from, to, outcome, nationId, defenderId, report);
  }
  addEvent(game, `${report.attackerName} ${report.attackerWins ? "won" : "lost"} an attack against ${report.defenderName}.`, {
    nationId,
    type: "war",
    tileId: to.id,
  });
  recordWarLog(game, report);

  return { ok: true, action: "battle", cost: movementCost, report };
}

function declareWarAction(game: ServerGameState, targetId: string, nationId: string, reason: string): ActionResult {
  const action = canSpendAction(game, nationId, SERVER_GAME_ACTION_TYPES.DECLARE_WAR);
  if (!action.ok) return action;
  const result = declareWar(game, nationId, targetId, reason);
  if (!result.ok) return result;
  const spend = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.DECLARE_WAR);
  if (!spend.ok) return spend;
  addEvent(game, `${game.nations[nationId].name} declared war on ${game.nations[targetId].name}.`, { nationId, type: "war" });
  return result;
}

function tradeAction(game: ServerGameState, partnerId: string, offer: unknown, request: unknown, nationId: string): ActionResult {
  const action = canSpendAction(game, nationId, SERVER_GAME_ACTION_TYPES.TRADE);
  if (!action.ok) return action;
  if (hasNegativeBundle(offer) || hasNegativeBundle(request)) return reject("INVALID_PAYLOAD", "Trade values must be positive.");
  const normalizedOffer = normalizeBundle(offer);
  const normalizedRequest = normalizeBundle(request);
  if (bundleTotal(normalizedOffer) <= 0 && bundleTotal(normalizedRequest) <= 0) {
    return reject("INVALID_PAYLOAD", "Trade must include a positive offer or request.");
  }
  const result = applyTrade(game, nationId, partnerId, offer, request);
  if (!result.ok) return result;
  const spend = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.TRADE);
  if (!spend.ok) return spend;
  const partner = game.nations[partnerId];
  addEvent(
    game,
    result.accepted
      ? `${game.nations[nationId].name} traded with ${partner.name}.`
      : `${partner.name} rejected a trade proposal.`,
    { nationId: result.accepted ? nationId : partnerId, type: "trade" },
  );
  return result;
}

function proposeAllianceAction(game: ServerGameState, partnerId: string, allianceType: string, nationId: string): ActionResult {
  const action = canSpendAction(game, nationId, SERVER_GAME_ACTION_TYPES.PROPOSE_ALLIANCE);
  if (!action.ok) return action;
  const result = proposeAlliance(game, nationId, partnerId, allianceType);
  if (!result.ok) return result;
  const spend = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.PROPOSE_ALLIANCE);
  if (!spend.ok) return spend;
  const partner = game.nations[partnerId];
  addEvent(
    game,
    result.accepted
      ? `${game.nations[nationId].name} formed an alliance with ${partner.name}.`
      : `${partner.name} rejected an alliance proposal.`,
    { nationId: result.accepted ? nationId : partnerId, type: "diplomacy" },
  );
  return result;
}

function breakAllianceAction(game: ServerGameState, allianceId: string, nationId: string): ActionResult {
  const action = canSpendAction(game, nationId, SERVER_GAME_ACTION_TYPES.BREAK_ALLIANCE);
  if (!action.ok) return action;
  const result = breakAlliance(game, allianceId, nationId);
  if (!result.ok) return result;
  const spend = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.BREAK_ALLIANCE);
  if (!spend.ok) return spend;
  addEvent(game, `${game.nations[nationId].name} broke an alliance.`, { nationId, type: "diplomacy" });
  return result;
}

function embargoAction(game: ServerGameState, targetId: string, nationId: string): ActionResult {
  const action = canSpendAction(game, nationId, SERVER_GAME_ACTION_TYPES.EMBARGO);
  if (!action.ok) return action;
  const result = embargoNation(game, nationId, targetId);
  if (!result.ok) return result;
  const spend = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.EMBARGO);
  if (!spend.ok) return spend;
  addEvent(game, `${game.nations[nationId].name} embargoed ${game.nations[targetId].name}.`, { nationId, type: "diplomacy" });
  return result;
}

function research(game: ServerGameState, category: string, nationId: string): ActionResult {
  const nation = game.nations[nationId];
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  if (!category) return reject("INVALID_PAYLOAD", "Technology category is required.");
  const check = validateResearchTech(game, nation, category);
  if (!check.ok) return check;
  const action = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.RESEARCH_TECH);
  if (!action.ok) return action;
  if (!spendMoney(nation, check.cost)) return { ok: false, reason: "Not enough money." };
  nation.resources[check.requirement.resource] = resourceCount(nation, check.requirement.resource) - check.requirement.resourceCost;
  (nation.tech as unknown as Record<string, number>)[category] = check.nextTier;
  incrementStat(nation, "techResearched", 1);
  addEvent(game, `${nation.name} advanced ${category} to tier ${check.nextTier}.`, { nationId, type: "tech" });
  return { ok: true, cost: check.cost, nextTier: check.nextTier };
}

function researchBranch(game: ServerGameState, branch: string, nationId: string): ActionResult {
  const nation = game.nations[nationId];
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  if (!branch) return reject("INVALID_PAYLOAD", "Military branch is required.");
  const check = validateResearchBranch(game, nation, branch);
  if (!check.ok) return check;
  const action = spendAction(game, nationId, SERVER_GAME_ACTION_TYPES.RESEARCH_BRANCH);
  if (!action.ok) return action;
  if (!spendMoney(nation, check.cost.money)) return { ok: false, reason: "Not enough money." };
  for (const resource of ["materials", "education", "industry"] as const) {
    nation.resources[resource] = resourceCount(nation, resource) - check.cost[resource];
  }
  nation.tech.branches[branch] = check.nextLevel;
  nation.military.branchFocus = branch;
  incrementStat(nation, "techResearched", 1);
  addEvent(game, `${nation.name} advanced ${branch} specialization to level ${check.nextLevel}.`, { nationId, type: "tech" });
  return { ok: true, cost: check.cost, nextLevel: check.nextLevel };
}

function submitEraReflection(game: ServerGameState, text: string, nationId: string): ActionResult {
  if (!game.pendingEraReport) return { ok: false, reason: "No era report is pending." };
  const reflection = String(text || "").trim();
  if (reflection.length < 8) return { ok: false, reason: "Write a short reflection before continuing." };
  const report = game.pendingEraReport as Record<string, unknown>;
  report.reflection = reflection;
  game.eraReports.push(report);
  const nextEra = Number(report.nextEra || game.era + 1);
  game.era = nextEra;
  game.pendingEraReport = null;
  game.turn += 1;
  game.turnNumber = game.turn;
  game.phase = "player";
  game.isProcessingTurn = false;
  resetTurnActions(game, nationId);
  addEvent(game, `Era ${game.era} began.`, { nationId, type: "era" });
  return { ok: true };
}

function canBuild(
  game: ServerGameState,
  tileId: string,
  type: string,
  nationId: string,
): { ok: true; cost: number; advancedCost?: { hardwood: number; iron: number } } | { ok: false; reason: string } {
  const nation = game.nations[nationId];
  const tile = tileById(game, tileId);
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  if (!tile) return { ok: false, reason: "Build target is unavailable." };
  if (tile.ownerId && tile.ownerId !== nationId) return { ok: false, reason: "Cannot build on foreign territory." };
  if (!BUILDING_TYPES.includes(type as (typeof BUILDING_TYPES)[number])) return { ok: false, reason: "Unknown building type." };
  if (!tileTypeUnlocked(type, game.era)) return { ok: false, reason: "This building is not unlocked yet." };
  const techCheck = validateBuildingTechRequirement(type, nation, game.era);
  if (!techCheck.ok) return techCheck;
  if (type === TILE_TYPES.FISHERY) {
    if (tile.type !== TILE_TYPES.WATER) return { ok: false, reason: "Fisheries require lake or ocean water." };
  } else if (type === TILE_TYPES.MOUNTAIN_MINE) {
    if (tile.type !== TILE_TYPES.MOUNTAIN) return { ok: false, reason: "Mountain mines require mountains." };
  } else {
    if (!isLand(tile)) return { ok: false, reason: "Buildings require land." };
    if (tile.type !== TILE_TYPES.EMPTY) return { ok: false, reason: "Tile is already developed." };
  }

  if (!tile.ownerId) {
    const adjacentOwned = neighbors(game, tile.id).some((neighbor) => neighbor.ownerId === nationId);
    if (!adjacentOwned && nation.territory.length > 0) {
      return { ok: false, reason: "Unowned tiles must border your territory." };
    }
  }

  if (type === TILE_TYPES.FACTORY) {
    const factoryCheck = canBuildFactory(game, nationId);
    if (!factoryCheck.ok) return factoryCheck;
  }

  const cost = buildingCost(type, game.era);
  if (nation.money < cost) return { ok: false, reason: `Requires $${cost}.` };
  if (isAdvancedMode(game)) {
    normalizeAdvancedResources(nation);
    const hardwoodCost = hardwoodCostForBuilding(type);
    const ironCost = ironCostForFactory(type);
    if (hardwoodCost > 0 && resourceCount(nation, "hardwood") < hardwoodCost) return { ok: false, reason: `Requires ${hardwoodCost} hardwood.` };
    if (ironCost > 0 && resourceCount(nation, "iron") < ironCost) return { ok: false, reason: `Requires ${ironCost} iron.` };
    return { ok: true, cost, advancedCost: { hardwood: hardwoodCost, iron: ironCost } };
  }
  return { ok: true, cost };
}

export function getActionCost(actionType: string, _game: ServerGameState, _playerNation?: Nation) {
  const normalized = normalizeServerActionType(actionType);
  return ACTION_COSTS[normalized] ?? 1;
}

export function canAffordAction(actionType: string, state: ServerGameState, nationId: string): ActionResult {
  const nation = state.nations[nationId];
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  const cost = getActionCost(actionType, state, nation);
  if (cost <= 0) return { ok: true };
  normalizeActionPointState(nation);
  if (nation.actionPoints < cost) return { ok: false, reason: "Not enough action points remaining this turn." };
  return { ok: true };
}

export function spendActionPoints(actionType: string, state: ServerGameState, nationId: string): ActionResult {
  const nation = state.nations[nationId];
  if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
  const cost = getActionCost(actionType, state, nation);
  if (cost <= 0) return { ok: true };
  const check = canAffordAction(actionType, state, nationId);
  if (!check.ok) return check;
  nation.actionPoints -= cost;
  nation.actionsRemaining = nation.actionPoints;
  nation.actionsUsedThisTurn += cost;
  return { ok: true };
}

function canSpendAction(game: ServerGameState, nationId: string, actionType: string): ActionResult {
  return canAffordAction(actionType, game, nationId);
}

function spendAction(game: ServerGameState, nationId: string, actionType: string): ActionResult {
  return spendActionPoints(actionType, game, nationId);
}

function normalizeHappiness(value: unknown) {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : DEFAULT_HAPPINESS;
  return Math.max(0, Math.min(100, numeric));
}

function applyAdvancedFruitEffects(game: ServerGameState, nation: Nation, summary: Record<string, any>) {
  normalizeAdvancedResources(nation);
  const demand = advancedFruitDemand(nation);
  if (demand <= 0) return;
  const available = resourceCount(nation, "fruit");
  const consumed = Math.min(available, demand);
  nation.resources.fruit = available - consumed;
  const stockSurplus = Math.max(0, available - demand);
  const capacity = Math.max(0, nation.territory.length * 10);
  const headroom = Math.max(0, capacity - nation.population.total);
  const growth = headroom > 0 ? Math.min(headroom, Math.floor(stockSurplus * FRUIT_SURPLUS_GROWTH_RATE)) : 0;
  if (growth > 0) {
    addPopulation(nation, growth);
    summary.population = numberValue(summary.population) + growth;
    addEvent(game, `${nation.name}'s fruit surplus supported ${growth} population growth.`, { nationId: nation.id, type: "resource" });
  }
  if (consumed < demand) {
    nation.population.happiness = normalizeHappiness(numberValue(nation.population.happiness, DEFAULT_HAPPINESS) - FRUIT_DEFICIT_STABILITY_PENALTY);
    addEvent(game, `${nation.name} lacked ${demand - consumed} fruit and faced population strain.`, { nationId: nation.id, type: "resource" });
  }
}

function happinessBand(nation: Nation) {
  const happiness = normalizeHappiness(nation.population?.happiness);
  return HAPPINESS_BANDS.find((band) => happiness >= band.min) || HAPPINESS_BANDS[HAPPINESS_BANDS.length - 1];
}

function checkMilitaryRefusal(game: ServerGameState, nation: Nation, fromTileId: string, toTileId: string): ActionResult {
  if (game.settings?.happinessEnabled === false) return { ok: true };
  nation.population.happiness = normalizeHappiness(nation.population.happiness);
  const band = happinessBand(nation);
  if (!band.militaryRefusalChance) return { ok: true };
  const roll = deterministicChance(`${game.gameId || game.roomId}|${game.turn}|${nation.id}|${fromTileId}|${toTileId}|military-refusal`);
  if (roll >= band.militaryRefusalChance) return { ok: true };
  const reason = `${nation.name}'s military refused orders amid ${band.label.toLowerCase()} at home.`;
  addEvent(game, reason, { nationId: nation.id, type: "happiness" });
  return { ok: false, reason };
}

function deterministicChance(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function canBuildFactory(game: ServerGameState, nationId: string): ActionResult {
  if (game.era < 3) return { ok: false, reason: "Factories unlock in Era 3." };
  const nation = game.nations[nationId];
  if (!nation) return { ok: false, reason: "Nation is inactive." };
  const factories = activeTiles(game, nationId, TILE_TYPES.FACTORY).length;
  const requiredMines = 3 + factories * 2;
  const requiredSchools = 2 + factories * 2;
  const requiredPopulation = 35 + factories * 8;
  if ((nation.tech.mining || 0) < 2) return { ok: false, reason: "Requires Mining tier 2." };
  if ((nation.tech.education || 0) < 2) return { ok: false, reason: "Requires Education tier 2." };
  if (activeTileCount(game, nationId, [TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE]) < requiredMines) return { ok: false, reason: `Requires ${requiredMines} active mines.` };
  if (activeTileCount(game, nationId, [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY]) < requiredSchools) return { ok: false, reason: `Requires ${requiredSchools} active schools.` };
  if (nation.population.total < requiredPopulation) return { ok: false, reason: `Requires ${requiredPopulation} population.` };
  return { ok: true };
}

function trainingCost(strength: number, era: number, branch = "infantry", branchLevel = 0) {
  const scale = era >= 4 ? TRAINING.era4Scale : era >= 3 ? TRAINING.era3Scale : 1;
  const cost: { money: number; people: number; materials: number; education?: number; industry?: number } = {
    money: Math.ceil(strength * TRAINING.moneyPerStrength * scale),
    people: Math.ceil(strength / TRAINING.peopleDivisor),
    materials: Math.ceil(strength * (era >= 4 ? TRAINING.materialsPerStrength.era4 : TRAINING.materialsPerStrength.early)),
  };
  if (branch !== "infantry") {
    cost.money = Math.ceil(cost.money * (TRAINING.branchMoneyMultiplier[branch] || TRAINING.branchMoneyMultiplier.infantry));
    cost.materials = Math.ceil(cost.materials * (TRAINING.branchMaterialsMultiplier[branch] || TRAINING.branchMaterialsMultiplier.default));
    cost.industry = Math.ceil((TRAINING.industryBase + strength * TRAINING.industryPerStrength) * (1 + branchLevel * TRAINING.industryPerBranchLevel));
    if (branch === "air") cost.education = Math.ceil(TRAINING.airEducationBase + strength * TRAINING.airEducationPerStrength);
  }
  return cost;
}

function getValidMilitaryActionsFromTile(game: ServerGameState, fromTileId: string, nationId: string) {
  const from = tileById(game, fromTileId);
  if (!from || from.ownerId !== nationId || !from.unit?.strength) return { actions: [] as MilitaryAction[] };
  const unitType = primaryUnitType(from.unit);
  const config = unitTypeConfig(unitType);
  if ((game.nations[nationId]?.actionsRemaining || 0) <= 0 || from.unit.movedTurn === game.turn) return { actions: [] as MilitaryAction[] };

  const actions: MilitaryAction[] = [];
  for (const target of reachableMoveTargets(game, from, nationId, unitType)) {
    actions.push({
      action: "move",
      fromTileId,
      toTileId: target.tile.id,
      cost: isWaterLike(target.tile) ? TROOP_MOVEMENT_COST.water : TROOP_MOVEMENT_COST.land,
      unitType,
      path: target.path,
      captureOnWin: false,
    });
  }
  for (const target of reachableAttackTargets(game, from, nationId, unitType)) {
    const distance = hexDistance(from, target);
    actions.push({
      action: "attack",
      fromTileId,
      toTileId: target.id,
      cost: isWaterLike(target) ? TROOP_MOVEMENT_COST.water : TROOP_MOVEMENT_COST.land,
      unitType,
      path: [from.id, target.id],
      captureOnWin: Boolean(config.capturesTerritory && distance <= 1),
    });
  }

  return { actions };
}

type MilitaryAction = {
  action: "move" | "attack";
  fromTileId: string;
  toTileId: string;
  cost: number;
  unitType: string;
  path: string[];
  captureOnWin: boolean;
};

function reachableMoveTargets(game: ServerGameState, from: Tile, nationId: string, unitType: string) {
  const config = unitTypeConfig(unitType);
  if (config.ignoresTerrainForMovement) {
    return game.map.tiles
      .filter((tile) => tile.id !== from.id && hexDistance(from, tile) <= config.moveRange)
      .filter((tile) => canMoveDestination(game, from, tile, nationId, unitType))
      .map((tile) => ({ tile, path: [from.id, tile.id] }));
  }

  const queue = [{ tile: from, path: [from.id], distance: 0 }];
  const seen = new Map([[from.id, 0]]);
  const targets: Array<{ tile: Tile; path: string[] }> = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.distance >= config.moveRange) continue;
    for (const neighbor of neighbors(game, current.tile.id)) {
      const nextDistance = current.distance + 1;
      if ((seen.get(neighbor.id) ?? Infinity) <= nextDistance) continue;
      if (!canUnitEnterTile(game, nationId, neighbor, unitType).ok) continue;
      if (neighbor.ownerId && neighbor.ownerId !== nationId && !areAllied(game, nationId, neighbor.ownerId)) continue;
      const path = [...current.path, neighbor.id];
      seen.set(neighbor.id, nextDistance);
      if (!neighbor.ownerId || neighbor.ownerId === nationId) targets.push({ tile: neighbor, path });
      if (neighbor.ownerId === nationId || areAllied(game, nationId, neighbor.ownerId) || (config.canEnterWater && isWaterLike(neighbor))) {
        queue.push({ tile: neighbor, path, distance: nextDistance });
      }
    }
  }
  return targets;
}

function reachableAttackTargets(game: ServerGameState, from: Tile, nationId: string, unitType: string) {
  const config = unitTypeConfig(unitType);
  return game.map.tiles
    .filter((tile) => tile.id !== from.id && hexDistance(from, tile) <= config.attackRange)
    .filter((tile) => tile.ownerId && tile.ownerId !== nationId && areAtWar(game, nationId, tile.ownerId))
    .filter((tile) => canUnitAttackTile(game, tile, unitType));
}

function canMoveDestination(game: ServerGameState, from: Tile, tile: Tile, nationId: string, unitType: string) {
  if (!tile || tile.id === from.id) return false;
  if (!canUnitEnterTile(game, nationId, tile, unitType).ok) return false;
  if (tile.ownerId && tile.ownerId !== nationId) return false;
  if (!tile.ownerId && !isWaterLike(tile) && !bordersNation(game, tile, nationId)) return false;
  return !isWaterLike(tile) || unitTypeConfig(unitType).canEnterWater;
}

function canUnitEnterTile(game: ServerGameState, nationId: string, tile: Tile, unitType = "infantry"): ActionResult {
  const config = unitTypeConfig(unitType);
  if (tile.type === TILE_TYPES.MOUNTAIN) return { ok: false, reason: "Mountains cannot be traversed." };
  if (isWaterLike(tile) && !config.canEnterWater) return { ok: false, reason: `${config.label} cannot enter water.` };
  if (isWaterLike(tile) && !hasNavalAccess(game.nations[nationId])) return { ok: false, reason: "Water crossing requires naval specialization." };
  if (config.coastalOnly && !isWaterLike(tile) && !isCoastalTile(game, tile)) return { ok: false, reason: `${config.label} can only operate on water or coastal tiles.` };
  if (!tile.ownerId || tile.ownerId === nationId || areAllied(game, nationId, tile.ownerId) || areAtWar(game, nationId, tile.ownerId)) return { ok: true };
  return { ok: false, reason: "Foreign territory requires war or alliance." };
}

function canUnitAttackTile(game: ServerGameState, tile: Tile, unitType: string) {
  const config = unitTypeConfig(unitType);
  if (isWaterLike(tile) && !config.canEnterWater && unitType !== "air") return false;
  if (config.coastalOnly && !isWaterLike(tile) && !isCoastalTile(game, tile)) return false;
  if (unitType === "tanks" && isWaterLike(tile)) return false;
  if (unitType === "infantry" && isWaterLike(tile)) return false;
  return true;
}

function declareWar(game: ServerGameState, attackerId: string, defenderId: string, reason: string): ActionResult {
  if (game.era < 3) return { ok: false, reason: "War unlocks in Era 3." };
  if (attackerId === defenderId) return { ok: false, reason: "A nation cannot declare war on itself." };
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  if (!attacker?.active || !defender?.active) return { ok: false, reason: "Target is unavailable." };
  if (areAllied(game, attackerId, defenderId)) return { ok: false, reason: "Break the alliance before declaring war." };
  if (areAtWar(game, attackerId, defenderId)) return { ok: false, reason: "War is already active." };
  const cost = WAR.declarationCost;
  if (attacker.money < cost) return { ok: false, reason: `Requires $${cost} to mobilize.` };

  spendMoney(attacker, cost);
  incrementStat(attacker, "warsDeclared", 1);
  const key = pairKey(attackerId, defenderId);
  const war = { key, attackerId, defenderId, reason, active: true, startedTurn: game.turn, battles: 0 };
  game.wars[key] = war;
  const diplomacy = getDiplomacy(game, attackerId, defenderId);
  diplomacy.atWar = true;
  diplomacy.wars = numberValue(diplomacy.wars) + 1;
  applyWarDiplomacyPenalty(game, attackerId, defenderId);
  disruptTradeRoutes(game, attackerId, defenderId, "war");
  return { ok: true, war, cost };
}

function applyTrade(game: ServerGameState, fromId: string, toId: string, offer: unknown, request: unknown) {
  const result = evaluateTrade(game, fromId, toId, offer, request);
  const record = getDiplomacy(game, fromId, toId);
  if (!result.ok) return result;
  if (!result.accepted) {
    record.relation = Math.max(0, numberValue(record.relation) - TRADE.rejectedRelationPenalty);
    return result;
  }
  transferBundle(game.nations[fromId], game.nations[toId], result.offer);
  transferBundle(game.nations[toId], game.nations[fromId], result.request);
  record.trades = numberValue(record.trades) + 1;
  increaseDependency(record, fromId, TRADE.dependency.gainPerTrade);
  increaseDependency(record, toId, TRADE.dependency.gainPerTrade);
  record.relation = Math.min(100, numberValue(record.relation) + TRADE.acceptedRelationGain);
  incrementStat(game.nations[fromId], "tradesAccepted", 1);
  incrementStat(game.nations[toId], "tradesAccepted", 1);
  game.trades.push({
    id: uniqueId("trade"),
    turn: game.turn,
    fromId,
    toId,
    offer: result.offer,
    request: result.request,
  });
  ensureTradeRoute(game, fromId, toId, { source: "trade", tradeValue: result.offerValue + result.requestValue });
  return result;
}

function evaluateTrade(game: ServerGameState, fromId: string, toId: string, offer: unknown, request: unknown) {
  const gate = canUseDiplomacy(game, fromId, toId);
  if (!gate.ok) return gate;
  const from = game.nations[fromId];
  const to = game.nations[toId];
  const record = getDiplomacy(game, fromId, toId);
  const normalizedOffer = normalizeBundle(offer);
  const normalizedRequest = normalizeBundle(request);
  if (!canPayBundle(from, normalizedOffer)) return { ok: false as const, reason: `${from.name} cannot afford that offer.` };
  if (!canPayBundle(to, normalizedRequest)) return { ok: false as const, reason: `${to.name} cannot afford the request.` };

  const offerValue = bundleValue(normalizedOffer);
  const requestValue = bundleValue(normalizedRequest);
  const threshold = TRADE.thresholds[to.personality] || TRADE.thresholds.default;
  const relationFactor = 1 - ((numberValue(record.relation, 50) - 50) / TRADE.relationFactorDivisor);
  const trustBonus = Math.min(TRADE.maxTrustBonus, numberValue(record.trades) * TRADE.trustBonusPerTrade);
  const required = requestValue * Math.max(TRADE.minimumRequiredFactor, threshold * relationFactor - trustBonus);
  const accepted = requestValue === 0 || offerValue >= required;
  return {
    ok: true as const,
    accepted,
    offer: normalizedOffer,
    request: normalizedRequest,
    offerValue,
    requestValue,
    required,
    reason: accepted ? "Offer accepted." : `Offer value is short by ${Math.ceil(required - offerValue)}.`,
  };
}

function proposeAlliance(game: ServerGameState, fromId: string, toId: string, type = "trade") {
  const gate = canUseDiplomacy(game, fromId, toId);
  if (!gate.ok) return gate;
  const config = TRADE.alliances[type] || TRADE.alliances.trade;
  const from = game.nations[fromId];
  const to = game.nations[toId];
  if (from.money < config.cost) return { ok: false as const, reason: `Requires $${config.cost}.` };
  const record = getDiplomacy(game, fromId, toId);
  const score =
    numberValue(record.relation, 50) +
    (to.personality === "economic" ? TRADE.personalityAllianceBonus.economic : 0) +
    (to.personality === "scientific" && type === "research" ? TRADE.personalityAllianceBonus.scientificResearch : 0) +
    (to.personality === "aggressive" && type === "military" ? TRADE.personalityAllianceBonus.aggressiveMilitary : 0);

  spendMoney(from, config.cost);
  if (score < TRADE.allianceScoreThreshold) {
    record.relation = Math.max(0, numberValue(record.relation) - TRADE.failedAlliancePenalty);
    return { ok: true as const, accepted: false, reason: `${to.name} rejected the alliance.` };
  }

  const alliance = {
    id: uniqueId("alliance"),
    type,
    label: config.label,
    members: [fromId, toId],
    createdTurn: game.turn,
    duration: TRADE.allianceDurationTurns,
    expiresTurn: game.turn + TRADE.allianceDurationTurns,
    active: true,
  };
  game.alliances.push(alliance);
  record.alliances = Array.isArray(record.alliances) ? record.alliances : [];
  record.alliances.push(alliance.id);
  record.relation = Math.min(100, numberValue(record.relation) + config.relationBoost);
  if (type === "trade") ensureTradeRoute(game, fromId, toId, { source: "alliance", force: true });
  incrementStat(from, "alliancesFormed", 1);
  incrementStat(to, "alliancesFormed", 1);
  return { ok: true as const, accepted: true, alliance, reason: `${config.label} formed.` };
}

function breakAlliance(game: ServerGameState, allianceId: string, breakerId: string): ActionResult {
  const alliance = (game.alliances as Array<Record<string, any>>).find((item) => item.id === allianceId && item.active);
  if (!alliance) return { ok: false, reason: "Alliance not found." };
  if (!Array.isArray(alliance.members) || !alliance.members.includes(breakerId)) {
    return { ok: false, reason: "Only alliance members can break this alliance." };
  }
  alliance.active = false;
  for (const partnerId of alliance.members) {
    if (partnerId === breakerId) continue;
    const record = getDiplomacy(game, breakerId, partnerId);
    record.relation = Math.max(0, numberValue(record.relation) - TRADE.brokenAgreementPenalty);
    record.brokenAgreements = numberValue(record.brokenAgreements) + 1;
  }
  return { ok: true, alliance };
}

function embargoNation(game: ServerGameState, fromId: string, targetId: string): ActionResult {
  const gate = canUseDiplomacy(game, fromId, targetId);
  if (!gate.ok) return gate;
  if (fromId === targetId) return { ok: false, reason: "A nation cannot embargo itself." };
  if (areAtWar(game, fromId, targetId)) return { ok: false, reason: "War already blocks direct trade." };
  const from = game.nations[fromId];
  const target = game.nations[targetId];
  if (from.money < TRADE.embargo.cost) return { ok: false, reason: `Requires $${TRADE.embargo.cost}.` };
  const record = getDiplomacy(game, fromId, targetId);
  record.embargoes = record.embargoes && typeof record.embargoes === "object" ? record.embargoes : {};
  if (numberValue((record.embargoes as Record<string, unknown>)[fromId]) > game.turn) return { ok: false, reason: `${target.name} is already under embargo.` };
  spendMoney(from, TRADE.embargo.cost);
  (record.embargoes as Record<string, unknown>)[fromId] = game.turn + TRADE.embargo.durationTurns;
  record.relation = Math.max(0, numberValue(record.relation) - TRADE.embargo.relationPenalty);
  for (const nation of Object.values(game.nations)) {
    if (!nation.active || nation.id === fromId || nation.id === targetId) continue;
    const other = getDiplomacy(game, fromId, nation.id);
    other.relation = Math.max(0, numberValue(other.relation) - TRADE.embargo.globalTrustPenalty);
  }
  const retaliation = getDiplomacy(game, targetId, fromId);
  retaliation.relation = Math.max(0, numberValue(retaliation.relation) - TRADE.embargo.retaliationRelationPenalty);
  return { ok: true, expiresTurn: (record.embargoes as Record<string, unknown>)[fromId], reason: `${target.name} is embargoed.` };
}

function canUseDiplomacy(game: ServerGameState, a: string, b: string): ActionResult {
  if (game.era < 2) return { ok: false, reason: "Diplomacy unlocks in Era 2." };
  if (a === b) return { ok: false, reason: "A nation cannot negotiate with itself." };
  if (!game.nations[a] || !game.nations[b]) return { ok: false, reason: "Nation unavailable." };
  if (!game.nations[a].active || !game.nations[b].active) return { ok: false, reason: "Conquered nations cannot negotiate." };
  return { ok: true };
}

function getDiplomacy(game: ServerGameState, a: string, b: string) {
  const key = pairKey(a, b);
  const diplomacy = game.diplomacy as Record<string, Record<string, any>>;
  if (!diplomacy[key]) diplomacy[key] = createDiplomacyRecord(a, b);
  normalizeDiplomacyRecord(diplomacy[key], a, b);
  return diplomacy[key];
}

function createDiplomacyRecord(a: string, b: string) {
  return {
    pair: pairKey(a, b),
    relation: 50,
    trades: 0,
    alliances: [],
    atWar: false,
    wars: 0,
    brokenAgreements: 0,
    dependency: { [a]: 0, [b]: 0 },
    embargoes: {},
  };
}

function normalizeDiplomacyRecord(record: Record<string, any>, a: string, b: string) {
  record.relation = numberValue(record.relation, 50);
  record.trades = numberValue(record.trades);
  record.alliances = Array.isArray(record.alliances) ? record.alliances : [];
  record.wars = numberValue(record.wars);
  record.brokenAgreements = numberValue(record.brokenAgreements);
  record.dependency = record.dependency && typeof record.dependency === "object" ? record.dependency : {};
  record.dependency[a] = numberValue(record.dependency[a]);
  record.dependency[b] = numberValue(record.dependency[b]);
  record.embargoes = record.embargoes && typeof record.embargoes === "object" ? record.embargoes : {};
}

function applyWarDiplomacyPenalty(game: ServerGameState, attackerId: string, defenderId: string) {
  const direct = getDiplomacy(game, attackerId, defenderId);
  let directPenalty = WAR.declarationRelationPenalty;
  if (numberValue(direct.trades) > 0 || hasTradeRouteHistory(game, attackerId, defenderId)) directPenalty += WAR.formerTradePartnerPenalty;
  if (hasAllianceHistory(game, attackerId, defenderId)) directPenalty += WAR.formerAlliancePenalty;
  direct.relation = Math.max(0, numberValue(direct.relation) - directPenalty);

  for (const nation of Object.values(game.nations)) {
    if (!nation.active || nation.id === attackerId || nation.id === defenderId) continue;
    const record = getDiplomacy(game, attackerId, nation.id);
    let penalty = WAR.globalTrustPenalty;
    if (numberValue(record.trades) > 0 || hasTradeRouteHistory(game, attackerId, nation.id)) penalty += WAR.globalFormerTradePartnerPenalty;
    if (hasAllianceHistory(game, attackerId, nation.id)) penalty += WAR.globalFormerAlliancePenalty;
    record.relation = Math.max(0, numberValue(record.relation) - penalty);
  }
}

function ensureTradeRoute(game: ServerGameState, a: string, b: string, options: { source?: string; tradeValue?: number; force?: boolean } = {}) {
  const tradeRoutes = game.tradeRoutes as Array<Record<string, any>>;
  const record = getDiplomacy(game, a, b);
  if (!options.force && numberValue(options.tradeValue) < TRADE.routes.creationMinimumValue) return null;
  if (numberValue(record.relation) < TRADE.routes.relationMinimum) return null;
  let route = tradeRoutes.find((item) => item.status !== "removed" && item.members?.includes(a) && item.members?.includes(b));
  if (!route) {
    route = {
      id: uniqueId("route"),
      members: [a, b],
      source: options.source || "trade",
      status: "active",
      createdTurn: game.turn,
      lastActiveTurn: game.turn,
      disruptedUntil: 0,
      tradeTurns: 0,
      tradeCount: 0,
    };
    tradeRoutes.push(route);
  }
  route.tradeCount = numberValue(route.tradeCount) + 1;
  route.lastActiveTurn = game.turn;
  return route;
}

function disruptTradeRoutes(game: ServerGameState, a: string, b: string, reason: string) {
  for (const route of game.tradeRoutes as Array<Record<string, any>>) {
    if (!route.members?.includes(a) || !route.members?.includes(b) || route.status === "removed") continue;
    route.status = "disrupted";
    route.disruptedUntil = game.turn + TRADE.routes.disruptionTurns;
    route.disruptionReason = reason;
  }
}

function transferBundle(from: Nation, to: Nation, bundle: ResourceBundle) {
  const normalized = normalizeBundle(bundle);
  from.money -= normalized.money || 0;
  to.money += normalized.money || 0;
  for (const resource of TRADE.pricing.resources) {
    from.resources[resource] = resourceCount(from, resource) - (normalized[resource as keyof ResourceBundle] || 0);
    to.resources[resource] = resourceCount(to, resource) + (normalized[resource as keyof ResourceBundle] || 0);
  }
  const people = normalized.people || 0;
  if (people > 0) {
    removePopulation(from, people);
    addPopulation(to, people);
  }
}

function ensureTradeProposals(game: ServerGameState): Array<Record<string, any>> {
  const state = game as ServerGameState & { tradeProposals?: Array<Record<string, any>> };
  if (!Array.isArray(state.tradeProposals)) state.tradeProposals = [];
  return state.tradeProposals as Array<Record<string, any>>;
}

function findTradeProposal(game: ServerGameState, payload: PlayerActionPayload): Record<string, any> | null {
  const proposalId = stringValue(payload.proposalId || payload.id);
  if (!proposalId) return null;
  return ensureTradeProposals(game).find((proposal) => proposal.id === proposalId && (proposal.status || "pending") === "pending") || null;
}

function removeTradeProposal(game: ServerGameState, proposalId: string) {
  const proposals = ensureTradeProposals(game);
  const index = proposals.findIndex((proposal) => proposal.id === proposalId);
  if (index >= 0) proposals.splice(index, 1);
}

function normalizeBundle(bundle: unknown): ResourceBundle {
  const input = bundle && typeof bundle === "object" ? bundle as Record<string, unknown> : {};
  const output: ResourceBundle = {};
  for (const key of ["money", "food", "materials", "education", "industry", "people"] as const) {
    output[key] = Math.max(0, Math.floor(Number(input[key]) || 0));
  }
  return output;
}

function hasNegativeBundle(bundle: unknown) {
  const input = bundle && typeof bundle === "object" ? bundle as Record<string, unknown> : {};
  return ["money", "food", "materials", "education", "industry", "people"].some((key) => Number(input[key]) < 0);
}

function bundleTotal(bundle: ResourceBundle) {
  return Object.values(bundle).reduce((sum, amount) => sum + Math.max(0, numberValue(amount)), 0);
}

function canPayBundle(nation: Nation, bundle: ResourceBundle) {
  if (nation.money < (bundle.money || 0)) return false;
  if (nation.population.available < (bundle.people || 0)) return false;
  for (const resource of TRADE.pricing.resources) {
    if (resourceCount(nation, resource) < (bundle[resource as keyof ResourceBundle] || 0)) return false;
  }
  return true;
}

function bundleValue(bundle: ResourceBundle) {
  let value = 0;
  for (const [key, amount] of Object.entries(bundle)) {
    value += (TRADE.bundleValues[key as keyof typeof TRADE.bundleValues] || 0) * numberValue(amount);
  }
  return value;
}

function increaseDependency(record: Record<string, any>, nationId: string, amount: number) {
  record.dependency = record.dependency && typeof record.dependency === "object" ? record.dependency : {};
  record.dependency[nationId] = Math.min(TRADE.dependency.max, numberValue(record.dependency[nationId]) + amount);
}

function areAllied(game: ServerGameState, a: string, b: string | null) {
  if (!b) return false;
  return (game.alliances as Array<Record<string, any>>).some((alliance) => {
    return alliance.active && alliance.members?.includes(a) && alliance.members?.includes(b);
  });
}

function areAtWar(game: ServerGameState, a: string, b: string | null) {
  if (!b) return false;
  return Boolean((game.wars as Record<string, any>)[pairKey(a, b)]?.active);
}

function resolveCombat(game: ServerGameState, attackerId: string, defenderId: string, attackingStrength: number, defendingStrength: number, targetTile: Tile, unitType: string) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  const unitConfig = unitTypeConfig(unitType);
  const attackerBranch =
    techBranchLevel(attacker, "tanks") * WAR.combat.attackerTankPower +
    techBranchLevel(attacker, "air") * WAR.combat.attackerAirPower +
    numberValue(attacker.tech.military) * WAR.combat.militaryTechPower;
  const defenderBranch =
    techBranchLevel(defender, "tanks") * WAR.combat.defenderTankPower +
    techBranchLevel(defender, "air") * WAR.combat.defenderAirPower +
    numberValue(defender.tech.military) * WAR.combat.militaryTechPower;
  const tileDefense = tileDefenseModifier(targetTile);
  const baseAttack = (attackingStrength + attackerBranch) * unitConfig.attackMultiplier;
  const baseDefense = defendingStrength + defenderBranch;
  const attack = baseAttack;
  const defense = baseDefense * tileDefense.multiplier + tileDefense.flatBonus;
  const margin = attack - defense;
  const attackerWins = margin > 0;
  const losses = {
    attacker: attackerWins ? Math.max(1, Math.ceil(defense * WAR.combat.winnerLossRate)) : Math.max(1, Math.ceil(attackingStrength * WAR.combat.loserLossRate)),
    defender: attackerWins ? Math.max(1, Math.ceil(defendingStrength * WAR.combat.loserLossRate)) : Math.max(1, Math.ceil(attack * WAR.combat.winnerLossRate)),
  };
  return {
    attackerWins,
    attack,
    defense,
    margin,
    losses,
    modifiers: { tileDefense, baseAttack, baseDefense, unitType: { id: unitType, label: unitConfig.label, attackMultiplier: unitConfig.attackMultiplier } },
    survivingAttackStrength: attackerWins ? Math.max(1, attackingStrength - losses.attacker) : 0,
    survivingDefenseStrength: attackerWins ? 0 : Math.max(1, defendingStrength - losses.defender),
  };
}

function applyBattleWarExhaustion(
  game: ServerGameState,
  attackerId: string,
  defenderId: string,
  losses: { attacker: number; defender: number },
  attackerWins: boolean,
) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  if (attacker?.active) {
    const multiplier = attackerWins ? WAR.exhaustion.winnerLossMultiplier : WAR.exhaustion.loserLossMultiplier;
    attacker.warExhaustion = clampWarExhaustion(numberValue(attacker.warExhaustion) + losses.attacker * WAR.exhaustion.battleLossPerUnit * multiplier);
  }
  if (defender?.active) {
    const multiplier = attackerWins ? WAR.exhaustion.loserLossMultiplier : WAR.exhaustion.winnerLossMultiplier;
    defender.warExhaustion = clampWarExhaustion(numberValue(defender.warExhaustion) + losses.defender * WAR.exhaustion.battleLossPerUnit * multiplier);
  }
}

function applyWarExhaustionProduction(nation: Nation, amount: number) {
  if (amount <= 0) return 0;
  const exhaustion = numberValue(nation.warExhaustion);
  if (exhaustion <= WAR.exhaustion.productionPenaltyThreshold) return amount;
  const pressure = (exhaustion - WAR.exhaustion.productionPenaltyThreshold) / Math.max(1, WAR.exhaustion.max - WAR.exhaustion.productionPenaltyThreshold);
  const penalty = WAR.exhaustion.productionMaxPenalty * Math.min(1, pressure);
  return Math.max(0, Math.ceil(amount * (1 - penalty)));
}

function clampWarExhaustion(value: number) {
  return Math.max(0, Math.min(WAR.exhaustion.max, value));
}

function recordWarLog(game: ServerGameState, report: Record<string, any>) {
  const state = game as ServerGameState & { warLog?: Array<Record<string, any>> };
  if (!Array.isArray(state.warLog)) state.warLog = [];
  state.warLog.push(report);
  if (state.warLog.length > 80) state.warLog.shift();
}

function applyStrikeOutcome(game: ServerGameState, from: Tile, to: Tile, outcome: ReturnType<typeof resolveCombat>, attackerId: string, defenderId: string, report: Record<string, any>) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  removePopulation(attacker, Math.min(attacker.population.total, outcome.losses.attacker));
  removePopulation(defender, Math.min(defender.population.total, outcome.losses.defender));
  applyBattleWarExhaustion(game, attackerId, defenderId, outcome.losses, outcome.attackerWins);
  incrementNestedStat(attacker.military, "unitsLost", outcome.losses.attacker);
  incrementNestedStat(defender.military, "unitsLost", outcome.losses.defender);
  const war = (game.wars as Record<string, any>)[pairKey(attackerId, defenderId)];
  if (war) war.battles = numberValue(war.battles) + 1;
  from.unit!.strength = outcome.attackerWins ? outcome.survivingAttackStrength : 0;
  trimUnitBranches(from.unit!);
  from.unit!.movedTurn = game.turn;
  if (from.unit!.strength <= 0) from.unit = null;
  if (to.unit) {
    to.unit.strength = outcome.attackerWins ? Math.max(0, to.unit.strength - outcome.losses.defender) : Math.max(1, outcome.survivingDefenseStrength);
    trimUnitBranches(to.unit);
    if (to.unit.strength <= 0) to.unit = null;
  }
  incrementNestedStat(attacker.military, outcome.attackerWins ? "battlesWon" : "battlesLost", 1);
  incrementNestedStat(defender.military, outcome.attackerWins ? "battlesLost" : "battlesWon", 1);
  report.territoryChanged = false;
  recomputeTerritories(game);
}

function applyCombatOutcome(game: ServerGameState, from: Tile, to: Tile, outcome: ReturnType<typeof resolveCombat>, attackerId: string, defenderId: string, report: Record<string, any>) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  removePopulation(attacker, Math.min(attacker.population.total, outcome.losses.attacker));
  removePopulation(defender, Math.min(defender.population.total, outcome.losses.defender));
  applyBattleWarExhaustion(game, attackerId, defenderId, outcome.losses, outcome.attackerWins);
  incrementNestedStat(attacker.military, "unitsLost", outcome.losses.attacker);
  incrementNestedStat(defender.military, "unitsLost", outcome.losses.defender);
  const war = (game.wars as Record<string, any>)[pairKey(attackerId, defenderId)];
  if (war) war.battles = numberValue(war.battles) + 1;

  if (outcome.attackerWins) {
    incrementNestedStat(attacker.military, "battlesWon", 1);
    incrementNestedStat(defender.military, "battlesLost", 1);
    const capitalCaptured = to.isCapital;
    clearSiegesForTile(game, to.id);
    clearSiegesFromTile(game, from.id, attackerId);
    to.ownerId = attackerId;
    to.workers = 0;
    from.unit!.strength = outcome.survivingAttackStrength;
    trimUnitBranches(from.unit!);
    to.unit = { ...from.unit!, nationId: attackerId, movedTurn: game.turn };
    from.unit = null;
    incrementStat(attacker, "tilesCaptured", 1);
    report.territoryChanged = true;
    if (capitalCaptured) {
      to.isCapital = false;
      report.capitalCaptured = true;
      incrementNestedStat(attacker.military, "capitalsCaptured", 1);
      conquerNation(game, defenderId, attackerId);
    }
  } else {
    incrementNestedStat(attacker.military, "battlesLost", 1);
    incrementNestedStat(defender.military, "battlesWon", 1);
    clearSiegesForTile(game, to.id, attackerId);
    clearSiegesFromTile(game, from.id, attackerId);
    from.unit = null;
    if (to.unit) {
      to.unit.strength = Math.max(1, outcome.survivingDefenseStrength);
      trimUnitBranches(to.unit);
    }
  }
  recomputeTerritories(game);
}

function conquerNation(game: ServerGameState, defenderId: string, winnerId: string) {
  const defender = game.nations[defenderId];
  if (!defender?.active) return;
  defender.active = false;
  for (const tile of game.map.tiles) {
    if (tile.ownerId === defenderId) {
      clearSiegesForTile(game, tile.id);
      tile.ownerId = winnerId;
      if (tile.unit?.nationId === defenderId) tile.unit = null;
    }
  }
  for (const [key, war] of Object.entries(game.wars as Record<string, any>)) {
    if (war.attackerId === defenderId || war.defenderId === defenderId) delete (game.wars as Record<string, any>)[key];
  }
  recomputeTerritories(game);
}

function defenderStrength(tile: Tile) {
  const base = tile.type === TILE_TYPES.MILITARY ? Math.max(tile.workers || 0, WORKER_MIN[TILE_TYPES.MILITARY]) : Math.ceil((tile.workers || 0) / 2);
  return base + (tile.unit?.strength || 0);
}

function tileDefenseModifier(tile: Tile) {
  const modifier = { multiplier: 1, flatBonus: 0, reasons: [] as string[] };
  if (tile.isCapital) {
    modifier.multiplier += WAR.defense.capital.multiplierBonus;
    modifier.flatBonus += WAR.defense.capital.flatBonus;
    modifier.reasons.push("capital");
  }
  if (WAR.defense.developed.types.includes(tile.type as any)) {
    modifier.multiplier += WAR.defense.developed.multiplierBonus;
    modifier.flatBonus += WAR.defense.developed.flatBonus;
    modifier.reasons.push("developed");
  }
  if (WAR.defense.highValue.types.includes(tile.type as any)) {
    modifier.multiplier += WAR.defense.highValue.multiplierBonus;
    modifier.flatBonus += WAR.defense.highValue.flatBonus;
    modifier.reasons.push("highValue");
  }
  return modifier;
}

function primaryUnitType(unit: NonNullable<Tile["unit"]>) {
  if (!unit?.strength) return "infantry";
  const branches = unit.branches || {};
  if (!Object.keys(branches).length) return normalizeUnitType(unit.branch);
  let best = normalizeUnitType(unit.branch);
  let bestStrength = -1;
  for (const branch of UNIT_TYPE_PRIORITY) {
    const strength = Math.max(0, Number(branches[branch] || 0));
    if (strength > bestStrength || (strength === bestStrength && UNIT_TYPE_PRIORITY.indexOf(branch) < UNIT_TYPE_PRIORITY.indexOf(best))) {
      best = branch;
      bestStrength = strength;
    }
  }
  return bestStrength > 0 ? normalizeUnitType(best) : normalizeUnitType(unit.branch);
}

function normalizeUnitType(type: unknown) {
  const value = String(type || "infantry").toLowerCase();
  if (value === "tank") return "tanks";
  if (value === "navy" || value === "fleet") return "naval";
  if (value === "aircraft" || value === "planes" || value === "plane") return "air";
  return value in UNIT_TYPES ? value : "infantry";
}

function isKnownUnitType(type: unknown) {
  const value = String(type || "infantry").toLowerCase();
  return ["tank", "navy", "fleet", "aircraft", "planes", "plane", ...Object.keys(UNIT_TYPES)].includes(value);
}

function unitTypeConfig(type: string) {
  return UNIT_TYPES[normalizeUnitType(type) as keyof typeof UNIT_TYPES] || UNIT_TYPES.infantry;
}

function addUnitBranch(unit: NonNullable<Tile["unit"]>, branch: string, amount: number) {
  unit.branches = unit.branches || {};
  const normalized = normalizeUnitType(branch);
  unit.branch = normalized;
  unit.branches[normalized] = Math.max(0, Number(unit.branches[normalized] || 0)) + amount;
  unit.strength = Object.values(unit.branches).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
}

function trimUnitBranches(unit: NonNullable<Tile["unit"]>) {
  unit.branches = unit.branches || { [normalizeUnitType(unit.branch)]: unit.strength };
  let remaining = Math.max(0, Math.floor(Number(unit.strength) || 0));
  for (const branch of UNIT_TYPE_PRIORITY) {
    if (!unit.branches[branch]) continue;
    const keep = Math.min(unit.branches[branch], remaining);
    unit.branches[branch] = keep;
    remaining -= keep;
  }
  for (const branch of Object.keys(unit.branches)) {
    if (unit.branches[branch] <= 0) delete unit.branches[branch];
  }
  unit.branch = primaryUnitType(unit);
}

function mergeUnitInto(existing: Tile["unit"], moving: NonNullable<Tile["unit"]>, nationId: string, turn: number) {
  const merged = existing && existing.nationId === nationId
    ? { ...existing, branches: { ...(existing.branches || {}) } }
    : { nationId, strength: 0, branch: moving.branch || "infantry", movedTurn: turn, branches: {} as Record<string, number> };
  const movingBranches = moving.branches && Object.keys(moving.branches).length ? moving.branches : { [normalizeUnitType(moving.branch)]: moving.strength };
  merged.branches = merged.branches || {};
  for (const [branch, amount] of Object.entries(movingBranches)) {
    merged.branches[normalizeUnitType(branch)] = Math.max(0, Number(merged.branches[normalizeUnitType(branch)] || 0)) + Math.max(0, Number(amount) || 0);
  }
  merged.strength = Object.values(merged.branches).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  merged.branch = primaryUnitType(merged);
  merged.movedTurn = turn;
  return merged;
}

function releaseTileWorkers(game: ServerGameState, tile: Tile) {
  if (!tile?.ownerId || !tile.workers) return 0;
  const nation = game.nations[tile.ownerId];
  const role = WORKER_ROLE_BY_TILE[tile.type];
  const released = tile.workers;
  if (nation && role) {
    nation.workers[role] = Math.max(0, workerCount(nation, role) - released);
    nation.population.available += released;
  }
  tile.workers = 0;
  return released;
}

function removePopulation(nation: Nation, rawAmount: number) {
  let remaining = Math.max(0, Math.floor(rawAmount));
  const before = remaining;
  const fromAvailable = Math.min(nation.population.available, remaining);
  nation.population.available -= fromAvailable;
  nation.population.total -= fromAvailable;
  remaining -= fromAvailable;
  for (const role of [WORKER_ROLES.SOLDIERS, WORKER_ROLES.ENGINEERS, WORKER_ROLES.SCHOLARS, WORKER_ROLES.MINERS, WORKER_ROLES.FISHERS, WORKER_ROLES.FARMERS]) {
    if (remaining <= 0) break;
    const lost = Math.min(workerCount(nation, role), remaining);
    nation.workers[role] = workerCount(nation, role) - lost;
    nation.population.total -= lost;
    remaining -= lost;
  }
  const removed = before - remaining;
  nation.population.total = Math.max(0, nation.population.total);
  nation.population.available = Math.max(0, nation.population.available);
  incrementStat(nation, "peopleLost", removed);
  if (nation.population.total <= 0) nation.active = false;
  return removed;
}

function addPopulation(nation: Nation, rawAmount: number) {
  const gain = Math.max(0, Math.floor(rawAmount));
  nation.population.total += gain;
  nation.population.available += gain;
  incrementStat(nation, "peopleGained", gain);
}

function activeTiles(game: ServerGameState, nationId: string, type: string) {
  return game.map.tiles.filter((tile) => tile.ownerId === nationId && tile.type === type && isTileActive(tile));
}

function activeTileCount(game: ServerGameState, nationId: string, types: string[]) {
  return types.reduce((sum, type) => sum + activeTiles(game, nationId, type).length, 0);
}

function isTileActive(tile: Tile) {
  if (!tile || !WORKER_MIN[tile.type]) return false;
  if (tile.effects?.disabledTurns > 0 || tile.effects?.floodedTurns > 0) return false;
  return (tile.workers || 0) >= WORKER_MIN[tile.type];
}

function tileTypeUnlocked(type: string, era: number) {
  if (type === TILE_TYPES.FACTORY) return era >= 3;
  return type !== TILE_TYPES.WATER;
}

function buildingCost(type: string, era: number) {
  const base = BUILD_COST[type] || 0;
  if (type === TILE_TYPES.FACTORY) return era >= 4 ? FACTORY_ERA_4_BUILD_COST : BUILD_COST[TILE_TYPES.FACTORY];
  if (era >= 4) return Math.ceil(base * BUILD_ERA_MULTIPLIERS.era4);
  if (era >= 3) return Math.ceil(base * BUILD_ERA_MULTIPLIERS.era3);
  return base;
}

function destroyCost(type: string) {
  if (type === TILE_TYPES.EMPTY || type === TILE_TYPES.WATER) return 0;
  return DESTROY_COST[type] || DESTROY_COST.default;
}

function destroyedFallbackType(type: string) {
  if (type === TILE_TYPES.FISHERY) return TILE_TYPES.WATER;
  if (type === TILE_TYPES.MOUNTAIN_MINE) return TILE_TYPES.MOUNTAIN;
  return TILE_TYPES.EMPTY;
}

function workerAdminCost(amount: number) {
  return Math.max(0, Math.ceil(amount) * WORKER_ADMIN_COST_PER_WORKER);
}

function tileById(game: ServerGameState, id: string) {
  return game.map.tiles.find((tile) => tile.id === id) || null;
}

function neighbors(game: ServerGameState, id: string) {
  const tile = tileById(game, id);
  if (!tile) return [];
  return HEX_DIRECTIONS
    .map((dir) => tileByCoords(game, tile.q + dir.q, tile.r + dir.r))
    .filter((neighbor): neighbor is NonNullable<typeof neighbor> => Boolean(neighbor));
}

function tileByCoords(game: ServerGameState, q: number, r: number) {
  return game.map.tiles.find((tile) => tile.q === q && tile.r === r) || null;
}

function isLand(tile?: Tile | null) {
  return tile && tile.terrain === "land" && !isWaterLike(tile) && tile.type !== TILE_TYPES.MOUNTAIN;
}

function isWaterLike(tile?: Tile | null) {
  return tile && (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.FISHERY);
}

function isCoastalTile(game: ServerGameState, tile: Tile) {
  if (!tile || isWaterLike(tile)) return true;
  return neighbors(game, tile.id).some((neighbor) => isWaterLike(neighbor));
}

function bordersNation(game: ServerGameState, tile: Tile, nationId: string) {
  return neighbors(game, tile.id).some((neighbor) => neighbor.ownerId === nationId);
}

function hasNavalAccess(nation: Nation) {
  return techBranchLevel(nation, "naval") > 0;
}

function hexDistance(a: Tile, b: Tile) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

function recomputeTerritories(game: ServerGameState) {
  for (const nation of Object.values(game.nations)) {
    nation.territory = game.map.tiles.filter((tile) => tile.ownerId === nation.id).map((tile) => tile.id);
    nation.capitalTileId = game.map.tiles.find((tile) => tile.ownerId === nation.id && tile.isCapital)?.id || nation.capitalTileId;
  }
}

function createVictoryState(game: ServerGameState, winnerId: string, victoryType: string, label: string, reason: string) {
  const winner = game.nations[winnerId];
  return {
    isGameOver: true,
    type: victoryType,
    victoryType,
    label,
    winnerId,
    winnerNationId: winnerId,
    winnerPlayerId: winner?.sessionId || null,
    turn: game.turn,
    turnNumber: game.turnNumber || game.turn,
    reason,
    scores: scoreboard(game),
  };
}

function scoreboard(game: ServerGameState) {
  return Object.values(game.nations)
    .map((nation) => ({
      id: nation.id,
      name: nation.name,
      active: nation.active,
      score: scoreNation(game, nation),
      money: nation.money,
      population: nation.population.total,
      territory: nation.territory.length,
      military: militaryPower(game, nation.id),
    }))
    .sort((a, b) => b.score - a.score);
}

function scoreNation(game: ServerGameState, nation: Nation) {
  const resourceScore = ["food", "materials", "education", "industry"].reduce((sum, resource) => sum + resourceCount(nation, resource), 0);
  return Math.round(
    numberValue(nation.money) +
      resourceScore +
      numberValue(nation.population.total) * 8 +
      numberValue(nation.territory.length) * 45 +
      militaryPower(game, nation.id) * 18 +
      numberValue(nation.tech.farming + nation.tech.mining + nation.tech.education + nation.tech.infrastructure + nation.tech.military) * 75,
  );
}

function militaryPower(game: ServerGameState, nationId: string) {
  const nation = game.nations[nationId];
  if (!nation?.active) return 0;
  const unitStrength = game.map.tiles
    .filter((tile) => tile.ownerId === nationId)
    .reduce((sum, tile) => sum + numberValue(tile.unit?.strength), 0);
  const staffedBases = game.map.tiles
    .filter((tile) => tile.ownerId === nationId && tile.type === TILE_TYPES.MILITARY)
    .reduce((sum, tile) => sum + numberValue(tile.workers), 0);
  return Math.round(
    unitStrength +
      staffedBases +
      numberValue(nation.tech.military) * 6 +
      techBranchLevel(nation, "tanks") * 10 +
      techBranchLevel(nation, "air") * 9 +
      techBranchLevel(nation, "naval") * 8,
  );
}

function cleanupSieges(game: ServerGameState) {
  for (const [tileId, siege] of Object.entries(game.sieges as Record<string, any>)) {
    const target = tileById(game, String(siege.tileId));
    const staging = tileById(game, String(siege.fromTileId));
    const attacker = game.nations[String(siege.attackerId)];
    const defender = game.nations[String(siege.defenderId)];
    const valid =
      target &&
      staging &&
      attacker?.active &&
      defender?.active &&
      target.ownerId === siege.defenderId &&
      staging.ownerId === siege.attackerId &&
      staging.unit?.nationId === siege.attackerId &&
      numberValue(staging.unit?.strength) > 0 &&
      neighbors(game, target.id).some((tile) => tile.id === staging.id);
    if (!valid) delete (game.sieges as Record<string, any>)[tileId];
  }
}

function clearSiegesForTile(game: ServerGameState, tileId: string, attackerId: string | null = null) {
  const siege = (game.sieges as Record<string, any>)[tileId];
  if (!siege) return false;
  if (attackerId && siege.attackerId !== attackerId) return false;
  delete (game.sieges as Record<string, any>)[tileId];
  return true;
}

function clearSiegesFromTile(game: ServerGameState, fromTileId: string, attackerId: string | null = null) {
  for (const [tileId, siege] of Object.entries(game.sieges as Record<string, any>)) {
    if (siege.fromTileId !== fromTileId) continue;
    if (attackerId && siege.attackerId !== attackerId) continue;
    delete (game.sieges as Record<string, any>)[tileId];
  }
}

function spendMoney(nation: Nation, amount: number) {
  const cost = Math.max(0, Math.ceil(amount));
  if (nation.money < cost) return false;
  nation.money -= cost;
  incrementStat(nation, "moneySpent", cost);
  return true;
}

function resetTurnActions(game: ServerGameState, nationId: string) {
  const nation = game.nations[nationId];
  if (!nation) return;
  normalizeActionPointState(nation);
  nation.actionPoints = nation.maxActionPoints;
  nation.actionsRemaining = nation.actionPoints;
  nation.actionsUsedThisTurn = 0;
}

export function resetActionPointsForTurn(game: ServerGameState, nationId: string) {
  resetTurnActions(game, nationId);
}

function addEvent(
  game: ServerGameState,
  message: string,
  options: { nationId?: string | null; type?: string; tileId?: string | null } = {},
) {
  const entry = {
    id: uniqueId("event"),
    turn: game.turn,
    era: game.era,
    phase: game.phase,
    nationId: options.nationId || null,
    type: options.type || "info",
    tileId: options.tileId || null,
    message,
    timestamp: Date.now(),
  };
  game.events.push(entry);
  if (game.events.length > 140) game.events.shift();

  const nation = options.nationId ? game.nations[options.nationId] : null;
  const history = nation?.stats.history;
  if (Array.isArray(history)) {
    history.unshift({
      turn: game.turn,
      message,
      type: options.type || "action",
    });
    if (history.length > 12) history.pop();
  }
}

function normalizeActionCount(value: unknown, fallback: number, max = Math.max(DEFAULT_ACTION_POINTS_PER_TURN, fallback)) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(max, numeric));
}

function normalizeActionPointState(nation: Nation) {
  nation.maxActionPoints = normalizeMaxActionPoints(nation.maxActionPoints);
  const rawPoints = nation.actionPoints ?? nation.actionsRemaining;
  nation.actionPoints = normalizeActionCount(rawPoints, nation.maxActionPoints, nation.maxActionPoints);
  nation.actionsRemaining = nation.actionPoints;
  nation.actionsUsedThisTurn = Math.max(0, Math.floor(Number(nation.actionsUsedThisTurn) || 0));
}

function normalizeMaxActionPoints(value: unknown) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_ACTION_POINTS_PER_TURN;
  return Math.max(1, numeric);
}

function typeLabel(type: string) {
  if (type === TILE_TYPES.MILITARY) return "Military Base";
  if (type === TILE_TYPES.MOUNTAIN_MINE) return "Mountain Mine";
  return String(type).replace(/^\w/, (letter) => letter.toUpperCase());
}

function resourceCount(nation: Nation, resource: string) {
  return numberValue(nation.resources?.[resource]);
}

function workerCount(nation: Nation, role: string) {
  return numberValue(nation.workers?.[role]);
}

function techBranchLevel(nation: Nation, branch: string) {
  return numberValue(nation.tech?.branches?.[branch]);
}

function incrementStat(nation: Nation, key: string, amount: number) {
  nation.stats[key] = numberValue(nation.stats[key]) + amount;
}

function incrementNestedStat(record: Record<string, unknown>, key: string, amount: number) {
  record[key] = numberValue(record[key]) + amount;
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("::");
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function reject(code: string, message: string): ActionResult {
  return { ok: false, code, message, reason: message };
}

function normalizeActionResult(result: ActionResult, actionType = "ACTION_ERROR"): ActionResult {
  if (result.ok) return result;
  const message = result.message || result.reason || "That action is not legal right now.";
  return {
    ok: false,
    code: result.code || errorCodeForMessage(message, actionType),
    message,
    reason: message,
  };
}

function errorCodeForMessage(message: string, actionType = "ACTION_ERROR") {
  if (/action points/i.test(message)) return "INSUFFICIENT_ACTION_POINTS";
  if (/not your turn|turn/i.test(message) && !/turn limit/i.test(message)) return "INVALID_TURN";
  if (/control|owned|foreign|participant|target nation/i.test(message)) return "OWNERSHIP_MISMATCH";
  if (/requires|afford|money|food|materials|education|industry|population|resource/i.test(message)) return "INSUFFICIENT_RESOURCES";
  if (/unknown|invalid|required|not found|positive|number|unsupported/i.test(message)) return "INVALID_PAYLOAD";
  if (/war|attack|move|target|range/i.test(message)) return "INVALID_TARGET";
  return `${normalizeServerActionType(actionType) || "ACTION"}_REJECTED`;
}

function hasTradeRouteHistory(game: ServerGameState, a: string, b: string) {
  return (game.tradeRoutes as Array<Record<string, any>>).some((route) => route.members?.includes(a) && route.members?.includes(b));
}

function hasAllianceHistory(game: ServerGameState, a: string, b: string) {
  return (game.alliances as Array<Record<string, any>>).some((alliance) => alliance.members?.includes(a) && alliance.members?.includes(b));
}
