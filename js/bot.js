// Phase 4/7: bot AI. Stage 1-2: conservative. Stage 3: factories, tech, warfare.


const BOT_ARCHETYPES = [
  "Expansionist",
  "Economist",
  "Militarist",
  "Diplomat",
  "Isolationist",
];

function botArchetype(index, seed = 0) {
  return BOT_ARCHETYPES[(index + seed) % BOT_ARCHETYPES.length];
}

function runBasicBotTurn(state, bot) {
  const actions = [];

  // Food first
  const food = foodStatus(bot);
  if (food.fed < food.needed) {
    const farmAction = buildAndStaff(state, bot, "farm", "food shortage");
    if (farmAction) actions.push(farmAction);
  }

  const inactiveFarmAction = staffInactiveTile(state, bot, "farm");
  if (inactiveFarmAction) actions.push(inactiveFarmAction);

  if (actions.length === 0 && bot.stage >= STAGES.TRADE && (bot.stage < STAGES.INDUSTRIAL || factorySlots(bot).available <= 0)) {
    const prepAction = botBuildTowardFactory(state, bot);
    if (prepAction) actions.push(prepAction);
  }

  // Stage 3: handle warfare first (bots at war prioritize attacks)
  if (bot.stage >= 3 && bot.atWarWith.length > 0) {
    const attackAction = botAttack(state, bot);
    if (attackAction) actions.push(attackAction);
  }

  // Stage 3: staff existing factories before spending slots.
  if (bot.stage >= 3 && actions.length === 0) {
    const staffFactory = staffInactiveTile(state, bot, "factory");
    if (staffFactory) actions.push(staffFactory);
  }

  // Stage 3: try to build factories
  if (bot.stage >= 3 && actions.length === 0) {
    if (state.getFactoryRequirement(bot).canBuild) {
      const built = buildAndStaff(state, bot, "factory", "industrial expansion");
      if (built) actions.push(built);
    }
  }

  // Stage 3: research technology
  if (bot.stage >= 3 && actions.length === 0) {
    const slots = factorySlots(bot);
    if (slots.available > 0) {
      const techAction = botResearchTech(state, bot);
      if (techAction) actions.push(techAction);
    }
  }

  // Normal build order
  if (actions.length === 0) {
    const preferred = preferredBuildOrder(bot);
    for (const tileType of preferred) {
      if (tileType === "factory" && bot.stage < 3) continue;
      const built = buildAndStaff(state, bot, tileType, `${bot.personality} priority`);
      if (built) {
        actions.push(built);
        break;
      }
    }
  }

  if (actions.length === 0) {
    const fallback = staffAnyInactiveTile(state, bot);
    if (fallback) actions.push(fallback);
  }

  if (actions.length === 0 && bot.stage >= STAGES.INDUSTRIAL) {
    const reinforce = botReinforceMilitary(state, bot);
    if (reinforce) actions.push(reinforce);
  }

  // Stage 4: assemble fleets
  if (bot.stage >= 4 && actions.length === 0) {
    const fleetAction = botBuildFleet(state, bot);
    if (fleetAction) actions.push(fleetAction);
  }

  // Stage 3: consider declaring war (after all other actions)
  if (bot.stage >= 3 && bot.atWarWith.length === 0) {
    const warAction = botConsiderWar(state, bot);
    if (warAction) actions.push(warAction);
  }

  if (actions.length === 0) {
    actions.push(`${bot.name} saved resources this turn.`);
    state.addEvent(actions[0], { nationId: bot.id, kind: "bot_idle" });
    state.logArchive(bot, {
      type: "bot_idle",
      details: "Saved resources for a future turn",
    });
  }

  return actions;
}

function botBuildTowardFactory(state, bot) {
  const req = state.getFactoryRequirement(bot);
  if (req.canBuild) return null;

  const inactiveMine = staffInactiveTile(state, bot, "mine");
  if (inactiveMine) return inactiveMine;
  const inactiveSchool = staffInactiveTile(state, bot, "school");
  if (inactiveSchool) return inactiveSchool;

  const needMines = req.activeMines < req.requiredMines;
  const needSchools = req.activeSchools < req.requiredSchools;
  if (needMines && (bot.tiles.mines.length <= bot.tiles.schools.length || !needSchools)) {
    return buildAndStaff(state, bot, "mine", "factory preparation");
  }
  if (needSchools) {
    return buildAndStaff(state, bot, "school", "factory preparation");
  }
  if (needMines) {
    return buildAndStaff(state, bot, "mine", "factory preparation");
  }
  return null;
}

