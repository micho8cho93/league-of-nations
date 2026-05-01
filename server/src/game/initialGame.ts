import { normalizeAdvancedResources } from "./advanced.js";
import { refreshVictoryProgress } from "./victory.js";
import { createInitialSociety } from "./cultureReligion.js";

type ControllerType = "human" | "bot";
type MapOptionLevel = "Low" | "Balanced" | "High";
type GameMode = "lite" | "advanced";
type LandscapeDiversity = MapOptionLevel | "high" | "superHigh";
type Biome = "grassland" | "desert" | "arctic" | "jungle" | "woods" | "water";

export interface InitialGameSettings {
  mode?: GameMode;
  mapSize: "Small" | "Medium" | "Large" | "Extra Large" | "Enormous";
  waterLevel?: MapOptionLevel;
  landscapeDiversity?: LandscapeDiversity;
  fogOfWarEnabled?: boolean;
  nationCount: number;
  maxTurns: number;
  turnTimerMinutes: number;
  timeLimitMinutes?: number;
  unlimitedMode: boolean;
  happinessEnabled?: boolean;
  seed: number;
  victory?: {
    economicGoldThreshold?: number;
  };
}

export interface SeatPlayer {
  sessionId: string;
  name?: string;
  playerName?: string;
  host: boolean;
  connected: boolean;
  nationId: string;
}

interface Nation {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;
  profile: string;
  personality: string;
  controllerType: ControllerType;
  sessionId: string | null;
  bot: boolean;
  isBot: boolean;
  active: boolean;
  actionPoints: number;
  maxActionPoints: number;
  actionsRemaining: number;
  actionsUsedThisTurn: number;
  capitalTileId: string | null;
  territory: string[];
  discoveredNations: string[];
  culture: {
    homeCultureId: string;
    mix: Record<string, number>;
    dominantCultureId: string;
  };
  religion: {
    stateReligionId: string | null;
    chosenTurn: number | null;
    prevalence: Record<string, number>;
    dominantReligionId: string | null;
  };
  warExhaustion: number;
  reputation: number;
  mobilizationLevel: number;
  population: {
    total: number;
    available: number;
    happiness: number;
  };
  money: number;
  resources: Record<string, number>;
  workers: Record<string, number>;
  diplomacy: Record<string, unknown>;
  military: Record<string, unknown>;
  tech: {
    farming: number;
    mining: number;
    education: number;
    infrastructure: number;
    military: number;
    branches: Record<string, number>;
  };
  stats: Record<string, unknown>;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  terrain: "land" | "water";
  landform: "continent" | "island" | "sea";
  biome: Biome;
  type: string;
  infrastructure?: string;
  ownerId: string | null;
  workers: number;
  unit: null | {
    nationId: string;
    strength: number;
    branch: string;
    movedTurn: number;
    branches?: Record<string, number>;
  };
  regionId: number | null;
  isCapital: boolean;
  effects: {
    disabledTurns: number;
    floodedTurns: number;
    bountifulTurns: number;
  };
}

export interface ServerGameState {
  gameId: string;
  roomId: string;
  status: "playing";
  settings: InitialGameSettings;
  turn: number;
  turnNumber: number;
  currentTurnIndex: number;
  era: number;
  phase: "player";
  nations: Record<string, Nation>;
  botIds: string[];
  map: {
    size: string;
    radius: number;
    seed: number;
    landRatio: number;
    tiles: Tile[];
  };
  diplomacy: Record<string, unknown>;
  wars: Record<string, unknown>;
  sieges: Record<string, unknown>;
  trades: unknown[];
  tradeProposals: unknown[];
  tradeRoutes: unknown[];
  alliances: unknown[];
  warLog: unknown[];
  events: Array<Record<string, unknown>>;
  activeEvents: Array<Record<string, unknown>>;
  eventHistory: Array<Record<string, unknown>>;
  eraReports: unknown[];
  pendingEraReport: null;
  globalEvents: Record<string, unknown>;
  gameOver: null | Record<string, unknown>;
  victoryProgress: null | Record<string, unknown>;
  selectedTileId: null;
  lastSummary: null | Record<string, unknown>;
  startedAt: number;
  turnStartedAt: number;
  isProcessingTurn: boolean;
  playerId: string;
  seats: SeatAssignment[];
}

export interface SeatAssignment {
  nationId: string;
  sessionId: string | null;
  playerName: string;
  controllerType: ControllerType;
  bot: boolean;
  isBot: boolean;
  host: boolean;
}

export const DEFAULT_ACTION_POINTS_PER_TURN = 5;

const MAP_SIZES = {
  Small: { radius: 7 },
  Medium: { radius: 10 },
  Large: { radius: 13 },
  "Extra Large": { radius: 18 },
  Enormous: { radius: 24 },
} as const;

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

const WORKER_ROLES = {
  FARMERS: "farmers",
  FISHERS: "fishers",
  MINERS: "miners",
  SCHOLARS: "scholars",
  ENGINEERS: "engineers",
  SOLDIERS: "soldiers",
} as const;

