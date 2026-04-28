import type { ServerGameState } from "./initialGame.js";
import { BRANCH_RESEARCH, TECH_RESEARCH } from "./tech.js";

type Nation = ServerGameState["nations"][string];

const LINEAR_TECH_CATEGORIES = ["farming", "mining", "education", "infrastructure", "military"] as const;
const BRANCH_TECH_CATEGORIES = ["tanks", "air", "naval"] as const;

export const VICTORY_CONFIG = {
  technologicalSupremacy: {
    finalTier: TECH_RESEARCH.maxTier,
    linearScoreWeight: 10,
    branchScoreWeight: 4,
    requiredLead: 12,
    holdTurns: 3,
  },
  diplomaticHegemony: {
    holdTurns: 10,
  },
} as const;

export function normalizeVictoryProgress(game: ServerGameState | Record<string, any>) {
  if (!game.victoryProgress || typeof game.victoryProgress !== "object") {
    game.victoryProgress = createVictoryProgressState();
  }

  const progress = game.victoryProgress as Record<string, any>;
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

export function refreshVictoryProgress(game: ServerGameState | Record<string, any>, { turnBoundary = false } = {}) {
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
    maxBranchLevel: BRANCH_RESEARCH.maxLevel,
  };
  progress.diplomaticHegemony = {
    requiredAllianceCount,
    holdTurns: diplomacyConfig.holdTurns,
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
      return sum + (numberValue(nation.tech?.[category]) >= techConfig.finalTier ? 1 : 0);
    }, 0);
    const finalTierComplete = nation?.active === true && linearTiersCompleted === LINEAR_TECH_CATEGORIES.length;
    const score = nation?.active ? (techScores[nationId] || 0) : 0;
    const bestOtherScore = Math.max(0, ...activeNationIds.filter((id) => id !== nationId).map((id) => techScores[id] || 0));
    const techLead = activeNationIds.length > 1 ? score - bestOtherScore : 0;
    const alliedNationIds = alliedNationIdsFor(game, nationId);
    const allianceCount = alliedNationIds.length;
    const meetsTechCondition = Boolean(
      nation?.active &&
      activeNationIds.length > 1 &&
      finalTierComplete &&
      techLead >= techConfig.requiredLead
    );
    const meetsDiplomaticCondition = Boolean(
      nation?.active &&
      activeNationIds.length > 1 &&
      allianceCount >= requiredAllianceCount
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
    entry.meetsDiplomaticCondition = meetsDiplomaticCondition;
    entry.diplomaticHoldTurns = nextHoldTurns(entry.diplomaticHoldTurns, meetsDiplomaticCondition, shouldCountTurnBoundary);
    entry.diplomaticTurnsRemaining = Math.max(0, diplomacyConfig.holdTurns - entry.diplomaticHoldTurns);

    progress.nations[nationId] = entry;
  }

  return progress;
}

export function totalDominationWinnerId(game: ServerGameState | Record<string, any>) {
  const capitalTileIds = capitalTileIdsFor(game);
  if (!capitalTileIds.length) return null;
  const owners = new Set<string>();
  for (const tileId of capitalTileIds) {
    const ownerId = tileById(game, tileId)?.ownerId;
    if (!ownerId) return null;
    owners.add(ownerId);
    if (owners.size > 1) return null;
  }
  const [winnerId] = [...owners];
  return winnerId && game.nations[winnerId]?.active ? winnerId : null;
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

function normalizeNationVictoryEntry(entry: Record<string, any> | null | undefined) {
  return {
    capitalsControlled: numberValue(entry?.capitalsControlled),
    totalCapitals: numberValue(entry?.totalCapitals),
    linearTiersCompleted: numberValue(entry?.linearTiersCompleted),
    requiredLinearTiers: numberValue(entry?.requiredLinearTiers, LINEAR_TECH_CATEGORIES.length),
    finalTierComplete: Boolean(entry?.finalTierComplete),
    techScore: numberValue(entry?.techScore),
    techLead: numberValue(entry?.techLead),
    requiredTechLead: numberValue(entry?.requiredTechLead, VICTORY_CONFIG.technologicalSupremacy.requiredLead),
    meetsTechCondition: Boolean(entry?.meetsTechCondition),
    techHoldTurns: numberValue(entry?.techHoldTurns),
    techTurnsRemaining: numberValue(entry?.techTurnsRemaining, VICTORY_CONFIG.technologicalSupremacy.holdTurns),
    alliedNationIds: Array.isArray(entry?.alliedNationIds) ? [...entry.alliedNationIds] : [],
    allianceCount: numberValue(entry?.allianceCount),
    requiredAllianceCount: numberValue(entry?.requiredAllianceCount),
    activeNationCount: numberValue(entry?.activeNationCount),
    meetsDiplomaticCondition: Boolean(entry?.meetsDiplomaticCondition),
    diplomaticHoldTurns: numberValue(entry?.diplomaticHoldTurns),
    diplomaticTurnsRemaining: numberValue(entry?.diplomaticTurnsRemaining, VICTORY_CONFIG.diplomaticHegemony.holdTurns),
  };
}

function capitalTileIdsFor(game: ServerGameState | Record<string, any>) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const nation of Object.values(game.nations || {}) as Nation[]) {
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

function techScore(nation: Nation, config: typeof VICTORY_CONFIG.technologicalSupremacy) {
  if (!nation?.active) return 0;
  const linear = LINEAR_TECH_CATEGORIES.reduce((sum, category) => sum + numberValue(nation.tech?.[category]), 0);
  const branches = BRANCH_TECH_CATEGORIES.reduce((sum, branch) => sum + numberValue(nation.tech?.branches?.[branch]), 0);
  return linear * config.linearScoreWeight + branches * config.branchScoreWeight;
}

function alliedNationIdsFor(game: ServerGameState | Record<string, any>, nationId: string) {
  const allies = new Set<string>();
  for (const alliance of game.alliances || []) {
    if (!alliance?.active || !Array.isArray(alliance.members) || !alliance.members.includes(nationId)) continue;
    for (const memberId of alliance.members) {
      if (memberId === nationId || !game.nations[memberId]?.active) continue;
      allies.add(memberId);
    }
  }
  return [...allies].sort();
}

function nextHoldTurns(previous: unknown, meetsCondition: boolean, shouldCountTurnBoundary: boolean) {
  const priorTurns = Math.max(0, numberValue(previous));
  if (!meetsCondition) return 0;
  if (!shouldCountTurnBoundary) return priorTurns;
  return priorTurns + 1;
}

function activeNationIdsFor(game: ServerGameState | Record<string, any>) {
  return Object.values(game.nations || {})
    .filter((nation: any) => nation?.active)
    .map((nation: any) => nation.id);
}

function tileById(game: ServerGameState | Record<string, any>, tileId: string) {
  return game.map?.tiles?.find((tile: any) => tile.id === tileId) || null;
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
