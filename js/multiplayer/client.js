const ROOM_NAME = "league";
const DEFAULT_LOCAL_COLYSEUS_ENDPOINT = "ws://localhost:2567";
const PRODUCTION_COLYSEUS_ENDPOINT = "wss://league-of-nations-production.up.railway.app";
export const CLOSED_GAME_MESSAGE = "This game has already started and is closed to new players.";

export const MULTIPLAYER_ACTION_TYPES = Object.freeze({
  ASSIGN_WORKERS: "ASSIGN_WORKERS",
  BUILD_TILE: "BUILD_TILE",
  BUILD_INFRASTRUCTURE: "BUILD_INFRASTRUCTURE",
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
  CHOOSE_RELIGION: "CHOOSE_RELIGION",
  PROMOTE_RELIGION: "PROMOTE_RELIGION",
  RESEARCH: "RESEARCH",
  RESEARCH_TECH: "RESEARCH_TECH",
  RESEARCH_BRANCH: "RESEARCH_BRANCH",
  SUBMIT_EDUCATION_REFLECTION: "SUBMIT_EDUCATION_REFLECTION",
  END_TURN: "END_TURN",
});

const ACTION_ALIASES = Object.freeze({
  assignWorkers: MULTIPLAYER_ACTION_TYPES.ASSIGN_WORKERS,
  buildTile: MULTIPLAYER_ACTION_TYPES.BUILD_TILE,
  buildInfrastructure: MULTIPLAYER_ACTION_TYPES.BUILD_INFRASTRUCTURE,
  destroyTile: MULTIPLAYER_ACTION_TYPES.DESTROY_TILE,
  trainUnit: MULTIPLAYER_ACTION_TYPES.TRAIN_UNIT,
  moveOrAttackUnit: MULTIPLAYER_ACTION_TYPES.MOVE_OR_ATTACK_UNIT,
  declareWar: MULTIPLAYER_ACTION_TYPES.DECLARE_WAR,
  trade: MULTIPLAYER_ACTION_TYPES.TRADE,
  proposeTrade: MULTIPLAYER_ACTION_TYPES.PROPOSE_TRADE,
  acceptTrade: MULTIPLAYER_ACTION_TYPES.ACCEPT_TRADE,
  rejectTrade: MULTIPLAYER_ACTION_TYPES.REJECT_TRADE,
  attack: MULTIPLAYER_ACTION_TYPES.ATTACK,
  proposeAlliance: MULTIPLAYER_ACTION_TYPES.PROPOSE_ALLIANCE,
  breakAlliance: MULTIPLAYER_ACTION_TYPES.BREAK_ALLIANCE,
  embargo: MULTIPLAYER_ACTION_TYPES.EMBARGO,
  chooseReligion: MULTIPLAYER_ACTION_TYPES.CHOOSE_RELIGION,
  promoteReligion: MULTIPLAYER_ACTION_TYPES.PROMOTE_RELIGION,
  research: MULTIPLAYER_ACTION_TYPES.RESEARCH,
  researchTech: MULTIPLAYER_ACTION_TYPES.RESEARCH_TECH,
  researchBranch: MULTIPLAYER_ACTION_TYPES.RESEARCH_BRANCH,
  submitEducationReflection: MULTIPLAYER_ACTION_TYPES.SUBMIT_EDUCATION_REFLECTION,
  endTurn: MULTIPLAYER_ACTION_TYPES.END_TURN,
});

export class LeagueMultiplayerClient {
  constructor({ serverUrl = defaultServerUrl() } = {}) {
    this.serverUrl = serverUrl;
    this.client = null;
    this.room = null;
    this.initialSnapshot = null;
  }

  createClient() {
    if (!window.Colyseus?.Client) {
      throw new Error("Colyseus client SDK could not load. Check your connection and refresh.");
    }

    if (!this.client) this.client = new window.Colyseus.Client(this.serverUrl);
    return this.client;
  }

  async createMatch({ playerName, settings }) {
    const room = await this.createClient().create(ROOM_NAME, { ...settings, playerName });
    this.setRoom(room);
    return room;
  }

  async joinMatch({ roomCode, playerName }) {
    const code = normalizeRoomCode(roomCode);
    if (!code) throw new Error("Enter a room code.");

    try {
      const room = await this.createClient().joinById(code, { playerName });
      this.setRoom(room);
      return room;
    } catch (error) {
      throw normalizeJoinError(error);
    }
  }

  sendSettings(settings) {
    this.room?.send("updateSettings", settings);
  }

  startGame() {
    this.room?.send("startGame");
  }

  sendPlayerAction(payload) {
    this.sendGameAction(payload?.type, payload);
  }

  send(type, payload = {}) {
    const {
      actionPoints,
      maxActionPoints,
      actionsRemaining,
      actionsUsedThisTurn,
      tech,
      cost,
      type: _type,
      ...intent
    } = payload || {};
    this.room?.send(type, intent);
  }

  proposeTrade(payload = {}) {
    this.send("proposeTrade", payload);
  }

  acceptTrade(payload = {}) {
    this.send("acceptTrade", payload);
  }

  rejectTrade(payload = {}) {
    this.send("rejectTrade", payload);
  }

  attack(payload = {}) {
    this.send("attack", payload);
  }

  sendGameAction(type, payload = {}) {
    const actionType = normalizeActionType(type);
    const {
      actionPoints,
      maxActionPoints,
      actionsRemaining,
      actionsUsedThisTurn,
      tech,
      cost,
      ...intent
    } = payload || {};
    this.room?.send("playerAction", {
      ...intent,
      type: actionType,
    });
  }

  setRoom(room) {
    this.room = room;
    this.initialSnapshot = null;
    return room;
  }

