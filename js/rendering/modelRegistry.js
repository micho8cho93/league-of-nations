/**
 * Model registry: maps logical model keys to their GLB asset paths and procedural fallbacks.
 *
 * To add a new model, drop the .glb file into assets/models/ and it will be
 * picked up automatically at game start — no gameplay code changes needed.
 *
 * =============================================================================
 * GLB EXPORT GUIDELINES (Blender or any DCC tool)
 * =============================================================================
 *
 * Mesh
 * ─────
 *   - Low-poly: keep under 5 000 triangles per model (under 2 000 preferred).
 *   - Centered origin: place the object origin at the model's base — Y = 0 at
 *     the feet/keel/foundation, so the model sits flush on the hex tile surface.
 *   - Y-up orientation: in Blender's glTF export dialog select "Y Up" so the
 *     model is upright in Three.js without a rotation correction.
 *   - Consistent scale: 1 Blender unit = 1 Three.js world unit.  The entire
 *     model should fit inside a ≈ 1 × 1 × 1 bounding box.
 *
 * Textures
 * ─────────
 *   - Embed textures inside the .glb (no separate .png files).
 *   - Maximum atlas size: 512 × 512 px.  256 × 256 preferred for mobile.
 *   - Avoid normal maps unless detail truly warrants the cost.
 *
 * Nation accent color
 * ────────────────────
 *   - In Blender: select the mesh(es) that should take on the owning nation's
 *     color, open Object Properties → Custom Properties, and add an integer
 *     property named "nationAccent" with value 1.
 *   - The glTF exporter writes Object Custom Properties into mesh.userData, so
 *     assetLoader.js can find and tint them automatically at runtime.
 *
 * Animation clips (units only)
 * ─────────────────────────────
 *   Name clips exactly as listed; extra clips are ignored.
 *   - "Idle"   — looping idle stance (required for all units)
 *   - "Move"   — walking / driving / sailing cycle
 *   - "Attack" — fire / strike animation
 *   - "Hit"    — receive-damage reaction
 *   - "Death"  — destruction / death sequence
 *   Clips are stored in model.userData.animations and can be driven by a
 *   Three.js AnimationMixer in a future animation pass.
 *
 * =============================================================================
 */

import {
  createLowPolyInfantry,
  createLowPolyTank,
  createLowPolyAircraft,
  createLowPolyShip,
  createLowPolyCity,
  createLowPolyFarm,
  createLowPolyMine,
  createLowPolyFactory,
  createLowPolySchool,
  createLowPolyPort,
  createLowPolyAirport,
} from "./assets.js";

/**
 * @typedef {Object} RegistryEntry
 * @property {string}         path             - URL to the .glb file (relative to page root).
 * @property {Function|null}  procedural       - Fallback factory: (options) → THREE.Object3D.
 *                                               null = tile type has no single-object fallback.
 * @property {number}         [normalizeScale] - Uniform scale applied after loading so the
 *                                               GLB footprint matches the procedural model
 *                                               (default: 1, i.e., no correction needed).
 * @property {number}         [upRotation]     - Extra Y-axis rotation (radians) applied after
 *                                               loading, for exporters that used Z-up convention.
 */

/** @type {Object<string, RegistryEntry>} */
export const MODEL_REGISTRY = {
  // ── Units ─────────────────────────────────────────────────────────────────

  /** Infantry squad. GLB should represent a single soldier; assetLoader places it. */
  infantry: {
    path: "assets/models/infantry.glb",
    procedural: (opts) => createLowPolyInfantry(opts),
    normalizeScale: 1,
  },

  /** Armoured vehicle. Include a child named "turret" for scan animation support. */
  tank: {
    path: "assets/models/tank.glb",
    procedural: (opts) => createLowPolyTank(opts),
    normalizeScale: 1,
  },

  /** Fighter / bomber. Modelled pointing along +X, tilted slightly for action pose. */
  plane: {
    path: "assets/models/plane.glb",
    procedural: (opts) => createLowPolyAircraft(opts),
    normalizeScale: 1,
  },

  /** Naval vessel. Hull keel at Y = 0; superstructure rises above. */
  ship: {
    path: "assets/models/ship.glb",
    procedural: (opts) => createLowPolyShip(opts),
    normalizeScale: 1,
  },

  // ── Settlements ───────────────────────────────────────────────────────────

  /**
   * Generic settlement / military-base structure (MILITARY tile type).
   * Nation flag and garrisoned units are always added procedurally on top.
   * Mark nation-color mesh(es) with Custom Property "nationAccent" = 1.
   */
  city: {
    path: "assets/models/city.glb",
    procedural: (opts) => createLowPolyCity(opts),
    normalizeScale: 1,
  },

  /**
   * Capital city marker — replaces the plinth + crown on capital tiles.
   * Glow rings and flag are still added procedurally on top.
   */
  capital: {
    path: "assets/models/capital.glb",
    procedural: (opts) => createLowPolyCity({ ...opts, scale: (opts?.scale || 1) * 1.25 }),
    normalizeScale: 1,
  },

  // ── Resource buildings ────────────────────────────────────────────────────

  /** Agricultural plots (FARM tile). Workers are added procedurally only in fallback mode. */
  farm: {
    path: "assets/models/farm.glb",
    procedural: (opts) => createLowPolyFarm(opts),
    normalizeScale: 1,
  },

  /** Mine shaft + ore pile (MINE / MOUNTAIN_MINE tile). */
  mine: {
    path: "assets/models/mine.glb",
    procedural: (opts) => createLowPolyMine(opts),
    normalizeScale: 1,
  },

  /** Factory building (FACTORY tile). */
  factory: {
    path: "assets/models/factory.glb",
    procedural: (opts) => createLowPolyFactory(opts),
    normalizeScale: 1,
  },

  /**
   * Research / university building (SCHOOL and UNIVERSITY tile types).
   * Both tile types use this key; visual tier differences are baked into the
   * procedural fallback but GLB authors can choose a single representative model.
   */
  university: {
    path: "assets/models/university.glb",
    procedural: (opts) => createLowPolySchool(opts),
    normalizeScale: 1,
  },

  // ── Infrastructure ────────────────────────────────────────────────────────

  /**
   * Road surface marker (ROAD + HIGHWAY tile types).
   * No single-object procedural fallback — inline tile geometry handles it.
   */
  road: {
    path: "assets/models/road.glb",
    procedural: null,
    normalizeScale: 1,
  },

  /**
   * Rail track marker (RAILROAD tile type).
   * No single-object procedural fallback — inline tile geometry handles it.
   */
  rail: {
    path: "assets/models/rail.glb",
    procedural: null,
    normalizeScale: 1,
  },

  /**
   * Port / dock structure (FISHERY tile type).
   * The fishing boat (ship unit) is always added on top regardless of GLB.
   */
  port: {
    path: "assets/models/port.glb",
    procedural: (opts) => createLowPolyPort(opts),
    normalizeScale: 1,
  },

  /**
   * Airport terminal + runway (AIRPORT tile type).
   * The parked plane unit is always added on top regardless of GLB.
   */
  airport: {
    path: "assets/models/airport.glb",
    procedural: (opts) => createLowPolyAirport(opts),
    normalizeScale: 1,
  },
};
