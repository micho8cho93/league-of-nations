import { clamp, pairKey } from "./utils.js";

export const RELIGIONS = Object.freeze([
  { id: "auralis", name: "Auralis", icon: "*" },
  { id: "thalorin", name: "Thalorin", icon: "~" },
  { id: "verdance", name: "Verdance", icon: "#" },
  { id: "pyrelume", name: "Pyrelume", icon: "^" },
]);

export const RELIGION_IDS = RELIGIONS.map((religion) => religion.id);

export const SOCIETY = Object.freeze({
  unlockEra: 2,
  promoteCost: 180,
  promoteShift: 15,
  internalConversionShift: 0.8,
  tradeCultureShift: 1.5,
  tradeReligionShift: 1.25,
  tradeAllianceBonusShift: 0.75,
  allianceCultureShift: 0.5,
  allianceReligionShift: 0.35,
  religiousCultureCarry: 0.4,
  strongReligionPrevalence: 60,
  tileCaptureCultureShift: 2,
  tileCaptureReligionShift: 1,
  conquestCultureShift: 15,
  conquestReligionShift: 8,
  sharedReligionRelationGain: 1,
  sameReligionModifier: 8,
  differentStrongStateReligionModifier: -5,
  strongStateReligionPrevalence: 65,
});

export function religionLabel(religionId) {
  return RELIGIONS.find((religion) => religion.id === religionId)?.name || "None";
}

export function religionIcon(religionId) {
  return RELIGIONS.find((religion) => religion.id === religionId)?.icon || ".";
}

export function isValidReligion(religionId) {
  return RELIGION_IDS.includes(religionId);
}

export function emptyReligionPrevalence() {
  return Object.fromEntries(RELIGION_IDS.map((religionId) => [religionId, 0]));
}

export function createInitialSociety(nationId) {
  return {
    culture: {
      homeCultureId: nationId,
      mix: { [nationId]: 100 },
      dominantCultureId: nationId,
    },
    religion: {
      stateReligionId: null,
      chosenTurn: null,
      prevalence: emptyReligionPrevalence(),
      dominantReligionId: null,
    },
  };
}

export function normalizeSociety(nation) {
  if (!nation) return nation;
  normalizeCulture(nation);
  normalizeReligion(nation);
  return nation;
}

export function chooseReligionForNation(nation, religionId, turn) {
  normalizeSociety(nation);
  if (!isValidReligion(religionId)) return { ok: false, reason: "Choose one of the four available religions." };
  if (nation.religion.stateReligionId) return { ok: false, reason: "This society has already chosen a religion." };
  nation.religion.stateReligionId = religionId;
  nation.religion.chosenTurn = turn;
  nation.religion.prevalence = emptyReligionPrevalence();
  nation.religion.prevalence[religionId] = 100;
  nation.religion.dominantReligionId = religionId;
  return { ok: true, religionId };
}

export function promoteReligionForNation(nation) {
  normalizeSociety(nation);
  const religionId = nation.religion.stateReligionId;
  if (!religionId) return { ok: false, reason: "Choose a state religion before promoting it." };
  const before = religionPrevalence(nation, religionId);
  if (before >= 100) return { ok: false, reason: "State religion is already fully prevalent." };
  shiftReligionToward(nation, religionId, SOCIETY.promoteShift);
  const after = religionPrevalence(nation, religionId);
  return { ok: true, religionId, changed: Math.max(0, roundPercent(after - before)), prevalence: after };
}

export function blendCultureTowardNation(target, source, pressure) {
  normalizeSociety(target);
  normalizeSociety(source);
  return blendCultureTowardMix(target, source.culture.mix, pressure);
}

export function blendCultureTowardId(target, cultureId, pressure) {
  if (!cultureId) return false;
  return blendCultureTowardMix(target, { [cultureId]: 100 }, pressure);
}

export function blendCultureTowardMix(target, sourceMix, pressure) {
  normalizeSociety(target);
  const normalizedSource = normalizeCultureMix(sourceMix, target.culture.homeCultureId);
  const ratio = clamp(Number(pressure) || 0, 0, 100) / 100;
  if (ratio <= 0) return false;
  const next = {};
  const keys = new Set([...Object.keys(target.culture.mix || {}), ...Object.keys(normalizedSource)]);
  for (const key of keys) {
    next[key] = ((target.culture.mix[key] || 0) * (1 - ratio)) + ((normalizedSource[key] || 0) * ratio);
  }
  target.culture.mix = normalizeCultureMix(next, target.culture.homeCultureId);
  target.culture.dominantCultureId = dominantKey(target.culture.mix);
  return true;
}

export function shiftReligionToward(nation, religionId, pressure) {
  normalizeSociety(nation);
  if (!isValidReligion(religionId)) return false;
  const amount = clamp(Number(pressure) || 0, 0, 100);
  if (amount <= 0) return false;
  const prevalence = { ...nation.religion.prevalence };
  prevalence[religionId] = Math.min(100, (prevalence[religionId] || 0) + amount);
  trimReligionOverflow(prevalence, religionId);
  nation.religion.prevalence = normalizeReligionPrevalence(prevalence);
  nation.religion.dominantReligionId = dominantReligionId(nation.religion.prevalence);
  return true;
}

