// Phase 5: trade negotiation helpers. Pure rules; GameState owns logging/events.

const RESOURCE_VALUES = {
  money: 1,
  people: 125,
};

const PERSONALITY_TERMS = {
  Expansionist: { threshold: 0.98, peopleValue: 1.05 },
  Economist: { threshold: 1.08, moneyValue: 1.08 },
  Militarist: { threshold: 1.02, peopleValue: 1.12 },
  Diplomat: { threshold: 0.9, peopleValue: 1.0 },
  Isolationist: { threshold: 1.18, peopleValue: 0.9 },
};

function normalizeTradeDraft(draft) {
  return {
    offer: normalizeBundle(draft && draft.offer),
    request: normalizeBundle(draft && draft.request),
  };
}

function evaluateTrade(player, partner, draft, diplomacy = {}) {
  const normalized = normalizeTradeDraft(draft);
  const playerCheck = canPayBundle(player, normalized.offer);
  if (!playerCheck.ok) {
    return { ok: false, accepted: false, reason: playerCheck.reason, normalized };
  }

  const partnerCheck = canPayBundle(partner, normalized.request);
  if (!partnerCheck.ok) {
    return { ok: false, accepted: false, reason: `${partner.name} ${partnerCheck.reason}`, normalized };
  }

  const offerValue = bundleValue(normalized.offer, partner);
  const requestValue = bundleValue(normalized.request, partner);
  if (offerValue <= 0 && requestValue <= 0) {
    return { ok: false, accepted: false, reason: "No resources in the proposal", normalized };
  }

  const terms = PERSONALITY_TERMS[partner.personality] || { threshold: 1 };
  const relation = diplomacy.relation == null ? 50 : diplomacy.relation;
  const relationFactor = 1 - ((relation - 50) / 500);
  const trustBonus = Math.min(0.1, (diplomacy.successfulTrades || 0) * 0.02);
  const threshold = Math.max(0.72, (terms.threshold || 1) * relationFactor - trustBonus);
  const requiredValue = requestValue * threshold;
  const accepted = requestValue === 0 || offerValue >= requiredValue;
  const gap = Math.max(0, Math.ceil(requiredValue - offerValue));

  return {
    ok: true,
    accepted,
    normalized,
    offerValue,
    requestValue,
    threshold,
    gap,
    reason: accepted
      ? `${partner.name} accepts these terms.`
      : `${partner.name} wants roughly $${gap.toLocaleString()} more value.`,
  };
}

function executeTrade(from, to, trade) {
  moveBundle(from, to, trade.offer);
  moveBundle(to, from, trade.request);
}

function describeTrade(trade, playerName, partnerName) {
  const give = describeBundle(trade.offer) || "nothing";
  const get = describeBundle(trade.request) || "nothing";
  return `${playerName} gives ${give}; ${partnerName} gives ${get}`;
}

function describeBundle(bundle) {
  const parts = [];
  if (bundle.money > 0) parts.push(`$${bundle.money.toLocaleString()}`);
  if (bundle.people > 0) parts.push(`${bundle.people} people`);
  return parts.join(" and ");
}

function normalizeBundle(bundle = {}) {
  return {
    money: Math.max(0, Math.floor(Number(bundle.money) || 0)),
    people: Math.max(0, Math.floor(Number(bundle.people) || 0)),
  };
}

function canPayBundle(nation, bundle) {
  if (nation.money < bundle.money) return { ok: false, reason: "cannot afford the money offer" };
  if (nation.population.available < bundle.people) {
    return { ok: false, reason: "does not have enough available people" };
  }
  return { ok: true };
}

function bundleValue(bundle, receivingNation) {
  const terms = PERSONALITY_TERMS[receivingNation.personality] || {};
  const moneyValue = RESOURCE_VALUES.money * (terms.moneyValue || 1);
  const peopleValue = RESOURCE_VALUES.people * (terms.peopleValue || 1);
  return (bundle.money * moneyValue) + (bundle.people * peopleValue);
}

function moveBundle(from, to, bundle) {
  if (bundle.money > 0) {
    from.money -= bundle.money;
    to.money += bundle.money;
  }
  if (bundle.people > 0) {
    from.population.available -= bundle.people;
    from.population.total -= bundle.people;
    to.population.available += bundle.people;
    to.population.total += bundle.people;
  }
}
