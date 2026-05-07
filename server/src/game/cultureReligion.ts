import type { ServerGameState } from "./initialGame.js";

type Nation = ServerGameState["nations"][string];

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
  cultureRelationWeight: 10,
  dominantCultureRelationBonus: 3,
  foreignCulturePressureScale: 0.08,
  cohesionHappinessScale: 0.05,
  lowReligionPenaltyThreshold: 45,
  highReligionBonusThreshold: 72,
  religionHappinessScale: 0.06,
  tradeYieldScale: 0.24,
  allianceQualityScale: 0.18,
  embargoResilienceScale: 0.2,
});

export function emptyReligionPrevalence() {
  return Object.fromEntries(RELIGION_IDS.map((religionId) => [religionId, 0])) as Record<string, number>;
}

export function religionLabel(religionId: string | null | undefined) {
  return RELIGIONS.find((religion) => religion.id === religionId)?.name || "None";
}

export function createInitialSociety(nationId: string) {
  return {
    culture: {
      homeCultureId: nationId,
      mix: { [nationId]: 100 },
      dominantCultureId: nationId,
    },
    religion: {
      stateReligionId: null as string | null,
      chosenTurn: null as number | null,
      prevalence: emptyReligionPrevalence(),
      dominantReligionId: null as string | null,
    },
  };
}

export function isSocietyEnabled(game: ServerGameState | Record<string, any>) {
  if ((game as any)?.settings?.scenarioId === "ww2_global") return false;
  if ((game as any)?.settings?.mode !== "advanced") return false;
  return (game as any)?.settings?.scenarioOverrides?.societyEnabled !== false;
}

export function isValidReligion(religionId: unknown) {
  return RELIGION_IDS.includes(String(religionId));
}

export function normalizeSociety(nation: Nation) {
  if (!nation) return nation;
  normalizeCulture(nation);
  normalizeReligion(nation);
  return nation;
}

export function chooseReligionForNation(nation: Nation, religionId: string, turn: number) {
  normalizeSociety(nation);
  if (!isValidReligion(religionId)) return { ok: false as const, reason: "Choose one of the four available religions." };
  if (nation.religion.stateReligionId) return { ok: false as const, reason: "This society has already chosen a religion." };
  nation.religion.stateReligionId = religionId;
  nation.religion.chosenTurn = turn;
  nation.religion.prevalence = emptyReligionPrevalence();
  nation.religion.prevalence[religionId] = 100;
  nation.religion.dominantReligionId = religionId;
  return { ok: true as const, religionId };
}

export function promoteReligionForNation(nation: Nation) {
  normalizeSociety(nation);
  const religionId = nation.religion.stateReligionId;
  if (!religionId) return { ok: false as const, reason: "Choose a state religion before promoting it." };
  const before = religionPrevalence(nation, religionId);
  if (before >= 100) return { ok: false as const, reason: "State religion is already fully prevalent." };
  shiftReligionToward(nation, religionId, SOCIETY.promoteShift);
  const after = religionPrevalence(nation, religionId);
  return { ok: true as const, religionId, changed: Math.max(0, roundPercent(after - before)), prevalence: after };
}

export function blendCultureTowardNation(target: Nation, source: Nation, pressure: number) {
  normalizeSociety(target);
  normalizeSociety(source);
  return blendCultureTowardMix(target, source.culture.mix, pressure);
}

export function blendCultureTowardId(target: Nation, cultureId: string | null | undefined, pressure: number) {
  if (!cultureId) return false;
  return blendCultureTowardMix(target, { [cultureId]: 100 }, pressure);
}