export function religionPrevalence(nation, religionId) {
  if (!isValidReligion(religionId)) return 0;
  normalizeSociety(nation);
  return Number(nation.religion.prevalence[religionId]) || 0;
}

export function societyRelationModifier(a, b) {
  normalizeSociety(a);
  normalizeSociety(b);
  const stateA = a.religion.stateReligionId;
  const stateB = b.religion.stateReligionId;
  const dominantA = a.religion.dominantReligionId;
  const dominantB = b.religion.dominantReligionId;
  if ((stateA && stateA === stateB) || (dominantA && dominantA === dominantB)) return SOCIETY.sameReligionModifier;
  if (
    stateA &&
    stateB &&
    stateA !== stateB &&
    religionPrevalence(a, stateA) >= SOCIETY.strongStateReligionPrevalence &&
    religionPrevalence(b, stateB) >= SOCIETY.strongStateReligionPrevalence
  ) {
    return SOCIETY.differentStrongStateReligionModifier;
  }
  return 0;
}

export function processSocietySpread(game) {
  const activeNations = Object.values(game.nations || {}).filter((nation) => nation?.active);
  for (const nation of activeNations) normalizeSociety(nation);

  const relationPairs = new Set();

  for (const route of game.tradeRoutes || []) {
    const [a, b] = route.members || [];
    if (!a || !b || route.status !== "active") continue;
    const nationA = game.nations[a];
    const nationB = game.nations[b];
    if (!nationA?.active || !nationB?.active) continue;
    const hasTradeAlliance = hasActiveAlliance(game, a, b, "trade");
    const religionPressure = SOCIETY.tradeReligionShift + (hasTradeAlliance ? SOCIETY.tradeAllianceBonusShift : 0);
    const culturePressure = SOCIETY.tradeCultureShift + (hasTradeAlliance ? SOCIETY.tradeAllianceBonusShift : 0);
    exchangeSociety(nationA, nationB, culturePressure, religionPressure);
    relationPairs.add(pairKey(a, b));
  }

  for (const alliance of game.alliances || []) {
    if (!alliance?.active) continue;
    const [a, b] = alliance.members || [];
    if (!a || !b || hasActiveTradeRoute(game, a, b)) continue;
    const nationA = game.nations[a];
    const nationB = game.nations[b];
    if (!nationA?.active || !nationB?.active) continue;
    exchangeSociety(nationA, nationB, SOCIETY.allianceCultureShift, SOCIETY.allianceReligionShift);
    relationPairs.add(pairKey(a, b));
  }

  for (const nation of activeNations) {
    if (nation.religion.stateReligionId) shiftReligionToward(nation, nation.religion.stateReligionId, SOCIETY.internalConversionShift);
  }

  for (const key of relationPairs) {
    const [a, b] = key.split("|");
    const nationA = game.nations[a];
    const nationB = game.nations[b];
    if (!shareReligion(nationA, nationB)) continue;
    const record = ensureDiplomacyRecord(game, a, b);
    record.relation = Math.min(100, (Number(record.relation) || 50) + SOCIETY.sharedReligionRelationGain);
  }
}

export function dominantCultureLabel(game, cultureId) {
  return game?.nations?.[cultureId]?.name || cultureId || "Unknown";
}

function exchangeSociety(nationA, nationB, culturePressure, religionPressure) {
  spreadSocietyOneWay(nationA, nationB, culturePressure, religionPressure);
  spreadSocietyOneWay(nationB, nationA, culturePressure, religionPressure);
}

function spreadSocietyOneWay(target, source, culturePressure, religionPressure) {
  const sourceReligion = source.religion.stateReligionId || source.religion.dominantReligionId;
  const sourceReligionPrevalence = sourceReligion ? religionPrevalence(source, sourceReligion) : 0;
  const carriedCulturePressure = sourceReligionPrevalence >= SOCIETY.strongReligionPrevalence
    ? religionPressure * SOCIETY.religiousCultureCarry
    : 0;
  blendCultureTowardId(target, source.culture.dominantCultureId, culturePressure + carriedCulturePressure);
  if (sourceReligion) shiftReligionToward(target, sourceReligion, religionPressure);
}

function shareReligion(a, b) {
  if (!a || !b) return false;
  normalizeSociety(a);
  normalizeSociety(b);
  const stateA = a.religion.stateReligionId;
  const stateB = b.religion.stateReligionId;
  if (stateA && stateA === stateB) return true;
  const dominantA = a.religion.dominantReligionId;
  const dominantB = b.religion.dominantReligionId;
  return Boolean(dominantA && dominantA === dominantB);
}

function hasActiveTradeRoute(game, a, b) {
  return (game.tradeRoutes || []).some((route) => route.status === "active" && route.members?.includes(a) && route.members?.includes(b));
}