const WORKER_MIN = {
  [TILE_TYPES.FARM]: 2,
  [TILE_TYPES.FISHERY]: 2,
  [TILE_TYPES.MINE]: 3,
  [TILE_TYPES.MOUNTAIN_MINE]: 4,
  [TILE_TYPES.SCHOOL]: 3,
  [TILE_TYPES.UNIVERSITY]: 5,
  [TILE_TYPES.FACTORY]: 5,
  [TILE_TYPES.MILITARY]: 4,
};

const NATION_COLOR_PALETTE = [
  "#2dd4bf",
  "#fb7185",
  "#60a5fa",
  "#fbbf24",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#f97316",
  "#22d3ee",
  "#bef264",
];

const STARTING_PROFILES = {
  small: {
    territoryTarget: 5,
    population: 24,
    money: 1320,
    resources: { food: 58, materials: 29, education: 18, industry: 0 },
  },
  balanced: {
    territoryTarget: 7,
    population: 32,
    money: 990,
    resources: { food: 80, materials: 40, education: 25, industry: 0 },
  },
  large: {
    territoryTarget: 9,
    population: 42,
    money: 700,
    resources: { food: 102, materials: 51, education: 33, industry: 0 },
  },
};

const NATION_NAMES = [
  "Republic of Nova",
  "Republic of Arden",
  "Vesper Union",
  "Meridian League",
  "Duchy of Solenne",
  "Orun Free Cities",
  "Caldor Dominion",
  "Istrian Commonwealth",
  "Kestral Accord",
  "Namar Isles",
  "Maritane Compact",
  "Aurelian Federation",
  "Peregrine States",
  "Valora Assembly",
  "Rookhaven League",
  "Sable Coast",
];

const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
];

export function createInitialServerGame(settings: InitialGameSettings, players: SeatPlayer[]): ServerGameState {
  settings = normalizeInitialGameSettings(settings);
  const territoryRng = mulberry32(settings.seed);
  const nameRng = mulberry32(settings.seed + 5050);
  const map = createMapData(settings);
  const seats = createSeatAssignments(settings.nationCount, players, nameRng);
  const profiles = profileSequence(settings.nationCount);
  const nations: Record<string, Nation> = {};
  const botIds: string[] = [];

  seats.forEach((seat, index) => {
    const profile = profiles[index] || "balanced";
    const nation = createNation({
      id: seat.nationId,
      name: seat.playerName,
      color: nationColor(index),
      profile,
      personality: seat.controllerType === "bot" ? personalityAt(botIds.length) : "balanced",
      controllerType: seat.controllerType,
      sessionId: seat.sessionId,
      bot: seat.bot,
    });
    if (settings.mode === "advanced") normalizeAdvancedResources(nation);

    nations[nation.id] = nation;
    if (nation.bot) botIds.push(nation.id);
  });

  assignStartingTerritories(map, Object.values(nations), territoryRng);

  const startedAt = Date.now();
  const game: ServerGameState = {
    settings,
    gameId: "",
    roomId: "",
    status: "playing",
    turn: 1,
    turnNumber: 1,
    currentTurnIndex: 0,
    era: 1,
    phase: "player",
    nations,
    botIds,
    map,
    diplomacy: {},
    wars: {},
    sieges: {},
    trades: [],
    tradeProposals: [],
    tradeRoutes: [],
    alliances: [],
    warLog: [],
    events: [
      {
        id: `event-${startedAt}-server-start`,
        turn: 1,
        era: 1,
        phase: "player",
        nationId: null,
        type: "system",
        tileId: null,
        message: `Server started the game with ${settings.nationCount} nations on a ${settings.mapSize.toLowerCase()} map.`,
        timestamp: startedAt,
      },
      ...botIds.map((botId, index) => ({
        id: `event-${startedAt}-bot-${index}`,
        turn: 1,
        era: 1,
        phase: "player",
        nationId: botId,
        type: "ai",
        tileId: null,
        message: `${nations[botId].name} plays as a ${nations[botId].personality} nation.`,
        timestamp: startedAt + index + 1,
      })),
    ],
    activeEvents: [],
    eventHistory: [],
    eraReports: [],
    pendingEraReport: null,
    globalEvents: {},
    gameOver: null,
    victoryProgress: null,
    selectedTileId: null,
    lastSummary: null,
    startedAt,
    turnStartedAt: startedAt,
    isProcessingTurn: false,
    playerId: seats.find((seat) => seat.controllerType === "human")?.nationId || seats[0]?.nationId || "nation-1",
    seats,
  };
  refreshVictoryProgress(game);
  return game;
}

function normalizeInitialGameSettings(settings: InitialGameSettings): InitialGameSettings {
  const mode = normalizeGameMode(settings.mode);
  return {
    ...settings,
    mode,
    waterLevel: sanitizeMapOptionLevel(settings.waterLevel),
    landscapeDiversity: normalizeLandscapeDiversity(settings.landscapeDiversity, mode),
    fogOfWarEnabled: settings.fogOfWarEnabled === true,
    happinessEnabled: settings.happinessEnabled !== false,
  };
}

function sanitizeMapOptionLevel(value: unknown): MapOptionLevel {
  return value === "Low" || value === "Balanced" || value === "High" ? value : "Balanced";
}