function botBuildFleet(state, bot) {
  const priority = {
    Militarist:   ["tankFleet", "navalFleet"],
    Expansionist: ["tankFleet", "navalFleet"],
    Economist:    ["navalFleet", "tankFleet"],
    Diplomat:     ["navalFleet", "tankFleet"],
    Isolationist: ["tankFleet", "navalFleet"],
  };
  const order = priority[bot.personality] || ["tankFleet", "navalFleet"];
  for (const fleetId of order) {
    const result = state.buildFleetForNation(bot, fleetId);
    if (result.ok) {
      const label = FLEET_TYPES[fleetId]?.label || fleetId;
      return `${bot.name} assembled a ${label}.`;
    }
  }
  return null;
}

function botResearchTech(state, bot) {
  const priority = {
    Militarist: ["tank", "excavator", "university", "tractor", "navalShip"],
    Expansionist: ["tractor", "excavator", "tank", "university", "navalShip"],
    Economist: ["excavator", "university", "tractor", "navalShip", "tank"],
    Diplomat: ["university", "tractor", "excavator", "navalShip", "tank"],
    Isolationist: ["tractor", "university", "excavator", "tank", "navalShip"],
  };
  const order = priority[bot.personality] || ["tractor", "excavator", "university", "tank", "navalShip"];

  for (const techId of order) {
    const tech = TECHNOLOGIES[techId];
    if (!tech) continue;
    // Don't double-research tractors/excavators/universities beyond need
    if (techId === "excavator" && (bot.technologies.excavators || 0) >= 1) continue;
    if (techId === "university" && (bot.technologies.universities || 0) >= 1) continue;
    const result = state.researchTechnologyForNation(bot, techId);
    if (result.ok) {
      return `${bot.name} researched ${tech.label}.`;
    }
  }
  return null;
}

function botConsiderWar(state, bot) {
  if (bot.personality === "Isolationist" || bot.personality === "Diplomat") return null;
  if (bot.personality === "Economist") return null;

  const botStr = totalMilitaryStrength(bot);
  if (botStr < 8) return null; // Need minimum force

  const candidates = [...state.botIds, state.playerId].filter(
    (id) => id !== bot.id && !bot.atWarWith.includes(id)
  );

  for (const targetId of candidates) {
    const target = state.nations[targetId];
    if (!target) continue;
    const targetStr = totalMilitaryStrength(target);
    if (botStr >= targetStr * 1.5) {
      if (!bot.atWarWith.includes(targetId)) bot.atWarWith.push(targetId);
      if (!target.atWarWith.includes(bot.id)) target.atWarWith.push(bot.id);
      state.logArchive(bot, { type: "war_declared", details: `Declared war on ${target.name}` });
      state.addEvent(`${bot.name} declared war on ${target.name}!`, { nationId: bot.id, kind: "war" });
      state._triggerMutualDefense(targetId, bot.id);
      state.emit({ type: "state_changed", source: "bot_war_declared", botId: bot.id, targetId });
      return `${bot.name} declared war on ${target.name}!`;
    }
  }
  return null;
}

function botReinforceMilitary(state, bot) {
  if (bot.personality !== "Militarist" && bot.personality !== "Expansionist" && bot.atWarWith.length === 0) {
    return null;
  }
  if (!bot.tiles.militaryBases.length || bot.population.available <= 0) return null;
  const desired = bot.personality === "Militarist" ? 24 : 12;
  if (totalMilitaryStrength(bot) >= desired && bot.atWarWith.length === 0) return null;
  const base = bot.tiles.militaryBases
    .slice()
    .sort((a, b) => (a.workers || 0) - (b.workers || 0))[0];
  const amount = Math.min(bot.population.available, bot.atWarWith.length > 0 ? 8 : 4);
  const result = state.recruitSoldiersForNation(bot, amount, base, { silent: true });
  if (!result.ok) return null;
  const message = `${bot.name} recruited ${amount} soldiers.`;
  state.addEvent(message, { nationId: bot.id, kind: "bot_staff" });
  state.logArchive(bot, {
    type: "bot_recruit_soldiers",
    details: `Recruited ${amount} soldiers to (${base.q}, ${base.r})`,
  });
  return message;
}

function botAttack(state, bot) {
  const targets = getAttackTargets(state, bot);
  if (targets.length === 0) return null;

  // Prioritize resource tiles (not military bases) first to weaken economy
  const resourceTarget = targets.find((t) => t.tile.type !== "military" && t.tile.type !== "water" && t.tile.type !== "empty");
  const militaryTarget = targets.find((t) => t.tile.type === "military");
  const anyTarget = targets[0];

  const chosen = resourceTarget || militaryTarget || anyTarget;
  if (!chosen) return null;

  // Don't attack military base if we'd lose
  if (chosen.tile.type === "military") {
    const aStr = militaryStrength(bot, chosen.fromBase);
    const dStr = militaryStrength(chosen.ownerNation, chosen.tile);
    if (aStr < dStr) {
      // Prefer a resource attack instead
      const res = targets.find((t) => t.tile.type !== "military");
      if (!res) return null;
      return botDoAttack(state, bot, res);
    }
  }

  return botDoAttack(state, bot, chosen);
}

