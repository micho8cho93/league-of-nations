import { Room, type Client } from "colyseus";
import { MapSchema, Schema, type } from "@colyseus/schema";
import { createInitialGameState } from "../game/createInitialGameState.js";
import {
  SERVER_GAME_ACTION_TYPES,
  ACTION_COSTS,
  applyServerPlayerAction,
  canAffordAction,
  checkServerVictory,
  handleAcceptTrade,
  handleAttack,
  handleProposeTrade,
  handleRejectTrade,
  normalizeServerActionType,
  processServerRound,
  resetActionPointsForTurn,
} from "../game/actions.js";
import {
  serializeGameSnapshot,
  type InitialGameSettings,
  type SeatPlayer,
  type ServerGameState,
} from "../game/initialGame.js";
import { maybeTriggerEvent } from "../game/events.js";

type RoomStatus = "lobby" | "playing" | "finished";

const ROOM_CODE_CHANNEL = "$league-of-nations-room-codes";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const MULTIPLAYER_NATION_NAMES = [
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

interface JoinOptions {
  playerName?: unknown;
  nationId?: unknown;
}

interface SettingsPayload {
  mode?: unknown;
  mapSize?: unknown;
  waterLevel?: unknown;
  landscapeDiversity?: unknown;
  fogOfWarEnabled?: unknown;
  nationCount?: unknown;
  maxTurns?: unknown;
  turnTimerMinutes?: unknown;
  timeLimitMinutes?: unknown;
  unlimitedMode?: unknown;
  happinessEnabled?: unknown;
  seed?: unknown;
}

interface PlayerActionPayload {
  type?: unknown;
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
  branch?: unknown;
  category?: unknown;
  allianceType?: unknown;
  offer?: unknown;
  request?: unknown;
  proposalId?: unknown;
  id?: unknown;
  actionPoints?: unknown;
  maxActionPoints?: unknown;
  actionsRemaining?: unknown;
  actionsUsedThisTurn?: unknown;
  tech?: unknown;
  cost?: unknown;
}

type ActionEnvelopeResult = { ok: true; nationId: string } | { ok: false; reason: string; code?: string; message?: string };

class LobbyPlayer extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("string") nationId = "";
  @type("boolean") host = false;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
}

class GameSettings extends Schema {
  @type("string") mode = "lite";
  @type("string") mapSize = "Medium";
  @type("string") waterLevel = "Balanced";
  @type("string") landscapeDiversity = "Balanced";
  @type("boolean") fogOfWarEnabled = false;
  @type("uint8") nationCount = 5;
  @type("uint16") maxTurns = 30;
  @type("uint16") turnTimerMinutes = 0;
  @type("boolean") unlimitedMode = false;
  @type("boolean") happinessEnabled = true;
  @type("uint32") seed = randomSeed();
}

class LeagueRoomState extends Schema {
  @type("string") roomCode = "";
  @type("string") hostSessionId = "";
  @type("string") status: RoomStatus = "lobby";
  @type(GameSettings) settings = new GameSettings();
  @type({ map: LobbyPlayer }) players = new MapSchema<LobbyPlayer>();
}

export class LeagueRoom extends Room {
  maxClients = 16;
  state = new LeagueRoomState();
  private gameState: ServerGameState | null = null;
  private resolvingTurn = false;
  private turnTimerTask: { clear?: () => void } | null = null;