function normalizeGameMode(value: unknown): GameMode {
  return value === "advanced" ? "advanced" : "lite";
}

function normalizeLandscapeDiversity(value: unknown, mode: GameMode): LandscapeDiversity {
  if (mode === "advanced") return value === "superHigh" ? "superHigh" : "high";
  return sanitizeMapOptionLevel(value);
}

export function serializeGameSnapshot(game: ServerGameState | Record<string, any>) {
  const gameState = serializableGameState(game);
  return {
    gameState,
    seats: deepClone(game.seats || []),
    startedAt: game.startedAt,
    nations: Object.values(game.nations || {}).map((nation: any) => ({
      id: nation.id,
      name: nation.name,
      color: nation.color,
      controllerType: nation.controllerType,
      sessionId: nation.sessionId,
      bot: nation.bot,
      isBot: Boolean(nation.isBot ?? nation.bot),
      territory: nation.territory.length,
      capitalTileId: nation.capitalTileId,
    })),
  };
}

function serializableGameState(game: ServerGameState | Record<string, any>) {
  return deepClone({
    gameId: game.gameId,
    roomId: game.roomId,
    status: game.status,
    settings: game.settings,
    turn: game.turn,
    turnNumber: game.turnNumber,
    currentTurnIndex: game.currentTurnIndex,
    era: game.era,
    phase: game.phase,
    nations: game.nations,
    playerId: game.playerId,
    botIds: game.botIds,
    map: game.map,
    diplomacy: game.diplomacy,
    wars: game.wars,
    sieges: game.sieges,
    trades: game.trades,
    tradeProposals: game.tradeProposals || [],
    tradeRoutes: game.tradeRoutes,
    alliances: game.alliances,
    warLog: game.warLog || [],
    events: game.events,
    activeEvents: game.activeEvents || [],
    eventHistory: game.eventHistory || [],
    eraReports: game.eraReports,
    pendingEraReport: game.pendingEraReport,
    globalEvents: game.globalEvents,
    gameOver: game.gameOver,
    victoryProgress: game.victoryProgress,
    selectedTileId: null,
    lastSummary: game.lastSummary,
    startedAt: game.startedAt,
    turnStartedAt: game.turnStartedAt,
    isProcessingTurn: game.isProcessingTurn,
    seats: game.seats || [],
  });
}

function createSeatAssignments(nationCount: number, players: SeatPlayer[], rng = Math.random): SeatAssignment[] {
  const assignments: SeatAssignment[] = [];
  const playersByNation = new Map(players.map((player) => [player.nationId, player]));
  const humanNames = new Set(players.map((player) => player.name || player.playerName).filter(Boolean));
  const botNamePool = shuffle(NATION_NAMES.filter((name) => !humanNames.has(name)), rng);
  let fallbackNationIndex = 1;

  const nextBotName = () => {
    const name = botNamePool.shift();
    if (name) return name;
    while (humanNames.has(`Nation ${fallbackNationIndex}`)) fallbackNationIndex += 1;
    const fallback = `Nation ${fallbackNationIndex}`;
    fallbackNationIndex += 1;
    return fallback;
  };

  for (let index = 0; index < nationCount; index += 1) {
    const nationId = `nation-${index + 1}`;
    const player = playersByNation.get(nationId);
    if (player) {
      assignments.push({
        nationId,
        sessionId: player.sessionId,
        playerName: player.name || player.playerName || `Player ${index + 1}`,
        controllerType: "human",
        bot: false,
        isBot: false,
        host: player.host,
      });
      continue;
    }

    assignments.push({
      nationId,
      sessionId: null,
      playerName: nextBotName(),
      controllerType: "bot",
      bot: true,
      isBot: true,
      host: false,
    });
  }

  return assignments;
}

function createNation({
  id,
  name,
  color,
  profile,
  personality,
  controllerType,
  sessionId,
  bot,
}: {
  id: string;
  name: string;
  color: string;
  profile: string;
  personality: string;
  controllerType: ControllerType;
  sessionId: string | null;
  bot: boolean;
}): Nation {
  const start = STARTING_PROFILES[profile as keyof typeof STARTING_PROFILES] || STARTING_PROFILES.balanced;
  const population = start.population;

  const nation = {
    id,
    name,
    color,
    isPlayer: controllerType === "human",
    profile,
    personality,
    controllerType,
    sessionId,
    bot,
    isBot: bot,
    active: true,
    actionPoints: DEFAULT_ACTION_POINTS_PER_TURN,
    maxActionPoints: DEFAULT_ACTION_POINTS_PER_TURN,
    actionsRemaining: DEFAULT_ACTION_POINTS_PER_TURN,
    actionsUsedThisTurn: 0,
    capitalTileId: null,
    territory: [],
    discoveredNations: [id],
    ...createInitialSociety(id),
    warExhaustion: 0,
    reputation: 0,
    mobilizationLevel: 0,
    population: {
      total: population,
      available: Math.max(0, population - 8),
      happiness: 65,
    },
    money: start.money,
    resources: { ...start.resources },
    workers: {
      [WORKER_ROLES.FARMERS]: 2,
      [WORKER_ROLES.FISHERS]: 0,
      [WORKER_ROLES.MINERS]: 0,
      [WORKER_ROLES.SCHOLARS]: 0,
      [WORKER_ROLES.ENGINEERS]: 0,
      [WORKER_ROLES.SOLDIERS]: 6,
    },
    diplomacy: {},
    military: {
      unitsTrained: 0,
      unitsLost: 0,
      battlesWon: 0,
      battlesLost: 0,
      capitalsCaptured: 0,
      branchFocus: null,
    },
    tech: {
      farming: 0,
      mining: 0,
      education: 0,
      infrastructure: 0,
      military: 0,
      branches: {
        tanks: 0,
        air: 0,
        naval: 0,
      },
    },
    stats: {
      built: 0,
      destroyed: 0,
      tilesCaptured: 0,
      warsDeclared: 0,
      tradesAccepted: 0,
      alliancesFormed: 0,
      turnsAtWar: 0,
      peopleLost: 0,
      peopleGained: 0,
      moneyEarned: 0,
      moneySpent: 0,
      resourcesProduced: 0,
      techResearched: 0,
      eventsSuffered: 0,
      history: [],
    },
  };
  return nation;
}

