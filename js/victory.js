import { BALANCE } from "./balance.js";
import { evaluateScenarioVictory } from "./scenarios.js";
import { bilateralSocietyMetrics } from "./cultureReligion.js";

const LINEAR_TECH_CATEGORIES = ["farming", "mining", "education", "infrastructure", "military"];
const BRANCH_TECH_CATEGORIES = ["tanks", "air", "naval"];

export const VICTORY_CONFIG = Object.freeze({
  technologicalSupremacy: {
    finalTier: BALANCE.tech.research.maxTier,
    linearScoreWeight: 10,
    branchScoreWeight: 4,
    requiredLead: 12,
    holdTurns: 3,
  },
  diplomaticHegemony: {
    holdTurns: 10,
    minimumBlocQuality: 58,
  },
});

export function normalizeVictoryProgress(game) {
  if (!game.victoryProgress || typeof game.victoryProgress !== "object") {
    game.victoryProgress = createVictoryProgressState();
  }

  const progress = game.victoryProgress;
  progress.lastTurnBoundaryTurn = Number.isFinite(Number(progress.lastTurnBoundaryTurn))
    ? Number(progress.lastTurnBoundaryTurn)
    : 0;
  progress.totalDomination = progress.totalDomination || {};
  progress.technologicalSupremacy = progress.technologicalSupremacy || {};
  progress.diplomaticHegemony = progress.diplomaticHegemony || {};
  progress.nations = progress.nations || {};

  for (const nationId of Object.keys(game.nations || {})) {
    progress.nations[nationId] = normalizeNationVictoryEntry(progress.nations[nationId]);
  }

  return progress;
}

export function refreshVictoryProgress(game, { turnBoundary = false } = {}) {
  const progress = normalizeVictoryProgress(game);
  const shouldCountTurnBoundary = turnBoundary && progress.lastTurnBoundaryTurn !== game.turn;
  if (shouldCountTurnBoundary) progress.lastTurnBoundaryTurn = game.turn;

  const activeNationIds = activeNationIdsFor(game);
  const capitalTileIds = capitalTileIdsFor(game);
  const totalCapitals = capitalTileIds.length;
  const techConfig = VICTORY_CONFIG.technologicalSupremacy;
  const diplomacyConfig = VICTORY_CONFIG.diplomaticHegemony;
  const requiredAllianceCount = Math.floor(activeNationIds.length / 2) + 1;
  const techScores = Object.fromEntries(activeNationIds.map((nationId) => [nationId, techScore(game.nations[nationId], techConfig)]));

  progress.totalDomination = {
    totalCapitals,
    capitalTileIds,
  };
  progress.technologicalSupremacy = {
    requiredLead: techConfig.requiredLead,
    holdTurns: techConfig.holdTurns,
    finalTier: techConfig.finalTier,
  };
  progress.diplomaticHegemony = {
    requiredAllianceCount,
    holdTurns: diplomacyConfig.holdTurns,
    minimumBlocQuality: diplomacyConfig.minimumBlocQuality,
    activeNationCount: activeNationIds.length,
  };

  for (const nationId of Object.keys(game.nations || {})) {
    const nation = game.nations[nationId];
    const entry = normalizeNationVictoryEntry(progress.nations[nationId]);
    const capitalsControlled = capitalTileIds.reduce((sum, tileId) => {
      const tile = tileById(game, tileId);
      return sum + (tile?.ownerId === nationId ? 1 : 0);
    }, 0);
    const linearTiersCompleted = LINEAR_TECH_CATEGORIES.reduce((sum, category) => {
      return sum + (Number(nation?.tech?.[category]) >= techConfig.finalTier ? 1 : 0);
    }, 0);
    const finalTierComplete = nation?.active === true && linearTiersCompleted === LINEAR_TECH_CATEGORIES.length;
    const score = nation?.active ? (techScores[nationId] || 0) : 0;
    const bestOtherScore = Math.max(0, ...activeNationIds.filter((id) => id !== nationId).map((id) => techScores[id] || 0));
    const techLead = activeNationIds.length > 1 ? score - bestOtherScore : 0;
    const alliedNationIds = alliedNationIdsFor(game, nationId);
    const allianceCount = alliedNationIds.length;
    const blocQuality = diplomaticBlocQuality(game, nationId, alliedNationIds);
    const meetsTechCondition = Boolean(
      nation?.active &&
      activeNationIds.length > 1 &&
      finalTierComplete &&
      techLead >= techConfig.requiredLead
    );
    const meetsDiplomaticCondition = Boolean(
      nation?.active &&
      activeNationIds.length > 1 &&
      allianceCount >= requiredAllianceCount &&
      blocQuality >= diplomacyConfig.minimumBlocQuality
    );

    entry.capitalsControlled = capitalsControlled;
    entry.totalCapitals = totalCapitals;
    entry.linearTiersCompleted = linearTiersCompleted;
    entry.requiredLinearTiers = LINEAR_TECH_CATEGORIES.length;
    entry.finalTierComplete = finalTierComplete;
    entry.techScore = score;
    entry.techLead = techLead;
    entry.requiredTechLead = techConfig.requiredLead;
    entry.meetsTechCondition = meetsTechCondition;
    entry.techHoldTurns = nextHoldTurns(entry.techHoldTurns, meetsTechCondition, shouldCountTurnBoundary);
    entry.techTurnsRemaining = Math.max(0, techConfig.holdTurns - entry.techHoldTurns);
    entry.alliedNationIds = alliedNationIds;
    entry.allianceCount = allianceCount;
    entry.requiredAllianceCount = requiredAllianceCount;
    entry.activeNationCount = activeNationIds.length;
    entry.diplomaticBlocQuality = blocQuality;
    entry.requiredDiplomaticBlocQuality = diplomacyConfig.minimumBlocQuality;
    entry.meetsDiplomaticCondition = meetsDiplomaticCondition;
    entry.diplomaticHoldTurns = nextHoldTurns(entry.diplomaticHoldTurns, meetsDiplomaticCondition, shouldCountTurnBoundary);
    entry.diplomaticTurnsRemaining = Math.max(0, diplomacyConfig.holdTurns - entry.diplomaticHoldTurns);

    progress.nations[nationId] = entry;
  }

  return progress;
}

