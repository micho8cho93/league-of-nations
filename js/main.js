import { clampInt } from "./utils.js";
import { GameState } from "./game.js";
import { HexMapRenderer } from "./map.js";
import { bindUI } from "./ui.js";
import {
  CLOSED_GAME_MESSAGE,
  LeagueMultiplayerClient,
  bindRoomEvents,
  readLobbyState,
  normalizeRoomCode,
} from "./multiplayer/client.js";
import { setQualityLevel, detectRecommendedQuality } from "./rendering/quality.js";
import { preloadAll, exposeDebug } from "./rendering/assetLoader.js";
import { MusicManager, isPlayerInBattle } from "./music.js";

const setupScreen = document.getElementById("setup-screen");
const setupForm = document.getElementById("setup-form");
const continueNote = document.getElementById("continue-note");
const createMatchBtn = document.getElementById("create-match-btn");
const enterCodeBtn = document.getElementById("enter-code-btn");
const joinPanel = document.getElementById("join-panel");
const joinRoomCodeInput = document.getElementById("join-room-code");
const joinMatchBtn = document.getElementById("join-match-btn");
const multiplayerError = document.getElementById("multiplayer-error");
const lobbyScreen = document.getElementById("lobby-screen");
const lobbyRoomCode = document.getElementById("lobby-room-code");
const lobbyPlayerList = document.getElementById("lobby-player-list");
const lobbyStatus = document.getElementById("lobby-status");
const lobbyStartBtn = document.getElementById("lobby-start-btn");
const leaveLobbyBtn = document.getElementById("leave-lobby-btn");
const app = document.getElementById("app");
const canvas = document.getElementById("map-canvas");

const inputs = {
  playerName: document.getElementById("setup-player-name"),
  mapSize: document.getElementById("setup-map-size"),
  waterLevel: document.getElementById("setup-water-level"),
  landscapeDiversity: document.getElementById("setup-landscape-diversity"),
  fogOfWarEnabled: document.getElementById("setup-fog-of-war"),
  nationCount: document.getElementById("setup-nation-count"),
  maxTurns: document.getElementById("setup-max-turns"),
  turnTimerMinutes: document.getElementById("setup-turn-timer"),
  unlimitedMode: document.getElementById("setup-unlimited"),
  happinessEnabled: document.getElementById("setup-happiness-enabled"),
};

const lobbyInputs = {
  mapSize: document.getElementById("lobby-map-size"),
  waterLevel: document.getElementById("lobby-water-level"),
  landscapeDiversity: document.getElementById("lobby-landscape-diversity"),
  fogOfWarEnabled: document.getElementById("lobby-fog-of-war"),
  nationCount: document.getElementById("lobby-nation-count"),
  maxTurns: document.getElementById("lobby-max-turns"),
  turnTimerMinutes: document.getElementById("lobby-turn-timer"),
  unlimitedMode: document.getElementById("lobby-unlimited"),
  happinessEnabled: document.getElementById("lobby-happiness-enabled"),
};

if (!window.THREE) {
  continueNote.textContent = "Three.js could not load. Check your connection and refresh.";
  throw new Error("Three.js failed to load.");
}

let game = null;
let renderer = null;
let ui = null;
let multiplayer = new LeagueMultiplayerClient();
let lobbyState = null;
let multiplayerStartHandled = false;
let syncingLobbyInputs = false;
let musicManager = null;

setSessionOnlyNote();

inputs.unlimitedMode.addEventListener("change", () => {
  inputs.maxTurns.disabled = inputs.unlimitedMode.checked;
});

lobbyInputs.unlimitedMode.addEventListener("change", () => {
  lobbyInputs.maxTurns.disabled = lobbyInputs.unlimitedMode.checked;
});

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  start(GameState.newGame(readSetup()));
});

enterCodeBtn.addEventListener("click", () => {
  clearMultiplayerError();
  joinPanel.hidden = !joinPanel.hidden;
  if (!joinPanel.hidden) joinRoomCodeInput.focus();
});

createMatchBtn.addEventListener("click", async () => {
  clearMultiplayerError();
  setMultiplayerBusy(true, "Creating match...");
  try {
    const setup = readSetup();
    const room = await multiplayer.createMatch({
      playerName: setup.playerName,
      settings: setup,
    });
    bindActiveRoom(room);
    showLobby(room);
  } catch (error) {
    showMultiplayerError(error);
  } finally {
    setMultiplayerBusy(false);
  }
});

