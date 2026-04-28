import {
  BUILDING_TYPES,
  FOG_OF_WAR_RADIUS,
  MAX_ACTIONS_PER_TURN,
  TILE_TYPES,
  WORKER_MIN,
  WORKER_ROLE_BY_TILE,
  computeFogOfWarVisibility,
  axialNeighbors,
  clamp,
  deepClone,
  delay,
  isLand,
  isWaterLike,
  isTileActive,
  mulberry32,
  nationColor,
  pairKey,
  randomSeed,
  tileId,
} from "./utils.js";
import {
  getScenarioMap,
  getScenarioObjectives,
  getScenarioStartingPositions,
} from "./scenarios.js";
import {
  BALANCE,
  FRUIT_DEFICIT_STABILITY_PENALTY,
  FRUIT_SURPLUS_GROWTH_RATE,
} from "./balance.js";
import {
  ADVANCED_RESOURCE_KEYS,
  advancedFruitDemand,
  applyAdvancedResourceDeficits,
  applyAdvancedResourceUpkeep,
  calculateAdvancedResourceUpkeep,
  collectAdvancedResourcesForNation,
  hardwoodCostForBuilding,
  ironCostForBranch,
  ironCostForFactory,
  isAdvancedMode,
  normalizeAdvancedResources,
  normalizeGameMode,
  normalizeLandscapeDiversity,
  oilCostForBranch,
} from "./advanced.js";
import {
  BOT_NAMES,
  addHistory,
  addPopulation,
  computeScore,
  createNation,
  earnMoney,
  militaryPower,
  personalitySequence,
  profileSequence,
  removePopulation,
  spendMoney,
} from "./nation.js";
import {
  INFRASTRUCTURE_BUILD_COSTS,
  INFRASTRUCTURE_LABELS,
  INFRASTRUCTURE_TYPES,
  canTileHostInfrastructure,
  computeNationLogistics,
  infrastructureLabel,
  infrastructureRequiredTier,
  normalizeInfrastructureType,
  tileInfrastructureType,
} from "./infrastructure.js";
import {
  assignStartingTerritories,
  buildTileIndex,
  createMapData,
} from "./map.js";
import {
  buildingCost,
  buildingTechRequirement,
  canBuildFactory,
  canResearch,
  canResearchBranch,
  destroyCost,
  productionForTile,
  tileTypeUnlocked,
  trainingCost,
  workerAdminCost,
  checkEraAdvancement,
} from "./tech.js";
import {
  checkVictory as evaluateVictory,
  refreshVictoryProgress,
} from "./victory.js";
import {
  applyTrade,
  breakAlliance,
  embargoNation,
  expireAlliances,
  getDiplomacy,
  processTradeRoutes,
  proposeAlliance,
  removeTradeRoutesForNation,
} from "./trade.js";
import {
  activeWarsFor,
  applyBattleWarExhaustion,
  applyWarExhaustionIncome,
  applyWarExhaustionProduction,
  areAtWar,
  declareWar as declareWarHelper,
  defenderStrength,
  endWar,
  findPath,
  getAdjacentMilitaryActions,
  getValidAttackTargets,
  getValidMilitaryActionsFromTile,
  getValidMoveTargets,
  primaryUnitType,
  resolveCombat,
  siegeRequirementForTile,
  unitTypeConfig,
  updateWarReadinessForTurn,
  warUpkeep,
} from "./war.js";
import { maybeRunGlobalEvent, scheduleEraEvent, tickTileEffects } from "./events.js";
import { processBotTurn } from "./ai.js";

function unitBranches(unit) {
  if (!unit) return {};
  const branches = {};
  for (const [branch, strength] of Object.entries(unit.branches || {})) {
    const amount = Math.max(0, Math.floor(Number(strength) || 0));
    if (amount > 0) branches[branch] = amount;
  }
  const total = Object.values(branches).reduce((sum, amount) => sum + amount, 0);
  const strength = Math.max(0, Math.floor(Number(unit.strength) || 0));
  if (strength > 0 && total <= 0) branches[unit.branch || "infantry"] = strength;
  return branches;
}

function trimUnitBranches(unit) {
  if (!unit?.strength) return unit;
  const strength = Math.max(0, Math.floor(Number(unit.strength) || 0));
  const branches = unitBranches(unit);
  const ordered = [...new Set([unit.branch || "infantry", "infantry", "tanks", "air", "naval", ...Object.keys(branches)])];
  let remaining = strength;
  const trimmed = {};
  for (const branch of ordered) {
    if (remaining <= 0) break;
    const keep = Math.min(branches[branch] || 0, remaining);
    if (keep > 0) {
      trimmed[branch] = keep;
      remaining -= keep;
    }
  }
  if (remaining > 0) trimmed[unit.branch || "infantry"] = (trimmed[unit.branch || "infantry"] || 0) + remaining;
  unit.strength = strength;
  unit.branches = trimmed;
  if (!unit.branch || !trimmed[unit.branch]) {
    unit.branch = Object.keys(trimmed).find((branch) => branch !== "infantry") || "infantry";
  }
  return unit;
}

function mergeUnitInto(target, moving, nationId, turn) {
  const unit = target || { nationId, strength: 0, branch: moving.branch || "infantry", movedTurn: turn, branches: {} };
  const branches = unitBranches(unit);
  for (const [branch, strength] of Object.entries(unitBranches(moving))) {
    branches[branch] = (branches[branch] || 0) + strength;
  }
  unit.nationId = nationId;
  unit.strength = (unit.strength || 0) + (moving.strength || 0);
  unit.branches = branches;
  unit.movedTurn = turn;
  if (moving.branch !== "infantry" || !unit.branch) unit.branch = moving.branch || unit.branch || "infantry";
  return trimUnitBranches(unit);
}

function addUnitBranch(unit, branch, amount) {
  const branches = unitBranches(unit);
  branches[branch] = (branches[branch] || 0) + amount;
  unit.branches = branches;
  unit.strength = (unit.strength || 0) + amount;
  if (branch !== "infantry" || !unit.branch) unit.branch = branch;
  return trimUnitBranches(unit);
}

export class GameState {
  constructor(data) {
    this.settings = data.settings;
    this.mode = normalizeGameMode(this.settings?.mode);
    this.settings.mode = this.mode;
    this.settings.landscapeDiversity = normalizeLandscapeDiversity(this.settings.landscapeDiversity, this.mode);
    this.turn = data.turn || 1;
    this.turnNumber = data.turnNumber || this.turn;
    this.currentTurnIndex = Number(data.currentTurnIndex) || 0;
    this.era = data.era || 1;
    this.phase = data.phase || "player";
    this.nations = data.nations || {};
    this.playerId = data.playerId || "player";
    this.botIds = data.botIds || [];
    this.seats = data.seats || [];
    this.map = data.map;
    this.tiles = this.map.tiles;
    this.tileIndex = buildTileIndex(this.tiles);
    if (!data.preserveNationColors) this.assignNationVisualColors();
    this.diplomacy = data.diplomacy || {};
    this.wars = data.wars || {};
    this.sieges = data.sieges || {};
    this.trades = data.trades || [];
    this.tradeProposals = data.tradeProposals || [];
    this.tradeRoutes = data.tradeRoutes || [];
    this.alliances = data.alliances || [];
    this.warLog = data.warLog || [];
    this.events = data.events || [];
    this.activeEvents = data.activeEvents || [];
    this.eventHistory = data.eventHistory || [];
    this.eraReports = data.eraReports || [];
    this.pendingEraReport = data.pendingEraReport || null;
    this.globalEvents = data.globalEvents || {};
    this.objectives = data.objectives || [];
    this.gameOver = data.gameOver || null;
    this.selectedTileId = data.selectedTileId || null;
    this.lastSummary = data.lastSummary || null;
    this.victoryProgress = data.victoryProgress || null;
    this.isProcessingTurn = Boolean(data.isProcessingTurn);
    this.serverAuthoritative = Boolean(data.serverAuthoritative);
    this.listeners = new Set();
    this.rng = mulberry32((this.settings.seed || 1) + this.turn * 7919 + this.events.length * 131);
    this.eraStartSnapshot = data.eraStartSnapshot || this.createSnapshot();
    this.startedAt = data.startedAt || Date.now();
    this.turnStartedAt = data.turnStartedAt || Date.now();
    this.normalizeActionStates();
    this.normalizePopulationStates();
    this.normalizeAdvancedNationStates();
    this.recomputeTerritories();
    this.normalizeDiscoveryStates();
    scheduleEraEvent(this, this.era);
    if (!this.serverAuthoritative || !data.victoryProgress) refreshVictoryProgress(this);
  }

  static newGame(rawSettings = {}) {
    const settings = normalizeSettings(rawSettings);
    const rng = mulberry32(settings.seed);

    // Get map - use scenario map if available, otherwise generate
    let map;
    let scenarioStartPositions = null;
    if (settings.scenarioId) {
      map = getScenarioMap(settings.scenarioId);
      scenarioStartPositions = getScenarioStartingPositions(settings.scenarioId);
    }
    if (!map) {
      map = createMapData(settings);
    }

    const profiles = profileSequence(settings.nationCount);
    const nations = {};
    const botIds = [];
    const player = createNation({
      id: "player",
      name: settings.playerName,
      color: nationColor(0),
      isPlayer: true,
      profile: profiles[0],
      personality: "balanced",
    });
    nations[player.id] = player;

    const personalities = personalitySequence(settings.nationCount - 1);
    for (let i = 1; i < settings.nationCount; i += 1) {
      const bot = createNation({
        id: `bot-${i}`,
        name: BOT_NAMES[i - 1] || `Nation ${i + 1}`,
        color: nationColor(i),
        isPlayer: false,
        profile: profiles[i],
        personality: personalities[i - 1],
      });
      nations[bot.id] = bot;
      botIds.push(bot.id);
    }

    // Assign starting territories - use scenario positions if available
    if (scenarioStartPositions && scenarioStartPositions.length > 0) {
      // Scenario-based starting positions
      for (const posData of scenarioStartPositions.slice(0, settings.nationCount)) {
        const nationId = posData.nationIndex === 0 ? "player" : `bot-${posData.nationIndex}`;
        const nation = nations[nationId];
        if (nation && posData.startTiles) {
          for (const [q, r] of posData.startTiles) {
            const tile = map.tiles.find((t) => t.q === q && t.r === r);
            if (tile) {
              tile.ownerId = nationId;
            }
          }
          // Set starting resources if provided
          if (posData.startingResources) {
            nation.resources = nation.resources || {};
            for (const [res, amount] of Object.entries(posData.startingResources)) {
              nation.resources[res] = amount;
            }
          }
        }
      }
    } else {
      // Normal starting territory assignment
      assignStartingTerritories(map, Object.values(nations), rng);
    }

    // Advanced Mode: Give all nations starting hardwood to avoid early bottleneck
    if (isAdvancedMode({ mode: settings.mode })) {
      for (const nation of Object.values(nations)) {
        nation.resources = nation.resources || {};
        nation.resources.hardwood = (nation.resources.hardwood || 0) + 10;
      }
    }

    // Get objectives if scenario
    let objectives = [];
    if (settings.scenarioId) {
      objectives = getScenarioObjectives(settings.scenarioId);
    }

    const game = new GameState({
      settings,
      map,
      nations,
      playerId: player.id,
      botIds,
      objectives,
    });
    game.addEvent(`Game started with ${settings.nationCount} nations on a ${settings.mapSize.toLowerCase()} map.`, { type: "system" });
    for (const botId of botIds) {
      game.addEvent(`${game.nations[botId].name} plays as a ${game.nations[botId].personality} nation.`, { nationId: botId, type: "ai" });
    }
    return game;
  }

