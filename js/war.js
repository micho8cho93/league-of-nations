import {
  TILE_TYPES,
  WORKER_MIN,
  axialNeighbors,
  hexDistance,
  isLand,
  pairKey,
  tileId,
} from "./utils.js";
import { applyWarDiplomacyPenalty, areAllied, disruptTradeRoutes, getDiplomacy } from "./trade.js";
import { militaryPower } from "./nation.js";
import { BALANCE } from "./balance.js";

export function warRecordKey(a, b) {
  return pairKey(a, b);
}

export function areAtWar(game, a, b) {
  return Boolean(game.wars[warRecordKey(a, b)]?.active);
}

export function normalizeWarReadiness(nation) {
  if (!nation) return null;
  nation.warExhaustion = clampWarExhaustion(nation.warExhaustion);
  nation.mobilizationLevel = clampMobilizationLevel(nation.mobilizationLevel);
  return nation;
}

export function setMobilizationLevel(nation, level) {
  if (!nation) return 0;
  normalizeWarReadiness(nation);
  nation.mobilizationLevel = clampMobilizationLevel(level);
  return nation.mobilizationLevel;
}

export function syncMobilizationForWarStatus(game, nationId) {
  const nation = normalizeWarReadiness(game.nations[nationId]);
  if (!nation?.active) return 0;
  const activeWarCount = activeWarsFor(game, nationId).length;
  const mobilization = BALANCE.war.mobilization;
  if (activeWarCount <= 0) {
    nation.mobilizationLevel = mobilization.peacetimeLevel;
    return nation.mobilizationLevel;
  }
  const minimumLevel =
    activeWarCount >= mobilization.fullMobilizationWarThreshold
      ? mobilization.maxLevel
      : mobilization.defaultAtWarLevel;
  nation.mobilizationLevel = Math.max(nation.mobilizationLevel, minimumLevel);
  return nation.mobilizationLevel;
}

export function updateWarReadinessForTurn(game, nationId) {
  const nation = normalizeWarReadiness(game.nations[nationId]);
  if (!nation?.active) return { activeWars: 0, exhaustionDelta: 0, mobilizationLevel: 0 };
  const activeWarCount = activeWarsFor(game, nationId).length;
  const exhaustion = BALANCE.war.exhaustion;
  const before = nation.warExhaustion;
  syncMobilizationForWarStatus(game, nationId);
  if (activeWarCount > 0) {
    const growth =
      (exhaustion.baseGrowthPerTurn + activeWarCount * exhaustion.perActiveWarGrowth) *
      mobilizationConfig(nation).exhaustionGrowthMultiplier;
    nation.warExhaustion = clampWarExhaustion(nation.warExhaustion + growth);
  } else {
    nation.warExhaustion = clampWarExhaustion(nation.warExhaustion - exhaustion.peaceRecoveryPerTurn);
  }
  return {
    activeWars: activeWarCount,
    exhaustionDelta: nation.warExhaustion - before,
    mobilizationLevel: nation.mobilizationLevel,
  };
}

export function applyBattleWarExhaustion(game, attackerId, defenderId, losses, attackerWins) {
  const attacker = normalizeWarReadiness(game.nations[attackerId]);
  const defender = normalizeWarReadiness(game.nations[defenderId]);
  const exhaustion = BALANCE.war.exhaustion;
  if (attacker?.active) {
    const multiplier = attackerWins ? exhaustion.winnerLossMultiplier : exhaustion.loserLossMultiplier;
    attacker.warExhaustion = clampWarExhaustion(
      attacker.warExhaustion + losses.attacker * exhaustion.battleLossPerUnit * multiplier * mobilizationConfig(attacker).exhaustionGrowthMultiplier
    );
  }
  if (defender?.active) {
    const multiplier = attackerWins ? exhaustion.loserLossMultiplier : exhaustion.winnerLossMultiplier;
    defender.warExhaustion = clampWarExhaustion(
      defender.warExhaustion + losses.defender * exhaustion.battleLossPerUnit * multiplier * mobilizationConfig(defender).exhaustionGrowthMultiplier
    );
  }
}

export function applyWarExhaustionProduction(nation, amount) {
  return Math.max(0, Math.ceil(amount * warExhaustionPenaltyMultiplier(nation, "production")));
}

export function applyWarExhaustionIncome(nation, amount) {
  return Math.max(0, Math.ceil(amount * warExhaustionPenaltyMultiplier(nation, "income")));
}

export function combatEffectivenessMultiplier(nation) {
  normalizeWarReadiness(nation);
  return mobilizationConfig(nation).effectivenessMultiplier * warExhaustionPenaltyMultiplier(nation, "combat");
}