function createMapData(settings: InitialGameSettings): ServerGameState["map"] {
  const sizeInfo = MAP_SIZES[settings.mapSize] || MAP_SIZES.Medium;
  const radius = sizeInfo.radius;
  const seed = Number(settings.seed || 1);
  const coords = hexMapCoords(radius);
  const rng = mulberry32(seed);
  const mode = normalizeGameMode(settings.mode);
  const nationCount = Math.max(2, Math.floor(Number(settings.nationCount) || 5));
  const waterRatio = targetWaterRatio(coords.length, nationCount, settings.waterLevel);
  const initialWaterRatio = Math.max(0.16, waterRatio - 0.045);
  const targetLandRatio = 1 - waterRatio;
  const initialLandRatio = 1 - initialWaterRatio;
  const continentCount = nationCount <= 4 ? randInt(rng, 1, 2) : nationCount <= 7 ? randInt(rng, 2, 3) : randInt(rng, 3, 4);
  const islandCount = Math.max(6, Math.floor(radius * 0.9) + randInt(rng, 0, 3));
  const archipelagoCount = Math.max(2, Math.floor(radius / 4));
  const channelCount = 2 + Math.floor(rng() * 3);
  const centers: Array<{
    q: number;
    r: number;
    radius: number;
    weight: number;
    kind: "continent" | "island";
  }> = [];

  for (let index = 0; index < continentCount; index += 1) {
    centers.push({
      q: randInt(rng, -Math.floor(radius * 0.62), Math.floor(radius * 0.62)),
      r: randInt(rng, -Math.floor(radius * 0.62), Math.floor(radius * 0.62)),
      radius: radius * (0.31 + rng() * 0.18),
      weight: 1.35 + rng() * 0.55,
      kind: "continent" as const,
    });
  }

  for (let index = 0; index < islandCount; index += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * (0.22 + rng() * 0.7);
    centers.push({
      q: Math.round(Math.cos(angle) * distance),
      r: Math.round(Math.sin(angle) * distance * 0.6),
      radius: 1.1 + rng() * 2.7,
      weight: 0.72 + rng() * 0.62,
      kind: "island" as const,
    });
  }

  for (let index = 0; index < archipelagoCount; index += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * (0.18 + rng() * 0.62);
    const baseQ = Math.round(Math.cos(angle) * distance);
    const baseR = Math.round(Math.sin(angle) * distance * 0.72);
    for (let child = 0; child < 3 + Math.floor(rng() * 3); child += 1) {
      centers.push({
        q: baseQ + randInt(rng, -2, 2),
        r: baseR + randInt(rng, -2, 2),
        radius: 0.9 + rng() * 1.6,
        weight: 0.58 + rng() * 0.48,
        kind: "island" as const,
      });
    }
  }

  const channels = Array.from({ length: channelCount }, () => ({
    angle: rng() * Math.PI * 2,
    offset: (rng() - 0.5) * radius * 1.35,
    width: 0.6 + rng() * 1.25,
    strength: 0.8 + rng() * 0.75,
  }));

  const scored = coords.map((coord) => {
    const edge = Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r)) / radius;
    let score = 0.18 - edge * 0.14 + hash2d(coord.q, coord.r, seed) * 0.5;
    let nearestKind: "continent" | "island" = "continent";
    let bestInfluence = 0;

    for (const center of centers) {
      const dist = hexDistance(coord, center);
      const influence = Math.max(0, 1 - dist / center.radius) * center.weight;
      if (influence > bestInfluence) {
        bestInfluence = influence;
        nearestKind = center.kind;
      }
      score += influence;
    }

    for (const channel of channels) {
      const x = coord.q + coord.r * 0.5;
      const y = coord.r * 0.866;
      const dist = Math.abs(x * Math.cos(channel.angle) + y * Math.sin(channel.angle) - channel.offset);
      score -= Math.max(0, 1 - dist / channel.width) * channel.strength;
    }

    score += hash2d(coord.q * 3 + 17, coord.r * 5 - 11, seed + 91) * 0.26;
    score += hash2d(Math.floor(coord.q / 2) + 31, Math.floor(coord.r / 2) - 19, seed + 313) * 0.18;
    return { ...coord, score, nearestKind };
  });

  const initialLandCount = Math.round(scored.length * initialLandRatio);
  const landIds = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, initialLandCount)
      .map((coord) => tileId(coord.q, coord.r))
  );

  const tiles: Tile[] = scored.map((coord) => {
    const land = landIds.has(tileId(coord.q, coord.r));
    return {
      id: tileId(coord.q, coord.r),
      q: coord.q,
      r: coord.r,
      terrain: land ? "land" : "water",
      landform: land ? coord.nearestKind : "sea",
      biome: land ? "grassland" : "water",
      type: land ? TILE_TYPES.EMPTY : TILE_TYPES.WATER,
      infrastructure: "none",
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
    };
  });

  carveWaterFeatures(tiles, radius, seed, Math.round(scored.length * targetLandRatio));
  if (mode === "advanced") assignAdvancedBiomes(tiles, radius, seed, settings.landscapeDiversity);
  else assignBiomes(tiles, radius, seed, settings.landscapeDiversity as MapOptionLevel | undefined);
  addMountainRanges(tiles, radius, seed, nationCount);

  const map = {
    size: settings.mapSize,
    radius,
    seed,
    landRatio: tiles.filter((tile) => tile.terrain === "land").length / scored.length,
    tiles,
  };
  assignRegions(map);
  return map;
}