  assignNationVisualColors() {
    const orderedIds = [
      this.playerId,
      ...this.botIds,
      ...Object.keys(this.nations).filter((id) => id !== this.playerId && !this.botIds.includes(id)),
    ];
    orderedIds.forEach((id, index) => {
      if (this.nations[id]) this.nations[id].color = nationColor(index);
    });
  }

  get player() {
    return this.nations[this.playerId];
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  addEvent(message, { nationId = null, type = "info", tileId: eventTileId = null } = {}) {
    const entry = {
      id: `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      turn: this.turn,
      era: this.era,
      phase: this.phase,
      nationId,
      type,
      tileId: eventTileId,
      message,
      timestamp: Date.now(),
    };
    this.events.push(entry);
    if (this.events.length > 140) this.events.shift();
    if (nationId && this.nations[nationId]) addHistory(this.nations[nationId], this.turn, message, type);
    this.emit({ type: "event_added", event: entry });
    return entry;
  }

  tileById(id) {
    return this.tileIndex.get(id) || null;
  }

  tileAt(q, r) {
    return this.tileIndex.get(tileId(q, r)) || null;
  }

  neighbors(id) {
    const tile = this.tileById(id);
    if (!tile) return [];
    return axialNeighbors(tile.q, tile.r)
      .map((coord) => this.tileAt(coord.q, coord.r))
      .filter(Boolean);
  }

  fogOfWarVisibilityFor(nationId = this.playerId) {
    if (!this.settings.fogOfWarEnabled) return null;
    const visibility = computeFogOfWarVisibility(this.tiles, this.discoverySourceTileIdsFor(nationId), FOG_OF_WAR_RADIUS);
    return {
      enabled: true,
      ...visibility,
    };
  }

  discoverySourceTileIdsFor(nationId = this.playerId) {
    const nation = this.nations[nationId];
    const sourceIds = new Set(
      Array.isArray(nation?.territory) && nation.territory.length
        ? nation.territory
        : this.tiles.filter((tile) => tile.ownerId === nationId).map((tile) => tile.id)
    );
    for (const tile of this.tiles) {
      if (tile.unit?.nationId === nationId) sourceIds.add(tile.id);
    }
    return [...sourceIds];
  }

  isTileVisible(tileIdValue, nationId = this.playerId) {
    const visibility = this.fogOfWarVisibilityFor(nationId);
    return !visibility || visibility.visibleTileIds.has(tileIdValue);
  }

  hasDiscoveredNation(nationId = this.playerId, targetId) {
    if (!targetId || !this.nations[nationId] || !this.nations[targetId]) return false;
    if (!this.settings.fogOfWarEnabled) return true;
    return Array.isArray(this.nations[nationId].discoveredNations) && this.nations[nationId].discoveredNations.includes(targetId);
  }

  discoverNation(nationId, targetId) {
    const nation = this.nations[nationId];
    if (!nation || !targetId || !this.nations[targetId]) return false;
    const discovered = new Set(Array.isArray(nation.discoveredNations) ? nation.discoveredNations : []);
    const sizeBefore = discovered.size;
    discovered.add(nationId);
    discovered.add(targetId);
    nation.discoveredNations = [...discovered];
    return discovered.size !== sizeBefore;
  }

  establishDiplomaticContact(a, b) {
    const aDiscovered = this.discoverNation(a, b);
    const bDiscovered = this.discoverNation(b, a);
    return aDiscovered || bDiscovered;
  }

  normalizeDiscoveryStates() {
    for (const nation of Object.values(this.nations)) {
      const discovered = new Set((Array.isArray(nation.discoveredNations) ? nation.discoveredNations : []).filter((id) => this.nations[id]));
      discovered.add(nation.id);
      nation.discoveredNations = [...discovered];
    }
    this.refreshDiscoveredNations();
  }

  refreshDiscoveredNations() {
    for (const nation of Object.values(this.nations)) this.refreshDiscoveredNationsFor(nation.id);
  }

  refreshDiscoveredNationsFor(nationId) {
    const nation = this.nations[nationId];
    if (!nation) return;
    const discovered = new Set(Array.isArray(nation.discoveredNations) ? nation.discoveredNations : []);
    discovered.add(nationId);
    const visibility = this.fogOfWarVisibilityFor(nationId);
    if (visibility?.visibleTileIds) {
      for (const tileIdValue of visibility.visibleTileIds) {
        const ownerId = this.tileById(tileIdValue)?.ownerId;
        if (ownerId && ownerId !== nationId && this.nations[ownerId]?.active) discovered.add(ownerId);
      }
    }
    for (const alliance of this.alliances || []) {
      if (!alliance?.active || !Array.isArray(alliance.members) || !alliance.members.includes(nationId)) continue;
      for (const memberId of alliance.members) {
        if (memberId !== nationId && this.nations[memberId]) discovered.add(memberId);
      }
    }
    nation.discoveredNations = [...discovered];
  }

  selectTile(id) {
    if (id && !this.isTileVisible(id)) id = null;
    this.selectedTileId = id;
    this.emit({ type: "selection_changed", tileId: id });
  }

  normalizeActionStates() {
    for (const nation of Object.values(this.nations)) {
      nation.maxActionPoints = normalizeMaxActionPoints(nation.maxActionPoints);
      nation.actionPoints = normalizeActionCount(nation.actionPoints ?? nation.actionsRemaining, nation.maxActionPoints, nation.maxActionPoints);
      nation.actionsRemaining = nation.actionPoints;
      nation.actionsUsedThisTurn = normalizeActionCount(nation.actionsUsedThisTurn, 0);
    }
  }

  normalizePopulationStates() {
    for (const nation of Object.values(this.nations)) {
      nation.population = nation.population || {};
      nation.population.total = Math.max(0, Math.floor(Number(nation.population.total) || 0));
      nation.population.available = Math.max(0, Math.floor(Number(nation.population.available) || 0));
      nation.population.happiness = normalizeHappiness(nation.population.happiness);
    }
  }

  normalizeAdvancedNationStates() {
    if (!isAdvancedMode(this)) return;
    for (const nation of Object.values(this.nations)) normalizeAdvancedResources(nation);
  }

  canSpendAction(nationId = this.playerId, amount = 1) {
    const nation = this.nations[nationId];
    if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
    const cost = Math.max(1, Math.floor(Number(amount) || 1));
    if (this.serverAuthoritative) {
      const maxActionPoints = normalizeMaxActionPoints(nation.maxActionPoints);
      const actionPoints = normalizeActionCount(nation.actionPoints ?? nation.actionsRemaining, maxActionPoints, maxActionPoints);
      if (actionPoints < cost) return { ok: false, reason: "Not enough action points remaining this turn." };
      return { ok: true, cost, actionsRemaining: actionPoints, actionPoints };
    }
    nation.maxActionPoints = normalizeMaxActionPoints(nation.maxActionPoints);
    nation.actionPoints = normalizeActionCount(nation.actionPoints ?? nation.actionsRemaining, nation.maxActionPoints, nation.maxActionPoints);
    nation.actionsRemaining = nation.actionPoints;
    nation.actionsUsedThisTurn = normalizeActionCount(nation.actionsUsedThisTurn, 0);
    if (nation.actionPoints < cost) return { ok: false, reason: "Not enough action points remaining this turn." };
    return { ok: true, cost, actionsRemaining: nation.actionPoints, actionPoints: nation.actionPoints };
  }

  rejectServerAuthoritativeMutation() {
    return {
      ok: false,
      reason: "Multiplayer state is server-authoritative. Send an action to the server instead of mutating local state.",
    };
  }

  canMutateLocally() {
    return !this.serverAuthoritative;
  }

  spendAction(reason = "action", nationId = this.playerId, { amount = 1, free = false } = {}) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    if (free) return { ok: true, free: true, reason };
    const check = this.canSpendAction(nationId, amount);
    if (!check.ok) return check;
    const nation = this.nations[nationId];
    nation.actionPoints -= check.cost;
    nation.actionsRemaining = nation.actionPoints;
    nation.actionsUsedThisTurn += check.cost;
    this.emit({
      type: "action_spent",
      nationId,
      reason,
      actionsRemaining: nation.actionsRemaining,
      actionPoints: nation.actionPoints,
      actionsUsedThisTurn: nation.actionsUsedThisTurn,
    });
    return {
      ok: true,
      reason,
      actionsRemaining: nation.actionsRemaining,
      actionPoints: nation.actionPoints,
      actionsUsedThisTurn: nation.actionsUsedThisTurn,
    };
  }

  resetTurnActions(nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const nation = this.nations[nationId];
    if (!nation) return { ok: false, reason: "Nation unavailable." };
    nation.maxActionPoints = normalizeMaxActionPoints(nation.maxActionPoints);
    nation.actionPoints = nation.maxActionPoints;
    nation.actionsRemaining = nation.actionPoints;
    nation.actionsUsedThisTurn = 0;
    this.emit({
      type: "actions_reset",
      nationId,
      actionsRemaining: nation.actionsRemaining,
      actionPoints: nation.actionPoints,
      actionsUsedThisTurn: nation.actionsUsedThisTurn,
    });
    return { ok: true, actionsRemaining: nation.actionsRemaining, actionPoints: nation.actionPoints, actionsUsedThisTurn: nation.actionsUsedThisTurn };
  }

  claimableTiles(nationId) {
    const owned = this.tiles.filter((tile) => tile.ownerId === nationId);
    const ids = new Set();
    for (const tile of owned) {
      if ([TILE_TYPES.EMPTY, TILE_TYPES.WATER, TILE_TYPES.MOUNTAIN].includes(tile.type)) ids.add(tile.id);
      for (const neighbor of this.neighbors(tile.id)) {
        const terrainBuildCandidate = isLand(neighbor) || isWaterLike(neighbor) || neighbor.type === TILE_TYPES.MOUNTAIN;
        if (terrainBuildCandidate && (!neighbor.ownerId || neighbor.ownerId === nationId)) ids.add(neighbor.id);
      }
    }
    return [...ids].map((id) => this.tileById(id)).filter(Boolean);
  }

  canBuild(tileIdValue, type, nationId = this.playerId) {
    const nation = this.nations[nationId];
    const tile = this.tileById(tileIdValue);
    if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
    if (!tile) return { ok: false, reason: "Build target is unavailable." };
    if (tile.ownerId && tile.ownerId !== nationId) return { ok: false, reason: "Cannot build on foreign territory." };
    if (!tileTypeUnlocked(type, this.era)) return { ok: false, reason: "This building is not unlocked yet." };
    if (!BUILDING_TYPES.includes(type)) return { ok: false, reason: "Unknown building type." };
    const techCheck = buildingTechRequirement(type, nation, this.era);
    if (!techCheck.ok) return techCheck;
    if (type === TILE_TYPES.FISHERY) {
      if (tile.type !== TILE_TYPES.WATER) return { ok: false, reason: "Fisheries require lake or ocean water." };
    } else if (type === TILE_TYPES.MOUNTAIN_MINE) {
      if (tile.type !== TILE_TYPES.MOUNTAIN) return { ok: false, reason: "Mountain mines require mountains." };
    } else {
      if (!isLand(tile)) return { ok: false, reason: "Buildings require land." };
      if (tile.type !== TILE_TYPES.EMPTY) return { ok: false, reason: "Tile is already developed." };
    }
    if (!tile.ownerId) {
      const adjacentOwned = this.neighbors(tile.id).some((neighbor) => neighbor.ownerId === nationId);
      if (!adjacentOwned && nation.territory.length > 0) return { ok: false, reason: "Unowned tiles must border your territory." };
    }
    if (type === TILE_TYPES.FACTORY) {
      const factoryCheck = canBuildFactory(nation, this.tiles, this.era);
      if (!factoryCheck.ok) return factoryCheck;
    }
    const cost = buildingCost(type, this.era);
    if (nation.money < cost) return { ok: false, reason: `Requires $${cost}.` };
    if (isAdvancedMode(this)) {
      normalizeAdvancedResources(nation);
      const advancedCost = {};
      const hardwoodCost = hardwoodCostForBuilding(type);
      const ironCost = ironCostForFactory(type);
      if (hardwoodCost > 0) {
        if (nation.resources.hardwood < hardwoodCost) return { ok: false, reason: `Requires ${hardwoodCost} hardwood.` };
        advancedCost.hardwood = hardwoodCost;
      }
      if (ironCost > 0) {
        if (nation.resources.iron < ironCost) return { ok: false, reason: `Requires ${ironCost} iron.` };
        advancedCost.iron = ironCost;
      }
      return { ok: true, cost, advancedCost };
    }
    return { ok: true, cost };
  }

  buildTile(tileIdValue, type, nationId = this.playerId, { silent = false } = {}) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const check = this.canBuild(tileIdValue, type, nationId);
    if (!check.ok) return check;
    const action = this.spendAction("build", nationId);
    if (!action.ok) return action;
    const nation = this.nations[nationId];
    const tile = this.tileById(tileIdValue);
    if (!spendMoney(nation, check.cost)) return { ok: false, reason: "Not enough money." };
    if (check.advancedCost?.hardwood) nation.resources.hardwood -= check.advancedCost.hardwood;
    if (check.advancedCost?.iron) nation.resources.iron -= check.advancedCost.iron;
    tile.ownerId = nationId;
    tile.type = type;
    tile.workers = 0;
    tile.unit = null;
    nation.stats.built += 1;
    this.recomputeTerritories();
    if (!silent) this.addEvent(`${nation.name} built a ${typeLabel(type)} for $${check.cost}.`, { nationId, type: "build", tileId: tile.id });
    this.changed("build");
    return { ok: true, cost: check.cost, advancedCost: check.advancedCost || null };
  }

  canBuildInfrastructure(tileIdValue, infrastructureType, nationId = this.playerId) {
    const nation = this.nations[nationId];
    const tile = this.tileById(tileIdValue);
    const type = normalizeInfrastructureType(infrastructureType);
    if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
    if (!tile || tile.ownerId !== nationId) return { ok: false, reason: "Infrastructure can only be built on owned tiles." };
    if (type === INFRASTRUCTURE_TYPES.NONE || !INFRASTRUCTURE_LABELS[type]) return { ok: false, reason: "Unknown infrastructure type." };
    if (!canTileHostInfrastructure(tile, type)) {
      return { ok: false, reason: type === INFRASTRUCTURE_TYPES.ADVANCED ? "Advanced networks require an owned land or water tile." : "Roads and rail require owned land tiles." };
    }
    const requiredTier = infrastructureRequiredTier(type);
    if ((nation.tech.infrastructure || 0) < requiredTier) return { ok: false, reason: `Requires Infrastructure tier ${requiredTier}.` };
    const currentType = tileInfrastructureType(tile);
    if (currentType === type) return { ok: false, reason: `${INFRASTRUCTURE_LABELS[type]} is already present on this tile.` };
    if (infrastructureRequiredTier(currentType) > requiredTier) return { ok: false, reason: "This tile already has a more advanced network." };
    const cost = INFRASTRUCTURE_BUILD_COSTS[type] || 0;
    if (nation.money < cost) return { ok: false, reason: `Requires $${cost}.` };
    return { ok: true, cost, infrastructureType: type };
  }

  buildInfrastructure(tileIdValue, infrastructureType, nationId = this.playerId, { silent = false } = {}) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const check = this.canBuildInfrastructure(tileIdValue, infrastructureType, nationId);
    if (!check.ok) return check;
    const action = this.spendAction("buildInfrastructure", nationId);
    if (!action.ok) return action;
    const nation = this.nations[nationId];
    const tile = this.tileById(tileIdValue);
    if (!spendMoney(nation, check.cost)) return { ok: false, reason: "Not enough money." };
    tile.infrastructure = check.infrastructureType;
    nation.stats.built += 1;
    if (!silent) {
      this.addEvent(`${nation.name} expanded ${infrastructureLabel(check.infrastructureType).toLowerCase()} on a controlled tile for $${check.cost}.`, {
        nationId,
        type: "build",
        tileId: tile.id,
      });
    }
    this.changed("infrastructure");
    return { ok: true, cost: check.cost, infrastructureType: check.infrastructureType };
  }

  destroyTile(tileIdValue, nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const tile = this.tileById(tileIdValue);
    const nation = this.nations[nationId];
    if (!tile || tile.ownerId !== nationId) return { ok: false, reason: "You only control your own tiles." };
    if (tile.isCapital) return { ok: false, reason: "Capital tiles cannot be voluntarily destroyed." };
    if (tile.type === TILE_TYPES.EMPTY) return { ok: false, reason: "Tile is already empty." };
    const cost = destroyCost(tile.type);
    if (nation.money < cost) return { ok: false, reason: `Requires $${cost}.` };
    const action = this.spendAction("destroy", nationId);
    if (!action.ok) return action;
    spendMoney(nation, cost);
    this.releaseTileWorkers(tile);
    tile.type = destroyedFallbackType(tile.type);
    tile.unit = null;
    nation.stats.destroyed += 1;
    this.addEvent(`${nation.name} cleared a tile for $${cost}.`, { nationId, type: "build", tileId: tile.id });
    this.changed("destroy");
    return { ok: true, cost };
  }

  releaseTileWorkers(tile) {
    if (!tile?.ownerId || !tile.workers) return 0;
    const nation = this.nations[tile.ownerId];
    const role = WORKER_ROLE_BY_TILE[tile.type];
    const released = tile.workers;
    if (nation && role) {
      nation.workers[role] = Math.max(0, (nation.workers[role] || 0) - released);
      nation.population.available += released;
    }
    tile.workers = 0;
    return released;
  }

  assignWorkers(tileIdValue, amount, nationId = this.playerId, { silent = false } = {}) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const tile = this.tileById(tileIdValue);
    const nation = this.nations[nationId];
    if (!tile || tile.ownerId !== nationId) return { ok: false, reason: "Workers can only be assigned to owned tiles." };
    const role = WORKER_ROLE_BY_TILE[tile.type];
    if (!role) return { ok: false, reason: "This tile has no worker role." };
    const delta = Math.floor(Number(amount) || 0);
    if (delta === 0) return { ok: false, reason: "No worker change requested." };
    const currentTileWorkers = Math.max(0, Math.floor(Number(tile.workers) || 0));
    const requiredWorkers = Math.max(0, Math.floor(Number(WORKER_MIN[tile.type]) || 0));
    if (delta > 0) {
      const openSlots = Math.max(0, requiredWorkers - currentTileWorkers);
      if (openSlots <= 0) return { ok: false, reason: "This tile is already fully staffed." };
      if (delta > openSlots) return { ok: false, reason: `Only ${openSlots} more worker${openSlots === 1 ? "" : "s"} needed for this tile.` };
      if (delta > nation.population.available) return { ok: false, reason: "No available population." };
      const cost = workerAdminCost(delta);
      if (nation.money < cost) return { ok: false, reason: `Requires $${cost} to organize workers.` };
      const action = this.spendAction("workers", nationId);
      if (!action.ok) return action;
      nation.money -= cost;
      nation.stats.moneySpent += cost;
      nation.population.available -= delta;
      nation.workers[role] = (nation.workers[role] || 0) + delta;
      tile.workers = currentTileWorkers + delta;
      if (!silent) this.addEvent(`${nation.name} assigned ${delta} workers to a ${typeLabel(tile.type)}.`, { nationId, type: "workers", tileId: tile.id });
      this.changed("workers");
      return { ok: true, changed: delta, cost };
    }
    const removed = Math.min(currentTileWorkers, Math.abs(delta));
    if (removed <= 0) return { ok: false, reason: "No assigned workers to remove." };
    const action = this.spendAction("workers", nationId);
    if (!action.ok) return action;
    tile.workers = currentTileWorkers - removed;
    nation.workers[role] = Math.max(0, (nation.workers[role] || 0) - removed);
    nation.population.available += removed;
    if (!silent) this.addEvent(`${nation.name} removed ${removed} workers from a ${typeLabel(tile.type)}.`, { nationId, type: "workers", tileId: tile.id });
    this.changed("workers");
    return { ok: true, changed: -removed, cost: 0 };
  }

  trainUnit(tileIdValue, strength, nationId = this.playerId, { silent = false, branch = "infantry" } = {}) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const tile = this.tileById(tileIdValue);
    const nation = this.nations[nationId];
    const amount = Math.max(1, Math.floor(Number(strength) || 1));
    const unitBranch = branch || "infantry";
    if (!tile || tile.ownerId !== nationId || tile.type !== TILE_TYPES.MILITARY) {
      return { ok: false, reason: "Training requires an owned military base." };
    }
    if (unitBranch !== "infantry" && (this.era < 4 || (nation.tech.branches[unitBranch] || 0) <= 0)) {
      return { ok: false, reason: "Research this military branch before deploying it." };
    }
    const cost = trainingCost(amount, this.era, unitBranch, nation.tech.branches[unitBranch] || 0);
    if (nation.money < cost.money) return { ok: false, reason: `Requires $${cost.money}.` };
    if (nation.population.available < cost.people) return { ok: false, reason: `Requires ${cost.people} available population.` };
    if (nation.resources.materials < cost.materials) return { ok: false, reason: `Requires ${cost.materials} materials.` };
    if (cost.education && nation.resources.education < cost.education) return { ok: false, reason: `Requires ${cost.education} education.` };
    if (cost.industry && nation.resources.industry < cost.industry) return { ok: false, reason: `Requires ${cost.industry} industry.` };
    const ironCost = isAdvancedMode(this) ? ironCostForBranch(unitBranch) : 0;
    const oilCost = isAdvancedMode(this) && unitBranch !== "infantry" ? oilCostForBranch(unitBranch) : 0;
    if (ironCost > 0 || oilCost > 0) {
      normalizeAdvancedResources(nation);
      if (ironCost > 0 && nation.resources.iron < ironCost) {
        return { ok: false, reason: `Advanced units require ${ironCost} iron.` };
      }
      if (oilCost > 0 && nation.resources.oil < oilCost) {
        return { ok: false, reason: `${unitBranch} units require ${oilCost} oil.` };
      }
    }
    const action = this.spendAction("train", nationId);
    if (!action.ok) return action;
    nation.money -= cost.money;
    nation.population.available -= cost.people;
    nation.resources.materials -= cost.materials;
    if (cost.education) nation.resources.education -= cost.education;
    if (cost.industry) nation.resources.industry -= cost.industry;
    if (ironCost > 0) nation.resources.iron -= ironCost;
    if (oilCost > 0) nation.resources.oil -= oilCost;
    nation.workers.soldiers += cost.people;
    nation.stats.moneySpent += cost.money;
    nation.military.unitsTrained += amount;
    tile.unit = tile.unit || { nationId, strength: 0, branch: unitBranch, movedTurn: 0, branches: {} };
    tile.unit.nationId = nationId;
    addUnitBranch(tile.unit, unitBranch, amount);
    if (!silent) this.addEvent(`${nation.name} ${unitBranch === "infantry" ? "trained" : "deployed"} ${amount} ${unitBranch} strength.`, { nationId, type: "military", tileId: tile.id });
    this.changed("train");
    const advancedCost = ironCost || oilCost ? { ...(ironCost && { iron: ironCost }), ...(oilCost && { oil: oilCost }) } : null;
    return { ok: true, cost, advancedCost };
  }

  moveUnitToward(fromTileId, targetTileId, nationId = this.playerId, options = {}) {
    const path = findPath(this, fromTileId, targetTileId, nationId);
    if (path.length < 2) return { ok: false, reason: "No valid path." };
    return this.moveOrAttackUnit(fromTileId, path[1], nationId, { ...options, path });
  }

  moveOrAttackUnit(fromTileId, toTileId, nationId = this.playerId, { silent = false, path = null } = {}) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    this.cleanupSieges();
    const from = this.tileById(fromTileId);
    const to = this.tileById(toTileId);
    const nation = this.nations[nationId];
    if (!from || !to || !nation?.active) return { ok: false, reason: "Invalid movement." };
    if (from.ownerId !== nationId || !from.unit?.strength) return { ok: false, reason: "Select a tile with your troops." };
    if (from.unit.movedTurn === this.turn) return { ok: false, reason: "This unit has already acted this turn." };
    const validActions = this.getValidMilitaryActionsFromTile(from.id, nationId).actions;
    const selectedAction = validActions.find((action) => action.toTileId === to.id);
    if (!selectedAction) return { ok: false, reason: "That target is out of range for this unit type." };
    const unitType = selectedAction.unitType || primaryUnitType(from.unit);
    const unitConfig = unitTypeConfig(unitType);
    const actionPath = path || selectedAction.path || [from.id, to.id];

    const movementCost = selectedAction.cost ?? (isWaterLike(to) ? BALANCE.costs.troopMovement.water : BALANCE.costs.troopMovement.land);
    if (nation.money < movementCost) return { ok: false, reason: `Requires $${movementCost} to move troops.` };
    const refusal = this.checkMilitaryRefusal(nationId);
    if (!refusal.ok) return refusal;
    const action = this.spendAction(selectedAction.action === "attack" ? "attack" : "move", nationId);
    if (!action.ok) return action;
    spendMoney(nation, movementCost);

    if (selectedAction.action === "move") {
      const wasUnowned = !to.ownerId;
      const moving = from.unit;
      this.clearSiegesFromTile(from.id, nationId);
      from.unit = null;
      to.ownerId = nationId;
      to.unit = mergeUnitInto(to.unit, moving, nationId, this.turn);
      if (wasUnowned) nation.stats.tilesCaptured += 1;
      this.recomputeTerritories();
      if (!silent) this.addEvent(`${nation.name} moved troops to a new tile.`, { nationId, type: "war", tileId: to.id });
      this.emit({
        type: "unit_animation",
        action: "move",
        unitType,
        unitTypeLabel: unitConfig.label,
        fromTileId: from.id,
        targetTileId: to.id,
        path: actionPath,
        nationId,
      });
      this.changed("move");
      return { ok: true, action: "move", unitType };
    }

    const defenderId = to.ownerId;
    if (!areAtWar(this, nationId, defenderId)) return { ok: false, reason: "Declare war before attacking." };
    const defender = this.nations[defenderId];

    // Advanced war tech (tanks, air, naval) causes no damage and cannot capture territory.
    // Units are infinite-use: strength is never depleted from attacks.
    if (unitType !== "infantry") {
      from.unit.movedTurn = this.turn;
      const strikeReport = {
        id: `battle-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        turn: this.turn,
        attackerId: nationId,
        defenderId,
        attackerName: nation.name,
        defenderName: defender.name,
        fromTileId: from.id,
        targetTileId: to.id,
        path: actionPath,
        unitType,
        unitTypeLabel: unitConfig.label,
        captureAttempt: false,
        attackerWins: false,
        attack: 0,
        defense: 0,
        modifiers: {},
        losses: { attacker: 0, defender: 0 },
        capitalCaptured: false,
        territoryChanged: false,
        siege: null,
        advancedStrike: true,
      };
      this.addEvent(
        `${nation.name} launched a ${unitConfig.label.toLowerCase()} strike on ${defender.name}.`,
        { nationId, type: "war", tileId: to.id }
      );
      this.emit({ type: "battle_report", report: strikeReport });
      this.changed("battle");
      return { ok: true, action: "battle", report: strikeReport };
    }

    const attackingStrength = from.unit.strength;
    const defense = defenderStrength(to);
    const outcome = resolveCombat(this, nationId, defenderId, attackingStrength, defense, to, from, unitType);
    const report = {
      id: `battle-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      turn: this.turn,
      attackerId: nationId,
      defenderId,
      attackerName: nation.name,
      defenderName: defender.name,
      fromTileId: from.id,
      targetTileId: to.id,
      path: actionPath,
      targetType: to.type,
      unitType,
      unitTypeLabel: unitConfig.label,
      captureAttempt: Boolean(selectedAction.captureOnWin),
      attackerWins: outcome.attackerWins,
      attack: outcome.attack,
      defense: outcome.defense,
      modifiers: outcome.modifiers,
      losses: outcome.losses,
      capitalCaptured: false,
      territoryChanged: false,
      siege: null,
    };
    if (report.captureAttempt) {
      this.applyCombatOutcome(from, to, outcome, nationId, defenderId, report);
    } else {
      this.applyStrikeOutcome(from, to, outcome, nationId, defenderId, report);
    }
    this.addEvent(
      `${report.attackerName} ${report.attackerWins ? "won" : "lost"} a ${unitConfig.label.toLowerCase()} attack against ${report.defenderName}.`,
      { nationId, type: "war", tileId: to.id }
    );
    this.emit({ type: "battle_report", report });
    this.checkVictory();
    this.changed("battle");
    return { ok: true, action: "battle", report };
  }

  checkMilitaryRefusal(nationId) {
    if (this.settings.happinessEnabled === false) return { ok: true };
    const nation = this.nations[nationId];
    const band = happinessBand(nation);
    if (!band.militaryRefusalChance || this.rng() >= band.militaryRefusalChance) return { ok: true };
    const reason = `${nation.name}'s military refused orders amid ${band.label.toLowerCase()} at home.`;
    this.addEvent(reason, { nationId, type: "happiness" });
    return { ok: false, reason };
  }

  applyStrikeOutcome(from, to, outcome, attackerId, defenderId, report) {
    const attacker = this.nations[attackerId];
    const defender = this.nations[defenderId];
    removePopulation(attacker, Math.min(attacker.population.total, outcome.losses.attacker));
    removePopulation(defender, Math.min(defender.population.total, outcome.losses.defender));
    this.normalizeTileWorkers(attackerId);
    this.normalizeTileWorkers(defenderId);
    applyBattleWarExhaustion(this, attackerId, defenderId, outcome.losses, outcome.attackerWins);
    attacker.military.unitsLost += outcome.losses.attacker;
    defender.military.unitsLost += outcome.losses.defender;
    const war = this.wars[pairKey(attackerId, defenderId)];
    if (war) war.battles += 1;
    from.unit.strength = outcome.attackerWins ? outcome.survivingAttackStrength : 0;
    trimUnitBranches(from.unit);
    from.unit.movedTurn = this.turn;
    if (from.unit.strength <= 0) from.unit = null;
    if (to.unit) {
      to.unit.strength = outcome.attackerWins
        ? Math.max(0, to.unit.strength - outcome.losses.defender)
        : Math.max(1, outcome.survivingDefenseStrength);
      trimUnitBranches(to.unit);
      if (to.unit.strength <= 0) to.unit = null;
    }
    if (outcome.attackerWins) {
      attacker.military.battlesWon += 1;
      defender.military.battlesLost += 1;
      this.clearSiegesForTile(to.id, attackerId);
    } else {
      attacker.military.battlesLost += 1;
      defender.military.battlesWon += 1;
    }
    this.clearSiegesFromTile(from.id, attackerId);
    report.territoryChanged = false;
    this.recomputeTerritories();
  }

  applyCombatOutcome(from, to, outcome, attackerId, defenderId, report) {
    const attacker = this.nations[attackerId];
    const defender = this.nations[defenderId];
    removePopulation(attacker, Math.min(attacker.population.total, outcome.losses.attacker));
    removePopulation(defender, Math.min(defender.population.total, outcome.losses.defender));
    this.normalizeTileWorkers(attackerId);
    this.normalizeTileWorkers(defenderId);
    applyBattleWarExhaustion(this, attackerId, defenderId, outcome.losses, outcome.attackerWins);
    attacker.military.unitsLost += outcome.losses.attacker;
    defender.military.unitsLost += outcome.losses.defender;
    const war = this.wars[pairKey(attackerId, defenderId)];
    if (war) war.battles += 1;
    if (outcome.attackerWins) {
      attacker.military.battlesWon += 1;
      defender.military.battlesLost += 1;
      const siege = this.progressSiegeIfNeeded(from, to, outcome, attackerId, defenderId, report);
      if (siege && !siege.completed) {
        from.unit.strength = outcome.survivingAttackStrength;
        trimUnitBranches(from.unit);
        from.unit.movedTurn = this.turn;
        if (to.unit) {
          to.unit.strength = Math.max(0, to.unit.strength - outcome.losses.defender);
          trimUnitBranches(to.unit);
          if (to.unit.strength <= 0) to.unit = null;
        }
        this.recomputeTerritories();
        return;
      }
      const capitalCaptured = to.isCapital;
      this.clearSiegesForTile(to.id);
      this.clearSiegesFromTile(from.id, attackerId);
      to.ownerId = attackerId;
      to.workers = 0;
      from.unit.strength = outcome.survivingAttackStrength;
      trimUnitBranches(from.unit);
      to.unit = { ...from.unit, nationId: attackerId, movedTurn: this.turn };
      from.unit = null;
      attacker.stats.tilesCaptured += 1;
      report.territoryChanged = true;
      if (capitalCaptured) {
        // Capital capture rule: losing your capital means immediate elimination.
        // The capital tile marker is cleared so it doesn't mislead after conquest.
        to.isCapital = false;
        report.capitalCaptured = true;
        attacker.military.capitalsCaptured += 1;
        this.addEvent(
          `${attacker.name} captured the capital of ${defender.name}! ${defender.name} is eliminated.`,
          { nationId: attackerId, type: "war", tileId: to.id }
        );
        this.conquerNation(defenderId, attackerId);
      }
    } else {
      attacker.military.battlesLost += 1;
      defender.military.battlesWon += 1;
      this.clearSiegesForTile(to.id, attackerId);
      this.clearSiegesFromTile(from.id, attackerId);
      from.unit = null;
      if (to.unit) {
        to.unit.strength = Math.max(1, outcome.survivingDefenseStrength);
        trimUnitBranches(to.unit);
      }
    }
    this.recomputeTerritories();
  }

  progressSiegeIfNeeded(from, to, outcome, attackerId, defenderId, report) {
    const required = siegeRequirementForTile(to);
    if (required <= 0) return null;
    const existing = this.sieges[to.id];
    const sameSiege =
      existing &&
      existing.attackerId === attackerId &&
      existing.defenderId === defenderId &&
      existing.fromTileId === from.id;
    const progress = (sameSiege ? existing.progress : 0) + BALANCE.war.siege.progressPerVictory;
    const siege = {
      tileId: to.id,
      attackerId,
      defenderId,
      fromTileId: from.id,
      progress,
      required,
      startedTurn: sameSiege ? existing.startedTurn : this.turn,
      updatedTurn: this.turn,
    };
    report.siege = {
      ...siege,
      completed: progress >= required,
    };
    if (progress >= required) {
      delete this.sieges[to.id];
      return { ...siege, completed: true };
    }
    this.sieges[to.id] = siege;
    return { ...siege, completed: false };
  }

  clearSiegesForTile(tileIdValue, attackerId = null) {
    const siege = this.sieges[tileIdValue];
    if (!siege) return false;
    if (attackerId && siege.attackerId !== attackerId) return false;
    delete this.sieges[tileIdValue];
    return true;
  }

  clearSiegesFromTile(fromTileId, attackerId = null) {
    let cleared = 0;
    for (const [tileIdValue, siege] of Object.entries(this.sieges)) {
      if (siege.fromTileId !== fromTileId) continue;
      if (attackerId && siege.attackerId !== attackerId) continue;
      delete this.sieges[tileIdValue];
      cleared += 1;
    }
    return cleared;
  }

  cleanupSieges() {
    let cleared = 0;
    for (const [tileIdValue, siege] of Object.entries(this.sieges)) {
      const target = this.tileById(siege.tileId);
      const staging = this.tileById(siege.fromTileId);
      const attacker = this.nations[siege.attackerId];
      const defender = this.nations[siege.defenderId];
      const valid =
        target &&
        staging &&
        attacker?.active &&
        defender?.active &&
        target.ownerId === siege.defenderId &&
        staging.ownerId === siege.attackerId &&
        staging.unit?.nationId === siege.attackerId &&
        staging.unit?.strength > 0 &&
        this.neighbors(target.id).some((tile) => tile.id === staging.id);
      if (valid) continue;
      delete this.sieges[tileIdValue];
      cleared += 1;
    }
    return cleared;
  }

  conquerNation(defenderId, winnerId) {
    const defender = this.nations[defenderId];
    const winner = this.nations[winnerId];
    if (!defender?.active) return;
    defender.active = false;
    for (const tile of this.tiles) {
      if (tile.ownerId === defenderId) {
        this.clearSiegesForTile(tile.id);
        tile.ownerId = winnerId;
        if (tile.unit?.nationId === defenderId) tile.unit = null;
      }
    }
    for (const [tileIdValue, siege] of Object.entries(this.sieges)) {
      if (siege.attackerId === defenderId || siege.defenderId === defenderId) delete this.sieges[tileIdValue];
    }
    for (const war of activeWarsFor(this, defenderId)) endWar(this, war.attackerId, war.defenderId);
    removeTradeRoutesForNation(this, defenderId, "conquest");
    this.addEvent(`${winner.name} conquered ${defender.name}.`, { nationId: winnerId, type: "war" });
    this.recomputeTerritories();
  }

  declareWar(targetId, nationId = this.playerId, reason = "Player declaration") {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const action = this.canSpendAction(nationId);
    if (!action.ok) return action;
    const result = declareWarHelper(this, nationId, targetId, reason);
    if (result.ok) {
      this.spendAction("declare-war", nationId);
      this.addEvent(`${this.nations[nationId].name} declared war on ${this.nations[targetId].name}.`, { nationId, type: "war" });
      this.changed("war");
    }
    return result;
  }

  trade(partnerId, offer, request, nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const action = this.canSpendAction(nationId);
    if (!action.ok) return action;
    const result = applyTrade(this, nationId, partnerId, offer, request);
    if (result.ok && result.accepted) {
      this.spendAction("trade", nationId);
      this.addEvent(`${this.nations[nationId].name} traded with ${this.nations[partnerId].name}.`, { nationId, type: "trade" });
      this.changed("trade");
    }
    if (result.ok && !result.accepted) {
      this.spendAction("trade", nationId);
      this.addEvent(`${this.nations[partnerId].name} rejected a trade proposal.`, { nationId: partnerId, type: "trade" });
      this.changed("trade");
    }
    return result;
  }

  proposeAlliance(partnerId, allianceType = "trade", nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const action = this.canSpendAction(nationId);
    if (!action.ok) return action;
    const result = proposeAlliance(this, nationId, partnerId, allianceType);
    if (result.ok) this.spendAction("alliance", nationId);
    if (result.ok && result.accepted) {
      this.addEvent(`${this.nations[nationId].name} formed an alliance with ${this.nations[partnerId].name}.`, { nationId, type: "diplomacy" });
    } else if (result.ok) {
      this.addEvent(`${this.nations[partnerId].name} rejected an alliance proposal.`, { nationId: partnerId, type: "diplomacy" });
    }
    this.changed("alliance");
    return result;
  }

  breakAlliance(allianceId, nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const action = this.canSpendAction(nationId);
    if (!action.ok) return action;
    const result = breakAlliance(this, allianceId, nationId);
    if (result.ok) {
      this.spendAction("break-alliance", nationId);
      this.addEvent(`${this.nations[nationId].name} broke an alliance.`, { nationId, type: "diplomacy" });
      this.changed("alliance");
    }
    return result;
  }

  embargo(targetId, nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const action = this.canSpendAction(nationId);
    if (!action.ok) return action;
    const result = embargoNation(this, nationId, targetId);
    if (result.ok) {
      this.spendAction("embargo", nationId);
      this.addEvent(`${this.nations[nationId].name} embargoed ${this.nations[targetId].name}.`, { nationId, type: "diplomacy" });
      this.changed("embargo");
    }
    return result;
  }

  research(category, nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const nation = this.nations[nationId];
    const check = canResearch(this, nation, category);
    if (!check.ok) return check;
    const action = this.spendAction("research", nationId);
    if (!action.ok) return action;
    if (!spendMoney(nation, check.cost)) return { ok: false, reason: "Not enough money." };
    nation.resources[check.requirement.resource] -= check.requirement.resourceCost;
    nation.tech[category] = check.nextTier;
    nation.stats.techResearched += 1;
    this.addEvent(`${nation.name} advanced ${category} to tier ${check.nextTier}.`, { nationId, type: "tech" });
    this.changed("tech");
    return { ok: true, cost: check.cost, nextTier: check.nextTier };
  }

  researchBranch(branch, nationId = this.playerId) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const nation = this.nations[nationId];
    const check = canResearchBranch(this, nation, branch);
    if (!check.ok) return check;
    const action = this.spendAction("branch-research", nationId);
    if (!action.ok) return action;
    if (!spendMoney(nation, check.cost.money)) return { ok: false, reason: "Not enough money." };
    for (const resource of ["materials", "education", "industry"]) {
      nation.resources[resource] -= check.cost[resource];
    }
    nation.tech.branches[branch] = check.nextLevel;
    nation.military.branchFocus = branch;
    nation.stats.techResearched += 1;
    this.addEvent(`${nation.name} advanced ${branch} specialization to level ${check.nextLevel}.`, { nationId, type: "tech" });
    this.changed("tech");
    return { ok: true, cost: check.cost, nextLevel: check.nextLevel };
  }