export function checkVictory(game, options = {}) {
  if (game.gameOver) return game.gameOver;

  const progress = refreshVictoryProgress(game, options);
  const dominationWinnerId = totalDominationWinnerId(game, progress.totalDomination?.capitalTileIds || []);
  if (dominationWinnerId) {
    return finalizeVictory(
      game,
      dominationWinnerId,
      "total_domination",
      "Total Domination Victory",
      `${game.nations[dominationWinnerId].name} controls every capital on the map.`,
      options
    );
  }

  if (options.turnBoundary) {
    const techWinnerId = Object.keys(progress.nations).find((nationId) => {
      const entry = progress.nations[nationId];
      return entry.meetsTechCondition && entry.techHoldTurns >= VICTORY_CONFIG.technologicalSupremacy.holdTurns;
    });
    if (techWinnerId) {
      return finalizeVictory(
        game,
        techWinnerId,
        "technological_supremacy",
        "Technological Supremacy Victory",
        `${game.nations[techWinnerId].name} completed the final tech tier and held a decisive research lead.`,
        options
      );
    }

    const diplomacyWinnerId = Object.keys(progress.nations).find((nationId) => {
      const entry = progress.nations[nationId];
      return entry.meetsDiplomaticCondition && entry.diplomaticHoldTurns >= VICTORY_CONFIG.diplomaticHegemony.holdTurns;
    });
    if (diplomacyWinnerId) {
      return finalizeVictory(
        game,
        diplomacyWinnerId,
        "diplomatic_hegemony",
        "Diplomatic Hegemony Victory",
        `${game.nations[diplomacyWinnerId].name} maintained a majority alliance bloc for 10 consecutive turns.`,
        options
      );
    }
  }

  // Scenario-specific victory hook (e.g. WW2 capital captures, territory %).
  // Runs before the generic turn-limit fallback so scenarios can win earlier.
  const scenarioOutcome = game.settings?.scenarioId ? evaluateScenarioVictory(game) : null;
  if (scenarioOutcome) {
    // Pick a winnerId from the winning bloc — the player if they are in it,
    // else the first allied member. Falls back to the first alive nation.
    const winnerId = scenarioWinnerNationId(game, scenarioOutcome) || activeNationIdsFor(game)[0] || "";
    if (winnerId) {
      return finalizeVictory(
        game,
        winnerId,
        "scenario_victory",
        scenarioOutcome.label || "Scenario Victory",
        scenarioOutcome.reason || "Scenario victory conditions met.",
        options,
      );
    }
  }

  if (!game.settings.unlimitedMode && game.settings.maxTurns > 0 && game.turn >= game.settings.maxTurns) {
    const scores = typeof options.scoreboard === "function" ? options.scoreboard(game) : [];
    const winnerId = scores[0]?.id || activeNationIdsFor(game)[0] || Object.keys(game.nations || {})[0] || "";
    game.gameOver = {
      isGameOver: true,
      type: "turn_limit",
      victoryType: "turn_limit",
      label: "Turn Limit Reached",
      winnerId,
      winnerNationId: winnerId,
      winnerPlayerId: game.nations[winnerId]?.sessionId || null,
      turn: game.turn,
      turnNumber: game.turnNumber || game.turn,
      reason: "The configured turn limit was reached.",
      scores,
    };
    if (typeof options.onVictory === "function") options.onVictory(game.gameOver);
  }

  return game.gameOver;
}

