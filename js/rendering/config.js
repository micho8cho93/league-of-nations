/**
 * Centralized visual configuration for the Three.js rendering system.
 * Consolidates material presets, lighting setup, color palettes, and renderer settings.
 */

import { BIOME_COLORS, TILE_COLORS, TILE_TYPES, isWaterLike } from "../utils.js";

// ============================================================================
// RENDERER SETTINGS
// ============================================================================

export const RENDERER_CONFIG = {
  antialias: true,
  alpha: true,
  pixelRatioCap: 2,
};

// ============================================================================
// SCENE BACKGROUND & FOG
// ============================================================================

export const SCENE_CONFIG = {
  backgroundColor: 0x102333, // dark blue
  fog: {
    enabled: true,
    color: 0x1a3a4d, // slightly lighter blue for depth
    near: 8,
    far: 140,
  },
};

// ============================================================================
// LIGHTING CONFIGURATION
// ============================================================================

export const LIGHTING_CONFIG = {
  // Directional key light (main light source)
  key: {
    color: 0xfff1cc,
    intensity: 1.05,
    position: [10, 18, 12],
    castShadow: false, // disabled by default for performance
    shadowMapSize: 2048,
  },

  // Directional fill light (secondary light)
  fill: {
    color: 0x8bb7ff,
    intensity: 0.42,
    position: [-10, 8, -8],
  },

  // Ambient light (overall illumination)
  ambient: {
    color: 0xffffff,
    intensity: 0.36,
  },

  // Hemisphere light (optional upgrade for richer ambient)
  hemisphere: {
    enabled: false, // can be enabled for visual upgrade
    skyColor: 0x87ceeb,
    groundColor: 0x6b5d4f,
    intensity: 0.5,
  },
};

// ============================================================================
// CAMERA DEFAULTS
// ============================================================================

export const CAMERA_CONFIG = {
  fov: 45, // field of view in degrees
  near: 0.1,
  far: 500,
};

// ============================================================================
// MATERIAL LIBRARY
// ============================================================================

/**
 * Create a terrain material for hexagon tiles.
 * @param {Object} tile - The tile object
 * @param {THREE} THREE - Three.js library reference
 * @returns {THREE.MeshStandardMaterial}
 */
export function createTerrainMaterial(tile, THREE) {
  const color = terrainColor(tile);
  const isWater = isWaterLike(tile);

  return new THREE.MeshStandardMaterial({
    color,
    roughness: isWater ? 0.45 : 0.86,
    metalness: isWater ? 0.12 : 0.04,
    emissive: new THREE.Color(color).multiplyScalar(isWater ? 0.14 : 0.04),
  });
}

/**
 * Get material for a tile (wrapper for easy future expansion).
 * @param {Object} tile - The tile object
 * @param {THREE} THREE - Three.js library reference
 * @returns {THREE.MeshStandardMaterial}
 */
export function getTileMaterial(tile, THREE) {
  return createTerrainMaterial(tile, THREE);
}

// ============================================================================
// MATERIAL PRESETS (used by decoration helpers)
// ============================================================================