joinMatchBtn.addEventListener("click", () => joinMatch());
joinRoomCodeInput.addEventListener("input", () => {
  joinRoomCodeInput.value = normalizeRoomCode(joinRoomCodeInput.value);
});
joinRoomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinMatch();
  }
});

leaveLobbyBtn.addEventListener("click", () => {
  multiplayer.room?.leave();
  multiplayer = new LeagueMultiplayerClient();
  lobbyState = null;
  multiplayerStartHandled = false;
  lobbyScreen.hidden = true;
  setupScreen.hidden = false;
});

lobbyStartBtn.addEventListener("click", () => {
  if (!isCurrentPlayerHost()) return;
  const warning = "Starting now will close the lobby. Any unfilled nations will be controlled by bots. New players will not be able to join after the game starts.";
  if (window.confirm(warning)) multiplayer.startGame();
});

for (const input of Object.values(lobbyInputs)) {
  input.addEventListener("change", () => {
    if (syncingLobbyInputs || !isCurrentPlayerHost()) return;
    multiplayer.sendSettings(readLobbySetup());
  });
}

function readSetup() {
  return {
    playerName: inputs.playerName.value,
    mapSize: inputs.mapSize.value,
    waterLevel: inputs.waterLevel.value,
    landscapeDiversity: inputs.landscapeDiversity.value,
    fogOfWarEnabled: inputs.fogOfWarEnabled.checked,
    nationCount: clampInt(inputs.nationCount.value, 2, 16, 5),
    maxTurns: clampInt(inputs.maxTurns.value, 10, 120, 30),
    turnTimerMinutes: clampInt(inputs.turnTimerMinutes.value, 0, 240, 0),
    unlimitedMode: inputs.unlimitedMode.checked,
    happinessEnabled: inputs.happinessEnabled.checked,
  };
}

function setSessionOnlyNote() {
  // Active games are session-only: in memory on this page, or in the live server room for multiplayer.
  // Durable persistence can be added later through server/database storage, not browser localStorage.
  continueNote.textContent = "Games are session-only. Start Bot Match always creates a fresh bot match.";
}

async function joinMatch() {
  clearMultiplayerError();
  setMultiplayerBusy(true, "Joining match...");
  try {
    const room = await multiplayer.joinMatch({
      roomCode: joinRoomCodeInput.value,
      playerName: inputs.playerName.value,
    });
    bindActiveRoom(room);
    showLobby(room);
  } catch (error) {
    showMultiplayerError(error);
  } finally {
    setMultiplayerBusy(false);
  }
}

function bindActiveRoom(room) {
  multiplayerStartHandled = false;
  bindRoomEvents(room, {
    onLobbyChange: (nextLobbyState) => renderLobby(nextLobbyState),
    onPlaying: (nextLobbyState, snapshot) => handlePlayingState(nextLobbyState, snapshot),
    onGameStarted: (snapshot) => {
      multiplayer.initialSnapshot = snapshot;
    },
    onGameSnapshot: (snapshot) => {
      multiplayer.initialSnapshot = snapshot;
      handleAuthoritativeSnapshot(snapshot);
    },
    onActionAccepted: (payload) => {
      ui?.handleAcceptedPlayerAction(payload);
    },
    onActionRejected: (error) => {
      const message = error?.message || String(error || "That action was rejected by the server.");
      if (ui?.showServerError) ui.showServerError(message);
      else ui?.showNotice("Action rejected", message);
      showMultiplayerError(message);
    },
    onError: (message) => {
      showMultiplayerError(message);
      if (ui?.showServerError) ui.showServerError(message);
      lobbyStatus.textContent = message;
    },
    onLeave: () => {
      if (!multiplayerStartHandled) lobbyStatus.textContent = "Disconnected from the lobby.";
    },
  });
}

function showLobby(room) {
  setupScreen.hidden = true;
  lobbyScreen.hidden = false;
  app.hidden = true;
  renderLobby(readLobbyState(room));
}

