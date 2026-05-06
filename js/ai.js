import { TILE_TYPES, WORKER_MIN, pickWeighted, randInt } from "./utils.js";
import { isAdvancedMode } from "./advanced.js";
import { activeTiles, militaryPower } from "./nation.js";
import { canResearch, canResearchBranch } from "./tech.js";
import { getDiplomacy } from "./trade.js";
import { canStrategicallyDeclare, nearestEnemyTile } from "./war.js";
import { RELIGION_IDS, SOCIETY, normalizeSociety } from "./cultureReligion.js";

// First type in each list is built first each turn (overridden temporarily by food pressure)
const PERSONALITY_BUILD_ORDER = {
  aggressive:  [TILE_TYPES.MILITARY, TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE, TILE_TYPES.FARM, TILE_TYPES.FACTORY, TILE_TYPES.SCHOOL, TILE_TYPES.CITY],
  economic:    [TILE_TYPES.FARM, TILE_TYPES.FISHERY, TILE_TYPES.MINE, TILE_TYPES.MOUNTAIN_MINE, TILE_TYPES.CITY, TILE_TYPES.FACTORY, TILE_TYPES.SCHOOL, TILE_TYPES.MILITARY],
  scientific:  [TILE_TYPES.SCHOOL, TILE_TYPES.UNIVERSITY, TILE_TYPES.FARM, TILE_TYPES.FISHERY, TILE_TYPES.MINE, TILE_TYPES.CITY, TILE_TYPES.FACTORY, TILE_TYPES.MILITARY],
  balanced:    [TILE_TYPES.FARM, TILE_TYPES.FISHERY, TILE_TYPES.MINE, TILE_TYPES.SCHOOL, TILE_TYPES.CITY, TILE_TYPES.FACTORY, TILE_TYPES.MILITARY],
};

export async function processBotTurn(game, botId) {
  const bot = game.nations[botId];
  if (!bot?.active || game.gameOver) return;
  game.addEvent(`${bot.name} is planning its turn.`, { nationId: botId, type: "ai" });

  staffCriticalTiles(game, bot);
  if (trySociety(game, bot)) return;

  // All personalities advance troops when already at war
  if (game.era >= 3 && tryAdvanceTroops(game, bot)) return;

  if (bot.personality === "aggressive") {
    // War-first: declare → build military → train → research → light diplomacy
    if (game.era >= 3 && tryDeclareWar(game, bot)) return;
    if (tryBuild(game, bot)) return;
    if (tryTrain(game, bot)) return;
    if (tryResearch(game, bot)) return;
    if (game.era >= 4 && tryBranchResearch(game, bot)) return;
    if (game.era >= 2 && tryDiplomacy(game, bot)) return;
  } else if (bot.personality === "economic") {
    // Economy-first: build income → trade actively → research → minimal defense
    if (tryBuild(game, bot)) return;
    if (game.era >= 2 && tryDiplomacy(game, bot)) return;
    if (tryResearch(game, bot)) return;
    if (game.era >= 4 && tryBranchResearch(game, bot)) return;
    if (tryTrain(game, bot)) return;
  } else if (bot.personality === "scientific") {
    // Research-first: advance tech → build schools → collaborate → light defense
    if (tryResearch(game, bot)) return;
    if (game.era >= 4 && tryBranchResearch(game, bot)) return;
    if (tryBuild(game, bot)) return;
    if (game.era >= 2 && tryDiplomacy(game, bot)) return;
    if (tryTrain(game, bot)) return;
  } else {
    // Balanced: mixed strategy — original ordering
    if (game.era >= 3 && tryDeclareWar(game, bot)) return;
    if (tryResearch(game, bot)) return;
    if (game.era >= 4 && tryBranchResearch(game, bot)) return;
    if (game.era >= 2 && tryDiplomacy(game, bot)) return;
    if (tryBuild(game, bot)) return;
    if (tryTrain(game, bot)) return;
  }

  game.addEvent(`${bot.name} conserved money and resources.`, { nationId: bot.id, type: "ai" });
}