  // Returns per-turn food production stats for a nation so the UI can display
  // produced / consumed / net without duplicating game logic in the renderer.
  foodFlowFor(nationId) {
    const nation = this.nations[nationId];
    if (!nation?.active) return { produced: 0, consumed: 0, net: 0, capacity: 0 };
    const consumed = foodConsumptionFor(nation, this.era);
    const logistics = this.logisticsSummaryFor(nationId);
    let produced = 0;
    for (const tile of this.tiles) {
      if (tile.ownerId !== nationId) continue;
      const production = productionForTile(nation, tile, this.era);
      if (production?.food) {
        const adjustedProduction = Math.ceil(production.food * logistics.foodModifier);
        const exhaustedProduction = applyWarExhaustionProduction(nation, adjustedProduction);
        produced += applyStockpileDiminishingReturns(nation, "food", exhaustedProduction);
      }
    }
    const capacity = nation.territory.length * BALANCE.population.capacityPerTile;
    return { produced, consumed, net: produced - consumed, capacity };
  }

  logisticsSummaryFor(nationId) {
    return computeNationLogistics(this.tiles, this.nations[nationId]);
  }

  async endTurn({ onBotTurn = null } = {}) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    if (this.isProcessingTurn || this.gameOver) return;
    this.isProcessingTurn = true;
    this.phase = "ai";
    this.changed("phase");
    for (const botId of this.botIds) {
      if (this.gameOver) break;
      if (!this.nations[botId]?.active) continue; // skip eliminated nations
      this.resetTurnActions(botId);
      await processBotTurn(this, botId);
      this.changed("ai");
      if (onBotTurn) await onBotTurn(botId, this);
      await delay(130);
    }
    this.phase = "round";
    this.changed("phase");
    this.processRound();
    if (!this.gameOver) {
      this.turn += 1;
      this.turnStartedAt = Date.now();
      this.phase = "player";
      this.rng = mulberry32((this.settings.seed || 1) + this.turn * 7919 + this.events.length * 131);
      // Local/offline games have one human nation; multiplayer games reset every
      // server-owned human nation after the authoritative round resolves.
      for (const nation of Object.values(this.nations)) {
        if (nation.active && !this.botIds.includes(nation.id)) this.resetTurnActions(nation.id);
      }
    }
    this.isProcessingTurn = false;
    this.changed("turn_end");
  }

  async missTurn(nationId = this.playerId, reason = "Turn timer expired.") {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const nation = this.nations[nationId];
    if (!nation?.active || this.isProcessingTurn || this.gameOver) return { ok: false, reason: "Turn cannot be skipped now." };
    this.addEvent(`${nation.name} missed their turn. ${reason}`, { nationId, type: "system" });
    if (nationId === this.playerId) {
      await this.endTurn();
      return { ok: true, missedTurn: true };
    }
    this.resetTurnActions(nationId);
    this.changed("missed_turn");
    return { ok: true, missedTurn: true };
  }

  processRound() {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    const summary = {
      turn: this.turn,
      money: 0,
      food: 0,
      foodProduced: 0,
      foodConsumed: 0,
      materials: 0,
      education: 0,
      industry: 0,
      fruit: 0,
      hardwood: 0,
      iron: 0,
      oil: 0,
      population: 0,
      happiness: 0,
      deaths: 0,
      upkeep: 0,
      notes: [],
    };

    const foodProducedByNation = {};
    const happinessContexts = {};
    for (const nation of Object.values(this.nations).filter((item) => item.active)) {
      const logistics = this.logisticsSummaryFor(nation.id);
      happinessContexts[nation.id] = { unpaidUpkeep: 0 };
      const warReadiness = updateWarReadinessForTurn(this, nation.id);
      const upkeep = warUpkeep(this, nation.id);
      if (upkeep > 0) {
        nation.stats.turnsAtWar += warReadiness.activeWars;
        const paid = Math.min(nation.money, upkeep);
        nation.money -= paid;
        nation.stats.moneySpent += paid;
        summary.upkeep += paid;
        if (paid < upkeep) {
          const deserters = Math.ceil((upkeep - paid) / BALANCE.war.deserterShortfallDivisor);
          this.reduceNationUnits(nation.id, deserters);
          happinessContexts[nation.id].unpaidUpkeep += upkeep - paid;
          summary.notes.push(`${nation.name} could not fully fund the war effort.`);
        }
      }
      const populationUpkeep = populationMaintenanceFor(nation);
      if (populationUpkeep > 0) {
        const paid = Math.min(nation.money, populationUpkeep);
        nation.money -= paid;
        nation.stats.moneySpent += paid;
        summary.upkeep += paid;
        if (paid < populationUpkeep) happinessContexts[nation.id].unpaidUpkeep += populationUpkeep - paid;
      }
      if (isAdvancedMode(this)) {
        const resourceCollection = collectAdvancedResourcesForNation(this, nation.id);
        for (const resource of ADVANCED_RESOURCE_KEYS) summary[resource] += resourceCollection.gained[resource];
        const gainedText = ADVANCED_RESOURCE_KEYS
          .filter((resource) => resourceCollection.gained[resource] > 0)
          .map((resource) => `${resourceCollection.gained[resource]} ${resource}`)
          .join(", ");
        if (gainedText) {
          this.addEvent(`${nation.name} gathered ${gainedText} from controlled terrain.`, { nationId: nation.id, type: "resource" });
        }
      }
      const foodProduced = this.produceForNation(nation, summary, logistics);
      foodProducedByNation[nation.id] = foodProduced;
      happinessContexts[nation.id].logistics = logistics;
    }

    const tradeResult = processTradeRoutes(this, summary);

    for (const nation of Object.values(this.nations).filter((item) => item.active)) {
      const routeFood = tradeResult.foodProduced[nation.id] || 0;
      this.consumeFood(nation, summary, (foodProducedByNation[nation.id] || 0) + routeFood, happinessContexts[nation.id] || {});
      if (isAdvancedMode(this)) {
        this.applyAdvancedFruitEffects(nation, summary);
        this.applyAdvancedResourceUpkeepAndDeficits(nation, summary);
      }
    }

    for (const alliance of expireAlliances(this)) {
      this.addEvent(`${alliance.label} expired.`, { type: "diplomacy" });
    }

    const event = maybeRunGlobalEvent(this);
    if (event) {
      this.addEvent(`${event.label}: ${event.description}`, { type: "global_event" });
      summary.notes.push(`${event.label}: ${event.results.slice(0, 3).join("; ")}`);
    }

    tickTileEffects(this);
    this.lastSummary = summary;
    this.cleanupSieges();
    this.recomputeTerritories();
    this.checkVictory({ turnBoundary: true });
    const nextEra = checkEraAdvancement(this);
    if (!this.gameOver && nextEra) {
      const eraEvent = maybeRunGlobalEvent(this, { force: true });
      if (eraEvent) {
        this.addEvent(`${eraEvent.label}: ${eraEvent.description}`, { type: "global_event" });
        summary.notes.push(`${eraEvent.label}: ${eraEvent.results.slice(0, 3).join("; ")}`);
      }
      this.era = nextEra;
      this.eraStartSnapshot = this.createSnapshot();
      scheduleEraEvent(this, this.era);
      this.addEvent(`Era ${this.era} has begun.`, { nationId: this.playerId, type: "era" });
    }
  }

  produceForNation(nation, summary, logistics = this.logisticsSummaryFor(nation.id)) {
    let populationGain = 0;
    let foodProduced = 0;
    const happinessEnabled = this.settings.happinessEnabled !== false;
    for (const tile of this.tiles.filter((item) => item.ownerId === nation.id)) {
      const production = productionForTile(nation, tile, this.era);
      if (!production) continue;
      const band = happinessEnabled ? happinessBand(nation) : { stoppageChance: 0 };
      if (band.stoppageChance && this.rng() < band.stoppageChance) {
        if (nation.isPlayer) summary.notes.push(`${nation.name}: unhappy workers stopped work on a ${typeLabel(tile.type)}.`);
        continue;
      }
      if (tile.type === TILE_TYPES.FACTORY) {
        if (nation.resources.materials < production.materialsCost || nation.resources.education < production.educationCost) {
          const exhaustedIncome = applyWarExhaustionIncome(nation, BALANCE.costs.factoryFallbackMoney);
          const fallbackIncome = happinessEnabled ? applyHappinessProduction(nation, exhaustedIncome) : exhaustedIncome;
          earnMoney(nation, fallbackIncome);
          summary.money += fallbackIncome;
          continue;
        }
        nation.resources.materials -= production.materialsCost;
        nation.resources.education -= production.educationCost;
      }
      for (const resource of ["food", "materials", "education", "industry"]) {
        if (production[resource]) {
          let adjustedAmount = production[resource];
          if (resource === "food") adjustedAmount = Math.ceil(adjustedAmount * logistics.foodModifier);
          if (resource === "materials") adjustedAmount = Math.ceil(adjustedAmount * logistics.materialsModifier);
          const exhaustedProduction = applyWarExhaustionProduction(nation, adjustedAmount);
          const happyProduction = happinessEnabled ? applyHappinessProduction(nation, exhaustedProduction) : exhaustedProduction;
          const produced = applyStockpileDiminishingReturns(nation, resource, happyProduction);
          nation.resources[resource] += produced;
          nation.stats.resourcesProduced += produced;
          summary[resource] += produced;
          // Track food produced separately for the growth calculation in consumeFood
          if (resource === "food") foodProduced += produced;
        }
      }
      if (production.money) {
        const exhaustedIncome = applyWarExhaustionIncome(nation, production.money);
        const income = happinessEnabled ? applyHappinessProduction(nation, exhaustedIncome) : exhaustedIncome;
        earnMoney(nation, income);
        summary.money += income;
      }
      // High-tier tech tiles grant a small bonus person representing skilled population growth.
      // This is an earned reward for technology investment, not automatic growth.
      if (production.people) populationGain += production.people;
    }
    // Apply tech-based people bonuses (farming t2+, mining t3+, etc.)
    // These are small and deliberate — not the main growth driver.
    if (populationGain > 0) {
      addPopulation(nation, populationGain);
      summary.population += populationGain;
    }
    summary.foodProduced += foodProduced;
    return foodProduced;
  }

  consumeFood(nation, summary, foodProduced, happinessContext = {}) {
    const logistics = happinessContext.logistics || this.logisticsSummaryFor(nation.id);
    // Each person consumes food every turn; rate rises slightly each era (urbanization costs more).
    const consumption = foodConsumptionFor(nation, this.era);
    summary.foodConsumed += consumption;

    // Deduct from stored stockpile
    nation.resources.food -= consumption;

    // Stockpile depleted: famine kills population
    if (nation.resources.food < 0) {
      const deficit = Math.abs(nation.resources.food);
      nation.resources.food = 0;
      const deaths = Math.max(1, Math.ceil(deficit / BALANCE.population.famineFoodPerDeath));
      const removed = removePopulation(nation, deaths);
      this.normalizeTileWorkers(nation.id);
      summary.deaths += removed;
      if (removed > 0) {
        this.addEvent(`${nation.name} lost ${removed} people to famine.`, { nationId: nation.id, type: "resource" });
      }
      this.updatePopulationHappiness(nation, summary, {
        ...happinessContext,
        foodProduced,
        consumption,
        surplus: foodProduced - consumption,
        deaths: removed,
        famine: true,
      });
      // Famine blocks growth — return early
      return;
    }

    // Per-turn surplus: how much more food was produced than consumed this turn.
    // Growth is driven by surplus flow, not stockpile size.
    const surplus = foodProduced - consumption;
    this.updatePopulationHappiness(nation, summary, {
      ...happinessContext,
      foodProduced,
      consumption,
      surplus,
      deaths: 0,
      famine: false,
    });

    if (isAdvancedMode(this)) {
      if (surplus <= -3 && nation.isPlayer) {
        this.addEvent(
          `${nation.name}: food output (${foodProduced}) below consumption (${consumption}). Stockpile shrinking.`,
          { nationId: nation.id, type: "resource" }
        );
      }
      return;
    }

    if (surplus < BALANCE.population.growth.minimumFoodSurplus) {
      // Production cannot keep up with consumption; stockpile is absorbing the gap.
      // Log a warning when the deficit is meaningful. For bot nations, only log severe
      // shortfalls (>30% of consumption) to avoid flooding the event feed.
      const severeDeficit = Math.abs(surplus) >= Math.ceil(consumption * 0.3);
      if (surplus <= -3 && (nation.isPlayer || severeDeficit)) {
        this.addEvent(
          `${nation.name}: food output (${foodProduced}) below consumption (${consumption}). Stockpile shrinking.`,
          { nationId: nation.id, type: "resource" }
        );
      }
      // No growth without a positive food production surplus.
      return;
    }

    // Surplus is positive: evaluate population growth.
    //
    // Growth is capped by territory capacity — every owned tile can sustain a
    // limited number of people. Expansion is needed to
    // keep growing once the cap is approached.
    const capacity = nation.territory.length * BALANCE.population.capacityPerTile;
    const headroom = Math.max(0, capacity - nation.population.total);

    if (headroom <= 0) {
      // At territory limit — player must expand to resume growth
      return;
    }

    // surplusRatio: how comfortable the food situation is (0 = barely positive, 1 = very well-fed)
    const surplusRatio = Math.min(1, surplus / Math.max(1, consumption));

    // headroomFraction: slows growth naturally as territory fills up, encouraging expansion
    const headroomFraction = headroom / capacity;

    // Base growth is 1–3 people per turn depending on food abundance,
    // then scaled down toward zero as the territory cap approaches.
    let baseGrowth;
    if (surplusRatio >= BALANCE.population.growth.thrivingSurplusRatio) baseGrowth = BALANCE.population.growth.thrivingGrowth;
    else if (surplusRatio >= BALANCE.population.growth.comfortableSurplusRatio) baseGrowth = BALANCE.population.growth.comfortableGrowth;
    else baseGrowth = BALANCE.population.growth.marginalGrowth;

    const growth = Math.round(baseGrowth * headroomFraction * logistics.growthMultiplier);
    if (growth > 0) {
      addPopulation(nation, growth);
      summary.population += growth;
    }
  }

  applyAdvancedFruitEffects(nation, summary) {
    normalizeAdvancedResources(nation);
    const demand = advancedFruitDemand(nation);
    if (demand <= 0) return;
    const available = nation.resources.fruit;
    const consumed = Math.min(available, demand);
    nation.resources.fruit -= consumed;
    const deficit = demand - consumed;
    const capacity = nation.territory.length * BALANCE.population.capacityPerTile;
    const headroom = Math.max(0, capacity - nation.population.total);
    const stockSurplus = Math.max(0, available - demand);
    const growth = headroom > 0 ? Math.min(headroom, Math.floor(stockSurplus * FRUIT_SURPLUS_GROWTH_RATE)) : 0;
    if (growth > 0) {
      addPopulation(nation, growth);
      summary.population += growth;
      this.addEvent(`${nation.name}'s fruit surplus supported ${growth} population growth.`, { nationId: nation.id, type: "resource" });
    }
    if (deficit > 0) {
      const before = normalizeHappiness(nation.population.happiness);
      nation.population.happiness = normalizeHappiness(before - FRUIT_DEFICIT_STABILITY_PENALTY);
      summary.happiness += nation.population.happiness - before;
      this.addEvent(`${nation.name} lacked ${deficit} fruit and faced population strain.`, { nationId: nation.id, type: "resource" });
    }
  }

  applyAdvancedResourceUpkeepAndDeficits(nation, summary) {
    // Apply resource upkeep for hardwood, iron, and oil
    const upkeepResult = applyAdvancedResourceUpkeep(this, nation.id);
    if (!upkeepResult) return; // Not in Advanced mode or nation not active

    // Apply deficit penalties
    applyAdvancedResourceDeficits(this, nation.id);

    // Report upkeep in events
    const { deficit } = upkeepResult;
    if (deficit.hardwood > 0) {
      this.addEvent(`${nation.name} suffered hardwood shortage, reducing building efficiency.`, { nationId: nation.id, type: "resource" });
    }
    if (deficit.iron > 0) {
      this.addEvent(`${nation.name} suffered iron shortage, reducing factory efficiency.`, { nationId: nation.id, type: "resource" });
    }
    if (deficit.oil > 0) {
      this.addEvent(`${nation.name} suffered oil shortage, reducing unit readiness.`, { nationId: nation.id, type: "resource" });
    }
  }

  updatePopulationHappiness(nation, summary, context) {
    if (this.settings.happinessEnabled === false) {
      nation.population.happiness = BALANCE.population.happiness.default;
      return;
    }
    const before = normalizeHappiness(nation.population.happiness);
    const delta = populationHappinessDelta(this, nation, context);
    const after = normalizeHappiness(before + delta);
    nation.population.happiness = after;
    const changed = after - before;
    summary.happiness += changed;
    if (changed <= -6 && nation.isPlayer) {
      this.addEvent(`${nation.name}'s population happiness fell to ${after}.`, { nationId: nation.id, type: "happiness" });
    }
  }

  reduceNationUnits(nationId, amount) {
    let remaining = amount;
    for (const tile of this.tiles.filter((item) => item.ownerId === nationId && item.unit?.strength > 0)) {
      if (remaining <= 0) break;
      const lost = Math.min(tile.unit.strength, remaining);
      tile.unit.strength -= lost;
      trimUnitBranches(tile.unit);
      remaining -= lost;
      if (tile.unit.strength <= 0) tile.unit = null;
    }
  }

  normalizeTileWorkers(nationId) {
    const nation = this.nations[nationId];
    if (!nation) return;
    for (const [type, role] of Object.entries(WORKER_ROLE_BY_TILE)) {
      let allowed = nation.workers[role] || 0;
      const tiles = this.tiles.filter((tile) => tile.ownerId === nationId && tile.type === type && tile.workers > 0);
      for (const tile of tiles) {
        const keep = Math.min(tile.workers, allowed);
        allowed -= keep;
        tile.workers = keep;
      }
    }
  }

  createEraReport(nextEra) {
    const startSnapshot = this.createSnapshot();
    const comparison = Object.values(this.nations)
      .map((nation) => ({
        id: nation.id,
        name: nation.name,
        active: nation.active,
        score: computeScore(nation, this.tiles),
        money: nation.money,
        population: nation.population.total,
        territory: nation.territory.length,
        military: militaryPower(nation, this.tiles),
      }))
      .sort((a, b) => b.score - a.score);
    return {
      id: `era-report-${this.era}-${Date.now()}`,
      fromEra: this.era,
      nextEra,
      turn: this.turn,
      sinceStart: startSnapshot,
      sinceEra: diffSnapshots(this.eraStartSnapshot, startSnapshot),
      comparison,
      reflection: "",
    };
  }

  submitEraReflection(text) {
    if (!this.canMutateLocally()) return this.rejectServerAuthoritativeMutation();
    if (!this.pendingEraReport) return { ok: false, reason: "No era report is pending." };
    const reflection = String(text || "").trim();
    if (reflection.length < 8) return { ok: false, reason: "Write a short reflection before continuing." };
    this.pendingEraReport.reflection = reflection;
    this.eraReports.push(this.pendingEraReport);
    const nextEra = this.pendingEraReport.nextEra;
    this.era = nextEra;
    this.pendingEraReport = null;
    this.eraStartSnapshot = this.createSnapshot();
    scheduleEraEvent(this, this.era);
    this.addEvent(`Era ${this.era} began.`, { nationId: this.playerId, type: "era" });
    this.turn += 1;
    this.phase = "player";
    this.isProcessingTurn = false;
    this.resetTurnActions(this.playerId);
    this.changed("era");
    return { ok: true };
  }

  createSnapshot() {
    const nations = {};
    for (const nation of Object.values(this.nations)) {
      nations[nation.id] = {
        money: nation.money,
        population: nation.population.total,
        territory: nation.territory.length,
        score: computeScore(nation, this.tiles || []),
        resources: { ...nation.resources },
        stats: { ...nation.stats, history: undefined },
      };
    }
    return {
      turn: this.turn,
      era: this.era,
      nations,
    };
  }

  checkVictory(options = {}) {
    const alreadyOver = Boolean(this.gameOver);
    const result = evaluateVictory(this, {
      ...options,
      scoreboard: (game) => game.scoreboard(),
      onVictory: (gameOver) => {
        this.addEvent(`${this.nations[gameOver.winnerId].name} won by ${gameOver.label}.`, { nationId: gameOver.winnerId, type: "victory" });
      },
    });
    if (!alreadyOver && result) this.emit({ type: "game_over", gameOver: result });
    return result;
  }

  scoreboard() {
    return Object.values(this.nations)
      .map((nation) => ({
        id: nation.id,
        name: nation.name,
        active: nation.active,
        score: computeScore(nation, this.tiles),
        money: nation.money,
        population: nation.population.total,
        territory: nation.territory.length,
        military: militaryPower(nation, this.tiles),
      }))
      .sort((a, b) => b.score - a.score);
  }

  recomputeTerritories() {
    for (const nation of Object.values(this.nations)) nation.territory = [];
    for (const tile of this.tiles) {
      if (tile.ownerId && this.nations[tile.ownerId]) this.nations[tile.ownerId].territory.push(tile.id);
    }
    this.refreshDiscoveredNations();
  }

  changed(source) {
    if (!this.serverAuthoritative) refreshVictoryProgress(this);
    this.emit({ type: "state_changed", source });
  }

  militaryActions(tileIdValue, nationId = this.playerId) {
    return getAdjacentMilitaryActions(this, tileIdValue, nationId);
  }

  getValidMilitaryActionsFromTile(tileIdValue, nationId = this.playerId) {
    return getValidMilitaryActionsFromTile(this, tileIdValue, nationId);
  }

  getValidMoveTargets(tileIdValue, nationId = this.playerId) {
    return getValidMoveTargets(this, tileIdValue, nationId);
  }

  getValidAttackTargets(tileIdValue, nationId = this.playerId) {
    return getValidAttackTargets(this, tileIdValue, nationId);
  }
}

