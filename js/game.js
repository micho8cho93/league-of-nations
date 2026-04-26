import {
  BUILDING_TYPES,
  SAVE_KEY,
  SAVE_VERSION,
  TILE_TYPES,
  WORKER_MIN,
  WORKER_ROLE_BY_TILE,
  axialNeighbors,
  clamp,
  deepClone,
  delay,
  isLand,
  isTileActive,
  mulberry32,
  pairKey,
  randomSeed,
  tileId,
} from "./utils.js";
import { BALANCE } from "./balance.js";
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
  restoreNation,
  serializeNation,
  spendMoney,
} from "./nation.js";
import {
  assignStartingTerritories,
  buildTileIndex,
  createMapData,
} from "./map.js";
import {
  buildingCost,
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
  canEnterTile,
  declareWar as declareWarHelper,
  defenderStrength,
  endWar,
  findPath,
  getAdjacentMilitaryActions,
  resolveCombat,
  siegeRequirementForTile,
  updateWarReadinessForTurn,
  warUpkeep,
} from "./war.js";
import { maybeRunGlobalEvent, scheduleEraEvent, tickTileEffects } from "./events.js";
import { processBotTurn } from "./ai.js";

export class GameState {
  constructor(data) {
    this.settings = data.settings;
    this.turn = data.turn || 1;
    this.era = data.era || 1;
    this.phase = data.phase || "player";
    this.nations = data.nations || {};
    this.playerId = data.playerId || "player";
    this.botIds = data.botIds || [];
    this.map = data.map;
    this.tiles = this.map.tiles;
    this.tileIndex = buildTileIndex(this.tiles);
    this.diplomacy = data.diplomacy || {};
    this.wars = data.wars || {};
    this.sieges = data.sieges || {};
    this.trades = data.trades || [];
    this.tradeRoutes = data.tradeRoutes || [];
    this.alliances = data.alliances || [];
    this.events = data.events || [];
    this.eraReports = data.eraReports || [];
    this.pendingEraReport = data.pendingEraReport || null;
    this.globalEvents = data.globalEvents || {};
    this.gameOver = data.gameOver || null;
    this.selectedTileId = data.selectedTileId || null;
    this.lastSummary = data.lastSummary || null;
    this.isProcessingTurn = false;
    this.listeners = new Set();
    this.rng = mulberry32((this.settings.seed || 1) + this.turn * 7919 + this.events.length * 131);
    this.eraStartSnapshot = data.eraStartSnapshot || this.createSnapshot();
    this.startedAt = data.startedAt || Date.now();
    this.turnStartedAt = Date.now();
    this.recomputeTerritories();
    scheduleEraEvent(this, this.era);
  }

  static newGame(rawSettings = {}) {
    const settings = normalizeSettings(rawSettings);
    const rng = mulberry32(settings.seed);
    const map = createMapData(settings);
    const profiles = profileSequence(settings.nationCount);
    const nations = {};
    const botIds = [];
    const colors = [
      "#55c6a5",
      "#d95f59",
      "#6c8ff0",
      "#d7b84f",
      "#a875d6",
      "#e58a42",
      "#3fb7c4",
      "#d66aa2",
      "#7cc46b",
      "#c9a5ff",
    ];

    const player = createNation({
      id: "player",
      name: settings.playerName,
      color: colors[0],
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
        color: colors[i % colors.length],
        isPlayer: false,
        profile: profiles[i],
        personality: personalities[i - 1],
      });
      nations[bot.id] = bot;
      botIds.push(bot.id);
    }