  messages = {
    updateSettings: (client: Client, payload: SettingsPayload = {}) => {
      if (!this.isHost(client)) {
        client.send("serverError", { message: "Only the host can update game settings." });
        return;
      }

      if (this.state.status !== "lobby") {
        client.send("serverError", { message: "Settings cannot be changed after the game starts." });
        return;
      }

      this.applySettings(payload);
      this.broadcast("settingsUpdated", this.snapshotSettings(), { afterNextPatch: true });
    },

    playerReady: (client: Client, payload: { ready?: unknown } = {}) => {
      if (this.state.status !== "lobby") {
        client.send("serverError", { message: "Ready state cannot be changed after the game starts." });
        return;
      }

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.ready = typeof payload.ready === "boolean" ? payload.ready : !player.ready;
      this.broadcast("playerReadyUpdated", {
        sessionId: client.sessionId,
        ready: player.ready,
      }, { afterNextPatch: true });
    },

    startGame: (client: Client) => {
      if (!this.isHost(client)) {
        client.send("serverError", { message: "Only the host can start the game." });
        return;
      }

      if (this.state.status !== "lobby") {
        client.send("serverError", { message: "This game has already started." });
        return;
      }

      this.lock();
      this.state.status = "playing";
      this.gameState = this.createRuntimeGame();
      this.startTurnTimerChecks();
      this.setMetadata({
        roomCode: this.state.roomCode,
        status: this.state.status,
      });
      this.broadcast("gameStarted", this.createInitialGameSnapshot(), { afterNextPatch: true });
    },

    playerAction: async (client: Client, payload: PlayerActionPayload = {}) => {
      await this.handlePlayerAction(client, payload);
    },

    proposeTrade: async (client: Client, payload: PlayerActionPayload = {}) => {
      await this.handleDirectGameAction(client, SERVER_GAME_ACTION_TYPES.PROPOSE_TRADE, payload);
    },

    acceptTrade: async (client: Client, payload: PlayerActionPayload = {}) => {
      await this.handleDirectGameAction(client, SERVER_GAME_ACTION_TYPES.ACCEPT_TRADE, payload);
    },

    rejectTrade: async (client: Client, payload: PlayerActionPayload = {}) => {
      await this.handleDirectGameAction(client, SERVER_GAME_ACTION_TYPES.REJECT_TRADE, payload);
    },

    attack: async (client: Client, payload: PlayerActionPayload = {}) => {
      await this.handleDirectGameAction(client, SERVER_GAME_ACTION_TYPES.ATTACK, payload);
    },
  };

  async onCreate(options: SettingsPayload = {}) {
    this.onMessage("updateSettings", this.messages.updateSettings);
    this.onMessage("playerReady", this.messages.playerReady);
    this.onMessage("startGame", this.messages.startGame);
    this.onMessage("playerAction", this.messages.playerAction);
    this.onMessage("proposeTrade", this.messages.proposeTrade);
    this.onMessage("acceptTrade", this.messages.acceptTrade);
    this.onMessage("rejectTrade", this.messages.rejectTrade);
    this.onMessage("attack", this.messages.attack);

    this.roomId = await this.generateRoomCode();
    this.state.roomCode = this.roomId;
    this.applySettings(options);
    this.maxClients = this.state.settings.nationCount;
    this.setMetadata({
      roomCode: this.state.roomCode,
      status: this.state.status,
    });
  }

  onAuth(_client: Client, options: JoinOptions = {}) {
    if (this.state.status !== "lobby") {
      throw new Error(`Room ${this.roomId} is already ${this.state.status}; new players can only join during the lobby.`);
    }

    this.assertNationAvailable(options.nationId);
    return true;
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    if (this.state.status !== "lobby") {
      throw new Error(`Room ${this.roomId} is already ${this.state.status}; new players can only join during the lobby.`);
    }

    const assignedNationId = this.assertNationAvailable(options.nationId);
    const isFirstPlayer = this.state.players.size === 0;
    const player = new LobbyPlayer();
    player.sessionId = client.sessionId;
    player.name = sanitizePlayerName(options.playerName) || this.randomAvailableNationName();
    player.nationId = assignedNationId;
    player.host = isFirstPlayer;
    player.ready = isFirstPlayer;
    player.connected = true;

    this.state.players.set(client.sessionId, player);

    if (isFirstPlayer) {
      this.state.hostSessionId = client.sessionId;
    }

    client.send("joinedLobby", {
      roomCode: this.state.roomCode,
      sessionId: client.sessionId,
      host: player.host,
      nationId: player.nationId,
    });
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (this.state.status === "lobby") {
      this.state.players.delete(client.sessionId);
      this.reassignHostIfNeeded(client.sessionId);
      return;
    }

    player.connected = false;
  }

  async onDispose() {
    this.turnTimerTask?.clear?.();
    this.turnTimerTask = null;
    await this.presence.srem(ROOM_CODE_CHANNEL, this.roomId);
  }

  private isHost(client: Client) {
    return client.sessionId === this.state.hostSessionId;
  }