export function declareWar(game, attackerId, defenderId, reason = "Strategic conflict") {
  if (game.era < 3) return { ok: false, reason: "War unlocks in Era 3." };
  if (attackerId === defenderId) return { ok: false, reason: "A nation cannot declare war on itself." };
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  normalizeWarReadiness(attacker);
  normalizeWarReadiness(defender);
  if (!attacker?.active || !defender?.active) return { ok: false, reason: "Target is unavailable." };
  if (areAllied(game, attackerId, defenderId)) return { ok: false, reason: "Break the alliance before declaring war." };
  if (areAtWar(game, attackerId, defenderId)) return { ok: false, reason: "War is already active." };
  const cost = BALANCE.war.declarationCost;
  if (attacker.money < cost) return { ok: false, reason: `Requires $${cost} to mobilize.` };
  attacker.money -= cost;
  attacker.stats.moneySpent += cost;
  attacker.stats.warsDeclared += 1;
  const key = warRecordKey(attackerId, defenderId);
  game.wars[key] = {
    key,
    attackerId,
    defenderId,
    reason,
    active: true,
    startedTurn: game.turn,
    battles: 0,
  };
  const diplomacy = getDiplomacy(game, attackerId, defenderId);
  diplomacy.atWar = true;
  diplomacy.wars += 1;
  applyWarDiplomacyPenalty(game, attackerId, defenderId);
  disruptTradeRoutes(game, attackerId, defenderId, "war");
  syncMobilizationForWarStatus(game, attackerId);
  syncMobilizationForWarStatus(game, defenderId);
  return { ok: true, war: game.wars[key], cost };
}

export function endWar(game, a, b) {
  const war = game.wars[warRecordKey(a, b)];
  if (!war) return null;
  war.active = false;
  const diplomacy = getDiplomacy(game, a, b);
  diplomacy.atWar = false;
  syncMobilizationForWarStatus(game, a);
  syncMobilizationForWarStatus(game, b);
  return war;
}

export function activeWarsFor(game, nationId) {
  return Object.values(game.wars).filter((war) => {
    return war.active && (war.attackerId === nationId || war.defenderId === nationId);
  });
}

export function warUpkeep(game, nationId) {
  const wars = activeWarsFor(game, nationId).length;
  if (wars <= 0) return 0;
  const nation = normalizeWarReadiness(game.nations[nationId]);
  const units = game.tiles
    .filter((tile) => tile.ownerId === nationId && tile.unit?.strength > 0)
    .reduce((sum, tile) => sum + tile.unit.strength, 0);
  const unitWarPressure = Math.max(1, wars * BALANCE.war.unitActiveWarMultiplier);
  const base = wars * BALANCE.war.upkeepPerWar + units * BALANCE.war.upkeepPerUnitStrength * unitWarPressure;
  return Math.ceil(base * mobilizationConfig(nation).upkeepMultiplier);
}

export function getAdjacentMilitaryActions(game, fromTileId, nationId) {
  const from = game.tileById(fromTileId);
  if (!from || from.ownerId !== nationId || !from.unit?.strength) return [];
  const actions = [];
  for (const coord of axialNeighbors(from.q, from.r)) {
    const target = game.tileAt(coord.q, coord.r);
    if (!target) continue;
    const pass = canEnterTile(game, nationId, target);
    if (!pass.ok) continue;
    let action = "move";
    if (target.ownerId && target.ownerId !== nationId) action = areAtWar(game, nationId, target.ownerId) ? "attack" : "blocked";
    if (action === "blocked") continue;
    actions.push({ action, fromTileId, toTileId: target.id, label: target.ownerId ? "Attack" : "Move" });
  }
  return actions;
}

export function canEnterTile(game, nationId, tile) {
  if (!tile) return { ok: false, reason: "No tile." };
  if (tile.type === TILE_TYPES.WATER && !hasNavalAccess(game.nations[nationId])) {
    return { ok: false, reason: "Water crossing requires naval specialization." };
  }
  if (!tile.ownerId || tile.ownerId === nationId || areAllied(game, nationId, tile.ownerId) || areAtWar(game, nationId, tile.ownerId)) {
    return { ok: true };
  }
  return { ok: false, reason: "Foreign territory requires war or alliance." };
}

export function hasNavalAccess(nation) {
  return (nation?.tech?.branches?.naval || 0) > 0;
}

export function findPath(game, fromTileId, toTileId, nationId, limit = 24) {
  const start = game.tileById(fromTileId);
  const goal = game.tileById(toTileId);
  if (!start || !goal) return [];
  const queue = [{ tile: start, path: [start.id] }];
  const seen = new Set([start.id]);
  while (queue.length) {
    const current = queue.shift();
    if (current.tile.id === goal.id) return current.path;
    if (current.path.length > limit) continue;
    for (const coord of axialNeighbors(current.tile.q, current.tile.r)) {
      const next = game.tileAt(coord.q, coord.r);
      if (!next || seen.has(next.id)) continue;
      const canEnter = next.id === goal.id ? canEnterTile(game, nationId, next).ok : canEnterTile(game, nationId, next).ok && (!next.ownerId || next.ownerId === nationId || areAllied(game, nationId, next.ownerId));
      if (!canEnter) continue;
      seen.add(next.id);
      queue.push({ tile: next, path: [...current.path, next.id] });
    }
  }
  return [];
}

