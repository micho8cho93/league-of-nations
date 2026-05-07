import {
  TILE_TYPES,
  WORKER_MIN,
  axialNeighbors,
  hexDistance,
  isLand,
  isWaterLike,
  pairKey,
  tileHasMilitaryBase,
  tileId,
} from "./utils.js";
import {
  INFRASTRUCTURE_TYPES,
  advancedNetworkSupport,
  canUseInfrastructureEdge,
  computeNationLogistics,
} from "./infrastructure.js";
import { advancedPenaltyStateForNation } from "./advanced.js";
import { applyWarDiplomacyPenalty, areAllied, disruptTradeRoutes, getDiplomacy } from "./trade.js";
import { militaryPower } from "./nation.js";
import { BALANCE } from "./balance.js";

const UNIT_TYPE_PRIORITY = ["air", "tanks", "naval", "infantry"];

export function normalizeUnitType(type) {
  const value = String(type || "infantry").toLowerCase();
  if (value === "tank") return "tanks";
  if (value === "navy" || value === "fleet") return "naval";
  if (value === "aircraft" || value === "planes" || value === "plane") return "air";
  return BALANCE.unitTypes[value] ? value : "infantry";
}

export function unitTypeConfig(type) {
  const id = normalizeUnitType(type);
  return BALANCE.unitTypes[id] || BALANCE.unitTypes.infantry;
}

export function primaryUnitType(unit) {
  if (!unit?.strength) return "infantry";
  const branches = unit.branches || {};
  if (!Object.keys(branches).length) return normalizeUnitType(unit.branch);
  let best = normalizeUnitType(unit.branch);
  let bestStrength = -1;
  for (const branch of UNIT_TYPE_PRIORITY) {
    const strength = Math.max(0, Number(branches[branch] || 0));
    if (strength > bestStrength || (strength === bestStrength && UNIT_TYPE_PRIORITY.indexOf(branch) < UNIT_TYPE_PRIORITY.indexOf(best))) {
      best = branch;
      bestStrength = strength;
    }
  }
  return bestStrength > 0 ? normalizeUnitType(best) : normalizeUnitType(unit.branch);
}

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
  if (isServerAuthoritative(game)) return { activeWars: 0, exhaustionDelta: 0, mobilizationLevel: 0 };
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
  if (isServerAuthoritative(game)) return;
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
  if (isServerAuthoritative(game)) return serverAuthoritativeRejection();
  if (game.era < 3) return { ok: false, reason: "War unlocks in Era 3." };
  if (attackerId === defenderId) return { ok: false, reason: "A nation cannot declare war on itself." };
  game.establishDiplomaticContact?.(attackerId, defenderId);
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  normalizeWarReadiness(attacker);
  normalizeWarReadiness(defender);
  if (!attacker?.active || !defender?.active) return { ok: false, reason: "Target is unavailable." };
  if (attacker.lockedNeutral || defender.lockedNeutral) return { ok: false, reason: "Neutral countries cannot be entered or interacted with." };
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
  if (isServerAuthoritative(game)) return null;
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
  const nation = isServerAuthoritative(game) ? game.nations[nationId] : normalizeWarReadiness(game.nations[nationId]);
  const units = game.tiles
    .filter((tile) => tile.ownerId === nationId && tile.unit?.strength > 0)
    .reduce((sum, tile) => sum + tile.unit.strength, 0);
  const unitWarPressure = Math.max(1, wars * BALANCE.war.unitActiveWarMultiplier);
  const base = wars * BALANCE.war.upkeepPerWar + units * BALANCE.war.upkeepPerUnitStrength * unitWarPressure;
  return Math.ceil(base * mobilizationConfig(nation).upkeepMultiplier);
}

