export const MAX_ACTIONS_PER_TURN = 10;

export const MAP_SIZES = {
  Small: { label: "Small", radius: 7 },
  Medium: { label: "Medium", radius: 10 },
  Large: { label: "Large", radius: 13 },
};

export const TILE_TYPES = {
  EMPTY: "empty",
  FARM: "farm",
  MINE: "mine",
  SCHOOL: "school",
  FACTORY: "factory",
  MILITARY: "military",
  WATER: "water",
  MOUNTAIN: "mountain",
};

export const BUILDING_TYPES = [
  TILE_TYPES.FARM,
  TILE_TYPES.MINE,
  TILE_TYPES.SCHOOL,
  TILE_TYPES.FACTORY,
  TILE_TYPES.MILITARY,
];

export const TILE_LABELS = {
  [TILE_TYPES.EMPTY]: "Empty",
  [TILE_TYPES.FARM]: "Farm",
  [TILE_TYPES.MINE]: "Mine",
  [TILE_TYPES.SCHOOL]: "School",
  [TILE_TYPES.FACTORY]: "Factory",
  [TILE_TYPES.MILITARY]: "Military Base",
  [TILE_TYPES.WATER]: "Water",
  [TILE_TYPES.MOUNTAIN]: "Mountain",
};

export const WORKER_ROLES = {
  FARMERS: "farmers",
  MINERS: "miners",
  SCHOLARS: "scholars",
  ENGINEERS: "engineers",
  SOLDIERS: "soldiers",
};

export const WORKER_ROLE_BY_TILE = {
  [TILE_TYPES.FARM]: WORKER_ROLES.FARMERS,
  [TILE_TYPES.MINE]: WORKER_ROLES.MINERS,
  [TILE_TYPES.SCHOOL]: WORKER_ROLES.SCHOLARS,
  [TILE_TYPES.FACTORY]: WORKER_ROLES.ENGINEERS,
  [TILE_TYPES.MILITARY]: WORKER_ROLES.SOLDIERS,
};

export const WORKER_MIN = {
  [TILE_TYPES.FARM]: 2,
  [TILE_TYPES.MINE]: 3,
  [TILE_TYPES.SCHOOL]: 3,
  [TILE_TYPES.FACTORY]: 5,
  [TILE_TYPES.MILITARY]: 4,
};

export const TILE_COLORS = {
  [TILE_TYPES.EMPTY]: 0x8d7251,
  [TILE_TYPES.FARM]: 0x4f9a58,
  [TILE_TYPES.MINE]: 0xb46e3d,
  [TILE_TYPES.SCHOOL]: 0x4e84c4,
  [TILE_TYPES.FACTORY]: 0x4b525f,
  [TILE_TYPES.MILITARY]: 0xa44646,
  [TILE_TYPES.WATER]: 0x2e6f95,
  [TILE_TYPES.MOUNTAIN]: 0x7a7060,
};

export const NATION_COLOR_PALETTE = [
  "#2dd4bf",
  "#fb7185",
  "#60a5fa",
  "#fbbf24",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#f97316",
  "#22d3ee",
  "#bef264",
];

export const OWNER_COLORS = NATION_COLOR_PALETTE;

export function nationColor(index = 0) {
  if (index < NATION_COLOR_PALETTE.length) return NATION_COLOR_PALETTE[index];
  const hue = (index * 137.508) % 360;
  return `hsl(${Math.round(hue)} 82% 66%)`;
}

export const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampInt(value, min, max, fallback = min) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

export function tileKey(q, r) {
  return `${q},${r}`;
}

export function tileId(q, r) {
  return `${q}:${r}`;
}

export function parseTileId(id) {
  const [q, r] = String(id).split(":").map(Number);
  return { q, r };
}

export function axialNeighbors(q, r) {
  return HEX_DIRECTIONS.map((dir) => ({ q: q + dir.q, r: r + dir.r }));
}

export function hexDistance(a, b) {
  return (
    Math.abs(a.q - b.q) +
    Math.abs(a.q + a.r - b.q - b.r) +
    Math.abs(a.r - b.r)
  ) / 2;
}

export function hexMapCoords(radius) {
  const coords = [];
  for (let q = -radius; q <= radius; q += 1) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r += 1) coords.push({ q, r });
  }
  return coords;
}

export function axialToWorld(q, r, size = 1) {
  return {
    x: size * 1.5 * q,
    z: size * (Math.sqrt(3) * (r + q / 2)),
  };
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2d(q, r, seed = 1) {
  let h = seed ^ Math.imul(q + 374761393, 668265263) ^ Math.imul(r + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randomSeed() {
  return Math.floor((Date.now() % 1000000000) + Math.random() * 1000000);
}

export function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickWeighted(options, rng) {
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let roll = rng() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.value;
  }
  return options[options.length - 1]?.value;
}

export function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

export function signed(value) {
  return value >= 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

export function titleCase(value) {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isLand(tile) {
  return tile && tile.terrain === "land" && tile.type !== TILE_TYPES.WATER && tile.type !== TILE_TYPES.MOUNTAIN;
}

export function isTileActive(tile) {
  if (!tile || !WORKER_MIN[tile.type]) return false;
  if (tile.effects?.disabledTurns > 0 || tile.effects?.floodedTurns > 0) return false;
  return (tile.workers || 0) >= WORKER_MIN[tile.type];
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function pairKey(a, b) {
  return [a, b].sort().join("|");
}

export function delay(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