function targetWaterRatio(tileCount: number, nationCount: number, waterLevel: MapOptionLevel = "Balanced") {
  const requested = {
    Low: 0.25,
    Balanced: 0.4,
    High: 0.55,
  }[waterLevel] || 0.4;
  const requiredBuildable = nationCount * 10 + 12;
  const maxByLandNeed = 1 - requiredBuildable / tileCount;
  return clampNumber(requested, 0.2, Math.max(0.2, Math.min(0.6, maxByLandNeed)));
}

function carveWaterFeatures(tiles: Tile[], radius: number, seed: number, targetLandCount: number) {
  let budget = Math.max(0, tiles.filter((tile) => tile.terrain === "land").length - targetLandCount);
  if (budget <= 0) return;
  const index = buildTileIndex(tiles);
  const candidates = tiles
    .filter((tile) => tile.terrain === "land")
    .map((tile) => {
      const neighbors = axialNeighbors(tile.q, tile.r).map((coord) => index.get(tileId(coord.q, coord.r))).filter(Boolean) as Tile[];
      const waterNeighbors = neighbors.filter((neighbor) => neighbor.terrain === "water").length;
      const landNeighbors = neighbors.filter((neighbor) => neighbor.terrain === "land").length;
      const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r)) / radius;
      const lakeNoise = 1 - hash2d(tile.q * 5 - 4, tile.r * 7 + 9, seed + 4242);
      const inletNoise = 1 - hash2d(tile.q * 13 + 2, tile.r * 11 - 5, seed + 9090);
      const lakeScore = landNeighbors >= 5 && edge < 0.82 ? lakeNoise * 1.35 : 0;
      const inletScore = waterNeighbors > 0 ? inletNoise * (0.7 + waterNeighbors * 0.22) : 0;
      return { tile, score: Math.max(lakeScore, inletScore) };
    })
    .filter((entry) => entry.score > 0.52)
    .sort((a, b) => b.score - a.score);

  for (const { tile } of candidates) {
    if (budget <= 0) break;
    const neighbors = axialNeighbors(tile.q, tile.r).map((coord) => index.get(tileId(coord.q, coord.r))).filter(Boolean) as Tile[];
    if (neighbors.filter((neighbor) => neighbor.terrain === "land").length < 3) continue;
    tile.terrain = "water";
    tile.landform = "sea";
    tile.biome = "water";
    tile.type = TILE_TYPES.WATER;
    budget -= 1;
  }
}

function assignBiomes(tiles: Tile[], radius: number, seed: number, landscapeDiversity: MapOptionLevel = "Balanced") {
  const config = {
    Low: { scale: 9, spread: 0.72, passes: 2 },
    Balanced: { scale: 5.5, spread: 1, passes: 1 },
    High: { scale: 3.3, spread: 1.22, passes: 1 },
  }[landscapeDiversity] || { scale: 5.5, spread: 1, passes: 1 };
  assignBiomesWithConfig(tiles, radius, seed, config);
}

function assignAdvancedBiomes(tiles: Tile[], radius: number, seed: number, landscapeDiversity: LandscapeDiversity = "high") {
  const config = landscapeDiversity === "superHigh"
    ? { scale: 2.4, spread: 1.36, passes: 0, patchCount: 4, patchRadius: 1.75, fillChance: 0.72, minimumRatio: 0.07, mergePasses: 0 }
    : { scale: 4.1, spread: 1.18, passes: 1, patchCount: 2, patchRadius: 3.35, fillChance: 0.9, minimumRatio: 0.09, mergePasses: 2 };
  assignBiomesWithConfig(tiles, radius, seed, config);
  stampAdvancedBiomePatches(tiles, radius, seed, config);
  ensureAdvancedBiomeMinimums(tiles, radius, seed, config);
  smoothBiomeClusters(tiles, config.mergePasses || 0, config.patchCount > 2 ? 4 : 3);
}

