/**
 * Renderer initialization and configuration.
 * Handles WebGLRenderer setup, scene configuration, and lighting.
 *
 * OPTIMIZATION: This module integrates with quality.js for performance tuning.
 * Call setQualityLevel() before creating the renderer to control visual fidelity.
 */

import { RENDERER_CONFIG, SCENE_CONFIG, LIGHTING_CONFIG, CAMERA_CONFIG, MATERIAL_PRESETS, initializeConfigGlobals } from "./config.js";
import { getQualitySettings, applyQualitySettings } from "./quality.js";

/**
 * Initialize WebGLRenderer with optimized settings.
 * Respects quality settings from quality.js.
 *
 * @param {HTMLCanvasElement} canvas - Canvas element to render to
 * @param {THREE} THREE - Three.js library reference
 * @returns {Object} { renderer, scene, camera }
 */
export function createRenderer(canvas, THREE = window.THREE) {
  if (!THREE) throw new Error("Three.js is not available");

  // Initialize global config references for material pooling
  initializeConfigGlobals();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: RENDERER_CONFIG.antialias,
    alpha: RENDERER_CONFIG.alpha,
  });

  // Apply quality-aware pixel ratio
  const qualitySettings = getQualitySettings();
  const actualPixelRatio = Math.min(
    qualitySettings.pixelRatio,
    window.devicePixelRatio || 1,
    RENDERER_CONFIG.pixelRatioCap
  );
  renderer.setPixelRatio(actualPixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    CAMERA_CONFIG.fov,
    1, // aspect ratio will be set during resize
    CAMERA_CONFIG.near,
    CAMERA_CONFIG.far
  );

  return { renderer, scene, camera };
}

/**
 * Configure scene with background, fog, and lighting.
 * Uses quality settings to control shadows, fog, and lighting intensity.
 *
 * @param {THREE.Scene} scene - Scene to configure
 * @param {THREE.WebGLRenderer} renderer - Renderer (needed to apply shadow settings)
 * @param {THREE} THREE - Three.js library reference
 * @returns {THREE.DirectionalLight} The key light (for later quality adjustments)
 */
export function setupScene(scene, renderer, THREE = window.THREE) {
  if (!THREE) throw new Error("Three.js is not available");

  // Set background color
  scene.background = new THREE.Color(SCENE_CONFIG.backgroundColor);

  // Add fog for depth perception (quality-aware)
  const qualitySettings = getQualitySettings();
  if (SCENE_CONFIG.fog.enabled && qualitySettings.fogEnabled) {
    scene.fog = new THREE.Fog(
      SCENE_CONFIG.fog.color,
      SCENE_CONFIG.fog.near,
      SCENE_CONFIG.fog.far
    );
  }

  // Key light (main directional light) - shadows controlled by quality
  const keyLight = new THREE.DirectionalLight(
    LIGHTING_CONFIG.key.color,
    LIGHTING_CONFIG.key.intensity
  );
  keyLight.position.set(...LIGHTING_CONFIG.key.position);
  keyLight.castShadow = qualitySettings.shadowsEnabled && LIGHTING_CONFIG.key.castShadow;
  if (keyLight.castShadow) {
    keyLight.shadow.mapSize.width = qualitySettings.shadowMapSize;
    keyLight.shadow.mapSize.height = qualitySettings.shadowMapSize;
  }
  scene.add(keyLight);

  // Fill light (secondary directional light)
  const fillLight = new THREE.DirectionalLight(
    LIGHTING_CONFIG.fill.color,
    LIGHTING_CONFIG.fill.intensity
  );
  fillLight.position.set(...LIGHTING_CONFIG.fill.position);
  scene.add(fillLight);

  // Ambient light (overall scene illumination)
  const ambientLight = new THREE.AmbientLight(
    LIGHTING_CONFIG.ambient.color,
    LIGHTING_CONFIG.ambient.intensity
  );
  scene.add(ambientLight);

  // Optional hemisphere light for richer ambient
  if (LIGHTING_CONFIG.hemisphere.enabled) {
    const hemisphereLight = new THREE.HemisphereLight(
      LIGHTING_CONFIG.hemisphere.skyColor,
      LIGHTING_CONFIG.hemisphere.groundColor,
      LIGHTING_CONFIG.hemisphere.intensity
    );
    scene.add(hemisphereLight);
  }

  // Apply quality settings to renderer shadows
  renderer.shadowMap.enabled = qualitySettings.shadowsEnabled;

  return keyLight;
}

/**
 * Configure camera with default parameters.
 * @param {THREE.PerspectiveCamera} camera - Camera to configure
 * @param {THREE} THREE - Three.js library reference
 */
export function setupCamera(camera, THREE = window.THREE) {
  if (!THREE) throw new Error("Three.js is not available");

  // Camera position will be set by HexMapRenderer._positionCamera()
  // This just ensures the camera is properly initialized
  camera.updateMatrixWorld();
}

/**
 * Apply render settings and return renderer reference for further configuration.
 * @param {THREE.WebGLRenderer} renderer - Renderer to configure
 * @returns {THREE.WebGLRenderer}
 */
export function configureRenderer(renderer) {
  // Additional renderer configuration can be added here
  // Examples: tone mapping, color space, shadow map type, etc.

  // Uncomment for more advanced color management (requires Three.js r128+):
  // renderer.outputColorSpace = THREE.SRGBColorSpace;
  // renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // renderer.toneMappingExposure = 0.8;

  return renderer;
}

/**
 * Create and configure all rendering components at once.
 * Applies quality settings during initialization.
 *
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {THREE} THREE - Three.js library reference
 * @returns {Object} { renderer, scene, camera, keyLight }
 */
export function initializeRenderingSystem(canvas, THREE = window.THREE) {
  const { renderer, scene, camera } = createRenderer(canvas, THREE);
  const keyLight = setupScene(scene, renderer, THREE);
  setupCamera(camera, THREE);
  configureRenderer(renderer);
  return { renderer, scene, camera, keyLight };
}