function botDoAttack(state, bot, target) {
  const payment = bot.money >= 500 ? "money"
    : bot.population.available >= 5 ? "people"
    : null;
  if (!payment) return null;

  const tileTypeName = TILE_LABELS[target.tile.type] || target.tile.type;
  const isMilitaryTarget = target.tile.type === "military";
  const result = state.attackEnemyTileForNation(bot, target.fromBase, target.tile, payment);
  if (result && result.ok) {
    const reason = !isMilitaryTarget ? "to weaken economy" : "to destroy defenses";
    return `${bot.name} attacked ${target.ownerNation.name}'s ${tileTypeName} at (${target.tile.q}, ${target.tile.r}) ${reason}.`;
  }
  return null;
}

function foodStatus(nation) {
  const fed = foodCapacity(nation);
  const needed = nation.population.total;
  return { fed, needed, surplus: fed - needed };
}

function preferredBuildOrder(bot) {
  switch (bot.personality) {
    case "Expansionist":
      return ["farm", "mine", "school", "military", "farm"];
    case "Economist":
      return ["mine", "school", "farm", "mine", "school"];
    case "Militarist":
      return ["military", "farm", "mine", "school", "military"];
    case "Diplomat":
      return ["school", "mine", "farm", "school"];
    case "Isolationist":
      return ["farm", "mine", "school", "military"];
    default:
      return ["farm", "mine", "school", "military"];
  }
}

function buildAndStaff(state, bot, tileType, reason) {
  const tile = findBuildTile(state, bot);
  if (!tile) return null;

  const cost = buildCost(bot.stage, tileType);
  const payment = bot.money >= cost.money
    ? "money"
    : cost.people != null && bot.population.available > cost.people + WORKER_MIN[tileType]
      ? "people"
      : null;
  if (!payment) return null;

  const built = state.buildTileForNation(bot, tile, tileType, payment);
  if (!built.ok) return null;

  const min = WORKER_MIN[tileType];
  if (bot.population.available >= min) {
    state.assignWorkersForNation(bot, tile, min, { silent: true });
    state.addEvent(
      `${bot.name} staffed its new ${tileLabel(tileType)} (${reason}).`,
      { nationId: bot.id, kind: "bot_staff" }
    );
  }

  return `${bot.name} built a ${tileLabel(tileType)} (${reason}).`;
}

function staffAnyInactiveTile(state, bot) {
  for (const tileType of ["factory", ...preferredBuildOrder(bot)]) {
    const staffed = staffInactiveTile(state, bot, tileType);
    if (staffed) return staffed;
  }
  return null;
}

function staffInactiveTile(state, bot, tileType) {
  const list = tileList(bot, tileType);
  const tile = list.find((t) => !isTileActive(t));
  if (!tile) return null;

  const need = WORKER_MIN[tileType] - (tile.workers || 0);
  if (need <= 0 || bot.population.available < need) return null;

  const assigned = state.assignWorkersForNation(bot, tile, need, { silent: true });
  if (!assigned.ok) return null;

  const message = `${bot.name} assigned ${need} workers to a ${tileLabel(tileType)}.`;
  state.addEvent(message, { nationId: bot.id, kind: "bot_staff" });
  state.logArchive(bot, {
    type: "bot_assign_workers",
    details: `Assigned ${need} ${WORKER_FIELD[tileType]} to ${tileType} at (${tile.q}, ${tile.r})`,
  });
  return message;
}

function findBuildTile(state, bot) {
  const ownedEmpty = bot.tiles.empty.find((tile) => state.canBuildOn(tile, bot).ok);
  if (ownedEmpty) return ownedEmpty;

  const ownedTiles = [
    ...bot.tiles.farms,
    ...bot.tiles.mines,
    ...bot.tiles.schools,
    ...bot.tiles.militaryBases,
    ...bot.tiles.factories,
    ...bot.tiles.empty,
  ];

  for (const owned of ownedTiles) {
    for (const n of axialNeighbors(owned.q, owned.r)) {
      const tile = state.map.tileAt(n.q, n.r);
      if (tile && state.canBuildOn(tile, bot).ok) return tile;
    }
  }
  return null;
}

function tileList(bot, tileType) {
  switch (tileType) {
    case "farm": return bot.tiles.farms;
    case "mine": return bot.tiles.mines;
    case "school": return bot.tiles.schools;
    case "military": return bot.tiles.militaryBases;
    case "factory": return bot.tiles.factories;
    default: return [];
  }
}

function tileLabel(tileType) {
  return tileType === "military" ? "military base" : tileType;
}