function createVictoryProgressState() {
  return {
    lastTurnBoundaryTurn: 0,
    totalDomination: {},
    technologicalSupremacy: {},
    diplomaticHegemony: {},
    nations: {},
  };
}

function normalizeNationVictoryEntry(entry) {
  return {
    capitalsControlled: Number(entry?.capitalsControlled) || 0,
    totalCapitals: Number(entry?.totalCapitals) || 0,
    linearTiersCompleted: Number(entry?.linearTiersCompleted) || 0,
    requiredLinearTiers: Number(entry?.requiredLinearTiers) || LINEAR_TECH_CATEGORIES.length,
    finalTierComplete: Boolean(entry?.finalTierComplete),
    techScore: Number(entry?.techScore) || 0,
    techLead: Number(entry?.techLead) || 0,
    requiredTechLead: Number(entry?.requiredTechLead) || VICTORY_CONFIG.technologicalSupremacy.requiredLead,
    meetsTechCondition: Boolean(entry?.meetsTechCondition),
    techHoldTurns: Number(entry?.techHoldTurns) || 0,
    techTurnsRemaining: Number(entry?.techTurnsRemaining) || VICTORY_CONFIG.technologicalSupremacy.holdTurns,
    alliedNationIds: Array.isArray(entry?.alliedNationIds) ? [...entry.alliedNationIds] : [],
    allianceCount: Number(entry?.allianceCount) || 0,
    requiredAllianceCount: Number(entry?.requiredAllianceCount) || 0,
    activeNationCount: Number(entry?.activeNationCount) || 0,
    diplomaticBlocQuality: Number(entry?.diplomaticBlocQuality) || 0,
    requiredDiplomaticBlocQuality: Number(entry?.requiredDiplomaticBlocQuality) || VICTORY_CONFIG.diplomaticHegemony.minimumBlocQuality,
    meetsDiplomaticCondition: Boolean(entry?.meetsDiplomaticCondition),
    diplomaticHoldTurns: Number(entry?.diplomaticHoldTurns) || 0,
    diplomaticTurnsRemaining: Number(entry?.diplomaticTurnsRemaining) || VICTORY_CONFIG.diplomaticHegemony.holdTurns,
  };
}

function finalizeVictory(game, winnerId, victoryType, label, reason, options) {
  const scores = typeof options.scoreboard === "function" ? options.scoreboard(game) : [];
  game.gameOver = {
    isGameOver: true,
    type: victoryType,
    victoryType,
    label,
    winnerId,
    winnerNationId: winnerId,
    winnerPlayerId: game.nations[winnerId]?.sessionId || null,
    turn: game.turn,
    turnNumber: game.turnNumber || game.turn,
    reason,
    scores,
  };
  if (typeof options.onVictory === "function") options.onVictory(game.gameOver);
  return game.gameOver;
}

function capitalTileIdsFor(game) {
  const ids = [];
  const seen = new Set();
  for (const nation of Object.values(game.nations || {})) {
    if (!nation?.capitalTileId || seen.has(nation.capitalTileId) || !tileById(game, nation.capitalTileId)) continue;
    seen.add(nation.capitalTileId);
    ids.push(nation.capitalTileId);
  }
  if (ids.length > 0) return ids;
  for (const tile of game.map?.tiles || []) {
    if (!tile?.isCapital || seen.has(tile.id)) continue;
    seen.add(tile.id);
    ids.push(tile.id);
  }
  return ids;
}