  private reassignHostIfNeeded(leavingSessionId: string) {
    if (this.state.hostSessionId !== leavingSessionId) return;

    const nextHost = Array.from(this.state.players.values())[0];
    this.state.hostSessionId = nextHost?.sessionId ?? "";

    if (nextHost) {
      nextHost.host = true;
      nextHost.ready = true;
    }
  }

  private applySettings(payload: SettingsPayload) {
    if (payload.mode !== undefined) {
      this.state.settings.mode = payload.mode === "advanced" ? "advanced" : "lite";
      if (this.state.settings.mode === "advanced") {
        this.state.settings.landscapeDiversity = this.state.settings.landscapeDiversity === "superHigh" ? "superHigh" : "high";
      } else if (!["Low", "Balanced", "High"].includes(this.state.settings.landscapeDiversity)) {
        this.state.settings.landscapeDiversity = "Balanced";
      }
    }

    if (payload.mapSize !== undefined) {
      this.state.settings.mapSize = sanitizeMapSize(payload.mapSize);
    }

    if (payload.waterLevel !== undefined) {
      this.state.settings.waterLevel = sanitizeMapOptionLevel(payload.waterLevel);
    }

    if (payload.landscapeDiversity !== undefined) {
      this.state.settings.landscapeDiversity = this.state.settings.mode === "advanced"
        ? sanitizeAdvancedLandscapeDiversity(payload.landscapeDiversity)
        : sanitizeMapOptionLevel(payload.landscapeDiversity);
    }

    if (payload.fogOfWarEnabled !== undefined) {
      this.state.settings.fogOfWarEnabled = Boolean(payload.fogOfWarEnabled);
    }

    if (payload.nationCount !== undefined) {
      const minimumNations = Math.max(2, this.state.players.size, this.highestClaimedNationIndex());
      this.state.settings.nationCount = clampInteger(payload.nationCount, minimumNations, 16, this.state.settings.nationCount);
      this.maxClients = this.state.settings.nationCount;
    }

    if (payload.unlimitedMode !== undefined) {
      this.state.settings.unlimitedMode = Boolean(payload.unlimitedMode);
    }

    if (payload.happinessEnabled !== undefined) {
      this.state.settings.happinessEnabled = Boolean(payload.happinessEnabled);
    }

    if (payload.maxTurns !== undefined) {
      this.state.settings.maxTurns = this.state.settings.unlimitedMode
        ? 0
        : clampInteger(payload.maxTurns, 10, 120, this.state.settings.maxTurns);
    }

    if (payload.turnTimerMinutes !== undefined || payload.timeLimitMinutes !== undefined) {
      const value = payload.turnTimerMinutes ?? payload.timeLimitMinutes;
      this.state.settings.turnTimerMinutes = clampInteger(value, 0, 240, this.state.settings.turnTimerMinutes);
    }

    if (payload.seed !== undefined) {
      this.state.settings.seed = clampInteger(payload.seed, 1, 4_294_967_295, this.state.settings.seed);
    }

    if (this.state.settings.unlimitedMode) {
      this.state.settings.maxTurns = 0;
    } else if (this.state.settings.maxTurns <= 0) {
      this.state.settings.maxTurns = 30;
    }
  }

  private snapshotSettings(): InitialGameSettings {
    return {
      mode: this.state.settings.mode as InitialGameSettings["mode"],
      mapSize: this.state.settings.mapSize as InitialGameSettings["mapSize"],
      waterLevel: this.state.settings.waterLevel as InitialGameSettings["waterLevel"],
      landscapeDiversity: this.state.settings.landscapeDiversity as InitialGameSettings["landscapeDiversity"],
      fogOfWarEnabled: this.state.settings.fogOfWarEnabled,
      nationCount: this.state.settings.nationCount,
      maxTurns: this.state.settings.maxTurns,
      turnTimerMinutes: this.state.settings.turnTimerMinutes,
      unlimitedMode: this.state.settings.unlimitedMode,
      happinessEnabled: this.state.settings.happinessEnabled,
      seed: this.state.settings.seed,
    };
  }