function normalizeSettings(raw) {
  const nationCount = clamp(Math.floor(Number(raw.nationCount) || 5), 2, 16);
  const unlimitedMode = Boolean(raw.unlimitedMode);
  const turnTimerMinutes = clamp(Math.floor(Number(raw.turnTimerMinutes ?? raw.timeLimitMinutes) || 0), 0, 240);
  const mode = normalizeGameMode(raw.mode);
  const mapSizes = ["Small", "Medium", "Large", "Extra Large", "Enormous"];
  const mapOptionLevels = ["Low", "Balanced", "High"];
  return {
    playerName: String(raw.playerName || "Republic of Nova").trim().slice(0, 40) || "Republic of Nova",
    mode,
    mapSize: mapSizes.includes(raw.mapSize) ? raw.mapSize : "Medium",
    waterLevel: mapOptionLevels.includes(raw.waterLevel) ? raw.waterLevel : "Balanced",
    landscapeDiversity: normalizeLandscapeDiversity(raw.landscapeDiversity, mode),
    fogOfWarEnabled: raw.fogOfWarEnabled === true,
    nationCount,
    maxTurns: unlimitedMode ? 0 : clamp(Math.floor(Number(raw.maxTurns) || 30), 10, 120),
    turnTimerMinutes,
    unlimitedMode,
    happinessEnabled: raw.happinessEnabled !== false,
    seed: Math.floor(Number(raw.seed) || randomSeed()),
    scenarioId: raw.scenarioId || null,
  };
}