function renderLobby(nextLobbyState) {
  if (!nextLobbyState) return;
  lobbyState = nextLobbyState;
  const host = isCurrentPlayerHost();
  const filled = lobbyState.players.length;
  const capacity = lobbyState.settings.nationCount;

  lobbyRoomCode.textContent = lobbyState.roomCode || "-----";
  lobbyStatus.textContent = host
    ? "You are the host. You can adjust settings and start the game."
    : "Waiting for the host to start the game.";

  lobbyPlayerList.innerHTML = "";
  if (lobbyState.players.length === 0) {
    const row = document.createElement("div");
    row.className = "muted";
    row.textContent = "No players connected yet.";
    lobbyPlayerList.append(row);
  } else {
    for (const player of lobbyState.players) {
      const row = document.createElement("div");
      row.className = "lobby-player";
      row.innerHTML = `
        <strong></strong>
        <span></span>
      `;
      row.querySelector("strong").textContent = player.name;
      row.querySelector("span").textContent = [
        player.nationId ? `Nation ${player.nationId.replace(/^nation-/, "")}` : "",
        player.host ? "Host" : "Player",
        player.connected ? "" : "Disconnected",
      ].filter(Boolean).join(" · ");
      lobbyPlayerList.append(row);
    }
  }

  syncLobbyInputs(lobbyState.settings, host);
  lobbyStartBtn.hidden = !host;
  lobbyStartBtn.disabled = !host || filled < 1 || lobbyState.status !== "lobby";
  lobbyStartBtn.textContent = `Start Game (${filled}/${capacity})`;
}

function syncLobbyInputs(settings, editable) {
  syncingLobbyInputs = true;
  lobbyInputs.mapSize.value = settings.mapSize;
  lobbyInputs.waterLevel.value = settings.waterLevel || "Balanced";
  lobbyInputs.landscapeDiversity.value = settings.landscapeDiversity || "Balanced";
  lobbyInputs.fogOfWarEnabled.checked = settings.fogOfWarEnabled === true;
  lobbyInputs.nationCount.value = settings.nationCount;
  lobbyInputs.maxTurns.value = settings.unlimitedMode ? 30 : settings.maxTurns;
  lobbyInputs.turnTimerMinutes.value = settings.turnTimerMinutes ?? settings.timeLimitMinutes ?? 0;
  lobbyInputs.unlimitedMode.checked = settings.unlimitedMode;
  lobbyInputs.happinessEnabled.checked = settings.happinessEnabled !== false;
  lobbyInputs.maxTurns.disabled = settings.unlimitedMode || !editable;

  for (const [key, input] of Object.entries(lobbyInputs)) {
    if (key !== "maxTurns") input.disabled = !editable;
  }
  syncingLobbyInputs = false;
}

function readLobbySetup() {
  return {
    mapSize: lobbyInputs.mapSize.value,
    waterLevel: lobbyInputs.waterLevel.value,
    landscapeDiversity: lobbyInputs.landscapeDiversity.value,
    fogOfWarEnabled: lobbyInputs.fogOfWarEnabled.checked,
    nationCount: clampInt(lobbyInputs.nationCount.value, 2, 16, 5),
    maxTurns: lobbyInputs.unlimitedMode.checked ? 0 : clampInt(lobbyInputs.maxTurns.value, 10, 120, 30),
    turnTimerMinutes: clampInt(lobbyInputs.turnTimerMinutes.value, 0, 240, 0),
    unlimitedMode: lobbyInputs.unlimitedMode.checked,
    happinessEnabled: lobbyInputs.happinessEnabled.checked,
  };
}

function isCurrentPlayerHost() {
  return Boolean(lobbyState?.hostSessionId && lobbyState.hostSessionId === multiplayer.sessionId);
}

function handlePlayingState(nextLobbyState, snapshot = multiplayer.initialSnapshot) {
  if (multiplayerStartHandled) return;
  lobbyState = nextLobbyState || lobbyState;

  const activeSnapshot = snapshot || multiplayer.initialSnapshot;
  if (!activeSnapshot) {
    lobbyStatus.textContent = "Waiting for the server game snapshot...";
    window.setTimeout(() => {
      if (!multiplayerStartHandled) handlePlayingState(lobbyState, multiplayer.initialSnapshot);
    }, 100);
    return;
  }

  multiplayerStartHandled = true;
  let nextGame = null;
  try {
    nextGame = createGameFromServerSnapshot(activeSnapshot);
  } catch (error) {
    multiplayerStartHandled = false;
    showMultiplayerError(error);
    return;
  }
  start(nextGame, { multiplayerSnapshot: activeSnapshot });
}

function setMultiplayerBusy(isBusy, message = "") {
  createMatchBtn.disabled = isBusy;
  joinMatchBtn.disabled = isBusy;
  enterCodeBtn.disabled = isBusy;
  if (isBusy) continueNote.textContent = message;
  if (!isBusy && !setupScreen.hidden) setSessionOnlyNote();
}

function clearMultiplayerError() {
  multiplayerError.hidden = true;
  multiplayerError.textContent = "";
}

function showMultiplayerError(error) {
  const message = String(error?.message || error || "");
  multiplayerError.textContent = /already.*started|locked|closed/i.test(message) ? CLOSED_GAME_MESSAGE : message;
  multiplayerError.hidden = false;
  if (!lobbyScreen.hidden) {
    lobbyStatus.textContent = multiplayerError.textContent;
  }
}