function assignBiomesWithConfig(tiles: Tile[], radius: number, seed: number, config: { scale: number; spread: number; passes?: number }) {
  for (const tile of tiles) {
    if (tile.terrain !== "land") {
      tile.biome = "water";
      continue;
    }
    tile.biome = biomeForTile(tile, radius, seed, config);
  }

  smoothBiomeClusters(tiles, config.passes || 0, 4);
}

function biomeForTile(tile: Tile, radius: number, seed: number, config: { scale: number; spread: number }): Biome {
  const { temperature, moisture } = biomeClimate(tile, radius, seed, config);

  if (temperature < 0.28) return "arctic";
  if (moisture < 0.26 && temperature > 0.42) return "desert";
  if (moisture > 0.68 && temperature > 0.52) return "jungle";
  if (moisture > 0.48) return "woods";
  return "grassland";
}

function biomeClimate(tile: Tile, radius: number, seed: number, config: { scale: number; spread: number }) {
  const y = (tile.r + tile.q * 0.5) / Math.max(1, radius);
  const latitudeTemp = 1 - Math.min(1, Math.abs(y));
  let temperature = latitudeTemp * 0.78 + smoothNoise(tile.q, tile.r, config.scale * 1.35, seed + 7001) * 0.38;
  let moisture = smoothNoise(tile.q + 29, tile.r - 17, config.scale, seed + 7101);
  const local = smoothNoise(tile.q - 11, tile.r + 23, config.scale * 0.58, seed + 7201);
  temperature = clampNumber(0.5 + (temperature - 0.5) * config.spread, 0, 1);
  moisture = clampNumber(0.5 + (moisture * 0.8 + local * 0.2 - 0.5) * config.spread, 0, 1);
  return { temperature, moisture };
}

function stampAdvancedBiomePatches(tiles: Tile[], radius: number, seed: number, config: { scale: number; spread: number; patchCount: number; patchRadius: number; fillChance: number }) {
  const landTiles = tiles.filter((tile) => tile.terrain === "land");
  const usedCenters = new Set<string>();
  for (const biome of ["grassland", "jungle", "arctic", "desert"] as const) {
    for (let patchIndex = 0; patchIndex < config.patchCount; patchIndex += 1) {
      const center = pickAdvancedBiomeCenter(landTiles, radius, seed, biome, patchIndex, usedCenters, config);
      if (!center) continue;
      usedCenters.add(center.id);
      for (const tile of landTiles) {
        const dist = hexDistance(tile, center);
        if (dist > config.patchRadius + hash2d(center.q * 7 + tile.q, center.r * 11 + tile.r, seed + patchIndex * 97) * 1.1) continue;
        const fillRoll = hash2d(tile.q * 13 + patchIndex * 17, tile.r * 19 - patchIndex * 23, seed + biomeSeedOffset(biome));
        if (fillRoll <= config.fillChance) tile.biome = biome;
      }
    }
  }
}

function pickAdvancedBiomeCenter(
  landTiles: Tile[],
  radius: number,
  seed: number,
  biome: Biome,
  patchIndex: number,
  usedCenters: Set<string>,
  config: { scale: number; spread: number }
) {
  return landTiles
    .filter((tile) => !usedCenters.has(tile.id))
    .map((tile) => {
      const climate = biomeClimate(tile, radius, seed, config);
      const affinity = advancedBiomeAffinity(tile, climate, biome);
      const noise = hash2d(tile.q * 29 + patchIndex * 13, tile.r * 31 - patchIndex * 17, seed + biomeSeedOffset(biome) + 41);
      return { tile, score: affinity + noise * 0.12 };
    })
    .sort((a, b) => b.score - a.score)[0]?.tile || null;
}

