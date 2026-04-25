// Shared helpers. Phase 1 focus: hex math + color palette.

const TILE_TYPES = {
  EMPTY: "empty",
  FARM: "farm",
  MINE: "mine",
  SCHOOL: "school",
  MILITARY: "military",
  FACTORY: "factory",
  WATER: "water",
  UN: "un", // Hidden UN territory — revealed at Stage 3.2, then claimable
  ISLAND: "island", // Legacy saves: old hidden UN territory key
};

const TILE_COLORS = {
  [TILE_TYPES.EMPTY]: 0x8a6a3d,
  [TILE_TYPES.FARM]: 0x4c9a3a,
  [TILE_TYPES.MINE]: 0xd98a2b,
  [TILE_TYPES.SCHOOL]: 0x3a78c9,
  [TILE_TYPES.MILITARY]: 0xc94c4c,
  [TILE_TYPES.FACTORY]: 0x222830,
  [TILE_TYPES.WATER]: 0x1f4a78,
  [TILE_TYPES.UN]: 0x1f4a78,
  [TILE_TYPES.ISLAND]: 0x1f4a78,
};

const TILE_LABELS = {
  [TILE_TYPES.EMPTY]: "Unclaimed Land",
  [TILE_TYPES.FARM]: "Farm",
  [TILE_TYPES.MINE]: "Mine",
  [TILE_TYPES.SCHOOL]: "School",
  [TILE_TYPES.MILITARY]: "Military Base",
  [TILE_TYPES.FACTORY]: "Factory",
  [TILE_TYPES.WATER]: "Water",
  [TILE_TYPES.UN]: "Uncharted Waters",
  [TILE_TYPES.ISLAND]: "Uncharted Waters",
};

// Flat-top hex geometry, per prompt:
//   x = size * (3/2 * q)
//   z = size * (sqrt(3)/2 * q + sqrt(3) * r)
const SQRT3 = Math.sqrt(3);

function axialToWorld(q, r, size) {
  const x = size * (1.5 * q);
  const z = size * ((SQRT3 / 2) * q + SQRT3 * r);
  return { x, z };
}

// Generate axial coords covering a hex-shaped map of given radius.
function hexMapCoords(radius) {
  const coords = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      coords.push({ q, r });
    }
  }
  return coords;
}

const AXIAL_DIRS = [
  { dq: 1, dr: 0 },
  { dq: -1, dr: 0 },
  { dq: 0, dr: 1 },
  { dq: 0, dr: -1 },
  { dq: 1, dr: -1 },
  { dq: -1, dr: 1 },
];

function axialNeighbors(q, r) {
  return AXIAL_DIRS.map((d) => ({ q: q + d.dq, r: r + d.dr }));
}

function hexDistance(a, b) {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}

// Deterministic hash → [0,1) for reproducible map gen given a seed.
function hash2d(q, r, seed) {
  let h = (q * 374761393) ^ (r * 668265263) ^ (seed * 2147483647);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000000) / 1000000;
}

function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}

function pickWeighted(entries, rand) {
  // entries: [[value, weight], ...]
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let n = rand * total;
  for (const [value, weight] of entries) {
    n -= weight;
    if (n <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
