import {
  TILE_TYPES,
  WORKER_MIN,
  axialNeighbors,
  hexDistance,
  pairKey,
  tileId,
} from "./utils.js";
import { areAllied, getDiplomacy } from "./trade.js";
import { militaryPower } from "./nation.js";

export function warRecordKey(a, b) {
  return pairKey(a, b);
}

export function areAtWar(game, a, b) {
  return Boolean(game.wars[warRecordKey(a, b)]?.active);
}

export function declareWar(game, attackerId, defenderId, reason = "Strategic conflict") {
  if (game.era < 3) return { ok: false, reason: "War unlocks in Era 3." };
  if (attackerId === defenderId) return { ok: false, reason: "A nation cannot declare war on itself." };
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  if (!attacker?.active || !defender?.active) return { ok: false, reason: "Target is unavailable." };
  if (areAllied(game, attackerId, defenderId)) return { ok: false, reason: "Break the alliance before declaring war." };
  if (areAtWar(game, attackerId, defenderId)) return { ok: false, reason: "War is already active." };
  const cost = 220;
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
  diplomacy.relation = Math.max(0, diplomacy.relation - 28);
  return { ok: true, war: game.wars[key], cost };
}

export function endWar(game, a, b) {
  const war = game.wars[warRecordKey(a, b)];
  if (!war) return null;
  war.active = false;
  const diplomacy = getDiplomacy(game, a, b);
  diplomacy.atWar = false;
  return war;
}

export function activeWarsFor(game, nationId) {
  return Object.values(game.wars).filter((war) => {
    return war.active && (war.attackerId === nationId || war.defenderId === nationId);
  });
}

export function warUpkeep(game, nationId) {
  const wars = activeWarsFor(game, nationId).length;
  const units = game.tiles
    .filter((tile) => tile.ownerId === nationId && tile.unit?.strength > 0)
    .reduce((sum, tile) => sum + tile.unit.strength, 0);
  return wars * 85 + units * 6;
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

export function resolveCombat(game, attackerId, defenderId, attackingStrength, defendingStrength, targetTile) {
  const attacker = game.nations[attackerId];
  const defender = game.nations[defenderId];
  const attackerBranch =
    attacker.tech.branches.tanks * 5 +
    attacker.tech.branches.air * 4 +
    attacker.tech.military * 2;
  const defenderBranch =
    defender.tech.branches.tanks * 4 +
    defender.tech.branches.air * 3 +
    defender.tech.military * 2;
  const capitalDefense = targetTile?.isCapital ? 4 : 0;
  const attack = attackingStrength + attackerBranch;
  const defense = defendingStrength + defenderBranch + capitalDefense;
  const margin = attack - defense;
  const attackerWins = margin > 0;
  const losses = {
    attacker: attackerWins ? Math.max(1, Math.ceil(defense * 0.35)) : Math.max(1, Math.ceil(attackingStrength * 0.8)),
    defender: attackerWins ? Math.max(1, Math.ceil(defendingStrength * 0.8)) : Math.max(1, Math.ceil(attack * 0.35)),
  };
  return {
    attackerWins,
    attack,
    defense,
    margin,
    losses,
    survivingAttackStrength: attackerWins ? Math.max(1, attackingStrength - losses.attacker) : 0,
    survivingDefenseStrength: attackerWins ? 0 : Math.max(1, defendingStrength - losses.defender),
  };
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
  return attackerPower >= Math.max(9, defenderPower * 1.35);
}

export function adjacentOwnedMilitaryBases(game, tile, nationId) {
  return axialNeighbors(tile.q, tile.r)
    .map((coord) => game.tileAt(coord.q, coord.r))
    .filter((neighbor) => neighbor?.ownerId === nationId && neighbor.type === TILE_TYPES.MILITARY);
}
