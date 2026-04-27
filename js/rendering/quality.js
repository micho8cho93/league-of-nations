/**
 * Quality settings system for Three.js rendering.
 * Controls performance vs visual fidelity based on device capabilities.
 *
 * Supports three preset levels: 'low', 'medium', 'high'
 * Can be overridden with custom settings for fine-tuning.
 */

/**
 * Quality preset definitions.
 * Each preset controls different rendering parameters.
 */
export const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1,
    shadowsEnabled: false,
    shadowMapSize: 512,
    fogEnabled: true,
    decorationDensity: 0.5, // 50% of decorations
    animationDetail: 0.6, // 60% animation complexity
    maxInstancesPerMesh: 100,
  },
  medium: {
    pixelRatio: 1.5,
    shadowsEnabled: false,
    shadowMapSize: 1024,
    fogEnabled: true,
    decorationDensity: 0.8,
    animationDetail: 0.9,
    maxInstancesPerMesh: 200,
  },
  high: {
    pixelRatio: 2,
    shadowsEnabled: false, // disabled by default even in high (can enable if needed)
    shadowMapSize: 2048,
    fogEnabled: true,
    decorationDensity: 1.0,
    animationDetail: 1.0,
    maxInstancesPerMesh: 500,
  },
};

/**
 * Current active quality settings.
 * Initialized to medium, can be changed via setQualityLevel()
 */
let currentQuality = { ...QUALITY_PRESETS.medium };
let currentQualityLevel = "medium";

/**
 * Set the quality level by preset name.
 * @param {string} level - 'low', 'medium', or 'high'
 * @param {Object} overrides - Optional object to override specific settings
 */
export function setQualityLevel(level = "medium", overrides = {}) {
  if (!QUALITY_PRESETS[level]) {
    console.warn(`Unknown quality level "${level}", using "medium"`);
    level = "medium";
  }
  currentQualityLevel = level;
  currentQuality = { ...QUALITY_PRESETS[level], ...overrides };
  console.log(`Quality level set to: ${level}`, currentQuality);
}

/**
 * Get current quality settings.
 * @returns {Object} Current quality configuration
 */
export function getQualitySettings() {
  return { ...currentQuality };
}

/**
 * Get current quality level name.
 * @returns {string} The preset name: 'low', 'medium', or 'high'
 */
export function getQualityLevel() {
  return currentQualityLevel;
}

/**
 * Update a specific quality setting without changing the preset.
 * @param {string} key - Setting key (e.g., 'pixelRatio', 'shadowsEnabled')
 * @param {*} value - New value
 */
export function updateQualitySetting(key, value) {
  currentQuality[key] = value;
  console.log(`Quality setting updated: ${key} = ${value}`);
}

/**
 * Detect recommended quality level based on device.
 * Uses window.devicePixelRatio and navigator info to estimate device capability.
 * @returns {string} Recommended quality level: 'low', 'medium', or 'high'
 */
export function detectRecommendedQuality() {
  const dpr = window.devicePixelRatio || 1;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

  // Heuristic: prioritize lower quality on mobile or low DPI
  if (isMobile) return "low";
  if (dpr < 1.5) return "low";
  if (dpr < 2) return "medium";
  return "high";
}

/**
 * Apply quality settings to Three.js renderer and scene.
 * Call this after creating renderer and scene to apply current quality.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.DirectionalLight} keyLight - The main directional light
 * @param {THREE} THREE - Three.js library reference
 */
export function applyQualitySettings(renderer, scene, keyLight, THREE) {
  const settings = getQualitySettings();

  // Apply pixel ratio
  const actualPixelRatio = Math.min(settings.pixelRatio, window.devicePixelRatio || 1);
  renderer.setPixelRatio(actualPixelRatio);

  // Apply shadows
  renderer.shadowMap.enabled = settings.shadowsEnabled;
  if (keyLight) {
    keyLight.castShadow = settings.shadowsEnabled;
    if (settings.shadowsEnabled) {
      keyLight.shadow.mapSize.width = settings.shadowMapSize;
      keyLight.shadow.mapSize.height = settings.shadowMapSize;
    }
  }

  // Apply fog
  if (scene.fog) {
    scene.fog = settings.fogEnabled
      ? new THREE.Fog(0x1a3a4d, 8, 140)
      : null;
  }

  console.log(
    `Quality settings applied: pixelRatio=${actualPixelRatio}, ` +
    `shadows=${settings.shadowsEnabled}, fog=${settings.fogEnabled}`
  );
}

/**
 * Get decoration density multiplier.
 * Use when deciding whether to render a decoration.
 * @example
 * if (Math.random() > getDecorationDensity()) return; // skip decoration
 *
 * @returns {number} 0-1, where 1 = all decorations, 0.5 = half
 */
export function getDecorationDensity() {
  return getQualitySettings().decorationDensity;
}

/**
 * Check if animation detail is sufficient for a given detail level.
 * @example
 * if (!shouldAnimateDetail(0.8)) return; // skip detailed animation
 *
 * @param {number} requiredDetail - 0-1, animation detail requirement
 * @returns {boolean} True if the animation should run
 */
export function shouldAnimateDetail(requiredDetail = 1.0) {
  return getQualitySettings().animationDetail >= requiredDetail;
}

/**
 * Get maximum instances per InstancedMesh for this quality level.
 * Used when batching repeated decorations.
 * @returns {number}
 */
export function getMaxInstancesPerMesh() {
  return getQualitySettings().maxInstancesPerMesh;
}