export function nearestEnemyTile(game, nationId) {
  const owned = game.tiles.filter((tile) => tile.ownerId === nationId && tile.unit?.strength > 0);
  let best = null;
  let bestDistance = Infinity;
  for (const from of owned) {
    for (const target of game.tiles) {
      if (!target.ownerId || target.ownerId === nationId) continue;
      if (!areAtWar(game, nationId, target.ownerId)) continue;
      const distance = hexDistance(from, target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { fromTileId: from.id, targetTileId: target.id, distance };
      }
    }
  }
  return best;
}

export function resolveCombat(game, attackerId, defenderId, attackingStrength, defendingStrength, targetTile, fromTile = null) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  const combat = BALANCE.war.combat;
  const attackerBranch =
    attacker.tech.branches.tanks * combat.attackerTankPower +
    attacker.tech.branches.air * combat.attackerAirPower +
    attacker.tech.military * combat.militaryTechPower;
  const defenderBranch =
    defender.tech.branches.tanks * combat.defenderTankPower +
    defender.tech.branches.air * combat.defenderAirPower +
    defender.tech.military * combat.militaryTechPower;
  const supply = attackSupplyModifier(game, attackerId, targetTile, fromTile);
  const tileDefense = tileDefenseModifier(targetTile);
  const baseAttack = (attackingStrength + attackerBranch) * combatEffectivenessMultiplier(attacker);
  const baseDefense = (defendingStrength + defenderBranch) * combatEffectivenessMultiplier(defender);
  const attack = baseAttack * supply.multiplier;
  const defense = baseDefense * tileDefense.multiplier + tileDefense.flatBonus;
  const margin = attack - defense;
  const attackerWins = margin > 0;
  const losses = {
    attacker: attackerWins ? Math.max(1, Math.ceil(defense * combat.winnerLossRate)) : Math.max(1, Math.ceil(attackingStrength * combat.loserLossRate)),
    defender: attackerWins ? Math.max(1, Math.ceil(defendingStrength * combat.loserLossRate)) : Math.max(1, Math.ceil(attack * combat.winnerLossRate)),
  };
  return {
    attackerWins,
    attack,
    defense,
    margin,
    losses,
    modifiers: {
      supply,
      tileDefense,
      baseAttack,
      baseDefense,
    },
    survivingAttackStrength: attackerWins ? Math.max(1, attackingStrength - losses.attacker) : 0,
    survivingDefenseStrength: attackerWins ? 0 : Math.max(1, defendingStrength - losses.defender),
  };
}

export function attackSupplyModifier(game, attackerId, targetTile, fromTile = null) {
  const config = BALANCE.war.supply;
  if (!game || !targetTile) {
    return {
      multiplier: 1,
      nearbyOwned: 0,
      nearbyAllied: 0,
      nearestAnchorDistance: null,
      distancePenalty: 0,
      nearbyBonus: 0,
    };
  }

  let nearbyOwned = 0;
  let nearbyAllied = 0;
  let nearestAnchorDistance = Infinity;

  for (const tile of game.tiles) {
    if (!isSupplyTile(game, tile, attackerId)) continue;
    const distance = hexDistance(tile, targetTile);
    if (distance <= config.nearbyRadius) {
      if (tile.ownerId === attackerId) nearbyOwned += 1;
      else nearbyAllied += 1;
    }
    if (isSupplyAnchor(tile, config)) nearestAnchorDistance = Math.min(nearestAnchorDistance, distance);
  }

  if (fromTile && isSupplyTile(game, fromTile, attackerId)) {
    nearestAnchorDistance = Math.min(nearestAnchorDistance, hexDistance(fromTile, targetTile) + config.anchorDistancePenaltyStart);
  }

  const anchorDistance = Number.isFinite(nearestAnchorDistance) ? nearestAnchorDistance : config.anchorDistancePenaltyStart;
  const distancePenalty = Math.min(
    config.maxDistancePenalty,
    Math.max(0, anchorDistance - config.anchorDistancePenaltyStart) * config.penaltyPerAnchorDistance
  );
  const nearbyBonus = Math.min(
    config.maxNearbyBonus,
    nearbyOwned * config.ownedNearbyBonus + nearbyAllied * config.alliedNearbyBonus
  );
  const multiplier = Math.max(
    config.minimumMultiplier,
    Math.min(config.maximumMultiplier, 1 - distancePenalty + nearbyBonus)
  );

  return {
    multiplier,
    nearbyOwned,
    nearbyAllied,
    nearestAnchorDistance: anchorDistance,
    distancePenalty,
    nearbyBonus,
  };
}

