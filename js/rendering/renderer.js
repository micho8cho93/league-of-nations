/**
 * Renderer initialization and configuration.
 * Handles WebGLRenderer setup, scene configuration, and lighting.
 */

import { RENDERER_CONFIG, SCENE_CONFIG, LIGHTING_CONFIG, CAMERA_CONFIG, MATERIAL_PRESETS } from "./config.js";

/**
 * Initialize WebGLRenderer with optimized settings.
 * @param {HTMLCanvasElement} canvas - Canvas element to render to
 * @param {THREE} THREE - Three.js library reference
 * @returns {Object} { renderer, scene, camera }
 */
export function createRenderer(canvas, THREE = window.THREE) {
  if (!THREE) throw new Error("Three.js is not available");

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: RENDERER_CONFIG.antialias,
    alpha: RENDERER_CONFIG.alpha,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDERER_CONFIG.pixelRatioCap));

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
 * @param {THREE.Scene} scene - Scene to configure
 * @param {THREE} THREE - Three.js library reference
 */
export function setupScene(scene, THREE = window.THREE) {
  if (!THREE) throw new Error("Three.js is not available");

  // Set background color
  scene.background = new THREE.Color(SCENE_CONFIG.backgroundColor);

  // Add fog for depth perception
  if (SCENE_CONFIG.fog.enabled) {
    scene.fog = new THREE.Fog(
      SCENE_CONFIG.fog.color,
      SCENE_CONFIG.fog.near,
      SCENE_CONFIG.fog.far
    );
  }

  // Key light (main directional light)
  const keyLight = new THREE.DirectionalLight(
    LIGHTING_CONFIG.key.color,
    LIGHTING_CONFIG.key.intensity
  );
  keyLight.position.set(...LIGHTING_CONFIG.key.position);
  keyLight.castShadow = LIGHTING_CONFIG.key.castShadow;
  if (LIGHTING_CONFIG.key.castShadow) {
    keyLight.shadow.mapSize.width = LIGHTING_CONFIG.key.shadowMapSize;
    keyLight.shadow.mapSize.height = LIGHTING_CONFIG.key.shadowMapSize;
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
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {THREE} THREE - Three.js library reference
 * @returns {Object} { renderer, scene, camera }
 */
export function initializeRenderingSystem(canvas, THREE = window.THREE) {
  const { renderer, scene, camera } = createRenderer(canvas, THREE);
  setupScene(scene, THREE);
  setupCamera(camera, THREE);
  configureRenderer(renderer);
  return { renderer, scene, camera };
}
