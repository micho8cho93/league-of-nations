import { TILE_TYPES, WORKER_MIN, pickWeighted, randInt } from "./utils.js";
import { activeTiles, militaryPower } from "./nation.js";
import { canResearch, canResearchBranch } from "./tech.js";
import { applyTrade, getDiplomacy, proposeAlliance } from "./trade.js";
import { canStrategicallyDeclare, declareWar, nearestEnemyTile } from "./war.js";

const PERSONALITY_BUILD_ORDER = {
  Builder: [TILE_TYPES.FARM, TILE_TYPES.MINE, TILE_TYPES.SCHOOL, TILE_TYPES.FACTORY, TILE_TYPES.MILITARY],
  Trader: [TILE_TYPES.FARM, TILE_TYPES.MINE, TILE_TYPES.SCHOOL, TILE_TYPES.FACTORY, TILE_TYPES.MILITARY],
  Scholar: [TILE_TYPES.SCHOOL, TILE_TYPES.FARM, TILE_TYPES.MINE, TILE_TYPES.FACTORY, TILE_TYPES.MILITARY],
  Militarist: [TILE_TYPES.MILITARY, TILE_TYPES.MINE, TILE_TYPES.FARM, TILE_TYPES.FACTORY, TILE_TYPES.SCHOOL],
  Expansionist: [TILE_TYPES.FARM, TILE_TYPES.MILITARY, TILE_TYPES.MINE, TILE_TYPES.SCHOOL, TILE_TYPES.FACTORY],
  Defender: [TILE_TYPES.FARM, TILE_TYPES.MILITARY, TILE_TYPES.SCHOOL, TILE_TYPES.MINE, TILE_TYPES.FACTORY],
};

export async function processBotTurn(game, botId) {
  const bot = game.nations[botId];
  if (!bot?.active || game.gameOver) return;
  game.addEvent(`${bot.name} is planning its turn.`, { nationId: botId, type: "ai" });

  staffCriticalTiles(game, bot);

  if (game.era >= 3 && tryWarAction(game, bot)) return;
  if (tryResearch(game, bot)) return;
  if (game.era >= 4 && tryBranchResearch(game, bot)) return;
  if (game.era >= 2 && tryDiplomacy(game, bot)) return;
  if (tryBuild(game, bot)) return;
  if (tryTrain(game, bot)) return;

  game.addEvent(`${bot.name} conserved money and resources.`, { nationId: bot.id, type: "ai" });
}

function staffCriticalTiles(game, bot) {
  const owned = game.tiles.filter((tile) => tile.ownerId === bot.id);
  const priority = owned
    .filter((tile) => WORKER_MIN[tile.type] && tile.workers < WORKER_MIN[tile.type])
    .sort((a, b) => {
      const aNeed = a.type === TILE_TYPES.FARM ? 0 : a.type === TILE_TYPES.MILITARY ? 1 : 2;
      const bNeed = b.type === TILE_TYPES.FARM ? 0 : b.type === TILE_TYPES.MILITARY ? 1 : 2;
      return aNeed - bNeed;
    });
  for (const tile of priority) {
    const need = WORKER_MIN[tile.type] - tile.workers;
    if (need <= 0 || bot.population.available <= 0) continue;
    game.assignWorkers(tile.id, Math.min(need, bot.population.available), bot.id, { silent: true });
  }
}

function tryResearch(game, bot) {
  const categories = bot.personality === "Scholar"
    ? ["education", "farming", "mining", "military"]
    : bot.personality === "Militarist"
      ? ["military", "mining", "farming", "education"]
      : ["farming", "mining", "education", "military"];
  for (const category of categories) {
    const check = canResearch(game, bot, category);
    if (!check.ok) continue;
    const result = game.research(category, bot.id);
    if (result.ok) {
      game.addEvent(`${bot.name} researched ${category} tier ${bot.tech[category]}.`, { nationId: bot.id, type: "tech" });
      return true;
    }
  }
  return false;
}

function tryBranchResearch(game, bot) {
  const branches = bot.personality === "Militarist" ? ["tanks", "air", "naval"] : ["naval", "air", "tanks"];
  for (const branch of branches) {
    if (!canResearchBranch(game, bot, branch).ok) continue;
    const result = game.researchBranch(branch, bot.id);
    if (result.ok) {
      game.addEvent(`${bot.name} specialized in ${branch}.`, { nationId: bot.id, type: "tech" });
      return true;
    }
  }
  return false;
}

