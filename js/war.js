// Phase 7: Warfare system. Stage 3+. Pure logic — no direct state mutation here.

const MILITARY_MOVE_MAX_DISTANCE = 4;
const NAVAL_ATTACK_RANGE = 4;
const MILITARY_MOVE_MONEY_PER_TILE = 100;
const MILITARY_MOVE_PEOPLE_PER_TILE = 1;


function militaryStrength(nation, base) {
  const soldiers = base ? (base.workers || 0) : 0;
  const tankBonus = (nation.technologies.tanks || 0) * TANK_STRENGTH;
  const fleetBonus = (nation.technologies.tankFleets || 0) * TANK_FLEET_STRENGTH;
  return soldiers + tankBonus + fleetBonus;
}

function totalMilitaryStrength(nation) {
  const soldiers = nation.tiles.militaryBases.reduce((s, b) => s + (b.workers || 0), 0);
  const tankBonus = (nation.technologies.tanks || 0) * TANK_STRENGTH;
  const fleetBonus = (nation.technologies.tankFleets || 0) * TANK_FLEET_STRENGTH;
  return soldiers + tankBonus + fleetBonus;
}

function resolveCombat(attackerStr, defenderStr) {
  const diff = attackerStr - defenderStr;
  if (diff > 0) return { attackerWins: true,  defenderWins: false, tied: false, remainder: diff };
  if (diff === 0) return { attackerWins: false, defenderWins: false, tied: true,  remainder: 0 };
  return { attackerWins: false, defenderWins: true,  tied: false, remainder: Math.abs(diff) };
}

function getAttackTargets(state, attackerNation) {
  const targets = [];
  const seen = new Set();

  for (const base of attackerNation.tiles.militaryBases) {
    if (militaryStrength(attackerNation, base) <= 0) continue;
    for (const tile of state.map.tiles) {
      if (!tile.owner || !attackerNation.atWarWith.includes(tile.owner)) continue;
      if (tile.type === TILE_TYPES.EMPTY) continue;
      const route = getAttackRoute(state, attackerNation, base, tile);
      if (!route.ok) continue;
      const key = `${base.q},${base.r}:${tile.q},${tile.r}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        tile,
        fromBase: base,
        ownerNation: state.nations[tile.owner],
        route,
      });
    }
  }
  return targets;
}

function getAttackRoute(state, attackerNation, fromBase, targetTile) {
  if (!fromBase || !targetTile) return { ok: false, reason: "Choose a base and target" };
  if (fromBase.owner !== attackerNation.id) return { ok: false, reason: "Base is not yours" };
  if (fromBase.type !== TILE_TYPES.MILITARY) return { ok: false, reason: "Attacks require a military base" };
  if (militaryStrength(attackerNation, fromBase) <= 0) return { ok: false, reason: "Base has no attacking strength" };
  if (!targetTile.owner || !attackerNation.atWarWith.includes(targetTile.owner)) {
    return { ok: false, reason: "Target is not a wartime enemy" };
  }
  if (targetTile.type === TILE_TYPES.EMPTY) return { ok: false, reason: "Cannot attack undeveloped land" };
  if (isWaterTile(targetTile)) return { ok: false, reason: "Cannot attack water" };

  const landDistance = findLandAttackDistance(state, attackerNation, fromBase, targetTile);
  if (landDistance != null) return attackRoute("land", landDistance);

  const navalDistance = findNavalAttackDistance(state, attackerNation, fromBase, targetTile);
  if (navalDistance != null) return attackRoute("naval", navalDistance);

  return { ok: false, reason: "Target is out of movement range" };
}

function attackRoute(mode, distance) {
  const movementTiles = Math.max(0, distance - 1);
  return {
    ok: true,
    mode: movementTiles === 0 ? "adjacent" : mode,
    distance,
    movementTiles,
    movementMoneyCost: movementTiles * MILITARY_MOVE_MONEY_PER_TILE,
    movementPeopleCost: movementTiles * MILITARY_MOVE_PEOPLE_PER_TILE,
  };
}

function findLandAttackDistance(state, attackerNation, fromBase, targetTile) {
  if (hexDistance(fromBase, targetTile) > MILITARY_MOVE_MAX_DISTANCE) return null;
  const targetKey = `${targetTile.q},${targetTile.r}`;
  const queue = [{ tile: fromBase, distance: 0 }];
  const seen = new Set([`${fromBase.q},${fromBase.r}`]);

  while (queue.length) {
    const current = queue.shift();
    if (current.distance >= MILITARY_MOVE_MAX_DISTANCE) continue;
    for (const n of axialNeighbors(current.tile.q, current.tile.r)) {
      const tile = state.map.tileAt(n.q, n.r);
      if (!tile) continue;
      const key = `${tile.q},${tile.r}`;
      if (seen.has(key)) continue;
      if (key === targetKey) return current.distance + 1;
      if (!isLandPassableForAttack(tile, attackerNation)) continue;
      seen.add(key);
      queue.push({ tile, distance: current.distance + 1 });
    }
  }
  return null;
}

function isLandPassableForAttack(tile, attackerNation) {
  if (isWaterTile(tile)) return false;
  if (tile.owner && attackerNation.atWarWith.includes(tile.owner)) return false;
  return true;
}

function findNavalAttackDistance(state, attackerNation, fromBase, targetTile) {
  if ((attackerNation.technologies.navalFleets || 0) <= 0) return null;
  if (hexDistance(fromBase, targetTile) > NAVAL_ATTACK_RANGE) return null;
  const startWaters = waterNeighbors(state, fromBase);
  const targetWaterKeys = new Set(waterNeighbors(state, targetTile).map((tile) => `${tile.q},${tile.r}`));
  if (!startWaters.length || !targetWaterKeys.size) return null;

  const queue = startWaters.map((tile) => ({ tile, distance: 1 }));
  const seen = new Set(queue.map(({ tile }) => `${tile.q},${tile.r}`));
  while (queue.length) {
    const current = queue.shift();
    const key = `${current.tile.q},${current.tile.r}`;
    if (targetWaterKeys.has(key)) return Math.max(2, current.distance + 1);
    if (current.distance >= NAVAL_ATTACK_RANGE - 1) continue;
    for (const n of axialNeighbors(current.tile.q, current.tile.r)) {
      const tile = state.map.tileAt(n.q, n.r);
      if (!tile || !isWaterTile(tile)) continue;
      const nextKey = `${tile.q},${tile.r}`;
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push({ tile, distance: current.distance + 1 });
    }
  }
  return null;
}

function waterNeighbors(state, tile) {
  return axialNeighbors(tile.q, tile.r)
    .map((n) => state.map.tileAt(n.q, n.r))
    .filter((t) => t && isWaterTile(t));
}

function isWaterTile(tile) {
  return tile.type === TILE_TYPES.WATER || tile.type === TILE_TYPES.UN || tile.type === TILE_TYPES.ISLAND;
}

function canDeclareWar(state, targetId) {
  if (state.stage < 3) return { ok: false, reason: "Warfare unlocks in Stage 3" };
  if (state.isProcessingTurn) return { ok: false, reason: "Wait for your turn" };
  const target = state.nations[targetId];
  if (!target || targetId === state.playerId) {
    return { ok: false, reason: "Invalid target" };
  }
  if (state.player.atWarWith.includes(targetId)) {
    return { ok: false, reason: `Already at war with ${target.name}` };
  }
  return { ok: true };
}