function ensureAdvancedBiomeMinimums(tiles: Tile[], radius: number, seed: number, config: { scale: number; spread: number; minimumRatio: number }) {
  const landTiles = tiles.filter((tile) => tile.terrain === "land");
  const minimumCount = Math.max(6, Math.round(landTiles.length * config.minimumRatio));
  for (const biome of ["grassland", "jungle", "arctic", "desert"] as const) {
    const currentCount = landTiles.filter((tile) => tile.biome === biome).length;
    if (currentCount >= minimumCount) continue;
    const needed = minimumCount - currentCount;
    const candidates = landTiles
      .filter((tile) => tile.biome !== biome)
      .map((tile) => {
        const climate = biomeClimate(tile, radius, seed, config);
        const affinity = advancedBiomeAffinity(tile, climate, biome);
        return { tile, score: affinity + hash2d(tile.q * 5 - 7, tile.r * 7 + 11, seed + biomeSeedOffset(biome) + 101) * 0.04 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, needed);
    for (const entry of candidates) entry.tile.biome = biome;
  }
}

function smoothBiomeClusters(tiles: Tile[], passes: number, dominantThreshold = 4) {
  if (!passes) return;
  const index = buildTileIndex(tiles);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Map<string, Biome>();
    for (const tile of tiles) {
      if (tile.terrain !== "land") continue;
      const counts: Partial<Record<Biome, number>> = {};
      for (const coord of axialNeighbors(tile.q, tile.r)) {
        const neighbor = index.get(tileId(coord.q, coord.r));
        if (!neighbor || neighbor.terrain !== "land") continue;
        counts[neighbor.biome] = (counts[neighbor.biome] || 0) + 1;
      }
      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] as [Biome, number] | undefined;
      const currentCount = counts[tile.biome] || 0;
      if (dominant && dominant[1] >= dominantThreshold && currentCount <= 1) next.set(tile.id, dominant[0]);
      else if (dominant && dominant[1] >= dominantThreshold - 1 && currentCount === 0) next.set(tile.id, dominant[0]);
    }
    for (const [id, biome] of next) {
      const tile = index.get(id);
      if (tile) tile.biome = biome;
    }
  }
}

function advancedBiomeAffinity(tile: Tile, climate: { temperature: number; moisture: number }, biome: Biome) {
  const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r));
  if (biome === "arctic") return (1 - climate.temperature) * 1.4 + edge * 0.015;
  if (biome === "desert") return (1 - climate.moisture) * 1.2 + climate.temperature * 0.6;
  if (biome === "jungle") return climate.moisture * 1.25 + climate.temperature * 0.55;
  return (1 - Math.abs(climate.moisture - 0.52)) + climate.temperature * 0.2;
}

function biomeSeedOffset(biome: Biome) {
  return {
    grassland: 101,
    jungle: 211,
    arctic: 307,
    desert: 401,
  }[biome as "grassland" | "jungle" | "arctic" | "desert"] || 0;
}

function smoothNoise(q: number, r: number, scale: number, seed: number) {
  const x = (q + r * 0.5) / scale;
  const y = (r * 0.866) / scale;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothStep(x - x0);
  const ty = smoothStep(y - y0);
  const a = hash2d(x0, y0, seed);
  const b = hash2d(x0 + 1, y0, seed);
  const c = hash2d(x0, y0 + 1, seed);
  const d = hash2d(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function smoothStep(value: number) {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function addMountainRanges(tiles: Tile[], radius: number, seed: number, nationCount: number) {
  const landTiles = tiles.filter((tile) => tile.terrain === "land");
  const requiredBuildable = nationCount * 9 + 8;
  const maxMountains = Math.max(0, landTiles.length - requiredBuildable);
  const targetMountains = Math.min(maxMountains, Math.round(landTiles.length * 0.13));
  if (targetMountains <= 0) return;

  const scored = landTiles
    .map((tile) => {
      const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r)) / radius;
      const ridgeA = 1 - Math.abs(hash2d(Math.floor(tile.q / 2) + 11, tile.r * 3 - 7, seed + 7777) - 0.52) * 2;
      const ridgeB = 1 - Math.abs(hash2d(tile.q * 2 + 2, Math.floor(tile.r / 2) + 3, seed + 8831) - 0.48) * 2;
      const peakNoise = hash2d(tile.q * 17 - 3, tile.r * 19 + 5, seed + 1234);
      return { tile, score: ridgeA * 0.48 + ridgeB * 0.34 + peakNoise * 0.28 - edge * 0.18 };
    })
    .filter((entry) => entry.score > 0.48)
    .sort((a, b) => b.score - a.score);

  for (const { tile } of scored.slice(0, targetMountains)) {
    tile.type = TILE_TYPES.MOUNTAIN;
  }
}

function assignRegions(map: ServerGameState["map"]) {
  const index = buildTileIndex(map.tiles);
  let regionId = 1;
  for (const tile of map.tiles) tile.regionId = null;

  for (const start of map.tiles) {
    if (!isLand(start) || start.regionId) continue;
    const queue = [start];
    start.regionId = regionId;
    let size = 0;

    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      size += 1;
      for (const coord of axialNeighbors(current.q, current.r)) {
        const neighbor = index.get(tileId(coord.q, coord.r));
        if (!neighbor || !isLand(neighbor) || neighbor.regionId) continue;
        neighbor.regionId = regionId;
        queue.push(neighbor);
      }
    }

    for (const tile of map.tiles) {
      if (tile.regionId === regionId && size <= 5) tile.landform = "island";
    }
    regionId += 1;
  }
}