  private createInitialGameSnapshot() {
    if (!this.gameState) {
      throw new Error("Cannot create a game snapshot before the server game state exists.");
    }

    const gameSnapshot = serializeGameSnapshot(this.gameState);
    const activeNationId = this.activeTurnNationId();
    return {
      snapshotVersion: 1,
      roomCode: this.state.roomCode,
      roomId: this.roomId,
      status: this.state.status,
      gameStatus: this.gameState.gameOver ? "gameOver" : this.state.status,
      phase: this.gameState.gameOver ? "gameOver" : this.gameState.phase,
      hostSessionId: this.state.hostSessionId,
      settings: this.snapshotSettings(),
      players: this.snapshotPlayers(),
      currentNationId: activeNationId,
      currentPlayerId: this.gameState.nations[activeNationId]?.sessionId || null,
      ...gameSnapshot,
    };
  }

  private snapshotPlayers() {
    return Array.from(this.state.players.values()).map((player) => ({
      sessionId: player.sessionId,
      name: player.name,
      nationId: player.nationId,
      host: player.host,
      ready: player.ready,
      connected: player.connected,
    }));
  }

  private createRuntimeGame() {
    return createInitialGameState(this.roomId, this.snapshotSettings(), this.orderedSeatPlayers());
  }

  private async handlePlayerAction(client: Client, payload: PlayerActionPayload) {
    if (this.expireActiveTurnIfNeeded()) {
      this.finishIfGameOver();
      this.broadcastGameSnapshot();
    }

    const validation = this.validateActionEnvelope(client, payload);
    if (!validation.ok) {
      this.sendActionError(client, String(payload?.type || ""), validation.message || validation.reason, validation.code);
      return;
    }

    const { nationId } = validation;
    const type = normalizeServerActionType(payload.type);
    const intentPayload = sanitizeActionIntentPayload(payload);
    let result: { ok?: boolean; reason?: string; [key: string]: unknown } = { ok: false, reason: "Unknown action." };

    try {
      if (type === SERVER_GAME_ACTION_TYPES.END_TURN) {
        result = await this.acceptEndTurn(nationId);
      } else {
        result = this.applyPlayerAction(type, nationId, intentPayload);
      }
    } catch (error) {
      result = this.reject("SERVER_ERROR", error instanceof Error ? error.message : "The server could not apply that action.");
    }

    if (!result?.ok) {
      this.sendActionError(client, type, String(result?.message || result?.reason || "That action is not legal right now."), String(result?.code || ""));
      return;
    }

    this.broadcast("actionAccepted", {
      type,
      nationId,
      payload: intentPayload,
      result,
    });
    this.finishIfGameOver();
    this.broadcastGameSnapshot();
  }

  private async handleDirectGameAction(client: Client, type: string, payload: PlayerActionPayload) {
    if (this.expireActiveTurnIfNeeded()) {
      this.finishIfGameOver();
      this.broadcastGameSnapshot();
    }

    const validation = this.validateDirectActionEnvelope(client, payload, type);
    if (!validation.ok) {
      this.sendActionError(client, type, validation.message || validation.reason, validation.code);
      return;
    }

    const intentPayload = sanitizeActionIntentPayload(payload);
    const player = this.gameState?.nations[validation.nationId] || null;
    let result: { ok?: boolean; reason?: string; [key: string]: unknown };

    try {
      if (!this.gameState) result = this.reject("GAME_UNAVAILABLE", "Game state is unavailable.");
      else if (type === SERVER_GAME_ACTION_TYPES.PROPOSE_TRADE) result = handleProposeTrade(this.gameState, player, intentPayload);
      else if (type === SERVER_GAME_ACTION_TYPES.ACCEPT_TRADE) result = handleAcceptTrade(this.gameState, player, intentPayload);
      else if (type === SERVER_GAME_ACTION_TYPES.REJECT_TRADE) result = handleRejectTrade(this.gameState, player, intentPayload);
      else if (type === SERVER_GAME_ACTION_TYPES.ATTACK) result = handleAttack(this.gameState, player, intentPayload);
      else result = this.reject("UNSUPPORTED_ACTION", `Unsupported multiplayer action: ${type}.`);
    } catch (error) {
      result = this.reject("SERVER_ERROR", error instanceof Error ? error.message : "The server could not apply that action.");
    }

    if (!result?.ok) {
      this.sendActionError(client, type, String(result?.message || result?.reason || "That action is not legal right now."), String(result?.code || ""));
      return;
    }

    this.broadcast("actionAccepted", {
      type,
      nationId: validation.nationId,
      payload: intentPayload,
      result,
    });
    this.finishIfGameOver();
    this.broadcastGameSnapshot();
  }