function totalDominationWinnerId(game, capitalTileIds) {
  if (!capitalTileIds.length) return null;
  const owners = new Set();
  for (const tileId of capitalTileIds) {
    const ownerId = tileById(game, tileId)?.ownerId;
    if (!ownerId) return null;
    owners.add(ownerId);
    if (owners.size > 1) return null;
  }
  const [winnerId] = [...owners];
  return winnerId && game.nations[winnerId]?.active ? winnerId : null;
}

function techScore(nation, config) {
  if (!nation?.active) return 0;
  const linear = LINEAR_TECH_CATEGORIES.reduce((sum, category) => sum + (Number(nation.tech?.[category]) || 0), 0);
  const branches = BRANCH_TECH_CATEGORIES.reduce((sum, branch) => sum + (Number(nation.tech?.branches?.[branch]) || 0), 0);
  return linear * config.linearScoreWeight + branches * config.branchScoreWeight;
}

function alliedNationIdsFor(game, nationId) {
  const allies = new Set();
  for (const alliance of game.alliances || []) {
    if (!alliance?.active || !Array.isArray(alliance.members) || !alliance.members.includes(nationId)) continue;
    for (const memberId of alliance.members) {
      if (memberId === nationId || !game.nations[memberId]?.active) continue;
      allies.add(memberId);
    }
  }
  return [...allies].sort();
}

function diplomaticBlocQuality(game, nationId, alliedNationIds = alliedNationIdsFor(game, nationId)) {
  if (!alliedNationIds.length) return 0;
  const scores = alliedNationIds.map((allyId) => {
    const record = game.diplomacy?.[[nationId, allyId].sort().join("|")] || {};
    const route = (game.tradeRoutes || []).find((item) => item.status !== "removed" && item.members?.includes(nationId) && item.members?.includes(allyId));
    const society = bilateralSocietyMetrics(game.nations[nationId], game.nations[allyId]);
    const relation = Math.max(0, Math.min(100, Number(record.relation) || 50));
    const tradeBonus = route?.status === "active" ? 12 : route?.status === "disrupted" ? -10 : 0;
    const societyBonus = Math.round((society.trust - 0.5) * 24 + society.pressure * 20);
    return Math.max(0, Math.min(100, relation + tradeBonus + societyBonus));
  });
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

function nextHoldTurns(previous, meetsCondition, shouldCountTurnBoundary) {
  const priorTurns = Math.max(0, Number(previous) || 0);
  if (!meetsCondition) return 0;
  if (!shouldCountTurnBoundary) return priorTurns;
  return priorTurns + 1;
}

// Resolve a winner nation id from a scenario outcome. Prefers the player
// if they are in the winning bloc; otherwise picks the first nation
// belonging to that bloc by faction metadata.
function scenarioWinnerNationId(game, outcome) {
  if (!outcome?.winnerBloc) return null;
  const bloc = outcome.winnerBloc;
  // Build candidate list of nation ids whose nation.bloc/factionId places
  // them in the winning bloc. We accept a few aliasing rules so scenarios
  // don't need to set bloc explicitly on every faction.
  const candidates = [];
  for (const nation of Object.values(game.nations || {})) {
    if (!nation?.active && nation?.active !== undefined) continue;
    const nationBloc = nation.bloc || null;
    const factionId = nation.factionId || null;
    if (bloc === "axis" && (nationBloc === "axis" || ["germany", "italy", "japan"].includes(factionId))) candidates.push(nation.id);
    else if (bloc === "allies" && (nationBloc === "allies" || ["uk", "france", "ussr", "usa"].includes(factionId))) candidates.push(nation.id);
  }
  if (!candidates.length) return null;
  if (candidates.includes(game.playerId)) return game.playerId;
  return candidates[0];
}

function activeNationIdsFor(game) {
  return Object.values(game.nations || {})
    .filter((nation) => nation?.active)
    .map((nation) => nation.id);
}

function tileById(game, tileId) {
  if (!tileId) return null;
  if (typeof game.tileById === "function") return game.tileById(tileId);
  return game.map?.tiles?.find((tile) => tile.id === tileId) || null;
}