function hasActiveAlliance(game, a, b, type = null) {
  return (game.alliances || []).some((alliance) => {
    if (!alliance?.active || !alliance.members?.includes(a) || !alliance.members?.includes(b)) return false;
    return !type || alliance.type === type;
  });
}

function ensureDiplomacyRecord(game, a, b) {
  if (!game.diplomacy) game.diplomacy = {};
  const key = pairKey(a, b);
  if (!game.diplomacy[key]) {
    game.diplomacy[key] = {
      pair: key,
      relation: 50,
      trades: 0,
      alliances: [],
      atWar: false,
      wars: 0,
      brokenAgreements: 0,
      dependency: { [a]: 0, [b]: 0 },
      embargoes: {},
    };
  }
  const record = game.diplomacy[key];
  record.relation = Number.isFinite(Number(record.relation)) ? Number(record.relation) : 50;
  record.dependency = record.dependency || { [a]: 0, [b]: 0 };
  record.alliances = Array.isArray(record.alliances) ? record.alliances : [];
  record.embargoes = record.embargoes || {};
  return record;
}

function normalizeCulture(nation) {
  const fallbackId = nation.id || "unknown";
  const culture = nation.culture && typeof nation.culture === "object" ? nation.culture : {};
  const homeCultureId = String(culture.homeCultureId || fallbackId);
  const mix = normalizeCultureMix(culture.mix, homeCultureId);
  nation.culture = {
    homeCultureId,
    mix,
    dominantCultureId: dominantKey(mix) || homeCultureId,
  };
}

function normalizeReligion(nation) {
  const religion = nation.religion && typeof nation.religion === "object" ? nation.religion : {};
  const stateReligionId = isValidReligion(religion.stateReligionId) ? religion.stateReligionId : null;
  const prevalence = normalizeReligionPrevalence(religion.prevalence);
  if (stateReligionId && sumValues(prevalence) <= 0) prevalence[stateReligionId] = 100;
  const chosenTurn = Number.isFinite(Number(religion.chosenTurn)) ? Number(religion.chosenTurn) : null;
  nation.religion = {
    stateReligionId,
    chosenTurn,
    prevalence,
    dominantReligionId: dominantReligionId(prevalence),
  };
}

function normalizeCultureMix(rawMix, fallbackId) {
  const mix = {};
  if (rawMix && typeof rawMix === "object") {
    for (const [key, value] of Object.entries(rawMix)) {
      const numeric = Number(value);
      if (!key || !Number.isFinite(numeric) || numeric <= 0) continue;
      mix[key] = (mix[key] || 0) + numeric;
    }
  }
  if (!Object.keys(mix).length) mix[fallbackId] = 100;
  const total = sumValues(mix) || 1;
  for (const key of Object.keys(mix)) mix[key] = roundPercent((mix[key] / total) * 100);
  return trimRounding(mix, fallbackId);
}

function normalizeReligionPrevalence(rawPrevalence) {
  const prevalence = emptyReligionPrevalence();
  if (rawPrevalence && typeof rawPrevalence === "object") {
    for (const religionId of RELIGION_IDS) {
      prevalence[religionId] = clamp(Number(rawPrevalence[religionId]) || 0, 0, 100);
    }
  }
  const total = sumValues(prevalence);
  if (total > 100) {
    for (const religionId of RELIGION_IDS) prevalence[religionId] = (prevalence[religionId] / total) * 100;
  }
  for (const religionId of RELIGION_IDS) prevalence[religionId] = roundPercent(prevalence[religionId]);
  return prevalence;
}

function trimReligionOverflow(prevalence, preferredId) {
  const total = sumValues(prevalence);
  if (total <= 100) return;
  let overflow = total - 100;
  const otherIds = RELIGION_IDS.filter((religionId) => religionId !== preferredId && prevalence[religionId] > 0);
  const otherTotal = otherIds.reduce((sum, religionId) => sum + prevalence[religionId], 0);
  if (otherTotal > 0) {
    for (const religionId of otherIds) {
      const reduction = Math.min(prevalence[religionId], overflow * (prevalence[religionId] / otherTotal));
      prevalence[religionId] -= reduction;
    }
  }
  overflow = sumValues(prevalence) - 100;
  if (overflow > 0) prevalence[preferredId] = Math.max(0, prevalence[preferredId] - overflow);
}

function dominantReligionId(prevalence) {
  const dominant = RELIGION_IDS
    .map((religionId) => ({ religionId, value: Number(prevalence[religionId]) || 0 }))
    .sort((a, b) => b.value - a.value)[0];
  return dominant?.value > 0 ? dominant.religionId : null;
}

function dominantKey(map) {
  return Object.entries(map || {}).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || null;
}

function sumValues(map) {
  return Object.values(map || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function trimRounding(map, fallbackId) {
  const total = roundPercent(sumValues(map));
  const delta = roundPercent(100 - total);
  if (Math.abs(delta) > 0 && Object.keys(map).length) {
    const target = dominantKey(map) || fallbackId;
    map[target] = roundPercent((map[target] || 0) + delta);
  }
  return map;
}

function roundPercent(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