function typeLabel(type) {
  if (type === TILE_TYPES.MILITARY) return "Military Base";
  if (type === TILE_TYPES.MOUNTAIN_MINE) return "Mountain Mine";
  return String(type).replace(/^\w/, (letter) => letter.toUpperCase());
}

function destroyedFallbackType(type) {
  if (type === TILE_TYPES.FISHERY) return TILE_TYPES.WATER;
  if (type === TILE_TYPES.MOUNTAIN_MINE) return TILE_TYPES.MOUNTAIN;
  return TILE_TYPES.EMPTY;
}

function foodConsumptionFor(nation, era) {
  return Math.ceil(nation.population.total * (BALANCE.population.foodConsumptionBase + era * BALANCE.population.foodConsumptionPerEra));
}

function populationMaintenanceFor(nation) {
  return Math.ceil(nation.population.total * BALANCE.population.upkeepMoneyPerPerson);
}

function applyStockpileDiminishingReturns(nation, resource, amount) {
  if (!BALANCE.stockpiles.resources.includes(resource)) return amount;
  const softCap = BALANCE.stockpiles.softCaps[resource];
  if (!softCap || amount <= 0) return amount;
  const current = nation.resources[resource] || 0;
  if (current <= softCap) return amount;
  const pressure = softCap / current;
  const multiplier = Math.max(BALANCE.stockpiles.minimumMultiplier, pressure);
  return Math.max(1, Math.ceil(amount * multiplier));
}

