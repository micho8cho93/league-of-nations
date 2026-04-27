/**
 * GLB/GLTF asset loader with transparent procedural fallback.
 *
 * Preloads all registered GLB models once at game start.  Every call to
 * getModelSync() is synchronous: it returns a cached GLB clone when available,
 * or silently falls back to the procedural Three.js model otherwise.  The game
 * is never blocked — 404s for not-yet-authored models resolve immediately.
 *
 * Public API
 * ──────────
 *   preloadAll()               → Promise<void>  (await before first render)
 *   getModelSync(key, options) → THREE.Object3D | null
 *   hasGLB(key)                → boolean
 *   exposeDebug()              → void  (attaches window.__assetLoader)
 *
 * Dropping a file into assets/models/ is all that's needed to switch from
 * procedural to GLB — no gameplay or rendering code changes required.
 */

import { MODEL_REGISTRY } from "./modelRegistry.js";

// ── Internal state ─────────────────────────────────────────────────────────────

/** @type {Map<string, THREE.Object3D|null>}  null = tried and failed (404 or parse error) */
const _cache = new Map();

/** @type {Map<string, Promise<THREE.Object3D|null>>}  dedup in-flight requests */
const _inFlight = new Map();

// ── Internal loader ────────────────────────────────────────────────────────────

/**
 * Attempt to load a single GLB by registry key.
 * Resolves to the root Object3D on success, or null on any failure.
 * Results are stored in _cache so getModelSync() can use them synchronously.
 *
 * @param {string} key
 * @returns {Promise<THREE.Object3D|null>}
 */
