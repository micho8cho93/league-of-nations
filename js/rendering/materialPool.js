/**
 * Material pooling system to avoid creating duplicate materials.
 * Materials are expensive to create and keep in memory, so we cache and reuse them.
 *
 * Instead of:
 *   new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.96 })  // Every decoration
 *
 * We do:
 *   getMaterial('rock')  // Reused across all decorations
 */

const materialCache = new Map();

/**
 * Get or create a material from the pool.
 * Materials are cached by a unique key and reused across the scene.
 *
 * @param {string} key - Unique cache key (e.g., 'rock', 'grassLight', 'water_0x2e6f95')
 * @param {Function} factory - Function that creates the material if not cached
 *                              Should return THREE.Material
 * @returns {THREE.Material}
 */
export function getMaterial(key, factory) {
  if (materialCache.has(key)) {
    return materialCache.get(key);
  }

  if (typeof factory !== "function") {
    console.warn(`Material pool: factory must be a function for key "${key}"`);
    return null;
  }

  const material = factory();
  materialCache.set(key, material);
  return material;
}

/**
 * Get material by preset name (e.g., 'rock', 'wood', 'grassLight').
 * Wraps getMaterialPreset from config.js and adds caching.
 *
 * @param {string} name - Material preset name
 * @param {THREE} THREE - Three.js library
 * @param {number|null} colorOverride - Optional color override (creates unique cache key)
 * @returns {THREE.Material}
 */
export function getMaterialPreset(name, THREE, colorOverride = null) {
  const { getMaterialPreset: getPreset } = window.__renderingConfig || {};
  if (!getPreset) {
    console.error("Material presets not available - ensure config.js is loaded first");
    return new THREE.MeshStandardMaterial({ color: 0x888888 });
  }

  // Create unique cache key: include color override to differentiate
  const cacheKey = colorOverride ? `${name}_${colorOverride.toString(16)}` : name;

  return getMaterial(cacheKey, () => getPreset(name, THREE, colorOverride));
}

/**
 * Get or create a color-specific material.
 * Useful for owner colors, nation colors, etc.
 * Caches by key and color to avoid recreating identical materials.
 *
 * @param {string} materialType - Type of material (e.g., 'territoryRing', 'ownerFlag')
 * @param {number} color - Hex color value
 * @param {Function} factory - Function to create material if not cached
 * @returns {THREE.Material}
 */
export function getColoredMaterial(materialType, color, factory) {
  const cacheKey = `${materialType}_${color.toString(16)}`;
  return getMaterial(cacheKey, factory);
}

/**
 * Dispose all cached materials.
 * Call this when cleaning up or changing scenes.
 */
export function disposeMaterialCache() {
  materialCache.forEach((material) => {
    if (material.dispose) {
      material.dispose();
    }
  });
  materialCache.clear();
  console.log("Material cache disposed");
}

/**
 * Get cache statistics (for debugging/profiling).
 * @returns {Object} { size, keys }
 */
export function getMaterialCacheStats() {
  return {
    size: materialCache.size,
    keys: Array.from(materialCache.keys()),
  };
}

/**
 * Preload common materials to avoid creation stalls.
 * Call during initialization.
 *
 * @param {THREE} THREE
 */
export function preloadCommonMaterials(THREE) {
  const commons = [
    "rock",
    "mountain",
    "wood",
    "darkMetal",
    "grassLight",
    "grassDark",
    "treeGreen",
    "water",
    "sand",
    "pebble",
  ];

  // Try to load presets if available
  const { getMaterialPreset: getPreset } = window.__renderingConfig || {};
  if (!getPreset) {
    console.warn("Material presets not available for preloading");
    return;
  }

  commons.forEach((name) => {
    try {
      getMaterial(name, () => getPreset(name, THREE));
    } catch (e) {
      console.warn(`Failed to preload material "${name}":`, e.message);
    }
  });

  console.log(`Preloaded ${getMaterialCacheStats().size} common materials`);
}
