import test from "node:test";
import assert from "node:assert/strict";
import {
  applyServerPlayerAction,
  processServerRound,
  validateEducationAction,
} from "./actions.js";
import { createInitialServerGame } from "./initialGame.js";

function createGame(overrides: Record<string, unknown> = {}) {
  return createInitialServerGame({
    mode: "lite",
    mapSize: "Small",
    nationCount: 2,
    maxTurns: 30,
    turnTimerMinutes: 0,
    unlimitedMode: false,
    happinessEnabled: true,
    educationModeEnabled: true,
    seed: 12345,
    ...overrides,
  }, [
    {
      sessionId: "host",
      name: "Host Nation",
      nationId: "nation-1",
      host: true,
      connected: true,
    },
  ]);
}

test("education mode explanations are required for strategic actions", () => {
  const game = createGame();
  const result = validateEducationAction(game, "researchTech", "nation-1", { category: "farming" });
  assert.equal(result.ok, false);
  assert.match(String(result.reason || ""), /short explanation/i);
});

test("education mode reflections block other actions until submitted", () => {
  const game = createGame();
  game.pendingEducationReflection = {
    id: "education-reflection-1",
    fromEra: 1,
    toEra: 2,
    requiredNationIds: ["nation-1"],
    completedNationIds: [],
  };

  const result = validateEducationAction(game, "buildTile", "nation-1", {});
  assert.equal(result.ok, false);
  assert.match(String(result.reason || ""), /reflection/i);
});

test("processServerRound creates a pending education reflection on era advance", () => {
  const game = createGame();
  game.turn = 7;
  game.turnNumber = 7;

  processServerRound(game);

  assert.equal(game.era, 2);
  assert.ok(game.pendingEducationReflection);
  assert.deepEqual(game.pendingEducationReflection?.requiredNationIds, ["nation-1"]);
  assert.deepEqual(game.pendingEducationReflection?.completedNationIds, []);
});

test("submitEducationReflection clears the pending requirement once complete", () => {
  const game = createGame();
  game.pendingEducationReflection = {
    id: "education-reflection-1",
    fromEra: 1,
    toEra: 2,
    requiredNationIds: ["nation-1"],
    completedNationIds: [],
  };

  const result = applyServerPlayerAction(game, "submitEducationReflection", "nation-1", {
    text: "The new era makes research and diplomacy more important.",
  });

  assert.equal(result.ok, true);
  assert.equal(game.pendingEducationReflection, null);
});