    assignStartingTerritories(map, Object.values(nations), rng);
    const game = new GameState({
      settings,
      map,
      nations,
      playerId: player.id,
      botIds,
    });
    game.addEvent(`Game started with ${settings.nationCount} nations on a ${settings.mapSize.toLowerCase()} map.`, { type: "system" });
    for (const botId of botIds) {
      game.addEvent(`${game.nations[botId].name} plays as a ${game.nations[botId].personality} nation.`, { nationId: botId, type: "ai" });
    }
    game.save();
    return game;
  }

  static fromSave(saveData) {
    if (!saveData || saveData.version !== SAVE_VERSION) throw new Error("Unsupported save data.");
    const nations = {};
    for (const [id, nation] of Object.entries(saveData.nations || {})) nations[id] = restoreNation(nation);
    const map = deepClone(saveData.map);
    return new GameState({
      settings: saveData.settings,
      turn: saveData.turn,
      era: saveData.era,
      phase: "player",
      nations,
      playerId: saveData.playerId,
      botIds: saveData.botIds || [],
      map,
      diplomacy: saveData.diplomacy || {},
      wars: saveData.wars || {},
      sieges: saveData.sieges || {},
      trades: saveData.trades || [],
      tradeRoutes: saveData.tradeRoutes || [],
      alliances: saveData.alliances || [],
      events: saveData.events || [],
      eraReports: saveData.eraReports || [],
      pendingEraReport: saveData.pendingEraReport || null,
      globalEvents: saveData.globalEvents || {},
      gameOver: saveData.gameOver || null,
      lastSummary: saveData.lastSummary || null,
      eraStartSnapshot: saveData.eraStartSnapshot || null,
      startedAt: saveData.startedAt || Date.now(),
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

  selectTile(id) {
    this.selectedTileId = id;
    this.emit({ type: "selection_changed", tileId: id });
  }

  claimableTiles(nationId) {
    const owned = this.tiles.filter((tile) => tile.ownerId === nationId);
    const ids = new Set();
    for (const tile of owned) {
      if (tile.type === TILE_TYPES.EMPTY) ids.add(tile.id);
      for (const neighbor of this.neighbors(tile.id)) {
        if (isLand(neighbor) && (!neighbor.ownerId || neighbor.ownerId === nationId)) ids.add(neighbor.id);
      }
    }
    return [...ids].map((id) => this.tileById(id)).filter(Boolean);
  }

  canBuild(tileIdValue, type, nationId = this.playerId) {
    const nation = this.nations[nationId];
    const tile = this.tileById(tileIdValue);
    if (!nation?.active) return { ok: false, reason: "Nation is inactive." };
    if (!tile || !isLand(tile)) return { ok: false, reason: "Buildings require land." };
    if (tile.type !== TILE_TYPES.EMPTY) return { ok: false, reason: "Tile is already developed." };
    if (tile.ownerId && tile.ownerId !== nationId) return { ok: false, reason: "Cannot build on foreign territory." };
    if (!tileTypeUnlocked(type, this.era)) return { ok: false, reason: "This building is not unlocked yet." };
    if (!BUILDING_TYPES.includes(type)) return { ok: false, reason: "Unknown building type." };
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
    return { ok: true, cost };
  }

  buildTile(tileIdValue, type, nationId = this.playerId, { silent = false } = {}) {
    const check = this.canBuild(tileIdValue, type, nationId);
    if (!check.ok) return check;
    const nation = this.nations[nationId];
    const tile = this.tileById(tileIdValue);
    if (!spendMoney(nation, check.cost)) return { ok: false, reason: "Not enough money." };
    tile.ownerId = nationId;
    tile.type = type;
    tile.workers = 0;
    tile.unit = null;
    nation.stats.built += 1;
    this.recomputeTerritories();
    if (!silent) this.addEvent(`${nation.name} built a ${typeLabel(type)} for $${check.cost}.`, { nationId, type: "build", tileId: tile.id });
    this.changed("build");
    return { ok: true, cost: check.cost };
  }

  destroyTile(tileIdValue, nationId = this.playerId) {
    const tile = this.tileById(tileIdValue);
    const nation = this.nations[nationId];
    if (!tile || tile.ownerId !== nationId) return { ok: false, reason: "You only control your own tiles." };
    if (tile.isCapital) return { ok: false, reason: "Capital tiles cannot be voluntarily destroyed." };
    if (tile.type === TILE_TYPES.EMPTY) return { ok: false, reason: "Tile is already empty." };
    const cost = destroyCost(tile.type);
    if (!spendMoney(nation, cost)) return { ok: false, reason: `Requires $${cost}.` };
    this.releaseTileWorkers(tile);
    tile.type = TILE_TYPES.EMPTY;
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
    const tile = this.tileById(tileIdValue);
    const nation = this.nations[nationId];
    if (!tile || tile.ownerId !== nationId) return { ok: false, reason: "Workers can only be assigned to owned tiles." };
    const role = WORKER_ROLE_BY_TILE[tile.type];
    if (!role) return { ok: false, reason: "This tile has no worker role." };
    const delta = Math.floor(Number(amount) || 0);
    if (delta === 0) return { ok: false, reason: "No worker change requested." };
    if (delta > 0) {
      const available = Math.min(delta, nation.population.available);
      if (available <= 0) return { ok: false, reason: "No available population." };
      const cost = workerAdminCost(available);
      if (nation.money < cost) return { ok: false, reason: `Requires $${cost} to organize workers.` };
      nation.money -= cost;
      nation.stats.moneySpent += cost;
      nation.population.available -= available;
      nation.workers[role] = (nation.workers[role] || 0) + available;
      tile.workers += available;
      if (!silent) this.addEvent(`${nation.name} assigned ${available} workers to a ${typeLabel(tile.type)}.`, { nationId, type: "workers", tileId: tile.id });
      this.changed("workers");
      return { ok: true, changed: available, cost };
    }
    const removed = Math.min(tile.workers, Math.abs(delta));
    if (removed <= 0) return { ok: false, reason: "No assigned workers to remove." };
    tile.workers -= removed;
    nation.workers[role] = Math.max(0, (nation.workers[role] || 0) - removed);
    nation.population.available += removed;
    if (!silent) this.addEvent(`${nation.name} removed ${removed} workers from a ${typeLabel(tile.type)}.`, { nationId, type: "workers", tileId: tile.id });
    this.changed("workers");
    return { ok: true, changed: -removed, cost: 0 };
  }

  trainUnit(tileIdValue, strength, nationId = this.playerId, { silent = false, branch = "infantry" } = {}) {
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
    nation.money -= cost.money;
    nation.population.available -= cost.people;
    nation.resources.materials -= cost.materials;
    if (cost.education) nation.resources.education -= cost.education;
    if (cost.industry) nation.resources.industry -= cost.industry;
    nation.workers.soldiers += cost.people;
    nation.stats.moneySpent += cost.money;
    nation.military.unitsTrained += amount;
    tile.unit = tile.unit || { nationId, strength: 0, branch: unitBranch, movedTurn: 0 };
    tile.unit.nationId = nationId;
    if (unitBranch !== "infantry" || !tile.unit.branch) tile.unit.branch = unitBranch;
    tile.unit.strength += amount;
    if (!silent) this.addEvent(`${nation.name} ${unitBranch === "infantry" ? "trained" : "deployed"} ${amount} ${unitBranch} strength.`, { nationId, type: "military", tileId: tile.id });
    this.changed("train");
    return { ok: true, cost };
  }

  moveUnitToward(fromTileId, targetTileId, nationId = this.playerId, options = {}) {
    const path = findPath(this, fromTileId, targetTileId, nationId);
    if (path.length < 2) return { ok: false, reason: "No valid path." };
    return this.moveOrAttackUnit(fromTileId, path[1], nationId, { ...options, path });
  }

  moveOrAttackUnit(fromTileId, toTileId, nationId = this.playerId, { silent = false, path = null } = {}) {
    this.cleanupSieges();
    const from = this.tileById(fromTileId);
    const to = this.tileById(toTileId);
    const nation = this.nations[nationId];
    if (!from || !to || !nation?.active) return { ok: false, reason: "Invalid movement." };
    if (from.ownerId !== nationId || !from.unit?.strength) return { ok: false, reason: "Select a tile with your troops." };
    if (!this.neighbors(from.id).some((tile) => tile.id === to.id)) return { ok: false, reason: "Units move one adjacent tile at a time." };
    const gate = canEnterTile(this, nationId, to);
    if (!gate.ok) return gate;

    const movementCost = to.type === TILE_TYPES.WATER ? BALANCE.costs.troopMovement.water : BALANCE.costs.troopMovement.land;
    if (!spendMoney(nation, movementCost)) return { ok: false, reason: `Requires $${movementCost} to move troops.` };

    if (!to.ownerId || to.ownerId === nationId) {
      const wasUnowned = !to.ownerId;
      const moving = from.unit;
      this.clearSiegesFromTile(from.id, nationId);
      from.unit = null;
      to.ownerId = nationId;
      to.unit = to.unit || { nationId, strength: 0, branch: moving.branch, movedTurn: this.turn };
      to.unit.strength += moving.strength;
      to.unit.nationId = nationId;
      if (wasUnowned) nation.stats.tilesCaptured += 1;
      this.recomputeTerritories();
      if (!silent) this.addEvent(`${nation.name} moved troops to a new tile.`, { nationId, type: "war", tileId: to.id });
      this.changed("move");
      return { ok: true, action: "move" };
    }

    const defenderId = to.ownerId;
    if (!areAtWar(this, nationId, defenderId)) return { ok: false, reason: "Declare war before attacking." };
    const defender = this.nations[defenderId];
    const attackingStrength = from.unit.strength;
    const defense = defenderStrength(to);
    const outcome = resolveCombat(this, nationId, defenderId, attackingStrength, defense, to, from);
    const report = {
      id: `battle-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      turn: this.turn,
      attackerId: nationId,
      defenderId,
      attackerName: nation.name,
      defenderName: defender.name,
      targetTileId: to.id,
      path: path || [from.id, to.id],
      targetType: to.type,
      attackerWins: outcome.attackerWins,
      attack: outcome.attack,
      defense: outcome.defense,
      modifiers: outcome.modifiers,
      losses: outcome.losses,
      capitalCaptured: false,
      territoryChanged: false,
      siege: null,
    };
    this.applyCombatOutcome(from, to, outcome, nationId, defenderId, report);
    this.addEvent(
      `${report.attackerName} ${report.attackerWins ? "won" : "lost"} a battle against ${report.defenderName}.`,
      { nationId, type: "war", tileId: to.id }
    );
    this.emit({ type: "battle_report", report });
    this.checkVictory();
    this.changed("battle");
    return { ok: true, action: "battle", report };
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
        from.unit.movedTurn = this.turn;
        if (to.unit) {
          to.unit.strength = Math.max(0, to.unit.strength - outcome.losses.defender);
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
      to.unit = { nationId: attackerId, strength: outcome.survivingAttackStrength, branch: from.unit.branch, movedTurn: this.turn };
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
      if (to.unit) to.unit.strength = Math.max(1, outcome.survivingDefenseStrength);
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
    const result = declareWarHelper(this, nationId, targetId, reason);
    if (result.ok) {
      this.addEvent(`${this.nations[nationId].name} declared war on ${this.nations[targetId].name}.`, { nationId, type: "war" });
      this.changed("war");
    }
    return result;
  }

  trade(partnerId, offer, request, nationId = this.playerId) {
    const result = applyTrade(this, nationId, partnerId, offer, request);
    if (result.ok && result.accepted) {
      this.addEvent(`${this.nations[nationId].name} traded with ${this.nations[partnerId].name}.`, { nationId, type: "trade" });
      this.changed("trade");
    }
    if (result.ok && !result.accepted) {
      this.addEvent(`${this.nations[partnerId].name} rejected a trade proposal.`, { nationId: partnerId, type: "trade" });
      this.changed("trade");
    }
    return result;
  }

  proposeAlliance(partnerId, allianceType = "trade", nationId = this.playerId) {
    const result = proposeAlliance(this, nationId, partnerId, allianceType);
    if (result.ok && result.accepted) {
      this.addEvent(`${this.nations[nationId].name} formed an alliance with ${this.nations[partnerId].name}.`, { nationId, type: "diplomacy" });
    } else if (result.ok) {
      this.addEvent(`${this.nations[partnerId].name} rejected an alliance proposal.`, { nationId: partnerId, type: "diplomacy" });
    }
    this.changed("alliance");
    return result;
  }

  breakAlliance(allianceId, nationId = this.playerId) {
    const result = breakAlliance(this, allianceId, nationId);
    if (result.ok) {
      this.addEvent(`${this.nations[nationId].name} broke an alliance.`, { nationId, type: "diplomacy" });
      this.changed("alliance");
    }
    return result;
  }

  embargo(targetId, nationId = this.playerId) {
    const result = embargoNation(this, nationId, targetId);
    if (result.ok) {
      this.addEvent(`${this.nations[nationId].name} embargoed ${this.nations[targetId].name}.`, { nationId, type: "diplomacy" });
      this.changed("embargo");
    }
    return result;
  }

  research(category, nationId = this.playerId) {
    const nation = this.nations[nationId];
    const check = canResearch(this, nation, category);
    if (!check.ok) return check;
    if (!spendMoney(nation, check.cost)) return { ok: false, reason: "Not enough money." };
    nation.resources[check.requirement.resource] -= check.requirement.resourceCost;
    nation.tech[category] = check.nextTier;
    nation.stats.techResearched += 1;
    this.addEvent(`${nation.name} advanced ${category} to tier ${check.nextTier}.`, { nationId, type: "tech" });
    this.changed("tech");
    return { ok: true, cost: check.cost, nextTier: check.nextTier };
  }

  researchBranch(branch, nationId = this.playerId) {
    const nation = this.nations[nationId];
    const check = canResearchBranch(this, nation, branch);
    if (!check.ok) return check;
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
    let produced = 0;
    for (const tile of this.tiles) {
      if (tile.ownerId !== nationId) continue;
      const production = productionForTile(nation, tile, this.era);
      if (production?.food) {
        const exhaustedProduction = applyWarExhaustionProduction(nation, production.food);
        produced += applyStockpileDiminishingReturns(nation, "food", exhaustedProduction);
      }
    }
    const capacity = nation.territory.length * BALANCE.population.capacityPerTile;
    return { produced, consumed, net: produced - consumed, capacity };
  }

  async endTurn() {
    if (this.isProcessingTurn || this.gameOver) return;
    if (this.pendingEraReport) {
      this.addEvent("Complete the era reflection before continuing.", { type: "system" });
      this.changed("blocked");
      return;
    }
    this.isProcessingTurn = true;
    this.phase = "ai";
    this.changed("phase");
    for (const botId of this.botIds) {
      if (this.gameOver) break;
      if (!this.nations[botId]?.active) continue; // skip eliminated nations
      await processBotTurn(this, botId);
      this.changed("ai");
      await delay(130);
    }
    this.phase = "round";
    this.changed("phase");
    this.processRound();
    if (!this.gameOver && !this.pendingEraReport) {
      this.turn += 1;
      this.turnStartedAt = Date.now();
      this.phase = "player";
      this.rng = mulberry32((this.settings.seed || 1) + this.turn * 7919 + this.events.length * 131);
    }
    this.isProcessingTurn = false;
    this.save();
    this.changed("turn_end");
  }

  processRound() {
    const summary = {
      turn: this.turn,
      money: 0,
      food: 0,
      foodProduced: 0,
      foodConsumed: 0,
      materials: 0,
      education: 0,
      industry: 0,
      population: 0,
      deaths: 0,
      upkeep: 0,
      notes: [],
    };

    const foodProducedByNation = {};
    for (const nation of Object.values(this.nations).filter((item) => item.active)) {
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
          summary.notes.push(`${nation.name} could not fully fund the war effort.`);
        }
      }
      const populationUpkeep = populationMaintenanceFor(nation);
      if (populationUpkeep > 0) {
        const paid = Math.min(nation.money, populationUpkeep);
        nation.money -= paid;
        nation.stats.moneySpent += paid;
        summary.upkeep += paid;
      }
      const foodProduced = this.produceForNation(nation, summary);
      foodProducedByNation[nation.id] = foodProduced;
    }

    const tradeResult = processTradeRoutes(this, summary);

    for (const nation of Object.values(this.nations).filter((item) => item.active)) {
      const routeFood = tradeResult.foodProduced[nation.id] || 0;
      this.consumeFood(nation, summary, (foodProducedByNation[nation.id] || 0) + routeFood);
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
    this.checkVictory();
    const nextEra = checkEraAdvancement(this);
    if (!this.gameOver && nextEra) {
      const eraEvent = maybeRunGlobalEvent(this, { force: true });
      if (eraEvent) {
        this.addEvent(`${eraEvent.label}: ${eraEvent.description}`, { type: "global_event" });
        summary.notes.push(`${eraEvent.label}: ${eraEvent.results.slice(0, 3).join("; ")}`);
      }
      this.pendingEraReport = this.createEraReport(nextEra);
    }
  }

  produceForNation(nation, summary) {
    let populationGain = 0;
    let foodProduced = 0;
    for (const tile of this.tiles.filter((item) => item.ownerId === nation.id)) {
      const production = productionForTile(nation, tile, this.era);
      if (!production) continue;
      if (tile.type === TILE_TYPES.FACTORY) {
        if (nation.resources.materials < production.materialsCost || nation.resources.education < production.educationCost) {
          const fallbackIncome = applyWarExhaustionIncome(nation, BALANCE.costs.factoryFallbackMoney);
          earnMoney(nation, fallbackIncome);
          summary.money += fallbackIncome;
          continue;
        }
        nation.resources.materials -= production.materialsCost;
        nation.resources.education -= production.educationCost;
      }
      for (const resource of ["food", "materials", "education", "industry"]) {
        if (production[resource]) {
          const exhaustedProduction = applyWarExhaustionProduction(nation, production[resource]);
          const produced = applyStockpileDiminishingReturns(nation, resource, exhaustedProduction);
          nation.resources[resource] += produced;
          nation.stats.resourcesProduced += produced;
          summary[resource] += produced;
          // Track food produced separately for the growth calculation in consumeFood
          if (resource === "food") foodProduced += produced;
        }
      }
      if (production.money) {
        const income = applyWarExhaustionIncome(nation, production.money);
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

  consumeFood(nation, summary, foodProduced) {
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
      // Famine blocks growth — return early
      return;
    }

    // Per-turn surplus: how much more food was produced than consumed this turn.
    // Growth is driven by surplus flow, not stockpile size.
    const surplus = foodProduced - consumption;

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

    const growth = Math.round(baseGrowth * headroomFraction);
    if (growth > 0) {
      addPopulation(nation, growth);
      summary.population += growth;
    }
  }

  reduceNationUnits(nationId, amount) {
    let remaining = amount;
    for (const tile of this.tiles.filter((item) => item.ownerId === nationId && item.unit?.strength > 0)) {
      if (remaining <= 0) break;
      const lost = Math.min(tile.unit.strength, remaining);
      tile.unit.strength -= lost;
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
    this.save();
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

  checkVictory() {
    if (this.gameOver) return this.gameOver;
    const active = Object.values(this.nations).filter((nation) => nation.active);
    if (active.length <= 1) {
      this.gameOver = {
        type: "domination",
        label: "Total Domination",
        winnerId: active[0]?.id || this.playerId,
        turn: this.turn,
        scores: this.scoreboard(),
      };
    } else if (!this.settings.unlimitedMode && this.settings.maxTurns > 0 && this.turn >= this.settings.maxTurns) {
      const scores = this.scoreboard();
      this.gameOver = {
        type: "turn_limit",
        label: "Turn Limit Reached",
        winnerId: scores[0].id,
        turn: this.turn,
        scores,
      };
    }
    if (this.gameOver) {
      this.addEvent(`${this.nations[this.gameOver.winnerId].name} won by ${this.gameOver.label}.`, { nationId: this.gameOver.winnerId, type: "victory" });
      this.emit({ type: "game_over", gameOver: this.gameOver });
    }
    return this.gameOver;
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
  }

  changed(source) {
    this.emit({ type: "state_changed", source });
    this.save();
  }

  save() {
    if (typeof localStorage === "undefined") return { ok: false, reason: "localStorage unavailable." };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.toSaveData()));
      return { ok: true };
    } catch (error) {
      console.warn("Save failed", error);
      return { ok: false, reason: "Save failed." };
    }
  }

  toSaveData() {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      settings: this.settings,
      turn: this.turn,
      era: this.era,
      phase: this.phase,
      playerId: this.playerId,
      botIds: [...this.botIds],
      nations: Object.fromEntries(Object.entries(this.nations).map(([id, nation]) => [id, serializeNation(nation)])),
      map: deepClone(this.map),
      diplomacy: deepClone(this.diplomacy),
      wars: deepClone(this.wars),
      sieges: deepClone(this.sieges),
      trades: deepClone(this.trades),
      tradeRoutes: deepClone(this.tradeRoutes),
      alliances: deepClone(this.alliances),
      events: deepClone(this.events),
      eraReports: deepClone(this.eraReports),
      pendingEraReport: deepClone(this.pendingEraReport),
      globalEvents: deepClone(this.globalEvents),
      gameOver: deepClone(this.gameOver),
      lastSummary: deepClone(this.lastSummary),
      eraStartSnapshot: deepClone(this.eraStartSnapshot),
      startedAt: this.startedAt,
    };
  }

  militaryActions(tileIdValue, nationId = this.playerId) {
    return getAdjacentMilitaryActions(this, tileIdValue, nationId);
  }
}

export function readSavedGame() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function clearSavedGame() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(SAVE_KEY);
}

function normalizeSettings(raw) {
  const nationCount = clamp(Math.floor(Number(raw.nationCount) || 5), 2, 10);
  const unlimitedMode = Boolean(raw.unlimitedMode);
  return {
    playerName: String(raw.playerName || "Republic of Nova").trim().slice(0, 40) || "Republic of Nova",
    mapSize: ["Small", "Medium", "Large"].includes(raw.mapSize) ? raw.mapSize : "Medium",
    nationCount,
    maxTurns: unlimitedMode ? 0 : clamp(Math.floor(Number(raw.maxTurns) || 30), 10, 120),
    timeLimitMinutes: clamp(Math.floor(Number(raw.timeLimitMinutes) || 0), 0, 240),
    unlimitedMode,
    seed: Math.floor(Number(raw.seed) || randomSeed()),
  };
}

function typeLabel(type) {
  if (type === TILE_TYPES.MILITARY) return "Military Base";
  return String(type).replace(/^\w/, (letter) => letter.toUpperCase());
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