export function getValidMilitaryActionsFromTile(game, fromTileId, nationId) {
  const from = game.tileById(fromTileId);
  if (!from || from.ownerId !== nationId || !from.unit?.strength) {
    return { fromTileId, nationId, moveTargets: [], attackTargets: [], actions: [] };
  }
  const unitType = primaryUnitType(from.unit);
  const config = unitTypeConfig(unitType);
  const base = {
    fromTileId,
    nationId,
    unitType,
    unitTypeLabel: config.label,
    moveRange: effectiveMoveRange(game, from, nationId, unitType),
    attackRange: config.attackRange,
    moveTargets: [],
    attackTargets: [],
    actions: [],
  };
  if ((game.nations[nationId]?.actionsRemaining || 0) <= 0) return base;
  if (from.unit.movedTurn === game.turn) return base;

  const actions = [];
  const moveTargets = reachableMoveTargets(game, from, nationId, unitType);
  const attackTargets = reachableAttackTargets(game, from, nationId, unitType);

  for (const target of moveTargets) {
    const movementCost = isWaterLike(target) ? BALANCE.costs.troopMovement.water : BALANCE.costs.troopMovement.land;
    if ((game.nations[nationId]?.money || 0) < movementCost) continue;
    const entry = {
      action: "move",
      fromTileId,
      toTileId: target.id,
      label: "Move",
      cost: movementCost,
      unitType,
      unitTypeLabel: config.label,
      range: hexDistance(from, target),
      path: target.path || [from.id, target.id],
      captureOnWin: false,
    };
    actions.push(entry);
    base.moveTargets.push(entry);
  }

  for (const target of attackTargets) {
    const movementCost = isWaterLike(target) ? BALANCE.costs.troopMovement.water : BALANCE.costs.troopMovement.land;
    if ((game.nations[nationId]?.money || 0) < movementCost) continue;
    const distance = hexDistance(from, target);
    const entry = {
      action: "attack",
      fromTileId,
      toTileId: target.id,
      label: "Attack",
      cost: movementCost,
      unitType,
      unitTypeLabel: config.label,
      range: distance,
      path: target.path || [from.id, target.id],
      captureOnWin: Boolean(config.capturesTerritory && distance <= 1),
    };
    actions.push(entry);
    base.attackTargets.push(entry);
  }

  base.actions = actions;
  return base;
}

export function getValidMoveTargets(game, fromTileId, nationId) {
  return getValidMilitaryActionsFromTile(game, fromTileId, nationId).moveTargets;
}

export function getValidAttackTargets(game, fromTileId, nationId) {
  return getValidMilitaryActionsFromTile(game, fromTileId, nationId).attackTargets;
}

export function getAdjacentMilitaryActions(game, fromTileId, nationId) {
  return getValidMilitaryActionsFromTile(game, fromTileId, nationId).actions;
}

export function canEnterTile(game, nationId, tile) {
  if (!tile) return { ok: false, reason: "No tile." };
  if (tile.ownerId && game.nations[tile.ownerId]?.lockedNeutral && tile.ownerId !== nationId) {
    return { ok: false, reason: "Neutral countries cannot be entered or interacted with." };
  }
  if (isWaterLike(tile) && !hasNavalAccess(game.nations[nationId])) {
    return { ok: false, reason: "Water crossing requires naval specialization." };
  }
  if (!tile.ownerId || tile.ownerId === nationId || areAllied(game, nationId, tile.ownerId) || areAtWar(game, nationId, tile.ownerId)) {
    return { ok: true };
  }
  return { ok: false, reason: "Foreign territory requires war or alliance." };
}