  get sessionId() {
    return this.room?.sessionId || "";
  }
}

export function bindRoomEvents(room, handlers = {}) {
  let lastActionErrorSignature = "";
  let lastActionErrorAt = 0;
  const forwardActionError = (payload) => {
    const signature = `${payload?.actionType || ""}:${payload?.message || ""}`;
    const now = Date.now();
    if (signature === lastActionErrorSignature && now - lastActionErrorAt < 100) return;
    lastActionErrorSignature = signature;
    lastActionErrorAt = now;
    handleActionError(payload, handlers);
  };

  room.onStateChange((state) => {
    const lobbyState = readLobbyState(room, state);
    handlers.onLobbyChange?.(lobbyState);
    if (lobbyState.status === "playing") handlers.onPlaying?.(lobbyState);
  });

  room.onMessage("joinedLobby", (message) => handlers.onJoinedLobby?.(message));
  room.onMessage("settingsUpdated", () => handlers.onLobbyChange?.(readLobbyState(room)));
  room.onMessage("playerReadyUpdated", () => handlers.onLobbyChange?.(readLobbyState(room)));
  room.onMessage("gameStarted", (snapshot) => {
    handlers.onGameStarted?.(snapshot);
    handlers.onPlaying?.(readLobbyState(room), snapshot);
  });
  room.onMessage("gameSnapshot", (snapshot) => {
    handlers.onGameSnapshot?.(snapshot);
    handlers.onPlaying?.(readLobbyState(room), snapshot);
  });
  room.onMessage("actionAccepted", (payload) => {
    handlers.onActionAccepted?.(payload);
  });
  room.onMessage("actionRejected", (payload) => {
    forwardActionError(payload);
  });
  room.onMessage("actionError", (payload) => {
    forwardActionError(payload);
  });
  room.onMessage("serverError", (payload) => {
    handlers.onError?.(payload?.message || "The multiplayer server reported an error.");
  });
  room.onLeave((code) => handlers.onLeave?.(code));
}

export function sendGameAction(room, type, payload = {}) {
  const {
    actionPoints,
    maxActionPoints,
    actionsRemaining,
    actionsUsedThisTurn,
    tech,
    cost,
    ...intent
  } = payload || {};
  room?.send("playerAction", { ...intent, type: normalizeActionType(type) });
}

export function handleGameStateUpdate(snapshot, handler) {
  if (!snapshot?.gameState) return false;
  handler?.(snapshot);
  return true;
}

export function handleActionError(payload, handlers = {}) {
  handlers.onActionRejected?.({
    type: payload?.type || "ACTION_ERROR",
    actionType: payload?.actionType || "",
    message: payload?.message || "That action was rejected by the server.",
  });
}

export function normalizeActionType(type) {
  const raw = String(type || "").trim();
  return ACTION_ALIASES[raw] || raw;
}

export function readLobbyState(room, state = room?.state) {
  const settings = readSettings(state?.settings);
  return {
    roomCode: String(state?.roomCode || room?.roomId || "").toUpperCase(),
    status: state?.status || "lobby",
    hostSessionId: state?.hostSessionId || "",
    settings,
    players: readPlayers(state?.players),
  };
}

export function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function defaultServerUrl() {
  return getColyseusEndpoint();
}

function getColyseusEndpoint() {
  const viteEndpoint = import.meta.env?.VITE_COLYSEUS_ENDPOINT;
  if (viteEndpoint) return viteEndpoint;

  const browserWindow = typeof window !== "undefined" ? window : undefined;
  if (browserWindow?.COLYSEUS_ENDPOINT) return browserWindow.COLYSEUS_ENDPOINT;
  if (browserWindow?.LEAGUE_COLYSEUS_URL) return browserWindow.LEAGUE_COLYSEUS_URL;

  const host = browserWindow?.location.hostname || "localhost";
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    return PRODUCTION_COLYSEUS_ENDPOINT;
  }

  return DEFAULT_LOCAL_COLYSEUS_ENDPOINT;
}

function readSettings(settings = {}) {
  const turnTimerMinutes = Number(settings.turnTimerMinutes ?? settings.timeLimitMinutes ?? 0);
  return {
    mode: settings.mode === "advanced" ? "advanced" : "lite",
    mapSize: settings.mapSize || "Medium",
    waterLevel: settings.waterLevel || "Balanced",
    landscapeDiversity: settings.landscapeDiversity || (settings.mode === "advanced" ? "high" : "Balanced"),
    fogOfWarEnabled: Boolean(settings.fogOfWarEnabled),
    nationCount: Number(settings.nationCount || 5),
    maxTurns: Number(settings.maxTurns || 30),
    turnTimerMinutes,
    unlimitedMode: Boolean(settings.unlimitedMode),
    happinessEnabled: settings.happinessEnabled !== false,
    educationModeEnabled: settings.educationModeEnabled === true,
    seed: Number(settings.seed || 1),
  };
}

function readPlayers(players) {
  const list = [];
  if (!players) return list;

  if (typeof players.forEach === "function") {
    players.forEach((player) => list.push(readPlayer(player)));
    return list;
  }

  for (const player of Object.values(players)) list.push(readPlayer(player));
  return list;
}

function readPlayer(player = {}) {
  return {
    sessionId: player.sessionId || "",
    name: player.name || "Player",
    nationId: player.nationId || "",
    host: Boolean(player.host),
    ready: Boolean(player.ready),
    connected: player.connected !== false,
  };
}

function normalizeJoinError(error) {
  const message = String(error?.message || error || "");
  const code = Number(error?.code || error?.status || 0);
  const closed = code === 421 || /locked|started|playing|closed|auth/i.test(message);
  return new Error(closed ? CLOSED_GAME_MESSAGE : (message || "Could not join that room."));
}
