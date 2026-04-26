const ROOM_NAME = "league";
export const CLOSED_GAME_MESSAGE = "This game has already started and is closed to new players.";

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
    this.room?.send("playerAction", payload);
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
  room.onMessage("actionRejected", (payload) => {
    handlers.onActionRejected?.(payload?.message || "That action was rejected by the server.");
  });
  room.onMessage("serverError", (payload) => {
    handlers.onError?.(payload?.message || "The multiplayer server reported an error.");
  });
  room.onLeave((code) => handlers.onLeave?.(code));
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
  if (window.LEAGUE_COLYSEUS_URL) return window.LEAGUE_COLYSEUS_URL;
  const isSecure = window.location.protocol === "https:";
  const host = window.location.hostname || "localhost";
  return `${isSecure ? "wss" : "ws"}://${host}:2567`;
}

function readSettings(settings = {}) {
  return {
    mapSize: settings.mapSize || "Medium",
    nationCount: Number(settings.nationCount || 5),
    maxTurns: Number(settings.maxTurns || 30),
    timeLimitMinutes: Number(settings.timeLimitMinutes || 0),
    unlimitedMode: Boolean(settings.unlimitedMode),
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