export function blendCultureTowardMix(target: Nation, sourceMix: Record<string, unknown>, pressure: number) {
  normalizeSociety(target);
  const normalizedSource = normalizeCultureMix(sourceMix, target.culture.homeCultureId);
  const ratio = clamp(Number(pressure) || 0, 0, 100) / 100;
  if (ratio <= 0) return false;
  const next: Record<string, number> = {};
  const keys = new Set([...Object.keys(target.culture.mix || {}), ...Object.keys(normalizedSource)]);
  for (const key of keys) {
    next[key] = ((target.culture.mix[key] || 0) * (1 - ratio)) + ((normalizedSource[key] || 0) * ratio);
  }
  target.culture.mix = normalizeCultureMix(next, target.culture.homeCultureId);
  target.culture.dominantCultureId = dominantKey(target.culture.mix);
  return true;
}

export function shiftReligionToward(nation: Nation, religionId: string, pressure: number) {
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

export function religionPrevalence(nation: Nation, religionId: string) {
  if (!isValidReligion(religionId)) return 0;
  normalizeSociety(nation);
  return Number(nation.religion.prevalence[religionId]) || 0;
}

export function societyRelationModifier(a: Nation, b: Nation) {
  normalizeSociety(a);
  normalizeSociety(b);
  const bilateral = bilateralSocietyMetrics(a, b);
  const stateA = a.religion.stateReligionId;
  const stateB = b.religion.stateReligionId;
  const dominantA = a.religion.dominantReligionId;
  const dominantB = b.religion.dominantReligionId;
  let modifier = Math.round(((bilateral.cultureOverlap - 50) / 100) * SOCIETY.cultureRelationWeight);
  if (bilateral.sharedDominantCulture) modifier += SOCIETY.dominantCultureRelationBonus;
  if ((stateA && stateA === stateB) || (dominantA && dominantA === dominantB)) modifier += SOCIETY.sameReligionModifier;
  if (
    stateA &&
    stateB &&
    stateA !== stateB &&
    religionPrevalence(a, stateA) >= SOCIETY.strongStateReligionPrevalence &&
    religionPrevalence(b, stateB) >= SOCIETY.strongStateReligionPrevalence
  ) {
    modifier += SOCIETY.differentStrongStateReligionModifier;
  }
  return clamp(modifier, -12, 14);
}

export function processSocietySpread(game: ServerGameState) {
  if (!isSocietyEnabled(game)) return;
  const activeNations = Object.values(game.nations || {}).filter((nation) => nation?.active);
  for (const nation of activeNations) normalizeSociety(nation);

  const relationPairs = new Set<string>();

  for (const route of game.tradeRoutes as Array<Record<string, any>>) {
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

  for (const alliance of game.alliances as Array<Record<string, any>>) {
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
    const [a, b] = key.split("::");
    const nationA = game.nations[a];
    const nationB = game.nations[b];
    if (!shareReligion(nationA, nationB)) continue;
    const record = ensureDiplomacyRecord(game, a, b);
    record.relation = Math.min(100, (Number(record.relation) || 50) + SOCIETY.sharedReligionRelationGain);
  }

  for (const nation of activeNations) nationSocietyMetrics(nation);
}

export function nationSocietyMetrics(nation: Nation) {
  normalizeSociety(nation);
  const homeCultureId = nation.culture.homeCultureId;
  const homeShare = roundPercent(Number(nation.culture.mix?.[homeCultureId]) || 0);
  const dominantCultureId = nation.culture.dominantCultureId;
  const dominantCultureShare = dominantCultureId ? roundPercent(Number(nation.culture.mix?.[dominantCultureId]) || 0) : homeShare;
  const foreignShare = roundPercent(Math.max(0, 100 - homeShare));
  const stateReligionId = nation.religion.stateReligionId;
  const stateReligionShare = stateReligionId ? religionPrevalence(nation, stateReligionId) : 0;
  const dominantReligionIdValue = nation.religion.dominantReligionId;
  const dominantReligionShare = dominantReligionIdValue ? religionPrevalence(nation, dominantReligionIdValue) : 0;
  const religiousCohesion = roundPercent(Math.max(stateReligionShare, dominantReligionShare));
  const culturePressure = foreignShare * SOCIETY.foreignCulturePressureScale;
  const cohesionRelief = Math.max(0, homeShare - 50) * SOCIETY.cohesionHappinessScale;
  const religionRelief = Math.max(0, religiousCohesion - 50) * SOCIETY.religionHappinessScale;
  const religionPenalty = Math.max(0, SOCIETY.lowReligionPenaltyThreshold - stateReligionShare) * 0.05;
  const happinessDelta = Math.round(clamp(cohesionRelief + religionRelief - culturePressure - religionPenalty, -6, 5));
  const stability = roundPercent(clamp((homeShare * 0.55) + (religiousCohesion * 0.45) - (foreignShare * 0.35), 0, 100));
  const metrics = {
    homeShare,
    foreignShare,
    dominantCultureId,
    dominantCultureShare,
    stateReligionShare: roundPercent(stateReligionShare),
    dominantReligionShare: roundPercent(dominantReligionShare),
    religiousCohesion,
    culturalCohesion: roundPercent(homeShare),
    happinessDelta,
    stability,
  };
  (nation as Nation & { societyMetrics?: typeof metrics }).societyMetrics = metrics;
  return metrics;
}

export function bilateralSocietyMetrics(a: Nation, b: Nation) {
  normalizeSociety(a);
  normalizeSociety(b);
  const cultureOverlap = roundPercent(cultureOverlapScore(a.culture.mix, b.culture.mix));
  const dominantCultureA = a.culture.dominantCultureId;
  const dominantCultureB = b.culture.dominantCultureId;
  const sharedDominantCulture = Boolean(dominantCultureA && dominantCultureA === dominantCultureB);
  const sharedStateReligion = Boolean(a.religion.stateReligionId && a.religion.stateReligionId === b.religion.stateReligionId);
  const sharedDominantReligion = Boolean(a.religion.dominantReligionId && a.religion.dominantReligionId === b.religion.dominantReligionId);
  const trust = clamp(
    (cultureOverlap / 100) * 0.7 +
      (sharedStateReligion ? 0.24 : 0) +
      (!sharedStateReligion && sharedDominantReligion ? 0.12 : 0) +
      (sharedDominantCulture ? 0.1 : 0),
    0,
    1,
  );
  const pressure = clamp(
    (sharedStateReligion ? 0.22 : 0) +
      (!sharedStateReligion && sharedDominantReligion ? 0.1 : 0) +
      ((cultureOverlap - 50) / 100) * SOCIETY.tradeYieldScale,
    -0.2,
    0.36,
  );
  return {
    cultureOverlap,
    sharedDominantCulture,
    sharedStateReligion,
    sharedDominantReligion,
    trust: roundPercent(trust * 100) / 100,
    pressure: roundPercent(pressure * 100) / 100,
  };
}

function exchangeSociety(nationA: Nation, nationB: Nation, culturePressure: number, religionPressure: number) {
  spreadSocietyOneWay(nationA, nationB, culturePressure, religionPressure);
  spreadSocietyOneWay(nationB, nationA, culturePressure, religionPressure);
}

function spreadSocietyOneWay(target: Nation, source: Nation, culturePressure: number, religionPressure: number) {
  const sourceReligion = source.religion.stateReligionId || source.religion.dominantReligionId;
  const sourceReligionPrevalence = sourceReligion ? religionPrevalence(source, sourceReligion) : 0;
  const carriedCulturePressure = sourceReligionPrevalence >= SOCIETY.strongReligionPrevalence
    ? religionPressure * SOCIETY.religiousCultureCarry
    : 0;
  blendCultureTowardId(target, source.culture.dominantCultureId, culturePressure + carriedCulturePressure);
  if (sourceReligion) shiftReligionToward(target, sourceReligion, religionPressure);
}

function shareReligion(a: Nation, b: Nation) {
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

function hasActiveTradeRoute(game: ServerGameState, a: string, b: string) {
  return (game.tradeRoutes as Array<Record<string, any>>).some((route) => route.status === "active" && route.members?.includes(a) && route.members?.includes(b));
}

function hasActiveAlliance(game: ServerGameState, a: string, b: string, type: string | null = null) {
  return (game.alliances as Array<Record<string, any>>).some((alliance) => {
    if (!alliance?.active || !alliance.members?.includes(a) || !alliance.members?.includes(b)) return false;
    return !type || alliance.type === type;
  });
}

function ensureDiplomacyRecord(game: ServerGameState, a: string, b: string) {
  const diplomacy = game.diplomacy as Record<string, Record<string, any>>;
  const key = pairKey(a, b);
  if (!diplomacy[key]) {
    diplomacy[key] = {
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
  const record = diplomacy[key];
  record.relation = Number.isFinite(Number(record.relation)) ? Number(record.relation) : 50;
  record.dependency = record.dependency || { [a]: 0, [b]: 0 };
  record.alliances = Array.isArray(record.alliances) ? record.alliances : [];
  record.embargoes = record.embargoes || {};
  return record;
}

function normalizeCulture(nation: Nation) {
  const fallbackId = nation.id || "unknown";
  const existing = (nation as any).culture && typeof (nation as any).culture === "object" ? (nation as any).culture : {};
  const homeCultureId = String(existing.homeCultureId || fallbackId);
  const mix = normalizeCultureMix(existing.mix, homeCultureId);
  (nation as any).culture = {
    homeCultureId,
    mix,
    dominantCultureId: dominantKey(mix) || homeCultureId,
  };
}

function normalizeReligion(nation: Nation) {
  const existing: Record<string, any> = (nation as any).religion && typeof (nation as any).religion === "object" ? (nation as any).religion : {};
  const stateReligionId = isValidReligion(existing.stateReligionId) ? String(existing.stateReligionId) : null;
  const prevalence = normalizeReligionPrevalence(existing.prevalence);
  if (stateReligionId && sumValues(prevalence) <= 0) prevalence[stateReligionId] = 100;
  const chosenTurn = Number.isFinite(Number(existing.chosenTurn)) ? Number(existing.chosenTurn) : null;
  (nation as any).religion = {
    stateReligionId,
    chosenTurn,
    prevalence,
    dominantReligionId: dominantReligionId(prevalence),
  };
}

function normalizeCultureMix(rawMix: Record<string, unknown> | undefined, fallbackId: string) {
  const mix: Record<string, number> = {};
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

function normalizeReligionPrevalence(rawPrevalence: Record<string, unknown> | undefined) {
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

function trimReligionOverflow(prevalence: Record<string, number>, preferredId: string) {
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

function dominantReligionId(prevalence: Record<string, number>) {
  const dominant = RELIGION_IDS
    .map((religionId) => ({ religionId, value: Number(prevalence[religionId]) || 0 }))
    .sort((a, b) => b.value - a.value)[0];
  return dominant?.value > 0 ? dominant.religionId : null;
}

function dominantKey(map: Record<string, number>) {
  return Object.entries(map || {}).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] || "";
}

function trimRounding(map: Record<string, number>, fallbackId: string) {
  const total = roundPercent(sumValues(map));
  const delta = roundPercent(100 - total);
  if (Math.abs(delta) > 0 && Object.keys(map).length) {
    const target = dominantKey(map) || fallbackId;
    map[target] = roundPercent((map[target] || 0) + delta);
  }
  return map;
}

function sumValues(map: Record<string, unknown>): number {
  let sum = 0;
  for (const value of Object.values(map || {})) sum += Number(value) || 0;
  return sum;
}

function roundPercent(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cultureOverlapScore(aMix: Record<string, number> = {}, bMix: Record<string, number> = {}) {
  const keys = new Set([...Object.keys(aMix || {}), ...Object.keys(bMix || {})]);
  let overlap = 0;
  for (const key of keys) overlap += Math.min(Number(aMix[key]) || 0, Number(bMix[key]) || 0);
  return clamp(overlap, 0, 100);
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("::");
}
