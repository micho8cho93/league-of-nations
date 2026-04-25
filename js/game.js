// Core game state + actions. Phase 7 = Industrial Era (factories, tech, warfare).


const BOT_TURN_PAUSE_MS = 600;
const GLOBAL_TRADE_SHIP_COST = 100;
const GAME_SAVE_KEY = "league-of-nations-save-v1";
const SAVE_VERSION = 1;
const DISASTER_CHANCE = 0.05;

class GameState {
  constructor({ map, playerNation, growthEvery = 1, turnLimit = 30 }) {
    this.map = map;
    this.nations = { [playerNation.id]: playerNation };
    this.playerId = playerNation.id;
    this.botIds = [];
    this.turn = 1;
    this.growthEvery = growthEvery;
    this.turnLimit = turnLimit;
    this.lastSummary = null;
    this.events = [];
    this.diplomacy = {};
    this.alliances = [];
    this.gameOver = null;
    this.currentPhase = "player";
    this.isProcessingTurn = false;
    this.tutorial = {
      step: 0,
      dismissed: false,
      completed: false,
    };
    this._listeners = [];
  }

  static fromSaveData(data, map) {
    if (!data || data.version !== SAVE_VERSION) {
      throw new Error("Unsupported save data");
    }
    const nations = {};
    for (const [id, savedNation] of Object.entries(data.nations || {})) {
      nations[id] = restoreNation(savedNation);
    }
    const player = nations[data.playerId];
    if (!player) throw new Error("Save data is missing the player nation");

    const state = new GameState({
      map,
      playerNation: player,
      growthEvery: data.growthEvery || 1,
      turnLimit: data.turnLimit ?? 30,
    });
    state.nations = nations;
    state.playerId = data.playerId;
    state.botIds = Array.isArray(data.botIds) ? [...data.botIds] : [];
    state.turn = data.turn || 1;
    state.lastSummary = data.lastSummary || null;
    state.events = Array.isArray(data.events) ? data.events : [];
    state.diplomacy = data.diplomacy || {};
    state.alliances = Array.isArray(data.alliances) ? data.alliances : [];
    state.currentPhase = "player";
    state.isProcessingTurn = false;
    state.tutorial = {
      step: 0,
      dismissed: false,
      completed: false,
      ...(data.tutorial || {}),
    };
    state.gameOver = restoreGameOver(data.gameOver, state.nations);
    state._restoreMapTiles(data.map?.tiles || []);
    if (Object.values(state.nations).some((nation) => nation.stage >= STAGES.INDUSTRIAL_EXPANSION)) {
      state.map.revealUNTerritories?.();
    }
    if (state.map.updateAllianceLines) {
      state.map.updateAllianceLines(state.alliances, state.nations);
    }

    // Migrate old saves that stored a single global stage — give all nations that stage.
    if (data.stage && data.stage !== STAGES.FOUNDATIONAL && !player.stage) {
      const legacyUnlocks = {
        stage2: false, stage3: false, stage32: false, stage4: false,
        ...(data.stageUnlocks || {}),
      };
      for (const nation of Object.values(nations)) {
        nation.stage = data.stage;
        nation.stageUnlocks = { ...legacyUnlocks };
      }
    }

    return state;
  }

  get player() {
    return this.nations[this.playerId];
  }

  // `this.stage` always reflects the player's current stage for backward-compat
  // with all player-context code (UI, war gating, victory checks, etc.)
  get stage() { return this.player?.stage ?? STAGES.FOUNDATIONAL; }
  set stage(v) { if (this.player) this.player.stage = v; }

