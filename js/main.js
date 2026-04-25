// Entry point. Phase 9 adds start/continue flow, save loading, and tutorial polish.


const canvas = document.getElementById("map-canvas");
const tileInfoEl = document.getElementById("tile-info");
const startScreenEl = document.getElementById("start-screen");
const startGameBtn = document.getElementById("start-game-btn");
const continueGameBtn = document.getElementById("continue-game-btn");
const continueNoteEl = document.getElementById("continue-note");
const inputs = {
  nationName: document.getElementById("start-nation-name"),
  botCount: document.getElementById("start-bot-count"),
  mapSize: document.getElementById("start-map-size"),
  turnLimit: document.getElementById("start-turn-limit"),
  growthRate: document.getElementById("start-growth-rate"),
};

if (typeof THREE === "undefined") {
  tileInfoEl.innerHTML = `<p class="muted">Three.js failed to load from CDN. Check your connection and refresh.</p>`;
  throw new Error("THREE not loaded");
}

const savedGame = readSavedGame();
if (savedGame) {
  const savedDate = savedGame.savedAt ? new Date(savedGame.savedAt).toLocaleString() : "recently";
  continueNoteEl.textContent = `Saved game found: turn ${savedGame.turn}, stage ${savedGame.stage}, saved ${savedDate}.`;
  continueGameBtn.disabled = false;
} else {
  continueNoteEl.textContent = "No saved game found.";
  continueGameBtn.disabled = true;
}

startGameBtn.addEventListener("click", () => {
  if (typeof localStorage !== "undefined") localStorage.removeItem(GAME_SAVE_KEY);
  startNewGame();
});

continueGameBtn.addEventListener("click", () => {
  if (!savedGame) return;
  continueSavedGame(savedGame);
});

function startNewGame() {
  const config = readStartConfig();
  const map = new HexMap(canvas, {
    radius: config.radius,
    seed: randomSeed(),
  });

  const regionAssignments = regionSequence(config.botCount + 1, map.seed);
  const player = createNation({
    id: "player",
    name: config.playerName,
    color: "#4cc9a8",
    regionType: regionAssignments[0],
  });

  const state = new GameState({
    map,
    playerNation: player,
    growthEvery: config.growthEvery,
    turnLimit: config.turnLimit,
  });
  state.setupPlayerStart();

  const botNames = [
    "Kingdom of Arden",
    "Union of Vesper",
    "Duchy of Solenne",
    "League of Meridia",
    "Free Cities of Orun",
    "Principality of Caldor",
    "Commonwealth of Istria",
  ];
  const botColors = ["#d95f59", "#6c8ff0", "#d7b84f", "#a875d6", "#e58a42", "#3fb7c4", "#d66aa2"];
  for (let index = 0; index < config.botCount; index++) {
    const bot = createNation({
      id: `bot_${index + 1}`,
      name: botNames[index],
      color: botColors[index],
      regionType: regionAssignments[index + 1],
    });
    state.addNation(bot, {
      isBot: true,
      personality: botArchetype(index, map.seed % 5),
    });
  }
  state.setupBotStarts();

  finishInit(state, map);
  state.addEvent(
    `Welcome, ${player.name}. ${config.botCount} rival nations have entered the league.`,
    { nationId: player.id, kind: "welcome" }
  );
  state.saveToLocalStorage({ silent: true });
}

function continueSavedGame(saveData) {
  try {
    const map = new HexMap(canvas, {
      radius: saveData.map?.radius || 8,
      seed: saveData.map?.seed || randomSeed(),
    });
    const state = GameState.fromSaveData(saveData, map);
    finishInit(state, map);
    state.addEvent(`Loaded saved game from turn ${state.turn}.`, {
      nationId: state.playerId,
      kind: "save",
    });
  } catch (err) {
    console.error(err);
    continueNoteEl.textContent = "Saved game could not be loaded. Start a new game instead.";
    continueGameBtn.disabled = true;
  }
}

function finishInit(state, map) {
  startScreenEl.hidden = true;
  bindUI(state);
  window.__game = { state, map };
}

function readStartConfig() {
  const playerName = String(inputs.nationName.value || "Republic of Nova").trim().slice(0, 40) || "Republic of Nova";
  const botCount = clampInt(inputs.botCount.value, 2, 7, 3);
  const selectedRadius = clampInt(inputs.mapSize.value, 8, 14, 8);
  return {
    playerName,
    botCount,
    radius: Math.max(selectedRadius, recommendedRadius(botCount + 1)),
    turnLimit: clampInt(inputs.turnLimit.value, 0, 40, 30),
    growthEvery: clampInt(inputs.growthRate.value, 1, 2, 1),
  };
}

function recommendedRadius(nationCount) {
  if (nationCount <= 3) return 8;
  if (nationCount <= 5) return 11;
  return 14;
}

function regionSequence(count, seed) {
  const regions = [];
  while (regions.length < count) regions.push(1, 2, 3, 4);
  return regions
    .slice(0, count)
    .map((regionType, index) => ({
      regionType,
      sort: seededSortValue(seed, index),
    }))
    .sort((a, b) => a.sort - b.sort)
    .map((entry) => entry.regionType);
}

function seededSortValue(seed, index) {
  const x = Math.sin(seed + index * 9973) * 10000;
  return x - Math.floor(x);
}

function readSavedGame() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(GAME_SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