function tryDiplomacy(game, bot) {
  if (game.rng() > 0.35) return false;
  const partners = Object.values(game.nations).filter((nation) => nation.id !== bot.id && nation.active);
  if (!partners.length) return false;
  const partner = partners[randInt(game.rng, 0, partners.length - 1)];
  const relation = getDiplomacy(game, bot.id, partner.id).relation;

  if (relation > 62 && game.rng() < 0.35) {
    const result = proposeAlliance(game, bot.id, partner.id, bot.personality === "Militarist" ? "military" : "trade");
    if (result.ok && result.accepted) {
      game.addEvent(`${bot.name} formed an alliance with ${partner.name}.`, { nationId: bot.id, type: "diplomacy" });
      return true;
    }
  }

  const offer = chooseTradeOffer(bot, game);
  const request = chooseTradeRequest(bot, partner);
  const result = applyTrade(game, bot.id, partner.id, offer, request);
  if (result.ok && result.accepted) {
    game.addEvent(`${bot.name} completed a trade with ${partner.name}.`, { nationId: bot.id, type: "trade" });
    return true;
  }
  return false;
}

function chooseTradeOffer(bot, game) {
  if (bot.money > 900) return { money: 120 };
  if (bot.resources.food > 140) return { food: 40 };
  if (bot.resources.materials > 80) return { materials: 18 };
  return { money: Math.min(80, Math.max(0, bot.money - 250)) };
}

function chooseTradeRequest(bot, partner) {
  if (bot.resources.food < bot.population.total * 0.7) return { food: 32 };
  if (bot.resources.materials < 35) return { materials: 12 };
  if (bot.resources.education < 30) return { education: 10 };
  if (partner.population.available > 6 && bot.population.available < 4) return { people: 1 };
  return { money: 100 };
}

function tryBuild(game, bot) {
  const farms = activeTiles(bot, game.tiles, TILE_TYPES.FARM).length;
  const foodPressure = bot.resources.food < bot.population.total * 0.65;
  const order = foodPressure ? [TILE_TYPES.FARM, ...PERSONALITY_BUILD_ORDER[bot.personality]] : PERSONALITY_BUILD_ORDER[bot.personality];
  for (const type of order) {
    const tile = chooseBuildTile(game, bot, type);
    if (!tile) continue;
    const result = game.buildTile(tile.id, type, bot.id, { silent: true });
    if (result.ok) {
      game.addEvent(`${bot.name} built a ${type}.`, { nationId: bot.id, type: "build", tileId: tile.id });
      if (type === TILE_TYPES.FARM || farms < 2) game.assignWorkers(tile.id, WORKER_MIN[type] || 0, bot.id, { silent: true });
      return true;
    }
  }
  return false;
}

function chooseBuildTile(game, bot, type) {
  const candidates = game.claimableTiles(bot.id).filter((tile) => {
    const check = game.canBuild(tile.id, type, bot.id);
    return check.ok;
  });
  if (!candidates.length) return null;
  const weighted = candidates.map((tile) => {
    let weight = 1;
    if (type === TILE_TYPES.FARM && tile.landform === "continent") weight += 1;
    if (type === TILE_TYPES.MINE && tile.regionId % 2 === 0) weight += 1;
    if (type === TILE_TYPES.SCHOOL && tile.regionId % 3 === 0) weight += 1;
    if (type === TILE_TYPES.MILITARY && game.neighbors(tile.id).some((n) => n.ownerId && n.ownerId !== bot.id)) weight += 3;
    return { value: tile, weight };
  });
  return pickWeighted(weighted, game.rng);
}

function tryTrain(game, bot) {
  if (bot.personality !== "Militarist" && bot.personality !== "Defender" && game.rng() > 0.25) return false;
  const bases = game.tiles.filter((tile) => tile.ownerId === bot.id && tile.type === TILE_TYPES.MILITARY);
  if (!bases.length) return false;
  const base = bases.sort((a, b) => (a.unit?.strength || 0) - (b.unit?.strength || 0))[0];
  const result = game.trainUnit(base.id, 3 + randInt(game.rng, 0, 3), bot.id, { silent: true });
  if (result.ok) {
    game.addEvent(`${bot.name} trained new troops.`, { nationId: bot.id, type: "military", tileId: base.id });
    return true;
  }
  return false;
}

function tryWarAction(game, bot) {
  const enemy = nearestEnemyTile(game, bot.id);
  if (enemy) {
    const result = game.moveUnitToward(enemy.fromTileId, enemy.targetTileId, bot.id, { silent: true });
    if (result.ok) {
      game.addEvent(`${bot.name} advanced against an enemy front.`, { nationId: bot.id, type: "war" });
      return true;
    }
  }

  if (bot.personality !== "Militarist" && bot.personality !== "Expansionist") return false;
  const targets = Object.values(game.nations).filter((nation) => {
    return nation.id !== bot.id && nation.active && canStrategicallyDeclare(game, bot.id, nation.id);
  });
  if (!targets.length || militaryPower(bot, game.tiles) < 12) return false;
  const target = targets.sort((a, b) => militaryPower(a, game.tiles) - militaryPower(b, game.tiles))[0];
  const result = declareWar(game, bot.id, target.id, "AI strategic opportunity");
  if (result.ok) {
    game.addEvent(`${bot.name} declared war on ${target.name}.`, { nationId: bot.id, type: "war" });
    return true;
  }
  return false;
}