  private validateActionEnvelope(client: Client, payload: PlayerActionPayload): ActionEnvelopeResult {
    if (this.gameState?.gameOver) {
      return this.reject("GAME_FINISHED", "The game is already finished.");
    }

    if (this.state.status !== "playing" || !this.gameState) {
      return this.reject("GAME_NOT_PLAYING", "The game is not currently playing.");
    }

    if (this.resolvingTurn || this.gameState.isProcessingTurn || this.gameState.phase !== "player") {
      return this.reject("TURN_RESOLVING", "The server is resolving the turn.");
    }

    const type = normalizeServerActionType(payload?.type);
    if (!type) return this.reject("INVALID_PAYLOAD", "Action type is required.");
    if (ACTION_COSTS[type] === undefined) {
      return this.reject("UNSUPPORTED_ACTION", `Unsupported multiplayer action: ${String(payload?.type || "")}.`);
    }

    if (!this.state.players.has(client.sessionId)) {
      return this.reject("NOT_A_PLAYER", "You are not a player in this match.");
    }

    const nationId = String(payload.nationId || "");
    const nation = nationId ? this.gameState.nations[nationId] : null;
    if (!nation) return this.reject("INVALID_NATION", "Unknown nation.");
    if (nation.sessionId !== client.sessionId) return this.reject("OWNERSHIP_MISMATCH", "You do not control that nation.");
    if (nation.bot || nation.controllerType === "bot") return this.reject("OWNERSHIP_MISMATCH", "Bot nations are controlled by the server.");
    if (!nation.active) return this.reject("INACTIVE_NATION", "That nation is no longer active.");
    if (this.activeTurnNationId() !== nationId) {
      return this.reject("INVALID_TURN", "It is not your turn.");
    }

    const actionCheck = canAffordAction(type, this.gameState, nationId);
    if (!actionCheck.ok) return this.reject(actionCode(actionCheck.reason), actionCheck.reason);

    return { ok: true, nationId };
  }

  private validateDirectActionEnvelope(client: Client, payload: PlayerActionPayload, type: string): ActionEnvelopeResult {
    return this.validateActionEnvelope(client, { ...payload, type });
  }

  private applyPlayerAction(type: string, nationId: string, payload: PlayerActionPayload) {
    if (!this.gameState) return this.reject("GAME_UNAVAILABLE", "Game state is unavailable.");
    return applyServerPlayerAction(this.gameState, type, nationId, payload);
  }

  private async acceptEndTurn(nationId: string) {
    if (!this.gameState) return this.reject("GAME_UNAVAILABLE", "Game state is unavailable.");

    this.resolvingTurn = true;
    this.gameState.isProcessingTurn = true;
    try {
      this.advanceTurn(nationId);
      this.finishIfGameOver();
    } finally {
      this.gameState.isProcessingTurn = false;
      this.resolvingTurn = false;
    }

    return { ok: true, advancedTurn: true, activeNationId: this.activeTurnNationId() };
  }

  private startTurnTimerChecks() {
    this.turnTimerTask?.clear?.();
    this.turnTimerTask = this.clock.setInterval(() => {
      if (!this.expireActiveTurnIfNeeded()) return;
      this.finishIfGameOver();
      this.broadcastGameSnapshot();
    }, 1000) as { clear?: () => void };
  }

  private expireActiveTurnIfNeeded() {
    if (!this.gameState || this.state.status !== "playing") return false;
    if (this.resolvingTurn || this.gameState.isProcessingTurn || this.gameState.phase !== "player" || this.gameState.gameOver) return false;

    const limit = Number(this.gameState.settings.turnTimerMinutes ?? this.gameState.settings.timeLimitMinutes ?? 0);
    if (limit <= 0) return false;

    const elapsedMs = Date.now() - Number(this.gameState.turnStartedAt || Date.now());
    if (elapsedMs < limit * 60_000) return false;

    const nationId = this.activeTurnNationId();
    const nation = this.gameState.nations[nationId];
    if (!nation?.active || nation.bot || nation.controllerType === "bot") return false;

    this.addRuntimeEvent(`${nation.name} missed their turn. Turn timer expired.`, { nationId, type: "system" });
    this.advanceTurn(nationId);
    return true;
  }