export const MATERIAL_PRESETS = {
  // Rock/stone materials
  rock: (THREE) => new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.96, metalness: 0 }),
  snow: (THREE) => new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.88 }),
  mountain: (THREE) => new THREE.MeshStandardMaterial({ color: 0x7a7060, roughness: 0.92, metalness: 0 }),

  // Wood materials
  wood: (THREE, colorOverride) => new THREE.MeshStandardMaterial({
    color: colorOverride || 0x8b6240,
    roughness: 0.72,
  }),
  darkWood: (THREE) => new THREE.MeshStandardMaterial({ color: 0x4f4037, roughness: 0.9 }),

  // Metal materials
  darkMetal: (THREE) => new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.8 }),
  metalArmor: (THREE) => new THREE.MeshStandardMaterial({ color: 0xc8c2b8, metalness: 0.32, roughness: 0.45 }),

  // Structural materials
  dock: (THREE) => new THREE.MeshStandardMaterial({ color: 0x8b6240, roughness: 0.72 }),
  silo: (THREE) => new THREE.MeshStandardMaterial({ color: 0xded5a8, roughness: 0.62 }),
  greenhouse: (THREE) => new THREE.MeshStandardMaterial({ color: 0xb7e4d8, transparent: true, opacity: 0.76 }),

  // Vegetation
  grassLight: (THREE) => new THREE.MeshStandardMaterial({ color: 0x7fc66c }),
  grassDark: (THREE) => new THREE.MeshStandardMaterial({ color: 0x5fb15b }),
  treeGreen: (THREE) => new THREE.MeshStandardMaterial({ color: 0x2f8a55 }),
  jungleGreen: (THREE) => new THREE.MeshStandardMaterial({ color: 0x3f7f46 }),
  reeds: (THREE) => new THREE.MeshStandardMaterial({ color: 0x2f5d58, roughness: 0.72 }),

  // Water
  water: (THREE) => new THREE.MeshStandardMaterial({ color: 0x2e6f95 }),
  waterTransparent: (THREE) => new THREE.MeshStandardMaterial({
    color: 0x79cce7,
    transparent: true,
    opacity: 0.56,
  }),

  // Ground/soil
  sand: (THREE) => new THREE.MeshStandardMaterial({ color: 0xc99755, roughness: 0.88 }),
  soil: (THREE) => new THREE.MeshStandardMaterial({ color: 0x8d7251, roughness: 0.86 }),
  pebble: (THREE) => new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.92 }),

  // Basic materials
  cloud: (THREE) => new THREE.MeshBasicMaterial({
    color: 0xf2efe5,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
  }),
  wave: (THREE, colorOverride) => new THREE.MeshBasicMaterial({
    color: colorOverride || 0x79cce7,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  }),
  smoke: (THREE, colorOverride) => new THREE.MeshBasicMaterial({
    color: colorOverride || 0xb9bec4,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  }),
};

/**
 * Get a preset material by name, or create custom with color override.
 * @param {string} name - Material preset name (e.g., 'rock', 'wood')
 * @param {THREE} THREE - Three.js library reference
 * @param {number|null} colorOverride - Optional hex color to override
 * @returns {THREE.Material}
 */
export function getMaterialPreset(name, THREE, colorOverride = null) {
  const factory = MATERIAL_PRESETS[name];
  if (!factory) {
    console.warn(`Material preset "${name}" not found, using rock as fallback`);
    return MATERIAL_PRESETS.rock(THREE);
  }
  return factory(THREE, colorOverride);
}

// ============================================================================
// COLOR UTILITIES
// ============================================================================

/**
 * Determine terrain color based on tile properties.
 * @param {Object} tile - Tile with terrain, biome, type, etc.
 * @returns {number} Hex color
 */
function terrainColor(tile) {
  if (tile.type === TILE_TYPES.EMPTY && tile.terrain === "land") {
    return BIOME_COLORS[tile.biome] || BIOME_COLORS.grassland;
  }
  return TILE_COLORS[tile.type] || TILE_COLORS[TILE_TYPES.EMPTY];
}

/**
 * Convert hex string (#RRGGBB) to integer color value.
 * @param {string} hex - Hex color string
 * @returns {number} Integer color value
 */
export function colorFromHex(hex) {
  const value = String(hex || "#ffffff").replace("#", "");
  return Number.parseInt(value, 16);
}

/**
 * Convert integer color value to hex string.
 * @param {number} color - Integer color value
 * @returns {string} Hex color string with #
 */
export function colorToHex(color) {
  return "#" + color.toString(16).padStart(6, "0");
}

// ============================================================================
// EXPORT SUMMARY
// ============================================================================

/**
 * Configuration export for easy reference and updates.
 * All rendering defaults and material presets are centralized here.
 */
export const RENDERING_PRESETS = {
  renderer: RENDERER_CONFIG,
  scene: SCENE_CONFIG,
  lighting: LIGHTING_CONFIG,
  camera: CAMERA_CONFIG,
  materials: MATERIAL_PRESETS,
};