export function canUnitEnterTile(game, nationId, tile, unitType = "infantry") {
  const config = unitTypeConfig(unitType);
  if (!tile) return { ok: false, reason: "No tile." };
  if (tile.ownerId && game.nations[tile.ownerId]?.lockedNeutral && tile.ownerId !== nationId) {
    return { ok: false, reason: "Neutral countries cannot be entered or interacted with." };
  }
  if (tile.type === TILE_TYPES.MOUNTAIN) {
    return { ok: false, reason: "Mountains cannot be traversed. Only aircraft can fly over them." };
  }
  if (isWaterLike(tile) && !config.canEnterWater) {
    return { ok: false, reason: `${config.label} cannot enter water.` };
  }
  if (isWaterLike(tile) && !hasNavalAccess(game.nations[nationId])) {
    return { ok: false, reason: "Water crossing requires naval specialization." };
  }
  if (config.coastalOnly && !isWaterLike(tile) && !isCoastalTile(game, tile)) {
    return { ok: false, reason: `${config.label} can only operate on water or coastal tiles.` };
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

export function resolveCombat(game, attackerId, defenderId, attackingStrength, defendingStrength, targetTile, fromTile = null, unitType = "infantry") {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  const combat = BALANCE.war.combat;
  const unitConfig = unitTypeConfig(unitType);
  const attackerReadiness = unitType === "infantry" ? 1 : advancedPenaltyStateForNation(attacker).advancedUnitReadinessModifier;
  const defenderReadiness = unitType === "infantry" ? 1 : advancedPenaltyStateForNation(defender).advancedUnitReadinessModifier;
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
  const baseAttack = (attackingStrength + attackerBranch) * combatEffectivenessMultiplier(attacker) * unitConfig.attackMultiplier * attackerReadiness;
  const baseDefense = (defendingStrength + defenderBranch) * combatEffectivenessMultiplier(defender) * defenderReadiness;
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
      unitType: {
        id: normalizeUnitType(unitType),
        label: unitConfig.label,
        attackMultiplier: unitConfig.attackMultiplier,
        readiness: attackerReadiness,
      },
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
    tileHasMilitaryBase(tile) ||
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
  const base = tileHasMilitaryBase(tile) ? Math.max(tile.workers || 0, WORKER_MIN[TILE_TYPES.MILITARY]) : Math.ceil((tile.workers || 0) / 2);
  return base + (tile.unit?.strength || 0);
}

export function canStrategicallyDeclare(game, attackerId, defenderId) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  if (!attacker?.active || !defender?.active || game.era < 3) return false;
  if (attacker.lockedNeutral || defender.lockedNeutral) return false;
  if (areAtWar(game, attackerId, defenderId) || areAllied(game, attackerId, defenderId)) return false;
  const attackerPower = militaryPower(attacker, game.tiles);
  const defenderPower = militaryPower(defender, game.tiles);
  return attackerPower >= Math.max(BALANCE.war.strategicPowerFloor, defenderPower * BALANCE.war.strategicPowerRatio);
}

export function adjacentOwnedMilitaryBases(game, tile, nationId) {
  return axialNeighbors(tile.q, tile.r)
    .map((coord) => game.tileAt(coord.q, coord.r))
    .filter((neighbor) => neighbor?.ownerId === nationId && tileHasMilitaryBase(neighbor));
}

function reachableMoveTargets(game, from, nationId, unitType) {
  const config = unitTypeConfig(unitType);
  const logistics = computeNationLogistics(game.tiles, game.nations[nationId]);
  const sourceBonus = movementBonusAvailable(logistics, from, unitType);
  if (config.ignoresTerrainForMovement) {
    return game.tiles
      .filter((tile) => tile.id !== from.id && hexDistance(from, tile) <= config.moveRange + sourceBonus)
      .filter((tile) => canMoveDestination(game, from, tile, nationId, unitType))
      .map((tile) => ({ ...tile, path: [from.id, tile.id] }));
  }

  const useEdgeBonus = unitType === "infantry" || unitType === "tanks";
  const maxDistance = config.moveRange + (useEdgeBonus ? 0 : sourceBonus);
  const queue = [{ tile: from, path: [from.id], distance: 0, bonusRemaining: useEdgeBonus ? sourceBonus : 0 }];
  const seen = new Map([[`${from.id}:${useEdgeBonus ? sourceBonus : 0}`, 0]]);
  const targets = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.distance >= maxDistance) continue;
    for (const coord of axialNeighbors(current.tile.q, current.tile.r)) {
      const next = game.tileAt(coord.q, coord.r);
      if (!next) continue;
      const useNetworkEdge = useEdgeBonus && current.bonusRemaining > 0 && canUseInfrastructureEdge(logistics, current.tile.id, next.id, unitType);
      const nextDistance = current.distance + (useNetworkEdge ? 0 : 1);
      const nextBonusRemaining = useNetworkEdge ? current.bonusRemaining - 1 : current.bonusRemaining;
      if (nextDistance > maxDistance) continue;
      const stateKey = `${next.id}:${nextBonusRemaining}`;
      if ((seen.get(stateKey) ?? Infinity) <= nextDistance) continue;
      if (!canUnitEnterTile(game, nationId, next, unitType).ok) continue;
      if (next.ownerId && next.ownerId !== nationId && !areAllied(game, nationId, next.ownerId)) continue;
      const path = [...current.path, next.id];
      seen.set(stateKey, nextDistance);
      if (!next.ownerId || next.ownerId === nationId) targets.push({ ...next, path });
      if (next.ownerId === nationId || areAllied(game, nationId, next.ownerId) || (config.canEnterWater && isWaterLike(next))) {
        queue.push({ tile: next, path, distance: nextDistance, bonusRemaining: nextBonusRemaining });
      }
    }
  }
  return targets;
}