async function start(nextGame, { multiplayerSnapshot = null } = {}) {
  game = nextGame;
  setupScreen.hidden = true;
  lobbyScreen.hidden = true;
  app.hidden = false;

  // Initialize rendering quality based on device capabilities
  // Can be overridden via console: window.__quality.setQualityLevel('high')
  const recommendedQuality = detectRecommendedQuality();
  setQualityLevel(recommendedQuality);

  // Preload all registered GLB models before the first render.
  // With no .glb files present, every attempt 404s silently and resolves
  // immediately — no perceptible delay.  When GLBs exist, they are guaranteed
  // to be cached by the time setMap() builds the scene.
  await preloadAll();
  exposeDebug(); // window.__assetLoader for console inspection

  renderer = new HexMapRenderer(canvas);
  renderer.setMap(game.map);
  ui = bindUI(game, renderer, { multiplayerClient: multiplayerSnapshot ? multiplayer : null });
  if (multiplayerSnapshot) renderMultiplayerSnapshotDebug(multiplayerSnapshot, game.playerId);
  window.__leagueOfNations = { game, renderer, ui, multiplayer, multiplayerSnapshot };

  // Initialize music manager
  if (!musicManager) {
    musicManager = new MusicManager();
  }
  musicManager.startBackgroundMusic();

  // Set up music state tracking
  const originalChanged = game.changed.bind(game);
  game.changed = function(source) {
    originalChanged(source);
    // Update music based on battle state
    if (source === "battle" || source === "war" || source === "turn_end") {
      updateMusicState();
    }
  };

  function updateMusicState() {
    const playerInBattle = isPlayerInBattle(game, game.playerId);
    if (playerInBattle && !musicManager.isInBattle) {
      musicManager.startBattleMusic();
    } else if (!playerInBattle && musicManager.isInBattle) {
      musicManager.stopBattleMusic();
    }
  }

  // Expose quality controls to console for debugging
  window.__quality = { setQualityLevel, detectRecommendedQuality };
}

function handleAuthoritativeSnapshot(snapshot) {
  if (!snapshot?.gameState || !game || !ui) return;
  const selectedTileId = game.selectedTileId;
  const nextGame = createGameFromServerSnapshot(snapshot);
  nextGame.selectedTileId = selectedTileId && nextGame.tileById(selectedTileId) ? selectedTileId : null;
  game = nextGame;
  renderer.setMap(game.map);
  ui.setGame(game);
  renderMultiplayerSnapshotDebug(snapshot, game.playerId);
  window.__leagueOfNations = { game, renderer, ui, multiplayer, multiplayerSnapshot: snapshot };

  // Update music state based on new game state
  if (musicManager) {
    const playerInBattle = isPlayerInBattle(game, game.playerId);
    if (playerInBattle && !musicManager.isInBattle) {
      musicManager.startBattleMusic();
    } else if (!playerInBattle && musicManager.isInBattle) {
      musicManager.stopBattleMusic();
    }
  }
}

function createGameFromServerSnapshot(snapshot) {
  const serverGameState = snapshot.gameState;
  if (!serverGameState?.map || !serverGameState?.nations) {
    throw new Error("The server did not provide an initial game snapshot.");
  }

  const assignedNation = findAssignedNation(snapshot, multiplayer.sessionId);
  const playerId = assignedNation?.id || Object.keys(serverGameState.nations)[0];
  const localGameData = deepClone(serverGameState);
  localGameData.playerId = playerId;
  localGameData.botIds = Object.values(localGameData.nations)
    .filter((nation) => nation.controllerType === "bot" || nation.bot)
    .map((nation) => nation.id);
  localGameData.preserveNationColors = true;
  localGameData.serverAuthoritative = true;

  for (const nation of Object.values(localGameData.nations)) {
    nation.isPlayer = nation.id === playerId;
  }

  const nextGame = new GameState(localGameData);
  nextGame.serverAuthoritative = true;
  return nextGame;
}

function findAssignedNation(snapshot, sessionId) {
  const nationList = snapshot.nations || Object.values(snapshot.gameState?.nations || {});
  return nationList.find((nation) => nation.sessionId === sessionId) || null;
}

function renderMultiplayerSnapshotDebug(snapshot, assignedNationId) {
  // Kept as a hook for console debugging without adding visible UI chrome.
  window.__leagueOfNationsSnapshotDebug = { snapshot, assignedNationId };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
