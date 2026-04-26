type ControllerType = "human" | "bot";

export interface InitialGameSettings {
  mapSize: "Small" | "Medium" | "Large";
  nationCount: number;
  maxTurns: number;
  timeLimitMinutes: number;
  unlimitedMode: boolean;
  seed: number;
}

export interface SeatPlayer {
  sessionId: string;
  name: string;
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
  actionsRemaining: number;
  actionsUsedThisTurn: number;
  capitalTileId: string | null;
  territory: string[];
  warExhaustion: number;
  mobilizationLevel: number;
  population: {
    total: number;
    available: number;
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
  type: string;
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
  tradeRoutes: unknown[];
  alliances: unknown[];
  events: Array<Record<string, unknown>>;
  eraReports: unknown[];
  pendingEraReport: null;
  globalEvents: Record<string, unknown>;
  gameOver: null;
  selectedTileId: null;
  lastSummary: null;
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

const MAX_ACTIONS_PER_TURN = 10;

const MAP_SIZES = {
  Small: { radius: 7 },
  Medium: { radius: 10 },
  Large: { radius: 13 },
} as const;

const TILE_TYPES = {
  EMPTY: "empty",
  FARM: "farm",
  MINE: "mine",
  SCHOOL: "school",
  FACTORY: "factory",
  MILITARY: "military",
  WATER: "water",
  MOUNTAIN: "mountain",
} as const;

const WORKER_ROLES = {
  FARMERS: "farmers",
  MINERS: "miners",
  SCHOLARS: "scholars",
  ENGINEERS: "engineers",
  SOLDIERS: "soldiers",
} as const;

const WORKER_MIN = {
  [TILE_TYPES.FARM]: 2,
  [TILE_TYPES.MINE]: 3,
  [TILE_TYPES.SCHOOL]: 3,
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

const BOT_NAMES = [
  "Arden Republic",
  "Vesper Union",
  "Meridian League",
  "Solenne Duchy",
  "Orun Free Cities",
  "Caldor Dominion",
  "Istrian Commonwealth",
  "Kestral Accord",
  "Namar Isles",
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
  const rng = mulberry32(settings.seed);
  const map = createMapData(settings);
  const seats = createSeatAssignments(settings.nationCount, players);
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

    nations[nation.id] = nation;
    if (nation.bot) botIds.push(nation.id);
  });

  assignStartingTerritories(map, Object.values(nations), rng);

  const startedAt = Date.now();
  return {
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
    tradeRoutes: [],
    alliances: [],
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
    eraReports: [],
    pendingEraReport: null,
    globalEvents: {},
    gameOver: null,
    selectedTileId: null,
    lastSummary: null,
    startedAt,
    turnStartedAt: startedAt,
    isProcessingTurn: false,
    playerId: seats.find((seat) => seat.controllerType === "human")?.nationId || seats[0]?.nationId || "nation-1",
    seats,
  };
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
    tradeRoutes: game.tradeRoutes,
    alliances: game.alliances,
    events: game.events,
    eraReports: game.eraReports,
    pendingEraReport: game.pendingEraReport,
    globalEvents: game.globalEvents,
    gameOver: game.gameOver,
    selectedTileId: null,
    lastSummary: game.lastSummary,
    startedAt: game.startedAt,
    turnStartedAt: game.turnStartedAt,
    isProcessingTurn: game.isProcessingTurn,
    seats: game.seats || [],
  });
}

function createSeatAssignments(nationCount: number, players: SeatPlayer[]): SeatAssignment[] {
  const assignments: SeatAssignment[] = [];
  const playersByNation = new Map(players.map((player) => [player.nationId, player]));

  for (let index = 0; index < nationCount; index += 1) {
    const nationId = `nation-${index + 1}`;
    const player = playersByNation.get(nationId);
    if (player) {
      assignments.push({
        nationId,
        sessionId: player.sessionId,
        playerName: player.name,
        controllerType: "human",
        bot: false,
        isBot: false,
        host: player.host,
      });
      continue;
    }

    const botIndex = index - players.length;
    assignments.push({
      nationId,
      sessionId: null,
      playerName: BOT_NAMES[botIndex] || `Nation ${index + 1}`,
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

  return {
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
    actionsRemaining: MAX_ACTIONS_PER_TURN,
    actionsUsedThisTurn: 0,
    capitalTileId: null,
    territory: [],
    warExhaustion: 0,
    mobilizationLevel: 0,
    population: {
      total: population,
      available: Math.max(0, population - 8),
    },
    money: start.money,
    resources: { ...start.resources },
    workers: {
      [WORKER_ROLES.FARMERS]: 2,
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
}

function createMapData(settings: InitialGameSettings): ServerGameState["map"] {
  const sizeInfo = MAP_SIZES[settings.mapSize] || MAP_SIZES.Medium;
  const radius = sizeInfo.radius;
  const seed = Number(settings.seed || 1);
  const coords = hexMapCoords(radius);
  const rng = mulberry32(seed);
  const targetLandRatio = 0.71 + rng() * 0.08;
  const continentCount = settings.nationCount <= 4 ? 2 : settings.nationCount <= 7 ? 3 : 4;
  const islandCount = Math.max(4, Math.floor(radius / 2));
  const centers: Array<{
    q: number;
    r: number;
    radius: number;
    weight: number;
    kind: "continent" | "island";
  }> = [];

  for (let index = 0; index < continentCount; index += 1) {
    centers.push({
      q: randInt(rng, -Math.floor(radius * 0.55), Math.floor(radius * 0.55)),
      r: randInt(rng, -Math.floor(radius * 0.55), Math.floor(radius * 0.55)),
      radius: radius * (0.48 + rng() * 0.22),
      weight: 1.8 + rng() * 0.5,
      kind: "continent" as const,
    });
  }

  for (let index = 0; index < islandCount; index += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * (0.35 + rng() * 0.52);
    centers.push({
      q: Math.round(Math.cos(angle) * distance),
      r: Math.round(Math.sin(angle) * distance * 0.6),
      radius: 1.5 + rng() * 2.5,
      weight: 0.75 + rng() * 0.5,
      kind: "island" as const,
    });
  }

  const scored = coords.map((coord) => {
    const edge = Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r)) / radius;
    let score = 0.3 - edge * 0.22 + hash2d(coord.q, coord.r, seed) * 0.55;
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

    score += hash2d(coord.q * 3 + 17, coord.r * 5 - 11, seed + 91) * 0.2;
    return { ...coord, score, nearestKind };
  });

  const landCount = Math.round(scored.length * targetLandRatio);
  const landIds = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, landCount)
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
      type: land ? TILE_TYPES.EMPTY : TILE_TYPES.WATER,
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

  for (const tile of tiles) {
    if (tile.terrain !== "land") continue;
    const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r)) / radius;
    if (edge > 0.78) continue;
    const n1 = hash2d(tile.q * 3 + 11, tile.r * 4 - 7, seed + 7777);
    const n2 = hash2d(tile.q + 2, tile.r * 2 + 3, seed + 8831);
    if (n1 * 0.62 + n2 * 0.38 < 0.083) tile.type = TILE_TYPES.MOUNTAIN;
  }

  const map = {
    size: settings.mapSize,
    radius,
    seed,
    landRatio: landCount / scored.length,
    tiles,
  };
  assignRegions(map);
  return map;
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
  return tile && tile.terrain === "land" && tile.type !== TILE_TYPES.WATER && tile.type !== TILE_TYPES.MOUNTAIN;
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
