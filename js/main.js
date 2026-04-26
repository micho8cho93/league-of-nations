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
  nationCount: document.getElementById("setup-nation-count"),
  maxTurns: document.getElementById("setup-max-turns"),
  turnTimerMinutes: document.getElementById("setup-turn-timer"),
  unlimitedMode: document.getElementById("setup-unlimited"),
};

const lobbyInputs = {
  mapSize: document.getElementById("lobby-map-size"),
  nationCount: document.getElementById("lobby-nation-count"),
  maxTurns: document.getElementById("lobby-max-turns"),
  turnTimerMinutes: document.getElementById("lobby-turn-timer"),
  unlimitedMode: document.getElementById("lobby-unlimited"),
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
    nationCount: clampInt(inputs.nationCount.value, 2, 10, 5),
    maxTurns: clampInt(inputs.maxTurns.value, 10, 120, 30),
    turnTimerMinutes: clampInt(inputs.turnTimerMinutes.value, 0, 240, 0),
    unlimitedMode: inputs.unlimitedMode.checked,
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
    onActionRejected: (message) => {
      ui?.showNotice("Action rejected", message);
      showMultiplayerError(message);
    },
    onError: (message) => {
      showMultiplayerError(message);
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
  lobbyInputs.nationCount.value = settings.nationCount;
  lobbyInputs.maxTurns.value = settings.unlimitedMode ? 30 : settings.maxTurns;
  lobbyInputs.turnTimerMinutes.value = settings.turnTimerMinutes ?? settings.timeLimitMinutes ?? 0;
  lobbyInputs.unlimitedMode.checked = settings.unlimitedMode;
  lobbyInputs.maxTurns.disabled = settings.unlimitedMode || !editable;

  for (const [key, input] of Object.entries(lobbyInputs)) {
    if (key !== "maxTurns") input.disabled = !editable;
  }
  syncingLobbyInputs = false;
}

function readLobbySetup() {
  return {
    mapSize: lobbyInputs.mapSize.value,
    nationCount: clampInt(lobbyInputs.nationCount.value, 2, 10, 5),
    maxTurns: lobbyInputs.unlimitedMode.checked ? 0 : clampInt(lobbyInputs.maxTurns.value, 10, 120, 30),
    turnTimerMinutes: clampInt(lobbyInputs.turnTimerMinutes.value, 0, 240, 0),
    unlimitedMode: lobbyInputs.unlimitedMode.checked,
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

function start(nextGame, { multiplayerSnapshot = null } = {}) {
  game = nextGame;
  setupScreen.hidden = true;
  lobbyScreen.hidden = true;
  app.hidden = false;
  renderer = new HexMapRenderer(canvas);
  renderer.setMap(game.map);
  ui = bindUI(game, renderer, { multiplayerClient: multiplayerSnapshot ? multiplayer : null });
  if (multiplayerSnapshot) renderMultiplayerSnapshotDebug(multiplayerSnapshot, game.playerId);
  window.__leagueOfNations = { game, renderer, ui, multiplayer, multiplayerSnapshot };
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
  const container = document.querySelector(".side-panel-content");
  if (!container) return;

  let panel = document.getElementById("multiplayer-snapshot-panel");
  if (!panel) {
    panel = document.createElement("details");
    panel.id = "multiplayer-snapshot-panel";
    panel.className = "panel side-section multiplayer-snapshot-panel";
    panel.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "Multiplayer Snapshot";
    const body = document.createElement("div");
    body.className = "multiplayer-snapshot-body";
    panel.append(summary, body);
    container.prepend(panel);
  }

  const body = panel.querySelector(".multiplayer-snapshot-body");
  const nations = snapshot.nations || Object.values(snapshot.gameState?.nations || {});
  const assigned = nations.find((nation) => nation.id === assignedNationId);
  body.innerHTML = "";

  const status = document.createElement("p");
  status.className = "muted";
  status.textContent = `Game started. You control ${assigned?.name || "an assigned nation"}.`;
  body.append(status);

  const list = document.createElement("div");
  list.className = "snapshot-nation-list";
  for (const nation of nations) {
    const row = document.createElement("div");
    row.className = "snapshot-nation-row";
    const name = document.createElement("strong");
    name.textContent = `${nation.id === assignedNationId ? "You: " : ""}${nation.name}`;
    const meta = document.createElement("span");
    meta.className = "mini-pill";
    meta.textContent = nation.bot ? "Bot" : "Human";
    row.append(name, meta);
    list.append(row);
  }
  body.append(list);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