  private advanceTurn(endingNationId = "") {
    if (!this.gameState) return;
    const seats = this.gameState.seats || [];
    if (seats.length === 0) return;

    const previousIndex = Math.max(0, Math.min(seats.length - 1, this.gameState.currentTurnIndex || 0));
    const nextIndex = this.nextPlayableSeatIndex(previousIndex);
    const wrapped = nextIndex <= previousIndex;

    if (wrapped) {
      maybeTriggerEvent(this.gameState);
      processServerRound(this.gameState);
      this.finishIfGameOver();
      if (this.gameState.gameOver) return;
    }

    this.gameState.currentTurnIndex = nextIndex;
    this.gameState.turnStartedAt = Date.now();

    if (wrapped) {
      this.gameState.turn += 1;
      this.gameState.turnNumber = this.gameState.turn;
    }

    const nextNationId = seats[nextIndex]?.nationId || "";
    for (const nationId of new Set([endingNationId, nextNationId])) {
      const nation = this.gameState.nations[nationId];
      if (!nation?.active) continue;
      resetActionPointsForTurn(this.gameState, nationId);
    }

    checkServerVictory(this.gameState);
  }

  private addRuntimeEvent(message: string, { nationId = null, type = "info", tileId = null }: { nationId?: string | null; type?: string; tileId?: string | null } = {}) {
    if (!this.gameState) return;
    this.gameState.events.push({
      id: `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      turn: this.gameState.turn,
      era: this.gameState.era,
      phase: this.gameState.phase,
      nationId,
      type,
      tileId,
      message,
      timestamp: Date.now(),
    });
    if (this.gameState.events.length > 140) this.gameState.events.shift();
  }

  private nextPlayableSeatIndex(fromIndex: number) {
    if (!this.gameState) return 0;
    const seats = this.gameState.seats || [];
    if (seats.length === 0) return 0;

    for (let offset = 1; offset <= seats.length; offset += 1) {
      const index = (fromIndex + offset) % seats.length;
      const seat = seats[index];
      const nation = this.gameState.nations[seat?.nationId || ""];
      if (nation?.active && !nation.bot && nation.controllerType !== "bot") return index;
    }

    return fromIndex;
  }

  private broadcastGameSnapshot() {
    if (!this.gameState) return;
    this.broadcast("gameSnapshot", this.createInitialGameSnapshot(), { afterNextPatch: true });
  }

  private finishIfGameOver() {
    if (!this.gameState) return;
    checkServerVictory(this.gameState);
    if (!this.gameState.gameOver || this.state.status === "finished") return;
    this.state.status = "finished";
    this.setMetadata({
      roomCode: this.state.roomCode,
      status: this.state.status,
    });
  }

  private sendActionError(client: Client, actionType: string, message: string, code = "") {
    const payload = {
      type: "ACTION_ERROR",
      code: code || actionCode(message),
      actionType: normalizeServerActionType(actionType),
      message,
    };
    client.send("actionRejected", payload);
    client.send("actionError", payload);
  }

  private reject(code: string, message: string) {
    return { ok: false as const, code, message, reason: message };
  }

  private orderedSeatPlayers(): SeatPlayer[] {
    const players = Array.from(this.state.players.values());
    const host = players.find((player) => player.sessionId === this.state.hostSessionId);
    const ordered = [
      ...(host ? [host] : []),
      ...players.filter((player) => player.sessionId !== this.state.hostSessionId),
    ];

    return ordered.map((player) => ({
      sessionId: player.sessionId,
      name: player.name,
      nationId: player.nationId,
      host: player.host,
      connected: player.connected,
    }));
  }

  private activeTurnNationId() {
    if (!this.gameState) return "";
    const seats = this.gameState.seats || [];
    const index = Math.max(0, Math.min(seats.length - 1, this.gameState.currentTurnIndex || 0));
    return seats[index]?.nationId || "";
  }

  private assertNationAvailable(requestedNationId?: unknown) {
    const rawRequested = String(requestedNationId ?? "").trim();
    const requested = sanitizeNationId(requestedNationId);
    const claimed = this.claimedNationIds();
    const capacity = this.state.settings.nationCount;

    if (rawRequested && !requested) throw new Error("Requested nation is invalid.");

    if (requested) {
      const index = nationIndex(requested);
      if (index < 1 || index > capacity) throw new Error(`Nation ${requested} is not available in this match.`);
      if (claimed.has(requested)) throw new Error(`Nation ${requested} is already taken.`);
      return requested;
    }

    for (let index = 1; index <= capacity; index += 1) {
      const nationId = `nation-${index}`;
      if (!claimed.has(nationId)) return nationId;
    }

    throw new Error(`Room ${this.roomId} is full; no nations are available.`);
  }

  private claimedNationIds() {
    return new Set(Array.from(this.state.players.values()).map((player) => player.nationId).filter(Boolean));
  }

  private highestClaimedNationIndex() {
    return Array.from(this.claimedNationIds()).reduce((highest, nationId) => Math.max(highest, nationIndex(nationId)), 0);
  }

  private randomAvailableNationName() {
    const claimed = new Set(Array.from(this.state.players.values()).map((player) => player.name).filter(Boolean));
    const available = MULTIPLAYER_NATION_NAMES.filter((name) => !claimed.has(name));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }

    let index = 1;
    while (claimed.has(`Nation ${index}`)) index += 1;
    return `Nation ${index}`;
  }

  private generateRoomCodeSingle() {
    let code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    return code;
  }

  private async generateRoomCode() {
    const activeCodes = await this.presence.smembers(ROOM_CODE_CHANNEL);
    let code = this.generateRoomCodeSingle();

    while (activeCodes.includes(code)) {
      code = this.generateRoomCodeSingle();
    }

    await this.presence.sadd(ROOM_CODE_CHANNEL, code);
    return code;
  }
}

function sanitizeNationId(value: unknown) {
  const nationId = String(value ?? "").trim().toLowerCase();
  return /^nation-\d+$/.test(nationId) ? nationId : "";
}

function sanitizePlayerName(value: unknown) {
  return String(value ?? "").trim().slice(0, 40);
}

function nationIndex(nationId: string) {
  const match = /^nation-(\d+)$/.exec(nationId);
  return match ? Number(match[1]) : 0;
}

function sanitizeMapSize(value: unknown) {
  const mapSize = String(value ?? "");
  return ["Small", "Medium", "Large", "Extra Large", "Enormous"].includes(mapSize) ? mapSize : "Medium";
}

function sanitizeMapOptionLevel(value: unknown) {
  const level = String(value ?? "");
  return ["Low", "Balanced", "High"].includes(level) ? level : "Balanced";
}

function sanitizeAdvancedLandscapeDiversity(value: unknown) {
  return String(value ?? "") === "superHigh" ? "superHigh" : "high";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizeActionIntentPayload(payload: PlayerActionPayload): PlayerActionPayload {
  const {
    actionPoints: _actionPoints,
    maxActionPoints: _maxActionPoints,
    actionsRemaining: _actionsRemaining,
    actionsUsedThisTurn: _actionsUsedThisTurn,
    tech: _tech,
    cost: _cost,
    ...intent
  } = payload as PlayerActionPayload & Record<string, unknown>;
  return intent;
}

function actionCode(message: string) {
  if (/action points/i.test(message)) return "INSUFFICIENT_ACTION_POINTS";
  if (/not your turn/i.test(message)) return "INVALID_TURN";
  if (/control|owned|participant/i.test(message)) return "OWNERSHIP_MISMATCH";
  if (/requires|afford|money|food|materials|education|industry|population|resource/i.test(message)) return "INSUFFICIENT_RESOURCES";
  if (/unknown|invalid|required|not found|positive|number|unsupported/i.test(message)) return "INVALID_PAYLOAD";
  return "ACTION_REJECTED";
}

function randomSeed() {
  return Math.floor((Date.now() % 1_000_000_000) + Math.random() * 1_000_000);
}