export function tileDefenseModifier(tile) {
  const config = BALANCE.war.defense;
  const modifier = {
    multiplier: 1,
    flatBonus: 0,
    reasons: [],
  };
  if (!tile) return modifier;

  if (tile.isCapital) {
    modifier.multiplier += config.capital.multiplierBonus;
    modifier.flatBonus += config.capital.flatBonus;
    modifier.reasons.push("capital");
  }
  if (config.developed.types.includes(tile.type)) {
    modifier.multiplier += config.developed.multiplierBonus;
    modifier.flatBonus += config.developed.flatBonus;
    modifier.reasons.push("developed");
  }
  if (config.highValue.types.includes(tile.type)) {
    modifier.multiplier += config.highValue.multiplierBonus;
    modifier.flatBonus += config.highValue.flatBonus;
    modifier.reasons.push("highValue");
  }

  const terrain = config.terrain[tile.terrain];
  if (terrain) {
    modifier.multiplier += terrain.multiplierBonus || 0;
    modifier.flatBonus += terrain.flatBonus || 0;
    modifier.reasons.push(`terrain:${tile.terrain}`);
  }
  const landform = config.landform[tile.landform];
  if (landform) {
    modifier.multiplier += landform.multiplierBonus || 0;
    modifier.flatBonus += landform.flatBonus || 0;
    modifier.reasons.push(`landform:${tile.landform}`);
  }

  return modifier;
}

export function siegeRequirementForTile(tile) {
  const config = BALANCE.war.siege;
  if (!tile || !isLand(tile)) return 0;
  if (tile.isCapital) return config.capitalRequiredProgress;
  if (config.highValueTypes.includes(tile.type)) return config.highValueRequiredProgress;
  return 0;
}

function isSupplyTile(game, tile, nationId) {
  return Boolean(
    tile &&
    isLand(tile) &&
    tile.ownerId &&
    (tile.ownerId === nationId || areAllied(game, nationId, tile.ownerId))
  );
}

function isSupplyAnchor(tile, config) {
  return Boolean(
    tile?.isCapital ||
    config.anchorTypes.includes(tile?.type)
  );
}

function mobilizationConfig(nation) {
  const mobilization = BALANCE.war.mobilization;
  const level = clampMobilizationLevel(nation?.mobilizationLevel);
  return mobilization.levels[level] || mobilization.levels[mobilization.peacetimeLevel];
}

function warExhaustionPenaltyMultiplier(nation, kind) {
  normalizeWarReadiness(nation);
  const config = BALANCE.war.exhaustion;
  const threshold = config[`${kind}PenaltyThreshold`];
  const maxPenalty = config[`${kind}MaxPenalty`];
  if (!threshold || !maxPenalty || nation.warExhaustion <= threshold) return 1;
  const pressure = (nation.warExhaustion - threshold) / Math.max(1, config.max - threshold);
  return Math.max(0, 1 - maxPenalty * Math.min(1, pressure));
}

function clampWarExhaustion(value) {
  const config = BALANCE.war.exhaustion;
  const numeric = Number.isFinite(value) ? value : config.min;
  return Math.max(config.min, Math.min(config.max, numeric));
}

function clampMobilizationLevel(value) {
  const config = BALANCE.war.mobilization;
  const numeric = Number.isFinite(value) ? Math.round(value) : config.peacetimeLevel;
  return Math.max(config.minLevel, Math.min(config.maxLevel, numeric));
}

export function defenderStrength(tile) {
  if (!tile) return 0;
  const base = tile.type === TILE_TYPES.MILITARY ? Math.max(tile.workers || 0, WORKER_MIN[TILE_TYPES.MILITARY]) : Math.ceil((tile.workers || 0) / 2);
  return base + (tile.unit?.strength || 0);
}

export function canStrategicallyDeclare(game, attackerId, defenderId) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  if (!attacker?.active || !defender?.active || game.era < 3) return false;
  if (areAtWar(game, attackerId, defenderId) || areAllied(game, attackerId, defenderId)) return false;
  const attackerPower = militaryPower(attacker, game.tiles);
  const defenderPower = militaryPower(defender, game.tiles);
  return attackerPower >= Math.max(BALANCE.war.strategicPowerFloor, defenderPower * BALANCE.war.strategicPowerRatio);
}

export function adjacentOwnedMilitaryBases(game, tile, nationId) {
  return axialNeighbors(tile.q, tile.r)
    .map((coord) => game.tileAt(coord.q, coord.r))
    .filter((neighbor) => neighbor?.ownerId === nationId && neighbor.type === TILE_TYPES.MILITARY);
}
