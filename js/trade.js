import { pairKey } from "./utils.js";

export const ALLIANCE_TYPES = {
  trade: {
    label: "Trade Alliance",
    cost: 120,
    relationBoost: 10,
  },
  military: {
    label: "Military Alliance",
    cost: 180,
    relationBoost: 8,
  },
  research: {
    label: "Research Pact",
    cost: 160,
    relationBoost: 12,
  },
};

export function createDiplomacyRecord(a, b) {
  return {
    pair: pairKey(a, b),
    relation: 50,
    trades: 0,
    alliances: [],
    atWar: false,
    wars: 0,
    brokenAgreements: 0,
  };
}

export function getDiplomacy(game, a, b) {
  const key = pairKey(a, b);
  if (!game.diplomacy[key]) game.diplomacy[key] = createDiplomacyRecord(a, b);
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
  const from = game.nations[fromId];
  const to = game.nations[toId];
  const record = getDiplomacy(game, fromId, toId);
  const normalizedOffer = normalizeBundle(offer);
  const normalizedRequest = normalizeBundle(request);
  if (!canPayBundle(from, normalizedOffer)) return { ok: false, reason: `${from.name} cannot afford that offer.` };
  if (!canPayBundle(to, normalizedRequest)) return { ok: false, reason: `${to.name} cannot afford the request.` };

  const offerValue = bundleValue(normalizedOffer);
  const requestValue = bundleValue(normalizedRequest);
  const personalityThreshold = tradeThreshold(to.personality);
  const relationFactor = 1 - ((record.relation - 50) / 420);
  const trustBonus = Math.min(0.16, record.trades * 0.025);
  const required = requestValue * Math.max(0.68, personalityThreshold * relationFactor - trustBonus);
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
  const result = evaluateTrade(game, fromId, toId, offer, request);
  const record = getDiplomacy(game, fromId, toId);
  if (!result.ok) return result;
  if (!result.accepted) {
    record.relation = Math.max(0, record.relation - 4);
    return result;
  }
  transferBundle(game.nations[fromId], game.nations[toId], result.offer);
  transferBundle(game.nations[toId], game.nations[fromId], result.request);
  record.trades += 1;
  record.relation = Math.min(100, record.relation + 7);
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
  return result;
}

export function proposeAlliance(game, fromId, toId, type = "trade") {
  const gate = canUseDiplomacy(game, fromId, toId);
  if (!gate.ok) return gate;
  const config = ALLIANCE_TYPES[type] || ALLIANCE_TYPES.trade;
  const from = game.nations[fromId];
  const to = game.nations[toId];
  if (from.money < config.cost) return { ok: false, reason: `Requires $${config.cost}.` };
  const record = getDiplomacy(game, fromId, toId);
  const score =
    record.relation +
    (to.personality === "Trader" ? 14 : 0) +
    (to.personality === "Scholar" && type === "research" ? 12 : 0) +
    (to.personality === "Militarist" && type === "military" ? 8 : 0) -
    (to.personality === "Defender" && type === "military" ? 6 : 0);
  const threshold = to.personality === "Defender" ? 62 : 54;
  from.money -= config.cost;
  from.stats.moneySpent += config.cost;
  if (score < threshold) {
    record.relation = Math.max(0, record.relation - 5);
    return { ok: true, accepted: false, reason: `${to.name} rejected the alliance.` };
  }
  const alliance = {
    id: `alliance-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    label: config.label,
    members: [fromId, toId],
    createdTurn: game.turn,
    duration: 6,
    expiresTurn: game.turn + 6,
    active: true,
  };
  game.alliances.push(alliance);
  record.alliances.push(alliance.id);
  record.relation = Math.min(100, record.relation + config.relationBoost);
  from.stats.alliancesFormed += 1;
  to.stats.alliancesFormed += 1;
  return { ok: true, accepted: true, alliance, reason: `${config.label} formed.` };
}

export function breakAlliance(game, allianceId, breakerId) {
  const alliance = game.alliances.find((item) => item.id === allianceId && item.active);
  if (!alliance) return { ok: false, reason: "Alliance not found." };
  alliance.active = false;
  for (const partnerId of alliance.members) {
    if (partnerId === breakerId) continue;
    const record = getDiplomacy(game, breakerId, partnerId);
    record.relation = Math.max(0, record.relation - 12);
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

function bundleValue(bundle) {
  return (
    bundle.money +
    bundle.food * 1.4 +
    bundle.materials * 5 +
    bundle.education * 7 +
    bundle.industry * 10 +
    bundle.people * 135
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
  if (personality === "Trader") return 0.88;
  if (personality === "Scholar") return 0.98;
  if (personality === "Expansionist") return 1.0;
  if (personality === "Militarist") return 1.05;
  if (personality === "Defender") return 1.12;
  return 1;
}