function trySociety(game, bot) {
  if (game.societyEnabled?.() === false) return false;
  normalizeSociety(bot);
  if (game.era < SOCIETY.unlockEra) return false;
  if (!bot.religion.stateReligionId) {
    const religionId = RELIGION_IDS[Math.abs(hashString(bot.id || bot.name)) % RELIGION_IDS.length];
    return game.chooseReligion(religionId, bot.id).ok;
  }
  const prevalence = bot.religion.prevalence[bot.religion.stateReligionId] || 0;
  if (prevalence >= 70 || bot.money < SOCIETY.promoteCost || game.rng() > 0.18) return false;
  return game.promoteReligion(bot.id).ok;
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
    if (!game.canSpendAction(bot.id).ok) break;
    const need = WORKER_MIN[tile.type] - tile.workers;
    if (need <= 0 || bot.population.available <= 0) continue;
    game.assignWorkers(tile.id, Math.min(need, bot.population.available), bot.id, { silent: true });
  }
}

function tryResearch(game, bot) {
  // Category priority by personality — scientific chases education, aggressive chases military
  const categories =
    bot.personality === "scientific" ? ["education", "infrastructure", "farming", "mining", "military"] :
    bot.personality === "aggressive" ? ["military", "mining", "infrastructure", "farming", "education"] :
    bot.personality === "economic"   ? ["farming", "mining", "infrastructure", "education", "military"] :
    /* balanced */                     ["farming", "mining", "education", "infrastructure", "military"];
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
  // Aggressive tanks-first; scientific prefers air for era speed; others naval/trade routes
  const branches =
    bot.personality === "aggressive" ? ["tanks", "air", "naval"] :
    bot.personality === "scientific" ? ["air", "naval", "tanks"] :
    /* economic / balanced */          ["naval", "air", "tanks"];
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
  // Engagement rate: economic trades eagerly, aggressive rarely bothers
  const diploChance = { aggressive: 0.10, economic: 0.70, scientific: 0.45, balanced: 0.35 };
  if (game.rng() > (diploChance[bot.personality] ?? 0.35)) return false;
  const partners = Object.values(game.nations).filter((nation) => nation.id !== bot.id && nation.active);
  if (!partners.length) return false;
  const partner = partners[randInt(game.rng, 0, partners.length - 1)];
  const relation = getDiplomacy(game, bot.id, partner.id).relation;

  if (relation > 62 && game.rng() < 0.35) {
    // Aggressive seeks military pacts; others prefer trade or research agreements
    const allianceType = bot.personality === "aggressive" ? "military" : "trade";
    const result = game.proposeAlliance(partner.id, allianceType, bot.id);
    if (result.ok && result.accepted) {
      return true;
    }
  }

  const offer = chooseTradeOffer(bot, game);
  const request = chooseTradeRequest(bot, partner);
  const result = game.trade(partner.id, offer, request, bot.id);
  if (result.ok && result.accepted) {
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
  const farms = activeTiles(bot, game.tiles, TILE_TYPES.FARM).length + activeTiles(bot, game.tiles, TILE_TYPES.FISHERY).length;
  const foodPressure = bot.resources.food < bot.population.total * 0.65;
  // Food pressure overrides personality order to prevent famine
  const order = foodPressure ? [TILE_TYPES.FARM, TILE_TYPES.FISHERY, ...PERSONALITY_BUILD_ORDER[bot.personality]] : PERSONALITY_BUILD_ORDER[bot.personality];
  for (const type of order) {
    const tile = chooseBuildTile(game, bot, type);
    if (!tile) continue;
    const result = game.buildTile(tile.id, type, bot.id, { silent: true });
    if (result.ok) {
      game.addEvent(`${bot.name} built a ${type}.`, { nationId: bot.id, type: "build", tileId: tile.id });
      if (type === TILE_TYPES.FARM || type === TILE_TYPES.FISHERY || farms < 2) game.assignWorkers(tile.id, WORKER_MIN[type] || 0, bot.id, { silent: true });
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
  const p = bot.personality;
  const weighted = candidates.map((tile) => {
    let weight = 1;
    if (isAdvancedMode(game)) {
      if (tile.biome === "grassland") weight += 1.2;
      if (tile.biome === "jungle") weight += 1;
      if (tile.biome === "arctic") weight += type === TILE_TYPES.FACTORY || type === TILE_TYPES.MINE ? 1.5 : 0.6;
      if (tile.biome === "desert") weight += type === TILE_TYPES.MILITARY ? 1.1 : 0.5;
    }
    // Farms: continent tiles are more fertile — universal preference
    if (type === TILE_TYPES.FARM && tile.landform === "continent") weight += 1;
    if (type === TILE_TYPES.FISHERY && tile.landform === "sea") weight += 1;
    // Mines: economic bots strongly prioritize resource-rich regions
    if ((type === TILE_TYPES.MINE || type === TILE_TYPES.MOUNTAIN_MINE) && tile.regionId % 2 === 0) weight += (p === "economic" ? 3 : 1);
    // Schools: scientific bots want them anywhere
    if (type === TILE_TYPES.SCHOOL || type === TILE_TYPES.UNIVERSITY) weight += (p === "scientific" ? 3 : 0);
    // Military bases: aggressive bots prefer border tiles for offensive staging
    if (type === TILE_TYPES.MILITARY && game.neighbors(tile.id).some((n) => n.ownerId && n.ownerId !== bot.id)) {
      weight += (p === "aggressive" ? 5 : 3);
    }
    if (type === TILE_TYPES.CITY) {
      if (tile.type === TILE_TYPES.MILITARY) weight += 4;
      if (game.logisticsSummaryFor) {
        const logistics = game.logisticsSummaryFor(bot.id);
        const capital = logistics.infrastructure?.capital;
        if (capital) weight += Math.min(4, Math.max(0, Math.ceil(Math.abs(tile.q - capital.q) + Math.abs(tile.r - capital.r)) / 3));
      }
      if (p === "economic" || p === "balanced") weight += 2;
    }
    // Factories: economic bots prefer tiles adjacent to mines or farms
    if (type === TILE_TYPES.FACTORY && p === "economic") {
      const nearInfra = game.neighbors(tile.id).some((n) => n.ownerId === bot.id &&
        (n.type === TILE_TYPES.MINE || n.type === TILE_TYPES.FARM));
      if (nearInfra) weight += 2;
    }
    return { value: tile, weight };
  });
  return pickWeighted(weighted, game.rng);
}

function tryTrain(game, bot) {
  // Aggressive trains every turn; balanced 25%; economic/scientific 10% for minimal garrison
  const trainChance = { aggressive: 1.0, balanced: 0.25, economic: 0.10, scientific: 0.10 };
  if (game.rng() > (trainChance[bot.personality] ?? 0.25)) return false;
  const bases = game.tiles.filter((tile) => tile.ownerId === bot.id && (tile.hasMilitaryBase || tile.type === TILE_TYPES.MILITARY || tile.type === TILE_TYPES.CITY || tile.type === TILE_TYPES.CAPITAL_CITY));
  if (!bases.length) return false;
  const base = bases.sort((a, b) => (a.unit?.strength || 0) - (b.unit?.strength || 0))[0];
  // Aggressive trains larger units to project power faster
  const strength = bot.personality === "aggressive" ? 4 + randInt(game.rng, 0, 3) : 3 + randInt(game.rng, 0, 3);
  const result = game.trainUnit(base.id, strength, bot.id, { silent: true });
  if (result.ok) {
    game.addEvent(`${bot.name} trained new troops.`, { nationId: bot.id, type: "military", tileId: base.id });
    return true;
  }
  return false;
}

function tryAdvanceTroops(game, bot) {
  // All personalities push their troops when at war — no sitting still
  const enemy = nearestEnemyTile(game, bot.id);
  if (!enemy) return false;
  const result = game.moveUnitToward(enemy.fromTileId, enemy.targetTileId, bot.id, { silent: true });
  if (result.ok) {
    game.addEvent(`${bot.name} advanced against an enemy front.`, { nationId: bot.id, type: "war" });
    return true;
  }
  return false;
}

function tryDeclareWar(game, bot) {
  // Aggressive declares eagerly at power >= 8; balanced more cautiously at >= 12 with random gate
  const threshold = bot.personality === "aggressive" ? 8 : 12;
  if (militaryPower(bot, game.tiles) < threshold) return false;
  if (bot.personality === "balanced" && game.rng() > 0.40) return false;
  const targets = Object.values(game.nations).filter((nation) =>
    nation.id !== bot.id && nation.active && canStrategicallyDeclare(game, bot.id, nation.id)
  );
  if (!targets.length) return false;
  // Always target the weakest available opponent
  const target = targets.sort((a, b) => militaryPower(a, game.tiles) - militaryPower(b, game.tiles))[0];
  const result = game.declareWar(target.id, bot.id, "AI strategic opportunity");
  if (result.ok) {
    return true;
  }
  return false;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < String(value).length; i += 1) {
    hash = ((hash << 5) - hash + String(value).charCodeAt(i)) | 0;
  }
  return hash;
}