function normalizeHappiness(value) {
  const fallback = BALANCE.population.happiness.default;
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  return clamp(numeric, 0, 100);
}

function happinessBand(nation) {
  const happiness = normalizeHappiness(nation?.population?.happiness);
  return BALANCE.population.happiness.bands.find((band) => happiness >= band.min) || BALANCE.population.happiness.bands.at(-1);
}

function applyHappinessProduction(nation, amount) {
  if (amount <= 0) return amount;
  return Math.max(0, Math.ceil(amount * happinessBand(nation).workRate));
}

function populationHappinessDelta(game, nation, context = {}) {
  const config = BALANCE.population.happiness.changes;
  const logistics = context.logistics || computeNationLogistics(game.tiles || game.map?.tiles || [], nation);
  const consumption = Math.max(1, Number(context.consumption) || 1);
  const surplus = Number(context.surplus) || 0;
  const surplusRatio = surplus / consumption;
  const activeWarCount = activeWarsFor(game, nation.id).length;
  const activeTradeRoutes = game.tradeRoutes.filter((route) => route.status === "active" && route.members?.includes(nation.id)).length;
  const disruptedRoutes = game.tradeRoutes.filter((route) => route.status === "disrupted" && route.members?.includes(nation.id)).length;
  const activeAlliances = game.alliances.filter((alliance) => alliance.active && alliance.members?.includes(nation.id)).length;
  let delta = 0;

  if (context.famine) delta -= config.severeFoodDeficitPenalty;
  else if (surplusRatio <= -0.3) delta -= config.severeFoodDeficitPenalty;
  else if (surplus < BALANCE.population.growth.minimumFoodSurplus) delta -= config.mildFoodDeficitPenalty;
  else if (surplusRatio >= 0.35) delta += config.prosperousRecovery;

  delta -= Math.min(12, (Number(context.deaths) || 0) * config.famineDeathPenalty);
  if ((Number(context.unpaidUpkeep) || 0) > 0) delta -= config.unpaidUpkeepPenalty;
  delta -= Math.floor((Number(nation.warExhaustion) || 0) / config.warExhaustionDivisor);
  delta -= activeWarCount * config.activeWarPenalty;
  delta -= disruptedRoutes * config.disruptedTradePenalty;
  delta += Math.min(3, activeTradeRoutes * config.activeTradeBonus + activeAlliances * config.allianceBonus);

  if (activeWarCount === 0 && surplus >= BALANCE.population.growth.minimumFoodSurplus && (Number(context.unpaidUpkeep) || 0) <= 0) {
    delta += config.peacefulRecovery;
  }
  delta += logistics.happinessDelta;

  if (delta === 0 && normalizeHappiness(nation.population.happiness) < BALANCE.population.happiness.default) return 1;
  return clamp(delta, -15, 8);
}

function normalizeActionCount(value, fallback, max = Math.max(MAX_ACTIONS_PER_TURN, fallback)) {
  const numeric = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
  return Math.max(0, Math.min(max, numeric));
}

function normalizeMaxActionPoints(value) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) return MAX_ACTIONS_PER_TURN;
  return Math.max(1, numeric);
}

function diffSnapshots(before, after) {
  if (!before) return after;
  const nations = {};
  for (const [id, current] of Object.entries(after.nations)) {
    const prev = before.nations[id];
    nations[id] = {
      money: current.money - (prev?.money || 0),
      population: current.population - (prev?.population || 0),
      territory: current.territory - (prev?.territory || 0),
      score: current.score - (prev?.score || 0),
      resources: {
        food: current.resources.food - (prev?.resources?.food || 0),
        materials: current.resources.materials - (prev?.resources?.materials || 0),
        education: current.resources.education - (prev?.resources?.education || 0),
        industry: current.resources.industry - (prev?.resources?.industry || 0),
      },
    };
  }
  return {
    turn: after.turn,
    era: after.era,
    nations,
  };
}