function _loadGLB(key) {
  if (_inFlight.has(key)) return _inFlight.get(key);

  const entry = MODEL_REGISTRY[key];
  if (!entry?.path) {
    _cache.set(key, null);
    return Promise.resolve(null);
  }

  const THREE = window.THREE;
  if (!THREE?.GLTFLoader) {
    // GLTFLoader script not loaded — skip silently; procedural fallback used.
    _cache.set(key, null);
    return Promise.resolve(null);
  }

  const promise = (async () => {
    // Probe the URL first so missing assets stay silent in the browser console.
    if (!(await _assetExists(entry.path))) {
      _cache.set(key, null);
      _inFlight.delete(key);
      return null;
    }

    return new Promise((resolve) => {
      const loader = new THREE.GLTFLoader();
      loader.load(
        entry.path,
        (gltf) => {
          const model = gltf.scene;

          // Bake in scale correction so callers don't need to worry about it.
          if (typeof entry.normalizeScale === "number" && entry.normalizeScale !== 1) {
            model.scale.setScalar(entry.normalizeScale);
          }

          // Optional Y-axis rotation for exporters that used Z-up convention.
          if (typeof entry.upRotation === "number") {
            model.rotation.y = entry.upRotation;
          }

          // Preserve animation clips on userData for future AnimationMixer use.
          //   Clip names to wire up: "Idle", "Move", "Attack", "Hit", "Death"
          if (gltf.animations?.length) {
            model.userData.animations = gltf.animations;
          }

          // Enable shadow casting on every mesh in the loaded model.
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          _cache.set(key, model);
          _inFlight.delete(key);
          resolve(model);
        },
        undefined, // progress callback — unused
        (error) => {
          // Missing files are expected while authored assets are phased in.
          if (!_isExpectedMissingAssetError(error)) {
            console.warn(`[assetLoader] "${key}" load error:`, error);
          }
          _cache.set(key, null);
          _inFlight.delete(key);
          resolve(null);
        }
      );
    });
  })();

  _inFlight.set(key, promise);
  return promise;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Preload all registered GLB models in parallel.
 *
 * Safe to call when no .glb files are present — every 404 resolves silently.
 * Idempotent: already-loaded or already-failed keys are skipped on repeat calls.
 *
 * @returns {Promise<void>}
 */
export async function preloadAll() {
  const pending = Object.keys(MODEL_REGISTRY).filter(
    (key) => !_cache.has(key) && !_inFlight.has(key)
  );
  await Promise.all(pending.map(_loadGLB));
}

/**
 * Synchronously return a scene-graph instance for the given model key.
 *
 * Resolution order:
 *   1. Cached GLB → returns a deep clone (geometry/materials shared, transforms independent).
 *   2. No GLB (file missing or not yet loaded) → calls the registry's procedural factory.
 *   3. No procedural factory defined → returns null.
 *
 * @param {string}  key              - Registry key (e.g. "infantry", "tank", "city")
 * @param {Object}  [options]        - Forwarded verbatim to the procedural fallback factory.
 * @param {number}  [options.color]      - Primary color for the procedural model.
 * @param {number}  [options.ownerColor] - Nation accent color; applied to GLB accent meshes too.
 * @param {number}  [options.scale]      - Additional uniform scale applied after model creation.
 * @returns {THREE.Object3D|null}
 */
export function getModelSync(key, options = {}) {
  const entry = MODEL_REGISTRY[key];
  if (!entry) {
    console.warn(`[assetLoader] Unknown model key: "${key}"`);
    return null;
  }

  const cached = _cache.get(key);

  if (cached) {
    const instance = _cloneModel(cached);

    // Tint nation-accent meshes if caller provides an ownerColor.
    if (options.ownerColor) _applyNationColor(instance, options.ownerColor);

    // Apply caller-supplied scale on top of the baked normalizeScale.
    if (options.scale && options.scale !== 1) instance.scale.multiplyScalar(options.scale);

    return instance;
  }

  // No GLB available — delegate to the procedural constructor.
  if (entry.procedural) return entry.procedural(options);

  return null;
}

/**
 * Return true if a GLB for this key loaded successfully.
 *
 * Use this to decide whether to skip inline procedural rendering code:
 *
 *   if (!this._tryBuildingModel(group, 'farm', opts)) {
 *     // inline procedural farm code runs only when no GLB is loaded
 *   }
 *
 * @param {string} key
 * @returns {boolean}
 */
export function hasGLB(key) {
  // Explicitly stored null = tried and failed.  undefined = not yet attempted.
  return _cache.get(key) != null;
}

/**
 * Attach the loader state to window.__assetLoader for browser-console debugging.
 * Call once after preloadAll() to inspect cache hits/misses.
 *
 *   window.__assetLoader.cache          — Map of key → loaded model or null
 *   window.__assetLoader.hasGLB('tank') — quick availability check
 */
export function exposeDebug() {
  window.__assetLoader = { cache: _cache, registry: MODEL_REGISTRY, preloadAll, getModelSync, hasGLB };
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Deep-clone a loaded scene so each tile placement gets independent transforms.
 * Geometry and materials are shared across clones for memory efficiency.
 *
 * @param {THREE.Object3D} model
 * @returns {THREE.Object3D}
 */
function _cloneModel(model) {
  const skeletonUtils = window.THREE?.SkeletonUtils;
  if (skeletonUtils?.clone) return skeletonUtils.clone(model);
  return model.clone(true);
}

/**
 * Check whether an asset URL exists without triggering noisy browser console errors.
 *
 * Uses HEAD first for minimal transfer. Some static hosts reject HEAD, so 405 falls
 * back to a normal GET probe. Any failed probe is treated as "asset absent".
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function _assetExists(path) {
  if (typeof fetch !== "function") return true;
  try {
    const head = await fetch(path, { method: "HEAD", cache: "no-store" });
    if (head.ok) return true;
    if (head.status !== 405) return false;
  } catch {
    return false;
  }

  try {
    const get = await fetch(path, { method: "GET", cache: "no-store" });
    return get.ok;
  } catch {
    return false;
  }
}

/**
 * Treat the common "file missing" shapes as expected so zero-asset repos stay quiet.
 * GLTFLoader often reports 404s as ProgressEvents rather than Error objects.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function _isExpectedMissingAssetError(error) {
  if (!error) return false;
  if (typeof ProgressEvent !== "undefined" && error instanceof ProgressEvent) return true;
  const msg = String(error?.message || error || "");
  return /404|not found|failed to fetch/i.test(msg);
}

/**
 * Tint meshes whose userData.nationAccent is truthy to the given color.
 *
 * In Blender: select a mesh → Object Properties → Custom Properties →
 * add integer "nationAccent" = 1.  The glTF exporter writes this into
 * mesh.userData, so this traversal picks it up automatically.
 *
 * @param {THREE.Object3D} model - Cloned instance (mutated in place).
 * @param {number}         color - Hex integer, e.g. 0xff4400.
 */
function _applyNationColor(model, color) {
  const THREE = window.THREE;
  const accentColor = new THREE.Color(color);
  const emissive = accentColor.clone().multiplyScalar(0.08);

  model.traverse((child) => {
    if (!child.isMesh || !child.userData?.nationAccent) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (m?.color) m.color.copy(accentColor);
      if (m?.emissive) m.emissive.copy(emissive);
    }
  });
}