function reachableAttackTargets(game, from, nationId, unitType) {
  const config = unitTypeConfig(unitType);
  return game.tiles
    .filter((tile) => tile.id !== from.id && hexDistance(from, tile) <= config.attackRange)
    .filter((tile) => tile.ownerId && tile.ownerId !== nationId && areAtWar(game, nationId, tile.ownerId))
    .filter((tile) => canUnitAttackTile(game, nationId, tile, unitType))
    .map((tile) => ({ ...tile, path: [from.id, tile.id] }));
}

function canMoveDestination(game, from, tile, nationId, unitType) {
  if (!tile || tile.id === from.id) return false;
  if (!canUnitEnterTile(game, nationId, tile, unitType).ok) return false;
  if (tile.ownerId && tile.ownerId !== nationId) return false;
  if (!tile.ownerId && !isWaterLike(tile) && !bordersNation(game, tile, nationId)) return false;
  return !isWaterLike(tile) || unitTypeConfig(unitType).canEnterWater;
}

function canUnitAttackTile(game, nationId, tile, unitType) {
  const config = unitTypeConfig(unitType);
  if (tile.ownerId && game.nations[tile.ownerId]?.lockedNeutral && tile.ownerId !== nationId) return false;
  if (isWaterLike(tile) && !config.canEnterWater && unitType !== "air") return false;
  if (config.coastalOnly && !isWaterLike(tile) && !isCoastalTile(game, tile)) return false;
  if (unitType === "tanks" && isWaterLike(tile)) return false;
  if (unitType === "infantry" && isWaterLike(tile)) return false;
  return true;
}

function movementBonusAvailable(logistics, from, unitType) {
  if (unitType === "infantry") return logistics.infrastructure.connectedByType[INFRASTRUCTURE_TYPES.ROAD].has(from.id) ? 1 : 0;
  if (unitType === "tanks") return logistics.infrastructure.connectedByType[INFRASTRUCTURE_TYPES.RAIL].has(from.id) && readinessFallback(logistics, unitType) >= 0.8 ? 1 : 0;
  if (unitType === "air" || unitType === "naval") return advancedNetworkSupport(logistics, from.id) && readinessFallback(logistics, unitType) >= 0.8 ? 1 : 0;
  return 0;
}

function readinessFallback(logistics, unitType) {
  const nation = logistics?.nation || null;
  if (!nation || unitType === "infantry") return 1;
  return advancedPenaltyStateForNation(nation).advancedUnitReadinessModifier;
}

function effectiveMoveRange(game, from, nationId, unitType) {
  const config = unitTypeConfig(unitType);
  const logistics = computeNationLogistics(game.tiles, game.nations[nationId]);
  return config.moveRange + movementBonusAvailable(logistics, from, unitType);
}

function isCoastalTile(game, tile) {
  if (!tile || isWaterLike(tile)) return true;
  return axialNeighbors(tile.q, tile.r).some((coord) => isWaterLike(game.tileAt(coord.q, coord.r)));
}

function bordersNation(game, tile, nationId) {
  return axialNeighbors(tile.q, tile.r).some((coord) => game.tileAt(coord.q, coord.r)?.ownerId === nationId);
}

function isServerAuthoritative(game) {
  return Boolean(game?.serverAuthoritative);
}

function serverAuthoritativeRejection() {
  return {
    ok: false,
    reason: "Multiplayer state is server-authoritative. Send an action to the server instead of mutating local state.",
  };
}
