import { pairKey } from "./utils.js";
import { BALANCE } from "./balance.js";
import { societyRelationModifier } from "./cultureReligion.js";

export const ALLIANCE_TYPES = BALANCE.trade.alliances;

export function createDiplomacyRecord(a, b) {
  return {
    pair: pairKey(a, b),
    relation: 50,
    trades: 0,
    alliances: [],
    atWar: false,
    wars: 0,
    brokenAgreements: 0,
    dependency: {
      [a]: 0,
      [b]: 0,
    },
    embargoes: {},
  };
}

export function getDiplomacy(game, a, b) {
  const key = pairKey(a, b);
  if (isServerAuthoritative(game) && !game.diplomacy[key]) return createDiplomacyRecord(a, b);
  if (!game.diplomacy[key]) game.diplomacy[key] = createDiplomacyRecord(a, b);
  normalizeDiplomacyRecord(game.diplomacy[key], a, b);
  return game.diplomacy[key];
}

export function relationLabel(value) {
  if (value >= 78) return "Trusted";
  if (value >= 60) return "Friendly";
  if (value >= 42) return "Neutral";
  if (value >= 25) return "Tense";
  return "Hostile";
}

export function canUseDiplomacy(game, a, b) {
  if (game.era < 2) return { ok: false, reason: "Diplomacy unlocks in Era 2." };
  if (!game.nations[a] || !game.nations[b]) return { ok: false, reason: "Nation unavailable." };
  if (!game.nations[a].active || !game.nations[b].active) return { ok: false, reason: "Conquered nations cannot negotiate." };
  return { ok: true };
}

export function evaluateTrade(game, fromId, toId, offer, request) {
  const gate = canUseDiplomacy(game, fromId, toId);
  if (!gate.ok) return gate;
  const discoveryGate = requireTradeDiscovery(game, fromId, toId);
  if (!discoveryGate.ok) return discoveryGate;
  const from = game.nations[fromId];
  const to = game.nations[toId];
  const record = getDiplomacy(game, fromId, toId);
  const normalizedOffer = normalizeBundle(offer);
  const normalizedRequest = normalizeBundle(request);
  if (!canPayBundle(from, normalizedOffer)) return { ok: false, reason: `${from.name} cannot afford that offer.` };
  if (!canPayBundle(to, normalizedRequest)) return { ok: false, reason: `${to.name} cannot afford the request.` };

  const offerValue = bundleValueForNation(game, toId, normalizedOffer);
  const requestValue = bundleValueForNation(game, fromId, normalizedRequest);
  const personalityThreshold = tradeThreshold(to.personality);
  const effectiveRelation = Math.max(0, Math.min(100, record.relation + societyRelationModifier(from, to)));
  const relationFactor = 1 - ((effectiveRelation - 50) / BALANCE.trade.relationFactorDivisor);
  const trustBonus = Math.min(BALANCE.trade.maxTrustBonus, record.trades * BALANCE.trade.trustBonusPerTrade);
  const required = requestValue * Math.max(BALANCE.trade.minimumRequiredFactor, personalityThreshold * relationFactor - trustBonus);
  const accepted = requestValue === 0 || offerValue >= required;
  return {
    ok: true,
    accepted,
    offer: normalizedOffer,
    request: normalizedRequest,
    offerValue,
    requestValue,
    required,
    reason: accepted ? "Offer accepted." : `Offer value is short by ${Math.ceil(required - offerValue)}.`,
  };
}