  on(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn);
    };
  }

  emit(event) {
    for (const l of this._listeners) l(event);
  }

  addNation(nation, { isBot = false, personality = null } = {}) {
    nation.isBot = isBot;
    nation.personality = personality;
    this.nations[nation.id] = nation;
    if (isBot && !this.botIds.includes(nation.id)) this.botIds.push(nation.id);
    this.emit({ type: "state_changed", source: "add_nation", nation });
  }

  addEvent(message, { nationId = null, kind = "info", tileCoord = null } = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      turn: this.turn,
      message,
      nationId,
      kind,
      tileCoord: tileCoord || null,
      timestamp: Date.now(),
    };
    this.events.push(entry);
    if (this.events.length > 80) this.events.shift();
    this.emit({ type: "event_added", event: entry });
    return entry;
  }

  dismissTutorial() {
    this.tutorial.dismissed = true;
    this.tutorial.completed = true;
    this.emit({ type: "state_changed", source: "tutorial_dismissed" });
    this.saveToLocalStorage({ silent: true });
  }

  manualSave() {
    const saved = this.saveToLocalStorage({ silent: true });
    if (saved.ok) {
      this.addEvent("Game saved.", { kind: "save" });
      this.saveToLocalStorage({ silent: true });
    }
    return saved;
  }

  saveToLocalStorage({ silent = false } = {}) {
    if (typeof localStorage === "undefined") {
      return { ok: false, reason: "localStorage is unavailable" };
    }
    try {
      localStorage.setItem(GAME_SAVE_KEY, JSON.stringify(this.toSaveData()));
      if (!silent) this.emit({ type: "state_changed", source: "saved" });
      return { ok: true, reason: "Game saved" };
    } catch (err) {
      console.warn("Save failed", err);
      return { ok: false, reason: "Save failed" };
    }
  }

  toSaveData() {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      playerId: this.playerId,
      botIds: [...this.botIds],
      turn: this.turn,
      stage: this.stage,
      growthEvery: this.growthEvery,
      turnLimit: this.turnLimit,
      lastSummary: sanitizeSummary(this.lastSummary),
      events: this.events,
      diplomacy: this.diplomacy,
      alliances: this.alliances,
      gameOver: this.gameOver
        ? {
            victoryType: this.gameOver.victoryType,
            winnerId: this.gameOver.winner?.id,
            turn: this.gameOver.turn,
          }
        : null,
      tutorial: this.tutorial,
      nations: Object.fromEntries(
        Object.entries(this.nations).map(([id, nation]) => [id, serializeNation(nation)])
      ),
      map: {
        radius: this.map.radius,
        seed: this.map.seed,
        tiles: this.map.tiles.map((tile) => ({
          q: tile.q,
          r: tile.r,
          type: tile.type,
          owner: tile.owner,
          workers: tile.workers || 0,
          workerType: tile.workerType || null,
          hasTractor: Boolean(tile.hasTractor),
          disabledTurns: tile.disabledTurns || 0,
          floodedTurns: tile.floodedTurns || 0,
          bountifulTurns: tile.bountifulTurns || 0,
        })),
      },
    };
  }

  logArchive(nation, entry) {
    nation.archives.push({
      ...entry,
      turn: this.turn,
      timestamp: Date.now(),
    });
  }

  getDiplomacy(partnerId) {
    if (!this.diplomacy[partnerId]) {
      this.diplomacy[partnerId] = {
        relation: 50,
        successfulTrades: 0,
        rejectedTrades: 0,
        lastOffer: null,
        alliancesFormed: 0,
      };
    }
    return this.diplomacy[partnerId];
  }

  // ---- Stage 2: government, alliances, global trade ----

  chooseGovernment(governmentId) {
    if (this.stage < STAGES.TRADE) {
      return { ok: false, reason: "Government unlocks in Stage 2" };
    }
    if (this.player.government) {
      return { ok: false, reason: "Government has already been chosen" };
    }
    const government = GOVERNMENTS[governmentId];
    if (!government) return { ok: false, reason: "Choose a valid government" };

    this.player.government = governmentId;
    this.player.governmentVetoes = governmentId === "democracy" ? 1 : 0;

    for (const botId of this.botIds) {
      const bot = this.nations[botId];
      if (!bot) continue;
      const d = this.getDiplomacy(botId);
      if (bot.government === governmentId) d.relation = Math.min(100, d.relation + 10);
      else if (governmentId === "dictatorship") d.relation = Math.min(100, d.relation + 4);
      else if (bot.government === "dictatorship") d.relation = Math.max(0, d.relation - 6);
      else if (governmentId === "democracy" && bot.government !== "democracy") d.relation = Math.max(0, d.relation - 2);
    }

    this.logArchive(this.player, {
      type: "government_chosen",
      details: `${this.player.name} chose ${government.label}`,
    });
    this.addEvent(`${this.player.name} adopted ${government.label}.`, {
      nationId: this.playerId,
      kind: "government",
    });
    this.emit({ type: "state_changed", source: "government_chosen", governmentId });
    return { ok: true, reason: `${government.label} established.` };
  }

  proposeAlliance(partnerId, draft) {
    if (this.isProcessingTurn) {
      return { ok: false, accepted: false, reason: "Wait for the next player turn" };
    }
    if (this.stage < STAGES.TRADE) {
      return { ok: false, accepted: false, reason: "Alliances unlock in Stage 2" };
    }
    if (!this.player.government) {
      return { ok: false, accepted: false, reason: "Choose a government first" };
    }

    const partner = this.nations[partnerId];
    if (!partner || partner.id === this.playerId) {
      return { ok: false, accepted: false, reason: "Choose a foreign nation" };
    }

    const existing = this.alliances.find((a) =>
      a.active && a.members.includes(this.playerId) && a.members.includes(partnerId)
    );
    if (existing) {
      return { ok: false, accepted: false, reason: `Already allied under ${existing.name}` };
    }

    const normalized = this._normalizeAllianceDraft(draft, partnerId);
    if (!normalized.ok) return normalized;

    const diplomacy = this.getDiplomacy(partnerId);
    const verdict = this._evaluateAlliance(partner, normalized.alliance, diplomacy);
    if (!verdict.accepted) {
      diplomacy.relation = Math.max(0, diplomacy.relation - 4);
      this.logArchive(this.player, {
        type: "alliance_rejected",
        details: `${partner.name} rejected ${normalized.alliance.name}: ${verdict.reason}`,
      });
      this.addEvent(`${partner.name} rejected alliance terms: ${verdict.reason}`, {
        nationId: partner.id,
        kind: "alliance_rejected",
      });
      this.emit({ type: "state_changed", source: "alliance_rejected", partner, verdict });
      return { ok: true, accepted: false, reason: verdict.reason };
    }

    const alliance = {
      ...normalized.alliance,
      id: `alliance_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      createdTurn: this.turn,
      expiresTurn: this.turn + normalized.alliance.duration,
      active: true,
    };
    this.alliances.push(alliance);
    this.player.alliances.push(alliance.id);
    partner.alliances.push(alliance.id);

    diplomacy.relation = Math.min(100, diplomacy.relation + 12);
    diplomacy.alliancesFormed += 1;

    const details = `${alliance.name}: ${ALLIANCE_TYPES[alliance.type]} alliance with ${partner.name} for ${alliance.duration} turns`;
    const treaty = {
      type: "alliance",
      allianceId: alliance.id,
      partnerId,
      details,
      turn: this.turn,
      timestamp: Date.now(),
    };
    this.player.treaties.push(treaty);
    partner.treaties.push({ ...treaty, partnerId: this.playerId });
    this.logArchive(this.player, { type: "alliance_formed", details });
    this.logArchive(partner, { type: "alliance_formed", details });
    this.addEvent(`Alliance formed: ${details}.`, {
      nationId: partner.id,
      kind: "alliance",
    });

    if (this.map.updateAllianceLines) {
      this.map.updateAllianceLines(this.alliances, this.nations);
    }
    this.emit({ type: "state_changed", source: "alliance_formed", alliance, partner });
    return { ok: true, accepted: true, reason: `${partner.name} signed ${alliance.name}.`, alliance };
  }

  getFactorySlots(nation) {
    return factorySlots(nation || this.player);
  }

  getTotalMilitaryStrength(nation) {
    return totalMilitaryStrength(nation || this.player);
  }

  getFoodCapacity(nation) {
    return foodCapacity(nation || this.player);
  }

  getFactoryRequirement(nation) {
    const existingFactories = nation.tiles.factories.length;
    const required = Math.min(4, existingFactories + 2);
    const activeMines = nation.tiles.mines.filter(isTileActive).length;
    const activeSchools = nation.tiles.schools.filter(isTileActive).length;
    return {
      activeMines,
      activeSchools,
      requiredMines: required,
      requiredSchools: required,
      canBuild: activeMines >= required && activeSchools >= required,
    };
  }

  getAttackTargetsForPlayer() {
    if (this.player.atWarWith.length === 0) return [];
    return getAttackTargets(this, this.player);
  }

  getTradeRouteInfo(partnerId) {
    const partner = this.nations[partnerId];
    if (!partner) {
      return { ok: false, adjacent: false, global: false, cost: 0, reason: "Choose a foreign nation" };
    }
    const adjacent = this._nationsAdjacent(this.player, partner);
    if (adjacent) {
      return { ok: true, adjacent: true, global: false, cost: 0, reason: "Border trade route" };
    }
    if (this.stage < STAGES.TRADE) {
      return {
        ok: false,
        adjacent: false,
        global: false,
        cost: 0,
        reason: "Non-adjacent trade unlocks in Stage 2",
      };
    }
    return {
      ok: true,
      adjacent: false,
      global: true,
      cost: GLOBAL_TRADE_SHIP_COST,
      reason: `Global trade route: $${GLOBAL_TRADE_SHIP_COST} ship cost`,
    };
  }

  // ---- Diplomacy + trade ----

  proposeTrade(partnerId, draft) {
    if (this.isProcessingTurn) {
      return { ok: false, accepted: false, reason: "Wait for the next player turn" };
    }

    const partner = this.nations[partnerId];
    if (!partner || partner.id === this.playerId) {
      return { ok: false, accepted: false, reason: "Choose a foreign nation" };
    }

    const route = this.getTradeRouteInfo(partnerId);
    if (!route.ok) return { ok: false, accepted: false, reason: route.reason };
    const offerMoney = Math.max(0, Math.floor(Number(draft?.offer?.money) || 0));
    if (this.player.money < offerMoney + route.cost) {
      return {
        ok: false,
        accepted: false,
        reason: `You need $${route.cost.toLocaleString()} extra for the ship route`,
      };
    }

    const diplomacy = this.getDiplomacy(partnerId);
    const verdict = evaluateTrade(this.player, partner, draft, diplomacy);
    if (!verdict.ok) return verdict;

    diplomacy.lastOffer = verdict.normalized;
    if (verdict.accepted) {
      executeTrade(this.player, partner, verdict.normalized);
      if (route.cost > 0) this.player.money -= route.cost;
      diplomacy.successfulTrades += 1;
      diplomacy.relation = Math.min(100, diplomacy.relation + 6);

      const details = describeTrade(verdict.normalized, this.player.name, partner.name);
      const routeDetails = route.cost > 0 ? `${details}; ship route cost $${route.cost}` : details;
      const treaty = {
        type: "trade",
        partnerId,
        details: routeDetails,
        turn: this.turn,
        timestamp: Date.now(),
      };
      this.player.treaties.push(treaty);
      partner.treaties.push({ ...treaty, partnerId: this.playerId });
      this.logArchive(this.player, {
        type: "trade_completed",
        details: routeDetails,
        cost: route.cost > 0 ? { money: route.cost } : undefined,
      });
      this.logArchive(partner, { type: "trade_completed", details: routeDetails });
      this.addEvent(`Trade accepted: ${routeDetails}.`, {
        nationId: partner.id,
        kind: "trade",
      });
    } else {
      diplomacy.rejectedTrades += 1;
      diplomacy.relation = Math.max(0, diplomacy.relation - 3);
      const details = describeTrade(verdict.normalized, this.player.name, partner.name);
      this.logArchive(this.player, {
        type: "trade_rejected",
        details: `${partner.name} rejected: ${details}`,
      });
      this.addEvent(`Trade rejected by ${partner.name}: ${verdict.reason}`, {
        nationId: partner.id,
        kind: "trade_rejected",
      });
    }

    this.emit({ type: "state_changed", source: "trade", partner, verdict });
    return { ...verdict, diplomacy };
  }

  _normalizeAllianceDraft(draft, partnerId) {
    const type = String(draft?.type || "trade").toLowerCase();
    if (!ALLIANCE_TYPES[type]) {
      return { ok: false, accepted: false, reason: "Choose an alliance type" };
    }
    const partner = this.nations[partnerId];
    const fallbackName = `${ALLIANCE_TYPES[type]} Accord`;
    const name = String(draft?.name || fallbackName).trim().slice(0, 48) || fallbackName;
    const duration = Math.max(1, Math.min(20, Math.floor(Number(draft?.duration) || 5)));
    const terms = {
      shareResources: Boolean(draft?.terms?.shareResources),
      mutualDefense: Boolean(draft?.terms?.mutualDefense),
      tradeExclusivity: Boolean(draft?.terms?.tradeExclusivity),
    };
    if (!Object.values(terms).some(Boolean)) {
      return { ok: false, accepted: false, reason: "Select at least one term" };
    }
    return {
      ok: true,
      alliance: {
        name,
        type,
        members: [this.playerId, partnerId],
        memberNames: [this.player.name, partner.name],
        terms,
        duration,
      },
    };
  }

  _evaluateAlliance(partner, alliance, diplomacy) {
    let score = diplomacy.relation;
    if (partner.personality === "Diplomat") score += 18;
    if (partner.personality === "Isolationist") score -= 20;
    if (partner.personality === "Militarist" && alliance.type === "military") score += 12;
    if (partner.personality === "Economist" && alliance.type === "trade") score += 10;
    if (partner.personality === "Expansionist" && alliance.terms.mutualDefense) score += 5;
    if (alliance.terms.tradeExclusivity) score -= 8;
    if (this.player.government && partner.government === this.player.government) score += 8;
    if (this.player.government === "dictatorship" && partner.government === "democracy") score -= 8;

    const threshold = partner.personality === "Diplomat" ? 46 : partner.personality === "Isolationist" ? 70 : 55;
    return {
      accepted: score >= threshold,
      score,
      threshold,
      reason: score >= threshold
        ? `${partner.name} accepts the accord.`
        : `${partner.name} wants stronger relations first.`,
    };
  }

  _nationsAdjacent(a, b) {
    const aTiles = this._ownedTiles(a);
    const bId = b.id;
    return aTiles.some((tile) =>
      axialNeighbors(tile.q, tile.r).some((n) => {
        const neighbor = this.map.tileAt(n.q, n.r);
        return neighbor && neighbor.owner === bId;
      })
    );
  }

  _ownedTiles(nation) {
    return [
      ...nation.tiles.farms,
      ...nation.tiles.mines,
      ...nation.tiles.schools,
      ...nation.tiles.militaryBases,
      ...nation.tiles.factories,
      ...nation.tiles.empty,
    ];
  }

  // ---- Starter territory ----

  setupPlayerStart(clusterSize = startingTileCount(this.player)) {
    let start = this.map.tileAt(0, 0);
    if (!this._isStartableTile(start)) start = this._findStartTileNear({ q: 0, r: 0 });
    if (!start) return;

    this._setupNationStart(this.player, start, clusterSize, [
      ["farm", 2],
      ["mine", 1],
      ["school", 1],
    ]);

    this.emit({ type: "state_changed", source: "init" });
  }

  setupBotStarts() {
    const starts = [
      { q: -6, r: 2 },
      { q: 6, r: -2 },
      { q: 2, r: 5 },
      { q: -2, r: -5 },
      { q: 6, r: 1 },
      { q: -6, r: -1 },
      { q: 1, r: -6 },
    ];

    this.botIds.forEach((id, index) => {
      const bot = this.nations[id];
      const start = this._findStartTileNear(starts[index % starts.length], 4);
      if (!start) return;

      const plan = bot.personality === "Militarist"
        ? [["farm", 1], ["mine", 1], ["military", 1], ["school", 1]]
        : [["farm", 2], ["mine", 1], ["school", 1]];
      this._setupNationStart(bot, start, startingTileCount(bot), plan);
    });

    this.emit({ type: "state_changed", source: "setup_bots" });
  }

  _restoreMapTiles(savedTiles) {
    for (const nation of Object.values(this.nations)) {
      nation.tiles = emptyTileBuckets();
    }

    const savedByKey = new Map(savedTiles.map((tile) => [`${tile.q},${tile.r}`, tile]));
    for (const tile of this.map.tiles) {
      const saved = savedByKey.get(`${tile.q},${tile.r}`);
      if (!saved) continue;

      this.map.setTileType(tile, saved.type);
      const owner = saved.owner ? this.nations[saved.owner] : null;
      this.map.setTileOwner(tile, owner || null);
      tile.workers = saved.workers || 0;
      tile.workerType = saved.workerType || WORKER_FIELD[saved.type] || null;
      tile.hasTractor = Boolean(saved.hasTractor);
      tile.disabledTurns = saved.disabledTurns || 0;
      tile.floodedTurns = saved.floodedTurns || 0;
      tile.bountifulTurns = saved.bountifulTurns || 0;

      if (owner) {
        const listKey = TILE_LIST_KEY[tile.type] || (tile.type === "empty" ? "empty" : null);
        if (listKey && !owner.tiles[listKey].includes(tile)) owner.tiles[listKey].push(tile);
      }
    }
  }

  _setupNationStart(nation, start, clusterSize, plan) {
    const cluster = this._claimableCluster(start, clusterSize);

    for (const t of cluster) {
      if (t.type !== "empty") this.map.setTileType(t, "empty");
      this.map.setTileOwner(t, nation);
      t.workers = 0;
      t.workerType = null;
      if (!nation.tiles.empty.includes(t)) nation.tiles.empty.push(t);
    }

    for (const [type, count] of plan) {
      for (let i = 0; i < count; i++) {
        const tile = nation.tiles.empty.shift();
        if (!tile) break;
        this._transformTile(tile, type, nation);
        const min = WORKER_MIN[type];
        const field = WORKER_FIELD[type];
        if (nation.population.available >= min) {
          nation.population.available -= min;
          nation.population[field] += min;
          tile.workers = min;
        }
      }
    }

    if (nation.id === this.playerId && cluster.length > 0) {
      const avgQ = cluster.reduce((s, t) => s + t.q, 0) / cluster.length;
      const avgR = cluster.reduce((s, t) => s + t.r, 0) / cluster.length;
      this.map.focusOn(avgQ, avgR);
    }
  }

  _claimableCluster(start, clusterSize) {
    const cluster = [];
    const visited = new Set();
    const queue = [start];
    while (queue.length && cluster.length < clusterSize) {
      const t = queue.shift();
      if (!this._isStartableTile(t) || visited.has(t)) continue;
      visited.add(t);
      cluster.push(t);
      for (const n of axialNeighbors(t.q, t.r)) {
        const nt = this.map.tileAt(n.q, n.r);
        if (nt && !visited.has(nt) && this._isStartableTile(nt)) queue.push(nt);
      }
    }
    return cluster;
  }

  _findStartTileNear(target, minDistanceFromOwned = 0) {
    const owned = this.map.tiles.filter((t) => t.owner);
    return this.map.tiles
      .filter((t) => this._isStartableTile(t))
      .filter((t) => {
        if (minDistanceFromOwned <= 0 || owned.length === 0) return true;
        return owned.every((o) => hexDistance(t, o) >= minDistanceFromOwned);
      })
      .sort((a, b) => hexDistance(a, target) - hexDistance(b, target))[0] || null;
  }

  _isStartableTile(tile) {
    return tile && tile.type !== TILE_TYPES.WATER && tile.type !== TILE_TYPES.UN && tile.type !== TILE_TYPES.ISLAND && !tile.owner;
  }

  // ---- Building ----

  canBuildOn(tile, nation) {
    if (!tile) return { ok: false, reason: "No tile" };
    if (tile.type === TILE_TYPES.WATER) return { ok: false, reason: "Water tile" };
    if (tile.type === TILE_TYPES.UN || tile.type === TILE_TYPES.ISLAND) {
      return { ok: false, reason: "UN territory unlocks in Stage 3.2" };
    }
    if ((tile.floodedTurns || 0) > 0) return { ok: false, reason: "Flooded tile" };
    if (tile.owner && tile.owner !== nation.id) {
      return { ok: false, reason: "Foreign territory" };
    }
    if (tile.owner === nation.id) {
      return tile.type === "empty"
        ? { ok: true }
        : { ok: false, reason: "Already built" };
    }
    for (const n of axialNeighbors(tile.q, tile.r)) {
      const t = this.map.tileAt(n.q, n.r);
      if (t && t.owner === nation.id) return { ok: true };
    }
    return { ok: false, reason: "Not adjacent to your territory" };
  }

  buildTile(tile, tileType, payment /* "money" | "people" */) {
    if (this.isProcessingTurn) {
      return { ok: false, reason: "Wait for the next player turn" };
    }
    return this.buildTileForNation(this.player, tile, tileType, payment);
  }

  buildTileForNation(nation, tile, tileType, payment /* "money" | "people" */) {
    const check = this.canBuildOn(tile, nation);
    if (!check.ok) return check;

    if (tileType === "factory") {
      if (nation.stage < STAGES.INDUSTRIAL) {
        return { ok: false, reason: "Factories require Stage 3 (Industrial Era)" };
      }
      const requirement = this.getFactoryRequirement(nation);
      if (!requirement.canBuild) {
        return {
          ok: false,
          reason: `Need ${requirement.requiredMines} active mines (have ${requirement.activeMines}) and ${requirement.requiredSchools} active schools (have ${requirement.activeSchools})`,
        };
      }
    }

    const cost = buildCost(nation.stage, tileType);
    if (!cost) return { ok: false, reason: "Unknown tile type" };

    const capCheck = this._checkResourceCap(nation, tileType);
    if (!capCheck.ok) return capCheck;

    if (payment === "money") {
      if (nation.money < cost.money) {
        return { ok: false, reason: "Not enough money" };
      }
      nation.money -= cost.money;
    } else if (payment === "people") {
      if (cost.people == null) {
        return { ok: false, reason: "This tile can only be paid with money" };
      }
      if (nation.population.available < cost.people) {
        return { ok: false, reason: "Not enough available people" };
      }
      nation.population.available -= cost.people;
      nation.population.total -= cost.people;
    } else {
      return { ok: false, reason: "No payment method" };
    }

    // Claim if not already owned.
    if (!tile.owner) {
      this.map.setTileOwner(tile, nation);
    }

    // Remove from owned empty list (if present).
    const idx = nation.tiles.empty.indexOf(tile);
    if (idx >= 0) nation.tiles.empty.splice(idx, 1);

    this._transformTile(tile, tileType, nation);

    this.logArchive(nation, {
      type: "build_tile",
      details: `Built ${tileType} at (${tile.q}, ${tile.r})`,
      cost: payment === "money" ? { money: cost.money } : { people: cost.people },
    });
    this.addEvent(
      `${nation.name} built ${tileType === "military" ? "a military base" : `a ${tileType}`} at (${tile.q}, ${tile.r}).`,
      { nationId: nation.id, kind: "build", tileCoord: { q: tile.q, r: tile.r } }
    );

    this.emit({ type: "state_changed", source: "build_tile", tile });
    if (nation.id === this.playerId && tileType === "farm") this._advanceTutorial("build");
    return { ok: true };
  }

  _transformTile(tile, tileType, nation) {
    this.map.setTileType(tile, tileType);
    tile.workerType = WORKER_FIELD[tileType];
    tile.workers = 0;
    const listKey = TILE_LIST_KEY[tileType];
    if (listKey) nation.tiles[listKey].push(tile);
  }

  _checkResourceCap(nation, tileType) {
    const region = REGION_TYPES[nation.regionType];
    const cap = region?.maxPerResource;
    const listKey = TILE_LIST_KEY[tileType];
    if (!listKey || !Number.isFinite(cap)) return { ok: true };
    if (nation.tiles[listKey].length >= cap) {
      const label = tileType === "military" ? "military bases" : tileType === "factory" ? "factories" : `${tileType}s`;
      return {
        ok: false,
        reason: `${region.name} regions can only use ${cap} ${label}`,
      };
    }
    return { ok: true };
  }

  // ---- Worker assignment ----

  assignWorkers(tile, delta) {
    if (this.isProcessingTurn) {
      return { ok: false, reason: "Wait for the next player turn" };
    }
    return this.assignWorkersForNation(this.player, tile, delta);
  }

  assignWorkersForNation(nation, tile, delta, { silent = false } = {}) {
    if (tile.owner !== nation.id) return { ok: false, reason: "Not your tile" };
    if (!tile.workerType) return { ok: false, reason: "No workers needed here" };
    const field = tile.workerType;

    if (delta > 0) {
      if (nation.population.available < delta) {
        return { ok: false, reason: "Not enough available people" };
      }
      nation.population.available -= delta;
      nation.population[field] += delta;
      tile.workers += delta;
    } else if (delta < 0) {
      const take = Math.min(-delta, tile.workers);
      if (take === 0) return { ok: false, reason: "No workers to remove" };
      tile.workers -= take;
      nation.population[field] -= take;
      nation.population.available += take;
    } else {
      return { ok: true };
    }

    this.logArchive(nation, {
      type: "assign_workers",
      details: `${delta > 0 ? "+" : ""}${delta} ${field} at (${tile.q}, ${tile.r})`,
    });
    if (!silent && delta !== 0) {
      this.addEvent(
        `${nation.name} ${delta > 0 ? "assigned" : "removed"} ${Math.abs(delta)} ${field}.`,
        { nationId: nation.id, kind: "workers" }
      );
    }
    this.emit({ type: "state_changed", source: "assign_workers", tile });
    if (nation.id === this.playerId && delta > 0) this._advanceTutorial("assign");
    return { ok: true };
  }

  recruitSoldiers(amount = 1, targetBase = null) {
    if (this.isProcessingTurn) return { ok: false, reason: "Wait for your turn" };
    const count = Math.max(1, Math.floor(Number(amount) || 1));
    return this.recruitSoldiersForNation(this.player, count, targetBase);
  }

  recruitSoldiersForNation(nation, amount = 1, targetBase = null, { silent = false } = {}) {
    const count = Math.max(1, Math.floor(Number(amount) || 1));
    if (nation.population.available < count) {
      return { ok: false, reason: `Need ${count} available people` };
    }

    if (targetBase) {
      if (targetBase.owner !== nation.id || targetBase.type !== "military") {
        return { ok: false, reason: "Choose one of your military bases" };
      }
      return this.assignWorkersForNation(nation, targetBase, count, { silent });
    }

    const base = nation.tiles.militaryBases
      .filter((tile) => tile.owner === nation.id)
      .sort((a, b) => (a.workers || 0) - (b.workers || 0))[0];
    if (!base) return { ok: false, reason: "Build a military base first" };
    return this.assignWorkersForNation(nation, base, count, { silent });
  }

  // ---- Stage 3: Technology ----

  researchTechnology(techType) {
    if (this.isProcessingTurn) return { ok: false, reason: "Wait for your turn" };
    if (this.stage < STAGES.INDUSTRIAL) return { ok: false, reason: "Technology unlocks in Stage 3" };

    const tech = TECHNOLOGIES[techType];
    if (!tech) return { ok: false, reason: "Unknown technology" };

    const slots = factorySlots(this.player);
    if (slots.available <= 0) {
      return { ok: false, reason: "No available factory slots (build more factories)" };
    }
    if (this.player.money < tech.cost) {
      return { ok: false, reason: `Need $${tech.cost.toLocaleString()} (have $${this.player.money.toLocaleString()})` };
    }

    this.player.money -= tech.cost;
    this.player.technologies[tech.field] += 1;

    let tractorFarm = null;
    if (techType === "tractor") {
      tractorFarm = this.player.tiles.farms.find((t) => !t.hasTractor && isTileActive(t))
        || this.player.tiles.farms.find((t) => !t.hasTractor);
      if (tractorFarm) tractorFarm.hasTractor = true;
    }

    this.logArchive(this.player, {
      type: "technology_researched",
      details: `Researched ${tech.label} for $${tech.cost.toLocaleString()}`,
      cost: { money: tech.cost },
    });
    const tractorNote = tractorFarm
      ? ` Tractor assigned to farm at (${tractorFarm.q}, ${tractorFarm.r}) — now feeds 40.`
      : "";
    this.addEvent(`${this.player.name} researched ${tech.label}.${tractorNote}`, {
      nationId: this.playerId,
      kind: "tech",
      tileCoord: tractorFarm ? { q: tractorFarm.q, r: tractorFarm.r } : null,
    });
    this.emit({ type: "state_changed", source: "tech_researched", techType, tractorFarm });
    return { ok: true, reason: `${tech.label} researched successfully.${tractorNote}` };
  }

  researchTechnologyForNation(nation, techType) {
    const tech = TECHNOLOGIES[techType];
    if (!tech) return { ok: false };
    if (nation.stage < STAGES.INDUSTRIAL) return { ok: false };
    const slots = factorySlots(nation);
    if (slots.available <= 0 || nation.money < tech.cost) return { ok: false };

    nation.money -= tech.cost;
    nation.technologies[tech.field] += 1;

    if (techType === "tractor") {
      const farm = nation.tiles.farms.find((t) => !t.hasTractor && isTileActive(t))
        || nation.tiles.farms.find((t) => !t.hasTractor);
      if (farm) farm.hasTractor = true;
    }

    this.logArchive(nation, {
      type: "technology_researched",
      details: `Researched ${tech.label}`,
    });
    this.addEvent(`${nation.name} researched ${tech.label}.`, {
      nationId: nation.id,
      kind: "tech",
    });
    return { ok: true };
  }

  // ---- Stage 3: Warfare ----

  declareWar(targetId) {
    const check = canDeclareWar(this, targetId);
    if (!check.ok) return check;

    const target = this.nations[targetId];
    if (!this.player.atWarWith.includes(targetId)) this.player.atWarWith.push(targetId);
    if (!target.atWarWith.includes(this.playerId)) target.atWarWith.push(this.playerId);

    this.logArchive(this.player, {
      type: "war_declared",
      details: `Declared war on ${target.name}`,
    });
    this.addEvent(`${this.player.name} declared war on ${target.name}!`, {
      nationId: this.playerId,
      kind: "war",
    });
    this._triggerMutualDefense(targetId, this.playerId);
    this.emit({ type: "state_changed", source: "war_declared", targetId });
    return { ok: true, reason: `War declared on ${target.name}.` };
  }

  _triggerMutualDefense(attackedId, attackerId) {
    for (const alliance of this.alliances) {
      if (!alliance.active || !alliance.terms?.mutualDefense) continue;
      if (!alliance.members.includes(attackedId)) continue;
      for (const memberId of alliance.members) {
        if (memberId === attackedId || memberId === attackerId) continue;
        const defender = this.nations[memberId];
        const attacker = this.nations[attackerId];
        const attacked = this.nations[attackedId];
        if (!defender || !attacker) continue;
        if (defender.atWarWith.includes(attackerId)) continue;
        defender.atWarWith.push(attackerId);
        if (!attacker.atWarWith.includes(memberId)) attacker.atWarWith.push(memberId);
        this.addEvent(
          `${defender.name} honors mutual defense with ${attacked?.name} — now at war with ${attacker.name}!`,
          { nationId: memberId, kind: "war" }
        );
        this.logArchive(defender, {
          type: "war_declared",
          details: `Entered war via mutual defense alliance — fighting ${attacker.name}`,
        });
      }
    }
  }

  getAttackTargets() {
    return getAttackTargets(this, this.player);
  }

  attackEnemyTile(fromBase, targetTile, payment = "money") {
    if (this.isProcessingTurn) return { ok: false, reason: "Wait for your turn" };
    return this._attackTileForNation(this.player, fromBase, targetTile, payment);
  }

  attackEnemyTileForNation(attackerNation, fromBase, targetTile, payment = "money") {
    return this._attackTileForNation(attackerNation, fromBase, targetTile, payment);
  }

  _attackTileForNation(attackerNation, fromBase, targetTile, payment) {
    const defenderNation = this.nations[targetTile.owner];
    if (!defenderNation) return { ok: false, reason: "Tile has no owner" };
    if (!attackerNation.atWarWith.includes(defenderNation.id)) {
      return { ok: false, reason: `Not at war with ${defenderNation.name}` };
    }

    const route = getAttackRoute(this, attackerNation, fromBase, targetTile);
    if (!route.ok) return route;

    if (targetTile.type === "military") {
      return this._resolveMilitaryCombat(fromBase, targetTile, attackerNation, defenderNation, route, payment);
    }
    return this._resolveResourceAttack(fromBase, targetTile, attackerNation, defenderNation, payment, route);
  }

  _payAttackMovement(attackerNation, payment, route) {
    if (!route || route.movementTiles <= 0) return { ok: true, moneyCost: 0, peopleCost: 0 };
    if (payment === "money") {
      if (attackerNation.money < route.movementMoneyCost) {
        return {
          ok: false,
          reason: `Need $${route.movementMoneyCost.toLocaleString()} to move ${route.movementTiles} tile(s)`,
        };
      }
      attackerNation.money -= route.movementMoneyCost;
      return { ok: true, moneyCost: route.movementMoneyCost, peopleCost: 0 };
    }
    if (attackerNation.population.available < route.movementPeopleCost) {
      return {
        ok: false,
        reason: `Need ${route.movementPeopleCost} available people to move ${route.movementTiles} tile(s)`,
      };
    }
    attackerNation.population.available -= route.movementPeopleCost;
    attackerNation.population.total -= route.movementPeopleCost;
    return { ok: true, moneyCost: 0, peopleCost: route.movementPeopleCost };
  }

  _movementPhrase(route) {
    if (!route || route.movementTiles <= 0) return "";
    return route.mode === "naval"
      ? ` via naval operation (${route.movementTiles} tile move)`
      : ` after a ${route.movementTiles}-tile march`;
  }

  _resolveResourceAttack(attackerBase, targetTile, attackerNation, defenderNation, payment, route) {
    const MONEY_COST = 500;
    const PEOPLE_COST = 5;
    const moveMoney = route?.movementMoneyCost || 0;
    const movePeople = route?.movementPeopleCost || 0;

    if (payment === "money") {
      const totalMoney = MONEY_COST + moveMoney;
      if (attackerNation.money < totalMoney) {
        return { ok: false, reason: `Need $${totalMoney.toLocaleString()} to attack (have $${attackerNation.money.toLocaleString()})` };
      }
      attackerNation.money -= totalMoney;
    } else {
      const totalPeople = PEOPLE_COST + movePeople;
      if (attackerNation.population.available < totalPeople) {
        return { ok: false, reason: `Need ${totalPeople} available people to attack` };
      }
      attackerNation.population.available -= totalPeople;
      attackerNation.population.total -= totalPeople;
    }

    const tileType = targetTile.type;
    const tileLabel = TILE_LABELS[tileType] || tileType;
    const coord = `(${targetTile.q}, ${targetTile.r})`;
    const movementPhrase = this._movementPhrase(route);
    this._captureAsEmpty(targetTile, defenderNation, attackerNation);

    const report = {
      ok: true,
      type: "resource_attack",
      attackerWins: true,
      tileType,
      coord,
      attackerName: attackerNation.name,
      defenderName: defenderNation.name,
      tilesDestroyed: 1,
      tilesLost: 0,
      tilesCaptured: 1,
      attackerCasualties: 0,
      defenderCasualties: 0,
      moneyCost: payment === "money" ? MONEY_COST + moveMoney : 0,
      peopleCost: payment === "people" ? PEOPLE_COST + movePeople : 0,
      movementTiles: route?.movementTiles || 0,
      movementMode: route?.mode || "adjacent",
    };

    this.logArchive(attackerNation, {
      type: "combat_resolved",
      details: `Captured ${defenderNation.name}'s ${tileLabel} at ${coord}${movementPhrase}`,
      cost: payment === "money" ? { money: MONEY_COST + moveMoney } : { people: PEOPLE_COST + movePeople },
    });
    this.addEvent(
      `${attackerNation.name} captured ${defenderNation.name}'s ${tileLabel} at ${coord}${movementPhrase}, leaving the land open for rebuilding.`,
      { nationId: attackerNation.id, kind: "war", tileCoord: { q: targetTile.q, r: targetTile.r } }
    );
    this.emit({ type: "state_changed", source: "combat" });
    this.emit({ type: "war_report", report });
    return { ok: true, report };
  }

  _resolveMilitaryCombat(attackerBase, defenderBase, attackerNation, defenderNation, route, payment = "money") {
    const movementPayment = this._payAttackMovement(attackerNation, payment, route);
    if (!movementPayment.ok) return movementPayment;

    const aTanks = attackerNation.technologies.tanks || 0;
    const dTanks = defenderNation.technologies.tanks || 0;
    const aFleets = attackerNation.technologies.tankFleets || 0;
    const dFleets = defenderNation.technologies.tankFleets || 0;
    const aSoldiers = attackerBase.workers || 0;
    const dSoldiers = defenderBase.workers || 0;
    const aStr = militaryStrength(attackerNation, attackerBase);
    const dStr = militaryStrength(defenderNation, defenderBase);
    const result = resolveCombat(aStr, dStr);

    let tilesDestroyed = 0;
    let tilesLost = 0;
    let tilesCaptured = 0;
    let attackerCasualties = 0;
    let defenderCasualties = 0;
    let attackerTanksLost = 0;
    let defenderTanksLost = 0;
    let attackerFleetsLost = 0;
    let defenderFleetsLost = 0;
    let note = "";

    const coord = `(${defenderBase.q}, ${defenderBase.r})`;
    const attackerCoord = `(${attackerBase.q}, ${attackerBase.r})`;
    const movementPhrase = this._movementPhrase(route);

    if (result.attackerWins) {
      // Defender base destroyed
      tilesDestroyed = 1;
      defenderCasualties = dSoldiers;
      defenderTanksLost = dTanks;
      defenderFleetsLost = dFleets;
      defenderNation.technologies.tanks = 0;
      defenderNation.technologies.tankFleets = 0;

      const losses = this._applyMilitarySurvivors(attackerNation, attackerBase, result.remainder, {
        tanksBefore: aTanks,
        fleetsBefore: aFleets,
      });
      attackerCasualties = losses.soldiersLost;
      attackerTanksLost = losses.tanksLost;
      attackerFleetsLost = losses.fleetsLost;

      const holdSoldiers = Math.min(attackerBase.workers || 0, result.remainder);
      // If fewer than 4 surviving soldiers can occupy the base, it cannot be held.
      if (result.remainder < 4 || holdSoldiers < WORKER_MIN.military) {
        this._destroyTile(defenderBase, defenderNation);
        const extra = attackerBase.workers || 0;
        if (extra > 0) {
          attackerNation.population.soldiers = Math.max(0, attackerNation.population.soldiers - extra);
          attackerNation.population.total = Math.max(0, attackerNation.population.total - extra);
          attackerBase.workers = 0;
          attackerCasualties += extra;
        }
        note = "Attacker base disbanded — insufficient forces to hold territory.";
      } else {
        attackerBase.workers -= holdSoldiers;
        this._captureMilitaryBase(defenderBase, defenderNation, attackerNation, holdSoldiers);
        tilesCaptured = 1;
        note = "Enemy base captured and garrisoned by surviving attackers.";
      }
    } else if (result.tied) {
      // Mutual annihilation — equal strength, both bases destroyed
      this._destroyTile(attackerBase, attackerNation);
      this._destroyTile(defenderBase, defenderNation);
      tilesLost = 1;
      tilesDestroyed = 1;
      attackerCasualties = aSoldiers;
      defenderCasualties = dSoldiers;
      attackerTanksLost = aTanks;
      defenderTanksLost = dTanks;
      attackerFleetsLost = aFleets;
      defenderFleetsLost = dFleets;
      attackerNation.technologies.tanks = 0;
      attackerNation.technologies.tankFleets = 0;
      defenderNation.technologies.tanks = 0;
      defenderNation.technologies.tankFleets = 0;
      note = "Equal strength — mutual annihilation. Both forces destroyed.";
    } else {
      // Defender wins — attacker base destroyed
      this._destroyTile(attackerBase, attackerNation);
      tilesLost = 1;
      attackerCasualties = aSoldiers;
      attackerTanksLost = aTanks;
      attackerFleetsLost = aFleets;
      attackerNation.technologies.tanks = 0;
      attackerNation.technologies.tankFleets = 0;

      const losses = this._applyMilitarySurvivors(defenderNation, defenderBase, result.remainder, {
        tanksBefore: dTanks,
        fleetsBefore: dFleets,
      });
      defenderCasualties = losses.soldiersLost;
      defenderTanksLost = losses.tanksLost;
      defenderFleetsLost = losses.fleetsLost;
    }

    const report = {
      ok: true,
      type: "military_combat",
      attackerWins: result.attackerWins,
      tied: result.tied || false,
      attackerName: attackerNation.name,
      defenderName: defenderNation.name,
      aStr, dStr,
      remainder: result.remainder,
      tilesDestroyed,
      tilesLost,
      tilesCaptured,
      attackerCasualties,
      defenderCasualties,
      attackerTanksLost,
      defenderTanksLost,
      attackerFleetsLost,
      defenderFleetsLost,
      moneyCost: movementPayment.moneyCost,
      peopleCost: movementPayment.peopleCost,
      movementTiles: route?.movementTiles || 0,
      movementMode: route?.mode || "adjacent",
      note,
      coord,
    };

    const outcomeLabel = result.tied ? "DRAW" : result.attackerWins ? "VICTORY" : "DEFEAT";
    this.logArchive(attackerNation, {
      type: "combat_resolved",
      details: `Combat from ${attackerCoord} to ${coord}${movementPhrase}: ${aStr} vs ${dStr} -> ${outcomeLabel} (remainder ${result.remainder})`,
      cost: movementPayment.moneyCost > 0
        ? { money: movementPayment.moneyCost }
        : movementPayment.peopleCost > 0
          ? { people: movementPayment.peopleCost }
          : undefined,
    });
    const eventMsg = result.tied
      ? `${attackerNation.name} and ${defenderNation.name} fought to mutual annihilation at ${coord}${movementPhrase}. (${aStr} vs ${dStr})`
      : `${attackerNation.name} ${result.attackerWins ? "defeated" : "was defeated by"} ${defenderNation.name} at ${coord}${movementPhrase}. (${aStr} vs ${dStr})`;
    this.addEvent(eventMsg, { nationId: attackerNation.id, kind: "war", tileCoord: { q: defenderBase.q, r: defenderBase.r } });
    this.emit({ type: "state_changed", source: "combat" });
    this.emit({ type: "war_report", report });
    return { ok: true, report };
  }

  _applyMilitarySurvivors(nation, base, remainingStrength, { tanksBefore, fleetsBefore }) {
    const soldiersBefore = base.workers || 0;
    let remaining = Math.max(0, remainingStrength);

    const survivingSoldiers = Math.min(soldiersBefore, remaining);
    const soldiersLost = soldiersBefore - survivingSoldiers;
    remaining -= survivingSoldiers;
    if (soldiersLost > 0) {
      base.workers = survivingSoldiers;
      nation.population.soldiers = Math.max(0, nation.population.soldiers - soldiersLost);
      nation.population.total = Math.max(0, nation.population.total - soldiersLost);
    }

    const survivingFleets = Math.min(fleetsBefore, Math.floor(remaining / TANK_FLEET_STRENGTH));
    remaining -= survivingFleets * TANK_FLEET_STRENGTH;
    const survivingTanks = Math.min(tanksBefore, Math.floor(remaining / TANK_STRENGTH));

    nation.technologies.tankFleets = survivingFleets;
    nation.technologies.tanks = survivingTanks;

    return {
      soldiersLost,
      tanksLost: tanksBefore - survivingTanks,
      fleetsLost: fleetsBefore - survivingFleets,
    };
  }

  _removeTileFromNation(tile, nation) {
    const listKeys = ["farms", "mines", "schools", "militaryBases", "factories", "empty"];
    for (const key of listKeys) {
      const idx = nation.tiles[key].indexOf(tile);
      if (idx < 0) continue;
      nation.tiles[key].splice(idx, 1);
      if (tile.workers > 0 && tile.workerType) {
        const field = tile.workerType;
        nation.population[field] = Math.max(0, nation.population[field] - tile.workers);
        nation.population.total = Math.max(0, nation.population.total - tile.workers);
      }
      return true;
    }
    return false;
  }

  _captureAsEmpty(tile, defenderNation, attackerNation) {
    this._removeTileFromNation(tile, defenderNation);
    this.map.setTileOwner(tile, attackerNation);
    this.map.setTileType(tile, "empty");
    tile.workers = 0;
    tile.workerType = null;
    tile.hasTractor = false;
    tile.disabledTurns = 0;
    tile.floodedTurns = 0;
    tile.bountifulTurns = 0;
    if (!attackerNation.tiles.empty.includes(tile)) attackerNation.tiles.empty.push(tile);
  }

  _captureMilitaryBase(tile, defenderNation, attackerNation, soldiers) {
    this._removeTileFromNation(tile, defenderNation);
    this.map.setTileOwner(tile, attackerNation);
    this.map.setTileType(tile, "military");
    tile.workerType = WORKER_FIELD.military;
    tile.workers = Math.max(WORKER_MIN.military, Math.floor(soldiers));
    tile.hasTractor = false;
    tile.disabledTurns = 0;
    tile.floodedTurns = 0;
    tile.bountifulTurns = 0;
    if (!attackerNation.tiles.militaryBases.includes(tile)) attackerNation.tiles.militaryBases.push(tile);
  }

  // ---- Stage 4: Fleets ----

  buildFleet(fleetType) {
    if (this.isProcessingTurn) return { ok: false, reason: "Wait for your turn" };
    if (this.stage < STAGES.MODERN) return { ok: false, reason: "Fleets require Stage 4 (Modern Era)" };
    return this._buildFleetForNation(this.player, fleetType, true);
  }

  buildFleetForNation(nation, fleetType) {
    return this._buildFleetForNation(nation, fleetType, false);
  }

  _buildFleetForNation(nation, fleetType, isPlayer) {
    const fleet = FLEET_TYPES[fleetType];
    if (!fleet) return { ok: false, reason: "Unknown fleet type" };
    if (nation.stage < STAGES.MODERN) return { ok: false, reason: "Fleets require Stage 4 (Modern Era)" };

    const slots = factorySlots(nation);
    if (slots.available <= 0) return { ok: false, reason: "No available factory slots (build more factories)" };
    if (nation.money < fleet.cost) {
      return { ok: false, reason: `Need $${fleet.cost.toLocaleString()} (have $${nation.money.toLocaleString()})` };
    }
    for (const [req, amount] of Object.entries(fleet.requires)) {
      if ((nation.technologies[req] || 0) < amount) {
        return { ok: false, reason: `Requires ${amount} ${req}` };
      }
    }

    nation.money -= fleet.cost;
    nation.technologies[fleet.field] = (nation.technologies[fleet.field] || 0) + 1;

    this.logArchive(nation, {
      type: "fleet_built",
      details: `Assembled ${fleet.label} for $${fleet.cost.toLocaleString()}`,
      cost: { money: fleet.cost },
    });
    this.addEvent(`${nation.name} assembled a ${fleet.label}!`, { nationId: nation.id, kind: "fleet" });
    if (isPlayer) this.emit({ type: "state_changed", source: "fleet_built", fleetType });
    return { ok: true, reason: `${fleet.label} assembled successfully.` };
  }

  // ---- Victory conditions ----

  _checkVictory() {
    if (this.gameOver) return this.gameOver;
    if (this.stage < STAGES.MODERN) return null;

    const allNations = Object.values(this.nations);

    // 1. Military victory: only one nation still has military bases
    const withMilitary = allNations.filter((n) => n.tiles.militaryBases.length > 0);
    if (withMilitary.length === 1 && allNations.length > 1) {
      return this._endGame("military", withMilitary[0]);
    }

    // 2. Population victory: 3x everyone else combined
    for (const n of allNations) {
      const others = allNations.filter((o) => o.id !== n.id);
      const othersTotal = others.reduce((s, o) => s + o.population.total, 0);
      if (othersTotal > 0 && n.population.total >= othersTotal * 3) {
        return this._endGame("population", n);
      }
    }

    // 3. Territory victory: 60%+ of all non-water tiles
    const claimable = this.map.tiles.filter((t) =>
      t.type !== TILE_TYPES.WATER && t.type !== TILE_TYPES.UN && t.type !== TILE_TYPES.ISLAND
    ).length;
    if (claimable > 0) {
      for (const n of allNations) {
        const owned = this._ownedTiles(n).length;
        if (owned / claimable >= 0.6) {
          return this._endGame("territory", n);
        }
      }
    }

    // 4. Turn limit
    if (this.turnLimit > 0 && this.turn > this.turnLimit) {
      return this._endGame("score", this._scoredWinner());
    }

    return null;
  }

  _scoredWinner() {
    return Object.values(this.nations).sort((a, b) => {
      const score = (n) =>
        n.money +
        n.population.total * 10 +
        this._ownedTiles(n).length * 100;
      return score(b) - score(a);
    })[0];
  }

  _endGame(victoryType, winner) {
    const awards = computeAwards(this.nations);
    this.gameOver = { victoryType, winner, awards, turn: this.turn };
    const label = { military: "Military", population: "Population", territory: "Territory", score: "Score" }[victoryType] || victoryType;
    this.addEvent(`Game Over! ${winner.name} wins by ${label} Victory!`, { kind: "game_over" });
    this.logArchive(winner, { type: "game_over", details: `Won by ${label} Victory on turn ${this.turn}` });
    this.emit({ type: "game_over", victoryType, winner, awards });
    return this.gameOver;
  }

  _destroyTile(tile, nation) {
    this._removeTileFromNation(tile, nation);
    this.map.setTileOwner(tile, null);
    this.map.setTileType(tile, "empty");
    tile.workers = 0;
    tile.workerType = null;
    tile.hasTractor = false;
    tile.disabledTurns = 0;
    tile.floodedTurns = 0;
    tile.bountifulTurns = 0;
  }

  // ---- Phase 9: tutorial + disaster events ----

  _advanceTutorial(action) {
    if (!this.tutorial || this.tutorial.dismissed || this.tutorial.completed) return;
    const steps = ["build", "assign", "end"];
    if (steps[this.tutorial.step] !== action) return;
    this.tutorial.step += 1;
    if (this.tutorial.step >= steps.length) {
      this.tutorial.completed = true;
      this.logArchive(this.player, {
        type: "tutorial_completed",
        details: "Completed guided tutorial",
      });
      this.addEvent("Tutorial completed. The league is yours to steer.", {
        nationId: this.playerId,
        kind: "tutorial",
      });
    }
    this.emit({ type: "state_changed", source: "tutorial" });
  }

  _rollDisasters() {
    const disasters = [];
    for (const nation of Object.values(this.nations)) {
      if (Math.random() >= DISASTER_CHANCE) continue;
      const disaster = this._applyRandomDisaster(nation);
      if (disaster) disasters.push(disaster);
    }
    return disasters;
  }

  _applyRandomDisaster(nation) {
    const choices = [
      () => this._applyDrought(nation),
      () => this._applyEarthquake(nation),
      () => this._applyPlague(nation),
      () => this._applyFlood(nation),
      () => this._applyBountifulHarvest(nation),
    ];
    const start = Math.floor(Math.random() * choices.length);
    for (let i = 0; i < choices.length; i++) {
      const result = choices[(start + i) % choices.length]();
      if (result) return result;
    }
    return null;
  }

  _applyDrought(nation) {
    const farms = nation.tiles.farms.filter((tile) => (tile.disabledTurns || 0) <= 0);
    const farm = randomItem(farms);
    if (!farm) return null;
    farm.disabledTurns = 2;
    return this._recordDisaster(nation, {
      disasterType: "Drought",
      details: `Drought dried out a farm at (${farm.q}, ${farm.r}); it is inactive for 2 turns.`,
      tileCoord: { q: farm.q, r: farm.r },
    });
  }

  _applyEarthquake(nation) {
    const mine = randomItem(nation.tiles.mines);
    if (!mine) return null;
    const coord = `(${mine.q}, ${mine.r})`;
    const tileCoord = { q: mine.q, r: mine.r };
    this._destroyTile(mine, nation);
    return this._recordDisaster(nation, {
      disasterType: "Earthquake",
      details: `Earthquake destroyed a mine at ${coord}.`,
      tileCoord,
    });
  }

  _applyPlague(nation) {
    if (nation.population.total <= 0) return null;
    const losses = Math.min(nation.population.total, 3 + Math.floor(Math.random() * 6));
    const deathsByField = this._removeRandomPopulation(nation, losses);
    return this._recordDisaster(nation, {
      disasterType: "Plague",
      details: `Plague struck ${nation.name}; ${losses} people were lost.`,
      losses,
      deathsByField,
    });
  }

  _applyFlood(nation) {
    const coastal = this._ownedTiles(nation).filter((tile) => (
      tile.type !== "water" &&
      (tile.floodedTurns || 0) <= 0 &&
      axialNeighbors(tile.q, tile.r).some((n) => this.map.tileAt(n.q, n.r)?.type === "water")
    ));
    const tile = randomItem(coastal);
    if (!tile) return null;
    tile.floodedTurns = 1;
    return this._recordDisaster(nation, {
      disasterType: "Flood",
      details: `Flooding blocked the coastal ${tile.type} at (${tile.q}, ${tile.r}) for 1 turn.`,
      tileCoord: { q: tile.q, r: tile.r },
    });
  }

  _applyBountifulHarvest(nation) {
    const farms = nation.tiles.farms.filter((tile) => (tile.bountifulTurns || 0) <= 0);
    const farm = randomItem(farms);
    if (!farm) return null;
    farm.bountifulTurns = 1;
    return this._recordDisaster(nation, {
      disasterType: "Bountiful Harvest",
      details: `Bountiful harvest at (${farm.q}, ${farm.r}); that farm feeds double next round.`,
      kind: "good_disaster",
      tileCoord: { q: farm.q, r: farm.r },
    });
  }

  _recordDisaster(nation, disaster) {
    const entry = {
      nationId: nation.id,
      nationName: nation.name,
      kind: disaster.kind || "disaster",
      ...disaster,
    };
    this.logArchive(nation, {
      type: "disaster_event",
      details: disaster.details,
    });
    this.addEvent(`${disaster.disasterType}: ${disaster.details}`, {
      nationId: nation.id,
      kind: disaster.kind || "disaster",
      tileCoord: disaster.tileCoord || null,
    });
    return entry;
  }

  _tickTemporaryTileEffects() {
    for (const tile of this.map.tiles) {
      if ((tile.disabledTurns || 0) > 0) tile.disabledTurns -= 1;
      if ((tile.floodedTurns || 0) > 0) tile.floodedTurns -= 1;
      if ((tile.bountifulTurns || 0) > 0) tile.bountifulTurns -= 1;
    }
  }

  _removeRandomPopulation(nation, amount) {
    const deathsByField = {};
    let remaining = amount;
    const fields = ["available", "farmers", "miners", "scholars", "soldiers"];

    while (remaining > 0 && nation.population.total > 0) {
      const candidates = fields.filter((field) => (nation.population[field] || 0) > 0);
      if (!candidates.length) break;
      const field = randomItem(candidates);
      if (field === "available") {
        nation.population.available -= 1;
        nation.population.total -= 1;
      } else {
        const killed = this._killWorkers(nation, field, 1);
        if (killed === 0) continue;
      }
      deathsByField[field] = (deathsByField[field] || 0) + 1;
      remaining -= 1;
    }
    return deathsByField;
  }

  // ---- Turn loop ----

  async endTurn() {
    if (this.isProcessingTurn || this.gameOver) return null;
    this.isProcessingTurn = true;
    this.currentPhase = "bots";
    this.emit({ type: "turn_phase", phase: this.currentPhase });
    this.addEvent(`Turn ${this.turn}: ${this.player.name} ended their turn.`, {
      nationId: this.playerId,
      kind: "turn",
    });

    for (const botId of this.botIds) {
      const bot = this.nations[botId];
      if (!bot) continue;
      this.emit({ type: "bot_thinking", nation: bot });
      this.addEvent(`${bot.name} is planning...`, {
        nationId: bot.id,
        kind: "bot_thinking",
      });
      await this._pause(BOT_TURN_PAUSE_MS);
      runBasicBotTurn(this, bot);
      await this._pause(BOT_TURN_PAUSE_MS);
    }

    const runGrowth = this.turn % this.growthEvery === 0;
    this.currentPhase = "round";
    this.emit({ type: "turn_phase", phase: this.currentPhase });

    const nationSummaries = {};
    for (const nation of Object.values(this.nations)) {
      const starve = this._processStarvation(nation);
      const growth = runGrowth
        ? this._processGrowth(nation)
        : { people: 0, money: 0, breakdown: {} };
      nationSummaries[nation.id] = this._roundSummary(
        nation,
        starve,
        growth,
        runGrowth
      );
    }

    this._tickTemporaryTileEffects();
    const disasters = this._rollDisasters();
    for (const disaster of disasters) {
      if (nationSummaries[disaster.nationId]) {
        nationSummaries[disaster.nationId].disaster = disaster;
      }
    }

    const summary = nationSummaries[this.playerId];
    summary.nations = nationSummaries;
    this.lastSummary = summary;

    const changed = Object.values(nationSummaries).filter(
      (s) => s.deaths || s.gainedPeople || s.gainedMoney
    );
    if (changed.length > 0) {
      this.addEvent(
        `Round processed: ${changed.length} nations changed population or money.`,
        { kind: "round" }
      );
    } else {
      this.addEvent("Round processed: no population or money changes.", {
        kind: "round",
      });
    }

    this.turn += 1;
    const stageUnlocks = this._checkStageProgression();
    if (stageUnlocks.length > 0) {
      this.lastSummary.stageUnlocks = stageUnlocks;
    }
    this._checkPollution();
    this._expireAlliances();

    const victory = this._checkVictory();
    if (victory) {
      this.lastSummary.gameOver = victory;
    }

    this.currentPhase = "player";
    this.isProcessingTurn = false;
    this._advanceTutorial("end");
    this.saveToLocalStorage({ silent: true });

    this.emit({ type: "state_changed", source: "end_turn", summary });
    this.emit({ type: "turn_phase", phase: this.currentPhase });
    return summary;
  }

  _roundSummary(nation, starve, growth, runGrowth) {
    return {
      nationId: nation.id,
      nationName: nation.name,
      turn: this.turn,
      fed: starve.fed,
      needed: starve.needed,
      unfed: starve.unfed,
      deaths: starve.deaths,
      deathsByField: starve.deathsByField,
      grew: runGrowth,
      gainedPeople: growth.people,
      gainedMoney: growth.money,
      breakdown: growth.breakdown,
    };
  }

  _pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Returns array of player stage unlocks that happened this turn.
  // Each nation advances at most one stage per call (one turn = one step, like AoE).
  _checkStageProgression() {
    const playerUnlocks = [];
    for (const nation of Object.values(this.nations)) {
      const unlock = this._checkNationStageProgression(nation);
      if (unlock && nation.id === this.playerId) {
        playerUnlocks.push(unlock);
      }
    }
    return playerUnlocks;
  }

  _checkNationStageProgression(nation) {
    const isPlayer = nation.id === this.playerId;

    if (nation.stage === STAGES.FOUNDATIONAL && qualifiesForTradeEra(this, nation)) {
      nation.stage = STAGES.TRADE;
      nation.stageUnlocks.stage2 = true;
      if (!isPlayer && !nation.government) {
        const byPersonality = { Diplomat: "democracy", Economist: "democracy", Militarist: "dictatorship", Expansionist: "monarchy", Isolationist: "monarchy" };
        nation.government = byPersonality[nation.personality] || "monarchy";
      }
      const unlock = { stage: STAGES.TRADE, name: "Trade Era", details: "Government, alliances, and global trade routes are now available." };
      if (isPlayer) {
        this.logArchive(nation, { type: "stage_unlocked", details: `Stage 2 unlocked on turn ${this.turn}: ${unlock.details}` });
        this.addEvent(`Stage 2 unlocked: ${unlock.details}`, { nationId: nation.id, kind: "stage_unlocked" });
        this.emit({ type: "stage_unlocked", unlock });
      } else {
        this.addEvent(`${nation.name} entered the Trade Era.`, { nationId: nation.id, kind: "stage_unlocked" });
      }
      return unlock;
    }

    if (nation.stage === STAGES.TRADE && qualifiesForIndustrialEra(this, nation)) {
      nation.stage = STAGES.INDUSTRIAL;
      nation.stageUnlocks.stage3 = true;
      const unlock = { stage: STAGES.INDUSTRIAL, name: "Industrial Era", details: "Factories, technologies, and warfare are now available." };
      if (isPlayer) {
        this.logArchive(nation, { type: "stage_unlocked", details: `Stage 3 unlocked on turn ${this.turn}: ${unlock.details}` });
        this.addEvent(`Stage 3 unlocked: ${unlock.details}`, { nationId: nation.id, kind: "stage_unlocked" });
        this.emit({ type: "stage_unlocked", unlock });
      } else {
        this.addEvent(`${nation.name} entered the Industrial Era.`, { nationId: nation.id, kind: "stage_unlocked" });
      }
      return unlock;
    }

    if (nation.stage === STAGES.INDUSTRIAL && qualifiesForIndustrialExpansionEra(this, nation)) {
      nation.stage = STAGES.INDUSTRIAL_EXPANSION;
      nation.stageUnlocks.stage32 = true;
      const revealed = this.map.revealUNTerritories ? this.map.revealUNTerritories() : 0;
      const revealDetails = revealed > 0
        ? ` ${revealed} neutral UN territories have surfaced as resource-rich claimable land.`
        : "";
      const unlock = {
        stage: STAGES.INDUSTRIAL_EXPANSION,
        name: "Industrial Expansion",
        details: `Build costs have escalated. Competition for territory and tech is intensifying.${revealDetails}`,
      };
      if (isPlayer) {
        this.logArchive(nation, { type: "stage_unlocked", details: `Stage 3.2 unlocked on turn ${this.turn}: ${unlock.details}` });
        this.addEvent(`Stage 3.2 unlocked: ${unlock.details}`, { nationId: nation.id, kind: "stage_unlocked" });
        this.emit({ type: "stage_unlocked", unlock });
      } else {
        this.addEvent(
          `${nation.name} entered Industrial Expansion.${revealDetails}`,
          { nationId: nation.id, kind: "stage_unlocked" }
        );
      }
      return unlock;
    }

    if (nation.stage === STAGES.INDUSTRIAL_EXPANSION && qualifiesForModernEra(this, nation)) {
      nation.stage = STAGES.MODERN;
      nation.stageUnlocks.stage4 = true;
      const unlock = { stage: STAGES.MODERN, name: "Modern Era", details: "Military fleets and end-game victory conditions are now active." };
      if (isPlayer) {
        this.logArchive(nation, { type: "stage_unlocked", details: `Stage 4 unlocked on turn ${this.turn}: ${unlock.details}` });
        this.addEvent(`Stage 4 unlocked: ${unlock.details}`, { nationId: nation.id, kind: "stage_unlocked" });
        this.emit({ type: "stage_unlocked", unlock });
      } else {
        this.addEvent(`${nation.name} entered the Modern Era.`, { nationId: nation.id, kind: "stage_unlocked" });
      }
      return unlock;
    }

    return null;
  }

  _checkPollution() {
    for (const alliance of this.alliances) {
      if (!alliance.active) continue;
      const totalFactories = alliance.members.reduce((sum, id) => {
        const n = this.nations[id];
        return sum + (n ? n.tiles.factories.length : 0);
      }, 0);
      if (totalFactories < 6) continue;
      for (const memberId of alliance.members) {
        const n = this.nations[memberId];
        if (!n) continue;
        const requestedDeaths = 15;
        const deathsByField = this._removeRandomPopulation(n, Math.min(requestedDeaths, n.population.total));
        const deaths = Object.values(deathsByField).reduce((sum, count) => sum + count, 0);
        if (deaths <= 0) continue;
        this.addEvent(
          `Pollution warning: ${alliance.name} has ${totalFactories} factories — ${n.name} loses ${deaths} people.`,
          { nationId: memberId, kind: "pollution" }
        );
        this.logArchive(n, {
          type: "pollution_event",
          details: `Lost ${deaths} people due to industrial pollution in ${alliance.name}`,
        });
      }
    }
  }

  _expireAlliances() {
    let changed = false;
    for (const alliance of this.alliances) {
      if (alliance.active && this.turn >= alliance.expiresTurn) {
        alliance.active = false;
        changed = true;
        this.addEvent(`${alliance.name} expired.`, { kind: "alliance_expired" });
      }
    }
    if (changed && this.map.updateAllianceLines) {
      this.map.updateAllianceLines(this.alliances, this.nations);
    }
  }

  _processStarvation(nation) {
    const fed = foodCapacity(nation);
    const needed = nation.population.total;
    const unfed = Math.max(0, needed - fed);
    const deaths = unfed > 0 ? Math.ceil(unfed * 0.1) : 0;
    const deathsByField = {};

    if (deaths > 0) {
      let remaining = deaths;

      // 1) available pool first.
      const fromAvail = Math.min(remaining, nation.population.available);
      nation.population.available -= fromAvail;
      nation.population.total -= fromAvail;
      remaining -= fromAvail;
      if (fromAvail > 0) deathsByField.available = fromAvail;

      // 2) then workers — save farmers for last so we don't deepen the famine.
      const order = ["soldiers", "scholars", "miners", "farmers"];
      for (const field of order) {
        if (remaining <= 0) break;
        const lost = this._killWorkers(nation, field, remaining);
        if (lost > 0) {
          deathsByField[field] = lost;
          remaining -= lost;
        }
      }

      this.logArchive(nation, {
        type: "starvation_event",
        details: `Starvation: fed ${fed}/${needed}, ${deaths} died`,
      });
    }

    return { fed, needed, unfed, deaths, deathsByField };
  }

  _killWorkers(nation, field, max) {
    const listKeys = {
      farmers:  ["farms"],
      miners:   ["mines"],
      scholars: ["schools", "factories"],
      soldiers: ["militaryBases"],
    }[field];
    if (!listKeys) return 0;

    let killed = 0;
    for (const listKey of listKeys) {
      for (const tile of nation.tiles[listKey]) {
        while (killed < max && (tile.workers || 0) > 0) {
          tile.workers -= 1;
          nation.population[field] -= 1;
          nation.population.total -= 1;
          killed += 1;
        }
        if (killed >= max) break;
      }
      if (killed >= max) break;
    }
    return killed;
  }

  _processGrowth(nation) {
    const stage = nation.stage;
    const t = nation.tiles;
    const active = {
      farm: t.farms.filter(isTileActive).length,
      mine: t.mines.filter(isTileActive).length,
      school: t.schools.filter(isTileActive).length,
      military: t.militaryBases.filter(isTileActive).length,
    };

    const breakdown = {};
    let people = 0;
    let money = 0;

    if (stage < 3) {
      // Grouped formula: 4-group first, then 2-group, leftover = 0.
      const groups = {
        farm:     { p4: 4, m4: 400, p2: 2, m2: 200 },
        mine:     { p4: 5, m4: 500, p2: 2, m2: 200 },
        school:   { p4: 5, m4: 500, p2: 2, m2: 200 },
        military: { p4: 6, m4: 600, p2: 2, m2: 200 },
      };
      for (const key of Object.keys(groups)) {
        const c = active[key];
        const g = groups[key];
        const fours = Math.floor(c / 4);
        const twos = Math.floor((c % 4) / 2);
        const pp = fours * g.p4 + twos * g.p2;
        const mm = fours * g.m4 + twos * g.m2;
        if (pp || mm) breakdown[key] = { active: c, people: pp, money: mm };
        people += pp;
        money += mm;
      }
    } else {
      // Stage 3+ simplified: per active tile. Excavator/University give +50% effective count.
      const excavFactor = (nation.technologies.excavators || 0) > 0 ? 1.5 : 1.0;
      const univFactor = (nation.technologies.universities || 0) > 0 ? 1.5 : 1.0;
      const effective = {
        farm:     active.farm,
        mine:     Math.floor(active.mine * excavFactor),
        school:   Math.floor(active.school * univFactor),
        military: active.military,
      };
      const per = {
        farm:     { p: 1, m: 150 },
        mine:     { p: 1, m: 200 },
        school:   { p: 1, m: 200 },
        military: { p: 1, m: 200 },
      };
      for (const key of Object.keys(per)) {
        const c = effective[key];
        const pp = c * per[key].p;
        const mm = c * per[key].m;
        if (pp || mm) breakdown[key] = { active: active[key], effective: c, people: pp, money: mm };
        people += pp;
        money += mm;
      }
    }

    if (people > 0) {
      nation.population.total += people;
      nation.population.available += people;
    }
    if (money > 0) nation.money += money;

    if (people > 0 || money > 0) {
      this.logArchive(nation, {
        type: "population_growth",
        details: `Growth: +${people} people, +$${money}`,
      });
    }

    return { people, money, breakdown };
  }
}

function emptyTileBuckets() {
  return {
    farms: [],
    mines: [],
    schools: [],
    militaryBases: [],
    factories: [],
    empty: [],
  };
}

function startingTileCount(nation) {
  return REGION_TYPES[nation.regionType]?.startTiles || 12;
}

function serializeNation(nation) {
  const { tiles, ...rest } = nation;
  return JSON.parse(JSON.stringify(rest));
}

function restoreNation(savedNation) {
  return {
    ...JSON.parse(JSON.stringify(savedNation)),
    tiles: emptyTileBuckets(),
  };
}

function restoreGameOver(savedGameOver, nations) {
  if (!savedGameOver) return null;
  const winner = nations[savedGameOver.winnerId];
  return {
    victoryType: savedGameOver.victoryType,
    winner,
    awards: computeAwards(nations),
    turn: savedGameOver.turn,
  };
}

function sanitizeSummary(summary) {
  if (!summary) return null;
  const copy = JSON.parse(JSON.stringify(summary, (key, value) => {
    if (key === "gameOver") return undefined;
    return value;
  }));
  return copy;
}

function randomItem(items) {
  if (!items || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}
