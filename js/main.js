import { SAVE_KEY, clampInt } from "./utils.js";
import { GameState, clearSavedGame, readSavedGame } from "./game.js";
import { HexMapRenderer } from "./map.js";
import { TUTORIAL_COMPLETED_KEY, bindUI } from "./ui.js";

const setupScreen = document.getElementById("setup-screen");
const setupForm = document.getElementById("setup-form");
const setupReplayTutorialBtn = document.getElementById("setup-replay-tutorial-btn");
const continueBtn = document.getElementById("continue-btn");
const continueNote = document.getElementById("continue-note");
const app = document.getElementById("app");
const canvas = document.getElementById("map-canvas");

const inputs = {
  playerName: document.getElementById("setup-player-name"),
  mapSize: document.getElementById("setup-map-size"),
  nationCount: document.getElementById("setup-nation-count"),
  maxTurns: document.getElementById("setup-max-turns"),
  timeLimitMinutes: document.getElementById("setup-time-limit"),
  unlimitedMode: document.getElementById("setup-unlimited"),
};

if (!window.THREE) {
  continueNote.textContent = "Three.js could not load. Check your connection and refresh.";
  continueBtn.disabled = true;
  throw new Error("Three.js failed to load.");
}

let game = null;
let renderer = null;
let ui = null;
const saved = readSavedGame();

if (saved) {
  const date = saved.savedAt ? new Date(saved.savedAt).toLocaleString() : "recently";
  continueNote.textContent = `Saved game found: turn ${saved.turn}, era ${saved.era}, saved ${date}.`;
  continueBtn.disabled = false;
} else {
  continueNote.textContent = "No saved game found.";
  continueBtn.disabled = true;
}

inputs.unlimitedMode.addEventListener("change", () => {
  inputs.maxTurns.disabled = inputs.unlimitedMode.checked;
});

setupReplayTutorialBtn.addEventListener("click", () => {
  localStorage.removeItem(TUTORIAL_COMPLETED_KEY);
  continueNote.textContent = "Tutorial will replay when you start or continue a game.";
});

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearSavedGame();
  start(GameState.newGame(readSetup()));
});

continueBtn.addEventListener("click", () => {
  const data = readSavedGame();
  if (!data) return;
  try {
    start(GameState.fromSave(data));
  } catch (error) {
    console.error(error);
    localStorage.removeItem(SAVE_KEY);
    continueNote.textContent = "Saved game could not be loaded. Start a new game.";
    continueBtn.disabled = true;
  }
});

function readSetup() {
  return {
    playerName: inputs.playerName.value,
    mapSize: inputs.mapSize.value,
    nationCount: clampInt(inputs.nationCount.value, 2, 10, 5),
    maxTurns: clampInt(inputs.maxTurns.value, 10, 120, 30),
    timeLimitMinutes: clampInt(inputs.timeLimitMinutes.value, 0, 240, 0),
    unlimitedMode: inputs.unlimitedMode.checked,
  };
}

function start(nextGame) {
  game = nextGame;
  setupScreen.hidden = true;
  app.hidden = false;
  renderer = new HexMapRenderer(canvas);
  renderer.setMap(game.map);
  ui = bindUI(game, renderer);
  window.__leagueOfNations = { game, renderer, ui };
}