function assignStartingTerritories(map: ServerGameState["map"], nations: Nation[], rng = mulberry32(map.seed + 101)) {
  const index = buildTileIndex(map.tiles);
  const land = map.tiles.filter((tile) => isLand(tile));
  const shuffledLand = shuffle(land, rng);
  const centers: Tile[] = [];
  const minSpacing = Math.max(4, Math.floor(map.radius * 0.55));

  for (const nation of nations) {
    let best: Tile | null = null;
    let bestScore = -Infinity;

    for (const candidate of shuffledLand) {
      if (candidate.ownerId) continue;
      const nearbyLand = axialNeighbors(candidate.q, candidate.r)
        .map((coord) => index.get(tileId(coord.q, coord.r)))
        .filter((tile) => tile && isLand(tile)).length;
      if (nearbyLand < 3) continue;
      const nearest = centers.length
        ? Math.min(...centers.map((center) => hexDistance(candidate, center)))
        : minSpacing;
      const centerBias = map.radius - Math.max(Math.abs(candidate.q), Math.abs(candidate.r), Math.abs(candidate.q + candidate.r));
      const score = nearest * 4 + centerBias + rng() * 3;
      if (nearest >= minSpacing && score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) {
      best = shuffledLand
        .filter((tile) => !tile.ownerId)
        .sort((a, b) => {
          const aDist = centers.length ? Math.min(...centers.map((center) => hexDistance(a, center))) : 0;
          const bDist = centers.length ? Math.min(...centers.map((center) => hexDistance(b, center))) : 0;
          return bDist - aDist;
        })[0] || null;
    }

    if (!best) continue;
    centers.push(best);
    claimStartingCluster(map, nation, best, rng);
  }
}

function claimStartingCluster(map: ServerGameState["map"], nation: Nation, center: Tile, rng: () => number) {
  const index = buildTileIndex(map.tiles);
  const profile = STARTING_PROFILES[nation.profile as keyof typeof STARTING_PROFILES] || STARTING_PROFILES.balanced;
  const target = profile.territoryTarget;
  const claimed: Tile[] = [];
  const queue = [center];
  const seen = new Set([center.id]);

  while (queue.length && claimed.length < target) {
    const tile = queue.shift();
    if (!tile) continue;
    if (isLand(tile) && !tile.ownerId) {
      tile.ownerId = nation.id;
      claimed.push(tile);
    }

    const neighbors = shuffle(axialNeighbors(tile.q, tile.r), rng);
    for (const coord of neighbors) {
      const neighbor = index.get(tileId(coord.q, coord.r));
      if (!neighbor || seen.has(neighbor.id) || !isLand(neighbor)) continue;
      seen.add(neighbor.id);
      queue.push(neighbor);
    }
  }

  nation.territory = claimed.map((tile) => tile.id);
  const capital = claimed[0];
  if (capital) {
    capital.isCapital = true;
    capital.type = TILE_TYPES.MILITARY;
    capital.workers = WORKER_MIN[TILE_TYPES.MILITARY];
    capital.unit = {
      nationId: nation.id,
      strength: 4,
      branch: "infantry",
      movedTurn: 0,
    };
    nation.capitalTileId = capital.id;
  }

  const farm = claimed[1];
  if (farm) {
    farm.type = TILE_TYPES.FARM;
    farm.workers = WORKER_MIN[TILE_TYPES.FARM];
  }
  if (claimed[2]) claimed[2].type = TILE_TYPES.MINE;
  if (claimed[3]) claimed[3].type = TILE_TYPES.SCHOOL;
  if (claimed[4] && nation.profile !== "small") claimed[4].type = TILE_TYPES.FARM;
}

function profileSequence(nationCount: number) {
  const sequence: string[] = [];
  const order = ["small", "balanced", "large"];
  for (let index = 0; index < nationCount; index += 1) sequence.push(order[index % order.length]);
  return sequence;
}

function personalityAt(index: number) {
  const rotation = ["aggressive", "economic", "scientific", "balanced"];
  return rotation[index % rotation.length];
}

function nationColor(index = 0) {
  if (index < NATION_COLOR_PALETTE.length) return NATION_COLOR_PALETTE[index];
  const hue = (index * 137.508) % 360;
  return `hsl(${Math.round(hue)} 82% 66%)`;
}

function buildTileIndex(tiles: Tile[]) {
  return new Map(tiles.map((tile) => [tile.id, tile]));
}

function isLand(tile?: Tile | null) {
  return tile && tile.terrain === "land" && !isWaterLike(tile) && tile.type !== TILE_TYPES.MOUNTAIN;
}

function isWaterLike(tile?: Tile | null) {
  return tile && (tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.FISHERY);
}

function tileId(q: number, r: number) {
  return `${q}:${r}`;
}

function axialNeighbors(q: number, r: number) {
  return HEX_DIRECTIONS.map((dir) => ({ q: q + dir.q, r: r + dir.r }));
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  return (
    Math.abs(a.q - b.q) +
    Math.abs(a.q + a.r - b.q - b.r) +
    Math.abs(a.r - b.r)
  ) / 2;
}

function hexMapCoords(radius: number) {
  const coords: Array<{ q: number; r: number }> = [];
  for (let q = -radius; q <= radius; q += 1) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r += 1) coords.push({ q, r });
  }
  return coords;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2d(q: number, r: number, seed = 1) {
  let h = seed ^ Math.imul(q + 374761393, 668265263) ^ Math.imul(r + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function randInt(rng: () => number, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function shuffle<T>(items: T[], rng: () => number) {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [out[index], out[swapIndex]] = [out[swapIndex], out[index]];
  }
  return out;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