export function applyTrade(game, fromId, toId, offer, request) {
  if (isServerAuthoritative(game)) return serverAuthoritativeRejection();
  const result = evaluateTrade(game, fromId, toId, offer, request);
  const record = getDiplomacy(game, fromId, toId);
  if (!result.ok) return result;
  game.establishDiplomaticContact?.(fromId, toId);
  if (!result.accepted) {
    record.relation = Math.max(0, record.relation - BALANCE.trade.rejectedRelationPenalty);
    return result;
  }
  transferBundle(game.nations[fromId], game.nations[toId], result.offer);
  transferBundle(game.nations[toId], game.nations[fromId], result.request);
  record.trades += 1;
  increaseDependency(record, fromId, BALANCE.trade.dependency.gainPerTrade);
  increaseDependency(record, toId, BALANCE.trade.dependency.gainPerTrade);
  record.relation = Math.min(100, record.relation + BALANCE.trade.acceptedRelationGain);
  game.nations[fromId].stats.tradesAccepted += 1;
  game.nations[toId].stats.tradesAccepted += 1;
  game.trades.push({
    id: `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    turn: game.turn,
    fromId,
    toId,
    offer: result.offer,
    request: result.request,
  });
  const route = ensureTradeRoute(game, fromId, toId, {
    source: "trade",
    tradeValue: result.offerValue + result.requestValue,
  });
  return result;
}

export function proposeAlliance(game, fromId, toId, type = "trade") {
  if (isServerAuthoritative(game)) return serverAuthoritativeRejection();
  const gate = canUseDiplomacy(game, fromId, toId);
  if (!gate.ok) return gate;
  game.establishDiplomaticContact?.(fromId, toId);
  const config = ALLIANCE_TYPES[type] || ALLIANCE_TYPES.trade;
  const from = game.nations[fromId];
  const to = game.nations[toId];
  if (from.money < config.cost) return { ok: false, reason: `Requires $${config.cost}.` };
  const record = getDiplomacy(game, fromId, toId);
  const score =
    record.relation +
    societyRelationModifier(from, to) +
    (to.personality === "economic" ? BALANCE.trade.personalityAllianceBonus.economic : 0) +
    (to.personality === "scientific" && type === "research" ? BALANCE.trade.personalityAllianceBonus.scientificResearch : 0) +
    (to.personality === "aggressive" && type === "military" ? BALANCE.trade.personalityAllianceBonus.aggressiveMilitary : 0);
  const threshold = BALANCE.trade.allianceScoreThreshold;
  from.money -= config.cost;
  from.stats.moneySpent += config.cost;
  if (score < threshold) {
    record.relation = Math.max(0, record.relation - BALANCE.trade.failedAlliancePenalty);
    return { ok: true, accepted: false, reason: `${to.name} rejected the alliance.` };
  }
  const alliance = {
    id: `alliance-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    label: config.label,
    members: [fromId, toId],
    createdTurn: game.turn,
    duration: BALANCE.trade.allianceDurationTurns,
    expiresTurn: game.turn + BALANCE.trade.allianceDurationTurns,
    active: true,
  };
  game.alliances.push(alliance);
  record.alliances.push(alliance.id);
  record.relation = Math.min(100, record.relation + config.relationBoost);
  if (type === "trade") ensureTradeRoute(game, fromId, toId, { source: "alliance", force: true });
  from.stats.alliancesFormed += 1;
  to.stats.alliancesFormed += 1;
  return { ok: true, accepted: true, alliance, reason: `${config.label} formed.` };
}

export function breakAlliance(game, allianceId, breakerId) {
  if (isServerAuthoritative(game)) return serverAuthoritativeRejection();
  const alliance = game.alliances.find((item) => item.id === allianceId && item.active);
  if (!alliance) return { ok: false, reason: "Alliance not found." };
  alliance.active = false;
  for (const partnerId of alliance.members) {
    if (partnerId === breakerId) continue;
    const record = getDiplomacy(game, breakerId, partnerId);
    record.relation = Math.max(0, record.relation - BALANCE.trade.brokenAgreementPenalty);
    record.brokenAgreements += 1;
  }
  return { ok: true, alliance };
}

export function areAllied(game, a, b) {
  return game.alliances.some((alliance) => {
    return alliance.active && alliance.members.includes(a) && alliance.members.includes(b);
  });
}

export function expireAlliances(game) {
  const expired = [];
  for (const alliance of game.alliances) {
    if (alliance.active && game.turn >= alliance.expiresTurn) {
      alliance.active = false;
      expired.push(alliance);
    }
  }
  return expired;
}

export function embargoNation(game, fromId, targetId) {
  if (isServerAuthoritative(game)) return serverAuthoritativeRejection();
  const gate = canUseDiplomacy(game, fromId, targetId);
  if (!gate.ok) return gate;
  game.establishDiplomaticContact?.(fromId, targetId);
  if (fromId === targetId) return { ok: false, reason: "A nation cannot embargo itself." };
  if (isPairAtWar(game, fromId, targetId)) return { ok: false, reason: "War already blocks direct trade." };
  const from = game.nations[fromId];
  const target = game.nations[targetId];
  const config = BALANCE.trade.embargo;
  if (from.money < config.cost) return { ok: false, reason: `Requires $${config.cost}.` };
  const record = getDiplomacy(game, fromId, targetId);
  if ((record.embargoes?.[fromId] || 0) > game.turn) return { ok: false, reason: `${target.name} is already under embargo.` };
  from.money -= config.cost;
  from.stats.moneySpent += config.cost;
  record.embargoes[fromId] = game.turn + config.durationTurns;
  record.relation = Math.max(0, record.relation - config.relationPenalty);
  for (const nation of Object.values(game.nations)) {
    if (!nation.active || nation.id === fromId || nation.id === targetId) continue;
    const other = getDiplomacy(game, fromId, nation.id);
    other.relation = Math.max(0, other.relation - config.globalTrustPenalty);
  }
  const retaliation = getDiplomacy(game, targetId, fromId);
  retaliation.relation = Math.max(0, retaliation.relation - config.retaliationRelationPenalty);
  return {
    ok: true,
    expiresTurn: record.embargoes[fromId],
    reason: `${target.name} is embargoed until turn ${record.embargoes[fromId]}.`,
  };
}

export function processTradeRoutes(game, summary = null) {
  if (isServerAuthoritative(game)) return { processed: [], foodProduced: {} };
  if (!Array.isArray(game.tradeRoutes)) game.tradeRoutes = [];
  cleanupExpiredEmbargoes(game);
  const routeFoodProduced = {};
  const processed = [];
  for (const route of game.tradeRoutes) {
    const [a, b] = route.members || [];
    const nationA = game.nations[a];
    const nationB = game.nations[b];
    if (!nationA?.active || !nationB?.active) {
      removeTradeRoute(game, route, "inactive nation");
      continue;
    }
    const record = getDiplomacy(game, a, b);
    if (record.relation <= BALANCE.trade.routes.removalRelationCutoff) {
      removeTradeRoute(game, route, "relations collapsed");
      continue;
    }
    if (isPairAtWar(game, a, b)) {
      disruptTradeRoute(game, route, "war");
      continue;
    }
    if (route.status === "disrupted" && game.turn < (route.disruptedUntil || 0)) {
      decayRouteDependency(record, route.members);
      continue;
    }
    route.active = true;
    route.status = "active";
    route.disruptedUntil = null;
    const yields = route.members.map((nationId) => {
      const partnerId = route.members.find((id) => id !== nationId);
      return calculateRouteYield(game, route, nationId, partnerId);
    });
    for (const item of yields) {
      applyRouteYield(game, item, summary);
      if (item.resources.food) routeFoodProduced[item.nationId] = (routeFoodProduced[item.nationId] || 0) + item.resources.food;
    }
    for (const memberId of route.members) increaseDependency(record, memberId, BALANCE.trade.dependency.gainPerActiveTurn);
    route.tradeTurns = (route.tradeTurns || 0) + 1;
    route.lastYield = yields;
    route.lastUpdatedTurn = game.turn;
    processed.push(route);
  }
  return { processed, foodProduced: routeFoodProduced };
}

export function projectTradeRouteYield(game, nationId) {
  if (!Array.isArray(game.tradeRoutes)) return { money: 0, food: 0, materials: 0, education: 0, industry: 0 };
  const totals = { money: 0, food: 0, materials: 0, education: 0, industry: 0 };
  for (const route of game.tradeRoutes) {
    if (route.status === "removed" || !route.members?.includes(nationId)) continue;
    const partnerId = route.members.find((id) => id !== nationId);
    if (!partnerId || isPairAtWar(game, nationId, partnerId)) continue;
    if (route.status === "disrupted" && game.turn < (route.disruptedUntil || 0)) continue;
    const projected = calculateRouteYield(game, route, nationId, partnerId);
    totals.money += projected.money;
    for (const resource of BALANCE.trade.pricing.resources) totals[resource] += projected.resources[resource] || 0;
  }
  return totals;
}

export function disruptTradeRoutes(game, a, b, reason = "war") {
  if (isServerAuthoritative(game)) return [];
  if (!Array.isArray(game.tradeRoutes)) return [];
  return game.tradeRoutes
    .filter((route) => route.status !== "removed" && route.members?.includes(a) && route.members?.includes(b))
    .map((route) => disruptTradeRoute(game, route, reason));
}

export function removeTradeRoutesForNation(game, nationId, reason = "inactive nation") {
  if (isServerAuthoritative(game)) return [];
  if (!Array.isArray(game.tradeRoutes)) return [];
  return game.tradeRoutes
    .filter((route) => route.status !== "removed" && route.members?.includes(nationId))
    .map((route) => removeTradeRoute(game, route, reason));
}

export function applyWarDiplomacyPenalty(game, attackerId, defenderId) {
  const direct = getDiplomacy(game, attackerId, defenderId);
  let directPenalty = BALANCE.war.declarationRelationPenalty;
  if (direct.trades > 0 || hasTradeRouteHistory(game, attackerId, defenderId)) directPenalty += BALANCE.war.formerTradePartnerPenalty;
  if (direct.alliances.length > 0) directPenalty += BALANCE.war.formerAlliancePenalty;
  direct.relation = Math.max(0, direct.relation - directPenalty);

  for (const nation of Object.values(game.nations)) {
    if (!nation.active || nation.id === attackerId || nation.id === defenderId) continue;
    const record = getDiplomacy(game, attackerId, nation.id);
    let penalty = BALANCE.war.globalTrustPenalty;
    if (record.trades > 0 || hasTradeRouteHistory(game, attackerId, nation.id)) penalty += BALANCE.war.globalFormerTradePartnerPenalty;
    if (record.alliances.length > 0) penalty += BALANCE.war.globalFormerAlliancePenalty;
    record.relation = Math.max(0, record.relation - penalty);
  }
  return directPenalty;
}

export function resourcePrice(game, nationId, resource) {
  const base = BALANCE.trade.bundleValues[resource] || 0;
  if (!base || !BALANCE.trade.pricing.resources.includes(resource)) return base;
  const nation = game.nations[nationId];
  if (!nation) return base;
  const config = BALANCE.trade.pricing;
  const baseline = Math.max(1, nation.population.total * (config.baselinePerPerson[resource] || 1));
  const stock = Math.max(0, nation.resources[resource] || 0);
  const ratio = stock / baseline;
  if (ratio < 1) {
    const scarcity = Math.min(1, 1 - ratio);
    return base * (1 + scarcity * config.scarcitySensitivity * (config.scarcityMultiplierMax - 1));
  }
  const abundance = Math.min(1, ratio - 1);
  return base * Math.max(config.abundanceMultiplierMin, 1 - abundance * config.abundanceSensitivity);
}

function normalizeBundle(bundle = {}) {
  return {
    money: Math.max(0, Math.floor(Number(bundle.money) || 0)),
    food: Math.max(0, Math.floor(Number(bundle.food) || 0)),
    materials: Math.max(0, Math.floor(Number(bundle.materials) || 0)),
    education: Math.max(0, Math.floor(Number(bundle.education) || 0)),
    industry: Math.max(0, Math.floor(Number(bundle.industry) || 0)),
    people: Math.max(0, Math.floor(Number(bundle.people) || 0)),
  };
}

function bundleValueForNation(game, nationId, bundle) {
  const values = BALANCE.trade.bundleValues;
  return (
    bundle.money * values.money +
    bundle.food * resourcePrice(game, nationId, "food") +
    bundle.materials * resourcePrice(game, nationId, "materials") +
    bundle.education * resourcePrice(game, nationId, "education") +
    bundle.industry * resourcePrice(game, nationId, "industry") +
    bundle.people * values.people
  );
}

function canPayBundle(nation, bundle) {
  if (nation.money < bundle.money) return false;
  if (nation.population.available < bundle.people) return false;
  for (const resource of ["food", "materials", "education", "industry"]) {
    if ((nation.resources[resource] || 0) < bundle[resource]) return false;
  }
  return true;
}

function transferBundle(from, to, bundle) {
  from.money -= bundle.money;
  to.money += bundle.money;
  from.population.available -= bundle.people;
  from.population.total -= bundle.people;
  to.population.available += bundle.people;
  to.population.total += bundle.people;
  for (const resource of ["food", "materials", "education", "industry"]) {
    from.resources[resource] -= bundle[resource];
    to.resources[resource] += bundle[resource];
  }
}

function tradeThreshold(personality) {
  return BALANCE.trade.thresholds[personality] || BALANCE.trade.thresholds.default;
}

function requireTradeDiscovery(game, fromId, toId) {
  if (!game?.settings?.fogOfWarEnabled) return { ok: true };
  if (game?.hasDiscoveredNation?.(fromId, toId)) return { ok: true };
  if (Array.isArray(game?.nations?.[fromId]?.discoveredNations) && game.nations[fromId].discoveredNations.includes(toId)) {
    return { ok: true };
  }
  return { ok: false, reason: "You cannot trade with an undiscovered nation." };
}

function normalizeDiplomacyRecord(record, a, b) {
  record.dependency = record.dependency || {};
  if (!Number.isFinite(record.dependency[a])) record.dependency[a] = 0;
  if (!Number.isFinite(record.dependency[b])) record.dependency[b] = 0;
  record.embargoes = record.embargoes || {};
  if (!Array.isArray(record.alliances)) record.alliances = [];
  if (!Number.isFinite(record.trades)) record.trades = 0;
  if (!Number.isFinite(record.brokenAgreements)) record.brokenAgreements = 0;
}

function ensureTradeRoute(game, a, b, { source = "trade", tradeValue = 0, force = false } = {}) {
  if (!Array.isArray(game.tradeRoutes)) game.tradeRoutes = [];
  const record = getDiplomacy(game, a, b);
  if (!force && tradeValue < BALANCE.trade.routes.creationMinimumValue) return null;
  if (record.relation < BALANCE.trade.routes.relationMinimum) return null;
  let route = game.tradeRoutes.find((item) => item.status !== "removed" && item.members?.includes(a) && item.members?.includes(b));
  if (!route) {
    route = {
      id: `route-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      pair: pairKey(a, b),
      members: [a, b],
      createdTurn: game.turn,
      lastUpdatedTurn: game.turn,
      tradeTurns: 0,
      tradeCount: 0,
      source,
      active: true,
      status: "active",
      disruptedUntil: null,
      removedTurn: null,
      lastYield: [],
      lastShockTurn: null,
    };
    game.tradeRoutes.push(route);
  }
  route.tradeCount = (route.tradeCount || 0) + 1;
  route.lastUpdatedTurn = game.turn;
  route.source = route.source === "alliance" ? route.source : source;
  route.status = route.status === "removed" ? "removed" : "active";
  route.active = route.status === "active";
  return route;
}

function calculateRouteYield(game, route, nationId, partnerId) {
  const nation = game.nations[nationId];
  const partner = game.nations[partnerId];
  const record = getDiplomacy(game, nationId, partnerId);
  const routes = BALANCE.trade.routes;
  const dependency = BALANCE.trade.dependency;
  const relationPressure = (record.relation - routes.relationNeutral) / routes.relationRangeDivisor;
  const relationMultiplier = 1 + relationPressure * routes.relationMultiplierRange;
  const partnerBonus = Math.min(routes.partnerStrengthMaxBonus, strategicStrength(partner) / routes.partnerStrengthDivisor);
  const dependencyBonus = Math.min(dependency.maxRateBonus, (record.dependency[nationId] || 0) * dependency.rateBonusPerPoint);
  const allianceBonus = hasActiveTradeAlliance(game, nationId, partnerId) ? routes.tradeAllianceIncomeBonus : 0;
  const embargo = embargoMultiplierFor(game, nationId);
  const multiplier = Math.max(routes.minimumYieldMultiplier, relationMultiplier + partnerBonus + dependencyBonus + allianceBonus);
  const money = Math.min(routes.maxIncomePerTurn, Math.ceil(routes.baseIncome * multiplier * embargo.income));
  const resource = scarcestResource(game, nationId);
  const scarcityPrice = resourcePrice(game, nationId, resource);
  const basePrice = BALANCE.trade.bundleValues[resource] || 1;
  const resourceScarcity = Math.max(routes.minimumResourceScarcityMultiplier, scarcityPrice / basePrice);
  const resourceBonus = hasActiveTradeAlliance(game, nationId, partnerId) ? routes.tradeAllianceResourceBonus : 0;
  const amount = Math.min(
    routes.maxResourceYield,
    Math.max(0, Math.ceil((routes.baseResourceYield + resourceBonus) * resourceScarcity * embargo.resources))
  );
  return {
    routeId: route.id,
    nationId,
    partnerId,
    money,
    resources: Object.fromEntries(BALANCE.trade.pricing.resources.map((item) => [item, item === resource ? amount : 0])),
  };
}

function applyRouteYield(game, item, summary) {
  const nation = game.nations[item.nationId];
  if (!nation?.active) return;
  nation.money += item.money;
  nation.stats.moneyEarned += item.money;
  if (summary) summary.money += item.money;
  for (const resource of BALANCE.trade.pricing.resources) {
    const amount = item.resources[resource] || 0;
    if (!amount) continue;
    nation.resources[resource] += amount;
    nation.stats.resourcesProduced += amount;
    if (summary) {
      summary[resource] += amount;
      if (resource === "food") summary.foodProduced += amount;
    }
  }
}

function disruptTradeRoute(game, route, reason) {
  if (!route || route.status === "removed") return route;
  if (route.status === "disrupted") {
    const [a, b] = route.members || [];
    decayRouteDependency(getDiplomacy(game, a, b), route.members);
    return route;
  }
  route.active = false;
  route.status = "disrupted";
  route.disruptedTurn = game.turn;
  route.disruptedUntil = game.turn + BALANCE.trade.routes.disruptionTurns;
  route.disruptionReason = reason;
  applyDependencyShock(game, route, reason);
  const [a, b] = route.members || [];
  const record = getDiplomacy(game, a, b);
  decayRouteDependency(record, route.members);
  return route;
}

function removeTradeRoute(game, route, reason) {
  if (!route || route.status === "removed") return route;
  route.active = false;
  route.status = "removed";
  route.removedTurn = game.turn;
  route.removalReason = reason;
  applyDependencyShock(game, route, reason);
  return route;
}

function applyDependencyShock(game, route, reason) {
  if (route.lastShockTurn === game.turn) return;
  const config = BALANCE.trade.dependency;
  const [a, b] = route.members || [];
  const record = getDiplomacy(game, a, b);
  for (const nationId of route.members || []) {
    const dependency = record.dependency[nationId] || 0;
    if (dependency < config.overdependenceThreshold) continue;
    const nation = game.nations[nationId];
    if (!nation?.active) continue;
    const pressure = dependency - config.overdependenceThreshold;
    const moneyLoss = Math.min(nation.money, Math.min(config.maxShockMoney, Math.ceil(pressure * config.shockMoneyPerPoint)));
    nation.money -= moneyLoss;
    nation.stats.moneySpent += moneyLoss;
    const resource = scarcestResource(game, nationId);
    const resourceLoss = Math.min(nation.resources[resource] || 0, Math.ceil(pressure * config.shockResourcePerPoint));
    nation.resources[resource] -= resourceLoss;
    if (game.addEvent) {
      game.addEvent(
        `${nation.name} suffered a trade dependency shock after a route was broken by ${reason}.`,
        { nationId, type: "trade" }
      );
    }
  }
  route.lastShockTurn = game.turn;
}

function increaseDependency(record, nationId, amount) {
  const config = BALANCE.trade.dependency;
  record.dependency[nationId] = Math.min(config.max, (record.dependency[nationId] || 0) + amount);
}

function decayRouteDependency(record, members = []) {
  const config = BALANCE.trade.dependency;
  for (const memberId of members) {
    record.dependency[memberId] = Math.max(0, (record.dependency[memberId] || 0) - config.decayPerInactiveTurn);
  }
}

function scarcestResource(game, nationId) {
  const nation = game.nations[nationId];
  if (!nation) return "food";
  return BALANCE.trade.pricing.resources
    .map((resource) => ({ resource, price: resourcePrice(game, nationId, resource) / (BALANCE.trade.bundleValues[resource] || 1) }))
    .sort((a, b) => b.price - a.price)[0]?.resource || "food";
}

function strategicStrength(nation) {
  if (!nation) return 0;
  const resources = nation.resources || {};
  const weights = BALANCE.trade.routes.partnerStrengthWeights;
  return (
    nation.money * weights.money +
    nation.population.total * weights.population +
    (nation.territory?.length || 0) * weights.territory +
    resources.food * weights.food +
    resources.materials * weights.materials +
    resources.education * weights.education +
    resources.industry * weights.industry
  );
}

function hasActiveTradeAlliance(game, a, b) {
  return game.alliances.some((alliance) => {
    return alliance.active && alliance.type === "trade" && alliance.members.includes(a) && alliance.members.includes(b);
  });
}

function hasTradeRouteHistory(game, a, b) {
  return Array.isArray(game.tradeRoutes) && game.tradeRoutes.some((route) => route.members?.includes(a) && route.members?.includes(b));
}

function embargoMultiplierFor(game, nationId) {
  const activeEmbargoes = activeEmbargoCountAgainst(game, nationId);
  if (!activeEmbargoes) return { income: 1, resources: 1 };
  const config = BALANCE.trade.embargo;
  const incomePenalty = Math.min(config.maxStackedIncomePenalty, activeEmbargoes * config.targetIncomePenalty);
  const resourcePenalty = Math.min(config.maxStackedIncomePenalty, activeEmbargoes * config.targetResourcePenalty);
  return {
    income: Math.max(0, 1 - incomePenalty),
    resources: Math.max(0, 1 - resourcePenalty),
  };
}

function activeEmbargoCountAgainst(game, nationId) {
  let count = 0;
  for (const key of Object.keys(game.diplomacy || {})) {
    if (!key.split("|").includes(nationId)) continue;
    const record = game.diplomacy[key];
    for (const [embargoerId, expiresTurn] of Object.entries(record.embargoes || {})) {
      if (embargoerId !== nationId && expiresTurn > game.turn) count += 1;
    }
  }
  return count;
}

function cleanupExpiredEmbargoes(game) {
  for (const record of Object.values(game.diplomacy || {})) {
    for (const [embargoerId, expiresTurn] of Object.entries(record.embargoes || {})) {
      if (expiresTurn <= game.turn) delete record.embargoes[embargoerId];
    }
  }
}

function isPairAtWar(game, a, b) {
  return Boolean(game.wars?.[pairKey(a, b)]?.active);
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
