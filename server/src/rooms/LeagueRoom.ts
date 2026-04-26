import { Room, type Client } from "colyseus";
import { MapSchema, Schema, type } from "@colyseus/schema";
// The authoritative multiplayer room reuses the browser game's rules engine so
// server validation/mutation stays aligned with local/offline play.
// @ts-expect-error The shared game engine is plain ESM JavaScript.
import { GameState as SharedGameState } from "../../../js/game.js";
import {
  createInitialServerGame,
  serializeGameSnapshot,
  type InitialGameSettings,
  type SeatPlayer,
  type ServerGameState,
} from "../game/initialGame.js";

type RoomStatus = "lobby" | "playing" | "finished";
type RuntimeGameState = InstanceType<typeof SharedGameState>;

const ROOM_CODE_CHANNEL = "$league-of-nations-room-codes";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;

interface JoinOptions {
  playerName?: unknown;
}

interface SettingsPayload {
  mapSize?: unknown;
  nationCount?: unknown;
  maxTurns?: unknown;
  timeLimitMinutes?: unknown;
  unlimitedMode?: unknown;
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
}

class LobbyPlayer extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("boolean") host = false;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
}

class GameSettings extends Schema {
  @type("string") mapSize = "Medium";
  @type("uint8") nationCount = 5;
  @type("uint16") maxTurns = 30;
  @type("uint16") timeLimitMinutes = 0;
  @type("boolean") unlimitedMode = false;
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
  maxClients = 10;
  state = new LeagueRoomState();
  private gameState: RuntimeGameState | null = null;
  private endedNationIds = new Set<string>();
  private resolvingTurn = false;

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
      this.endedNationIds.clear();
      this.setMetadata({
        roomCode: this.state.roomCode,
        status: this.state.status,
      });
      this.broadcast("gameStarted", this.createInitialGameSnapshot(), { afterNextPatch: true });
    },

    playerAction: async (client: Client, payload: PlayerActionPayload = {}) => {
      await this.handlePlayerAction(client, payload);
    },
  };

  async onCreate(options: SettingsPayload = {}) {
    this.roomId = await this.generateRoomCode();
    this.state.roomCode = this.roomId;
    this.applySettings(options);
    this.maxClients = this.state.settings.nationCount;
    this.setMetadata({
      roomCode: this.state.roomCode,
      status: this.state.status,
    });
  }

  onAuth() {
    if (this.state.status !== "lobby") {
      throw new Error(`Room ${this.roomId} is already ${this.state.status}; new players can only join during the lobby.`);
    }

    return true;
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    if (this.state.status !== "lobby") {
      throw new Error(`Room ${this.roomId} is already ${this.state.status}; new players can only join during the lobby.`);
    }

    const isFirstPlayer = this.state.players.size === 0;
    const player = new LobbyPlayer();
    player.sessionId = client.sessionId;
    player.name = sanitizePlayerName(options.playerName, `Player ${this.state.players.size + 1}`);
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
    if (payload.mapSize !== undefined) {
      this.state.settings.mapSize = sanitizeMapSize(payload.mapSize);
    }

    if (payload.nationCount !== undefined) {
      const minimumNations = Math.max(2, this.state.players.size);
      this.state.settings.nationCount = clampInteger(payload.nationCount, minimumNations, 10, this.state.settings.nationCount);
      this.maxClients = this.state.settings.nationCount;
    }

    if (payload.unlimitedMode !== undefined) {
      this.state.settings.unlimitedMode = Boolean(payload.unlimitedMode);
    }

    if (payload.maxTurns !== undefined) {
      this.state.settings.maxTurns = this.state.settings.unlimitedMode
        ? 0
        : clampInteger(payload.maxTurns, 10, 120, this.state.settings.maxTurns);
    }

    if (payload.timeLimitMinutes !== undefined) {
      this.state.settings.timeLimitMinutes = clampInteger(payload.timeLimitMinutes, 0, 240, this.state.settings.timeLimitMinutes);
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
      mapSize: this.state.settings.mapSize as InitialGameSettings["mapSize"],
      nationCount: this.state.settings.nationCount,
      maxTurns: this.state.settings.maxTurns,
      timeLimitMinutes: this.state.settings.timeLimitMinutes,
      unlimitedMode: this.state.settings.unlimitedMode,
      seed: this.state.settings.seed,
    };
  }

  private createInitialGameSnapshot() {
    if (!this.gameState) {
      throw new Error("Cannot create a game snapshot before the server game state exists.");
    }

    const gameSnapshot = serializeGameSnapshot(this.gameState);
    return {
      snapshotVersion: 1,
      roomCode: this.state.roomCode,
      roomId: this.roomId,
      status: this.state.status,
      hostSessionId: this.state.hostSessionId,
      settings: this.snapshotSettings(),
      players: this.snapshotPlayers(),
      ...gameSnapshot,
    };
  }

  private snapshotPlayers() {
    return Array.from(this.state.players.values()).map((player) => ({
      sessionId: player.sessionId,
      name: player.name,
      host: player.host,
      ready: player.ready,
      connected: player.connected,
    }));
  }

  private createRuntimeGame() {
    const data = createInitialServerGame(this.snapshotSettings(), this.orderedSeatPlayers());
    const firstHuman = data.seats.find((seat) => seat.controllerType === "human")?.nationId;
    const runtime = new SharedGameState({
      ...data,
      playerId: firstHuman || data.seats[0]?.nationId || "nation-1",
      preserveNationColors: true,
    });
    runtime.seats = data.seats;
    return runtime;
  }

  private async handlePlayerAction(client: Client, payload: PlayerActionPayload) {
    const validation = this.validateActionEnvelope(client, payload);
    if (!validation.ok) {
      client.send("actionRejected", { message: validation.reason });
      return;
    }

    const { nationId } = validation;
    const type = String(payload.type);
    let result: { ok?: boolean; reason?: string; [key: string]: unknown } = { ok: false, reason: "Unknown action." };

    try {
      // Multiplayer/server-authoritative logic: clients send intent only. The
      // Colyseus room validates ownership/status, runs existing rule checks by
      // invoking GameState methods, mutates server-owned state, then snapshots.
      if (type === "endTurn") {
        result = await this.acceptEndTurn(nationId);
      } else {
        result = this.applyPlayerAction(type, nationId, payload);
      }
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : "The server could not apply that action." };
    }

    if (!result?.ok) {
      client.send("actionRejected", { message: result?.reason || "That action is not legal right now." });
      return;
    }

    this.finishIfGameOver();
    this.broadcastGameSnapshot();
  }

  private validateActionEnvelope(client: Client, payload: PlayerActionPayload): { ok: true; nationId: string } | { ok: false; reason: string } {
    if (this.state.status !== "playing" || !this.gameState) {
      return { ok: false, reason: "The game is not currently playing." };
    }

    if (this.resolvingTurn || this.gameState.isProcessingTurn || this.gameState.phase !== "player") {
      return { ok: false, reason: "The server is resolving the turn." };
    }

    if (this.gameState.gameOver) {
      return { ok: false, reason: "The game is already finished." };
    }

    const type = String(payload?.type || "");
    if (!type) return { ok: false, reason: "Action type is required." };

    const nationId = String(payload.nationId || "");
    const nation = nationId ? this.gameState.nations[nationId] : null;
    if (!nation) return { ok: false, reason: "Unknown nation." };
    if (nation.sessionId !== client.sessionId) return { ok: false, reason: "You do not control that nation." };
    if (nation.bot || nation.controllerType === "bot") return { ok: false, reason: "Bot nations are controlled by the server." };
    if (!nation.active) return { ok: false, reason: "That nation is no longer active." };
    if (this.endedNationIds.has(nationId)) return { ok: false, reason: "That nation has already ended this turn." };

    return { ok: true, nationId };
  }

  private applyPlayerAction(type: string, nationId: string, payload: PlayerActionPayload) {
    if (!this.gameState) return { ok: false, reason: "Game state is unavailable." };

    switch (type) {
      case "buildTile":
        return this.gameState.buildTile(requiredString(payload.tileId, "Tile"), requiredString(payload.buildingType, "Building type"), nationId);
      case "assignWorkers":
        return this.gameState.assignWorkers(requiredString(payload.tileId, "Tile"), integerValue(payload.amount, 0), nationId);
      case "destroyTile":
        return this.gameState.destroyTile(requiredString(payload.tileId, "Tile"), nationId);
      case "trainUnit":
        return this.gameState.trainUnit(requiredString(payload.tileId, "Tile"), integerValue(payload.strength ?? payload.amount, 1), nationId, {
          branch: stringValue(payload.branch, "infantry"),
        });
      case "moveOrAttackUnit":
        return this.gameState.moveOrAttackUnit(
          requiredString(payload.fromTileId ?? payload.tileId, "Source tile"),
          requiredString(payload.toTileId ?? payload.targetId, "Target tile"),
          nationId
        );
      case "declareWar":
        return this.gameState.declareWar(requiredString(payload.targetId, "Target nation"), nationId, "Player declaration");
      case "trade":
        return this.gameState.trade(
          requiredString(payload.partnerId ?? payload.targetId, "Trade partner"),
          objectValue(payload.offer),
          objectValue(payload.request),
          nationId
        );
      case "proposeAlliance":
        return this.gameState.proposeAlliance(
          requiredString(payload.partnerId ?? payload.targetId, "Alliance partner"),
          stringValue(payload.allianceType, "trade"),
          nationId
        );
      case "breakAlliance":
        return this.gameState.breakAlliance(requiredString(payload.allianceId ?? payload.targetId, "Alliance"), nationId);
      case "embargo":
        return this.gameState.embargo(requiredString(payload.targetId, "Target nation"), nationId);
      case "research":
        return this.gameState.research(requiredString(payload.category, "Research category"), nationId);
      case "researchBranch":
        return this.gameState.researchBranch(requiredString(payload.branch, "Research branch"), nationId);
      default:
        return { ok: false, reason: `Unsupported action "${type}".` };
    }
  }

  private async acceptEndTurn(nationId: string) {
    if (!this.gameState) return { ok: false, reason: "Game state is unavailable." };

    this.endedNationIds.add(nationId);
    const activeHumanIds = (Object.values(this.gameState.nations) as Array<Record<string, any>>)
      .filter((nation) => nation.active && !nation.bot && nation.controllerType !== "bot")
      .map((nation) => String(nation.id));

    if (activeHumanIds.some((id) => !this.endedNationIds.has(id))) {
      return { ok: true, waitingForHumans: true };
    }

    this.resolvingTurn = true;
    try {
      await this.gameState.endTurn({
        onBotTurn: async () => {
          this.broadcastGameSnapshot();
        },
      });
      this.endedNationIds.clear();
      this.finishIfGameOver();
    } finally {
      this.resolvingTurn = false;
    }

    return { ok: true, advancedTurn: true };
  }

  private broadcastGameSnapshot() {
    if (!this.gameState) return;
    this.broadcast("gameSnapshot", this.createInitialGameSnapshot(), { afterNextPatch: true });
  }

  private finishIfGameOver() {
    if (!this.gameState?.gameOver || this.state.status === "finished") return;
    this.state.status = "finished";
    this.setMetadata({
      roomCode: this.state.roomCode,
      status: this.state.status,
    });
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
      host: player.host,
      connected: player.connected,
    }));
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

function sanitizePlayerName(value: unknown, fallback: string) {
  const name = String(value ?? "").trim().slice(0, 40);
  return name || fallback;
}

function sanitizeMapSize(value: unknown) {
  const mapSize = String(value ?? "");
  return ["Small", "Medium", "Large"].includes(mapSize) ? mapSize : "Medium";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function requiredString(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function stringValue(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function integerValue(value: unknown, fallback: number) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function objectValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function randomSeed() {
  return Math.floor((Date.now() % 1_000_000_000) + Math.random() * 1_000_000);
}
