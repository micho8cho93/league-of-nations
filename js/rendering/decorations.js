/**
 * Decoration and visual element builders for the game map.
 * Extracted from HexMapRenderer to improve code organization.
 *
 * OPTIMIZATION: This module uses material pooling (materialPool.js) to reuse materials.
 * Instead of creating new materials for every decoration, we cache and reuse them.
 * This significantly reduces memory usage and garbage collection pressure.
 *
 * Functions here are pure geometry builders that create Three.js meshes and groups.
 * They take a `renderer` parameter to register animations with the HexMapRenderer.
 */

import { hash2d } from "../utils.js";
import { getMaterialPreset as getPresetConfig } from "./config.js";
import { getMaterialPreset, getColoredMaterial } from "./materialPool.js";
import { getDecorationDensity } from "./quality.js";
import { createLowPolyInfantry, createLowPolyTank, createLowPolyAircraft, createLowPolyShip } from "./assets.js";
import { getModelSync, hasGLB } from "./assetLoader.js";

const TAU = Math.PI * 2;

// ============================================================================
// HELPER: Quality-Aware Decoration Skipping
// ============================================================================

/**
 * Check if a decoration should be rendered based on quality settings.
 * Uses tile coordinates for deterministic pseudo-random behavior.
 *
 * @param {Object} tile - Tile with q, r coordinates
 * @param {number} salt - Variation salt (e.g., tile.id * 13)
 * @returns {boolean} True if decoration should be rendered
 */
export function shouldRenderDecoration(tile, salt = 0) {
  const density = getDecorationDensity();
  if (density >= 1.0) return true;
  // Use tile hash for deterministic decisions (same tile always same decision)
  const threshold = hash2d(tile.q * 7 + salt, tile.r * 11 - salt, 9999) * (1 - density);
  return threshold > density;
}

// ============================================================================
// HELPER: Animation Registration
// ============================================================================

/**
 * Register an object for animation with the renderer.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Object3D} root - The animation root group
 * @param {THREE.Object3D} object - The object to animate
 * @param {string} kind - Animation kind (e.g., 'spin', 'pulse', 'bob')
 * @param {Object} options - Animation options { phase, duration, amplitude, etc. }
 */
export function registerAnimation(renderer, root, object, kind, options = {}) {
  if (!object || !renderer) return;
  renderer._registerAnimation(root, object, kind, options);
}

/**
 * Get animation phase for a tile (deterministic pseudo-random based on tile + salt).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {Object} tile - Tile with q, r coordinates
 * @param {number} salt - Salt value for variation
 * @returns {number} Phase value in radians
 */
export function getPhaseForTile(renderer, tile, salt = 0) {
  if (!renderer || !tile) return 0;
  return renderer._phaseForTile(tile, salt);
}

// ============================================================================
// SIMPLE GEOMETRY BUILDERS
// ============================================================================

/**
 * Add a crate (box) to a group.
 * Uses material pooling to reuse materials across all crates.
 *
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} color - Hex color value (cached per-color)
 * @returns {THREE.Mesh}
 */
export function addCrate(renderer, group, x, y, z, color = 0xb88755) {
  const THREE = window.THREE;
  const crateMaterial = getColoredMaterial(`crate`, color, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.82 })
  );
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.14), crateMaterial);
  crate.position.set(x, y, z);
  group.add(crate);
  return crate;
}

/**
 * Add a wave (torus) to a group.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, radius, color, phase }
 * @returns {THREE.Mesh}
 */
export function addWave(renderer, group, { x = 0, y = 0.03, z = 0, radius = 0.26, color = 0x79cce7, phase = 0 } = {}) {
  const THREE = window.THREE;
  const wave = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.009, 5, 18),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false })
  );
  wave.rotation.x = Math.PI / 2;
  wave.position.set(x, y, z);
  group.add(wave);
  registerAnimation(renderer, group, wave, "wave", { phase, duration: 11 });
  return wave;
}

/**
 * Add a smoke puff to a group.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, color, phase, scale }
 * @returns {THREE.Mesh}
 */
export function addSmokePuff(renderer, group, { x = 0, y = 0, z = 0, color = 0xb9bec4, phase = 0, scale = 1 } = {}) {
  const THREE = window.THREE;
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(0.065 * scale, 8, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.36, depthWrite: false })
  );
  puff.position.set(x, y, z);
  group.add(puff);
  registerAnimation(renderer, group, puff, "smoke", { phase, duration: 8 + scale * 2, amplitude: scale });
  return puff;
}

// ============================================================================
// NATURE ELEMENTS
// ============================================================================

/**
 * Add land nature (trees, grass, cacti, pebbles) based on biome.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} tile - Tile with biome, q, r, ownerId
 */
export function addLandNature(renderer, group, tile) {
  if (!renderer || !tile) return;
  const seed = renderer.map?.seed || 1;
  const density = hash2d(tile.q * 29 + 5, tile.r * 31 - 7, seed + 5151);
  if (density < 0.32 && tile.ownerId) return;

  const biome = tile.biome || "grassland";
  const count = biome === "jungle"
    ? density > 0.68 ? 5 : 4
    : biome === "woods"
      ? density > 0.72 ? 4 : 3
      : density > 0.76 ? 4 : density > 0.52 ? 3 : 2;

  for (let i = 0; i < count; i += 1) {
    const angle = hash2d(tile.q + i * 13, tile.r - i * 17, seed + 5200) * TAU;
    const dist = 0.16 + hash2d(tile.q - i * 19, tile.r + i * 23, seed + 5300) * 0.36;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const variant = hash2d(tile.q * 3 + i, tile.r * 5 - i, seed + 5400);

    if (biome === "desert") {
      if (variant > 0.62) addCactus(renderer, group, x, 0.02, z, 0.72 + variant * 0.42);
      else addPebble(renderer, group, x, 0.025, z, 0.75 + variant * 0.48, 0xa97842);
    } else if (biome === "arctic") {
      if (variant > 0.52) addPebble(renderer, group, x, 0.025, z, 0.86 + variant * 0.4, 0xd8e1df);
      else addGrassTuft(renderer, group, x, 0.02, z, 0.55 + variant * 0.35, 0xc3d1c7);
    } else if (biome === "jungle") {
      if (variant > 0.28) addTinyTree(renderer, group, x, 0.02, z, 0.92 + variant * 0.55, 0x27723f);
      else addGrassTuft(renderer, group, x, 0.02, z, 0.9 + variant * 0.7, 0x3f9b4d);
    } else if (biome === "woods") {
      if (variant > 0.38) addTinyTree(renderer, group, x, 0.02, z, 0.82 + variant * 0.45, 0x2f7b42);
      else addGrassTuft(renderer, group, x, 0.02, z, 0.72 + variant * 0.5, 0x6b9b52);
    } else if (variant > 0.66) addTinyTree(renderer, group, x, 0.02, z, 0.82 + variant * 0.45);
    else if (variant > 0.34) addPebble(renderer, group, x, 0.025, z, 0.8 + variant * 0.5);
    else addGrassTuft(renderer, group, x, 0.02, z, 0.75 + variant * 0.6);
  }
}

/**
 * Add water nature (reeds, pebbles).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} tile - Tile with q, r
 */
export function addWaterNature(renderer, group, tile) {
  if (!renderer || !tile) return;
  const seed = renderer.map?.seed || 1;
  const count = 1 + Math.floor(hash2d(tile.q * 17, tile.r * 13, seed + 6100) * 3);

  for (let i = 0; i < count; i += 1) {
    const angle = hash2d(tile.q + i * 11, tile.r - i * 7, seed + 6200) * TAU;
    const dist = 0.22 + hash2d(tile.q - i * 5, tile.r + i * 3, seed + 6300) * 0.28;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (hash2d(tile.q + i, tile.r - i, seed + 6400) > 0.45) {
      addReeds(renderer, group, x, 0.02, z);
    } else {
      addPebble(renderer, group, x, 0.02, z, 0.55, 0x6f7d78);
    }
  }
}

/**
 * Add a tiny tree (trunk + cone crown).
 * Uses material pooling; crown color variations are cached separately.
 *
 * OPTIMIZATION: Repeated trees share materials. Crown colors are cached by value.
 *
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 * @param {number} crownColor - Crown color (cached per-color)
 */
export function addTinyTree(renderer, group, x, y, z, scale = 1, crownColor = 0x2f8a55) {
  const THREE = window.THREE;
  const trunkMaterial = getMaterialPreset("wood", THREE, 0x6f4a2d);
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025 * scale, 0.032 * scale, 0.16 * scale, 5),
    trunkMaterial
  );
  trunk.position.set(x, y + 0.08 * scale, z);
  group.add(trunk);

  const crownMaterial = getColoredMaterial("treeGreen", crownColor, () =>
    new THREE.MeshStandardMaterial({ color: crownColor, roughness: 0.9 })
  );
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.12 * scale, 0.24 * scale, 6),
    crownMaterial
  );
  crown.position.set(x, y + 0.25 * scale, z);
  group.add(crown);
}

/**
 * Add grass tuft (cone).
 * Uses material pooling; color variations are cached separately.
 *
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 * @param {number} color - Color (cached per-color)
 */
export function addGrassTuft(renderer, group, x, y, z, scale = 1, color = 0x5aa65a) {
  const THREE = window.THREE;
  const grassMaterial = getColoredMaterial("grass", color, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.94 })
  );
  const tuft = new THREE.Mesh(
    new THREE.ConeGeometry(0.055 * scale, 0.15 * scale, 5),
    grassMaterial
  );
  tuft.position.set(x, y + 0.07 * scale, z);
  tuft.rotation.z = 0.18;
  group.add(tuft);
}

/**
 * Add cactus (stem + arm).
 * Uses material pooling to share cactus material across all instances.
 *
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 */
export function addCactus(renderer, group, x, y, z, scale = 1) {
  const THREE = window.THREE;
  const cactusMat = getMaterialPreset("jungleGreen", THREE);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025 * scale, 0.035 * scale, 0.22 * scale, 6),
    cactusMat
  );
  stem.position.set(x, y + 0.11 * scale, z);
  group.add(stem);

  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014 * scale, 0.018 * scale, 0.12 * scale, 6),
    cactusMat
  );
  arm.position.set(x + 0.055 * scale, y + 0.13 * scale, z);
  arm.rotation.z = Math.PI / 2;
  group.add(arm);
}

/**
 * Add pebble (dodecahedron).
 * Uses material pooling; color variations are cached separately.
 *
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 * @param {number} color - Color (cached per-color)
 */
export function addPebble(renderer, group, x, y, z, scale = 1, color = 0x8b8578) {
  const THREE = window.THREE;
  const pebbleMaterial = getColoredMaterial("pebble", color, () =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.96 })
  );
  const pebble = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.055 * scale, 0),
    pebbleMaterial
  );
  pebble.position.set(x, y + 0.035 * scale, z);
  pebble.scale.y = 0.48;
  group.add(pebble);
}

/**
 * Add reeds (3 thin cylinders).
 * Uses material pooling to share reed material across all instances.
 *
 * OPTIMIZATION: All reeds share the same pooled material.
 *
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 */
export function addReeds(renderer, group, x, y, z) {
  const THREE = window.THREE;
  const reedMat = getMaterialPreset("reeds", THREE);
  for (let i = 0; i < 3; i += 1) {
    const reed = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.012, 0.16 + i * 0.035, 5),
      reedMat
    );
    reed.position.set(x + (i - 1) * 0.028, y + 0.08 + i * 0.015, z + (i % 2) * 0.025);
    reed.rotation.z = (i - 1) * 0.12;
    group.add(reed);
  }
}

// ============================================================================
// FLAGS & MARKERS
// ============================================================================

/**
 * Add a flag (pole + flag).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, color, phase, scale }
 * @returns {THREE.Mesh} The flag mesh
 */
export function addFlag(renderer, group, { x = 0, y = 0, z = 0, color = 0xffd166, phase = 0, scale = 1 } = {}) {
  const THREE = window.THREE;

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012 * scale, 0.012 * scale, 0.58 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x3b3328, roughness: 0.65 })
  );
  pole.position.set(x, y + 0.3 * scale, z);
  group.add(pole);

  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.22 * scale, 0.13 * scale, 0.012 * scale),
    new THREE.MeshStandardMaterial({ color, roughness: 0.58, emissive: new THREE.Color(color).multiplyScalar(0.08) })
  );
  flag.position.set(x + 0.12 * scale, y + 0.48 * scale, z);
  group.add(flag);

  registerAnimation(renderer, group, flag, "flag", { phase, duration: 7.5, amplitude: 0.8 });
  return flag;
}

// ============================================================================
// UNIT FIGURES
// ============================================================================

/**
 * Add a low-poly person figure.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, shirt, accent, tool, kind, phase, duration }
 * @returns {THREE.Group} The person group
 */
export function addLowPolyPerson(renderer, group, {
  x = 0,
  y = 0,
  z = 0,
  scale = 1,
  color = 0xe8c9a7,
  shirt = 0xeadfbd,
  accent = 0x3d342b,
  tool = null,
  kind = "idlePerson",
  phase = 0,
  duration = 9,
} = {}) {
  const THREE = window.THREE;
  const person = new THREE.Group();
  person.position.set(x, y, z);
  person.scale.setScalar(scale);

  const skinMat = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.78 });
  const darkMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.82 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.058, 0.18, 6), shirtMat);
  body.position.y = 0.18;
  person.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 6), skinMat);
  head.position.y = 0.31;
  person.add(head);

  for (const xOffset of [-0.028, 0.028]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.13, 5), darkMat);
    leg.position.set(xOffset, 0.065, 0);
    person.add(leg);
  }

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.055, 0.23, 0);
  const leftArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.16, 5), skinMat);
  leftArmMesh.position.y = -0.075;
  leftArm.add(leftArmMesh);
  leftArm.rotation.z = 0.42;
  person.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.055, 0.23, 0);
  const rightArmMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.16, 5), skinMat);
  rightArmMesh.position.y = -0.075;
  rightArm.add(rightArmMesh);
  rightArm.rotation.z = -0.42;
  person.add(rightArm);

  if (tool === "pickaxe" || tool === "shovel") {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.22, 0.015), darkMat);
    handle.position.set(0.025, -0.16, 0);
    handle.rotation.z = -0.15;
    rightArm.add(handle);

    const headWidth = tool === "pickaxe" ? 0.17 : 0.08;
    const toolHead = new THREE.Mesh(
      new THREE.BoxGeometry(headWidth, 0.024, 0.024),
      new THREE.MeshStandardMaterial({ color: tool === "pickaxe" ? 0xc8c2b8 : 0xb7b0a5, roughness: 0.48, metalness: 0.18 })
    );
    toolHead.position.set(0.025, -0.27, 0);
    toolHead.rotation.z = tool === "pickaxe" ? 0.1 : 0.75;
    rightArm.add(toolHead);
  }

  if (tool === "book") {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.09), new THREE.MeshStandardMaterial({ color: 0xf1d27b, roughness: 0.7 }));
    book.position.set(0, -0.12, 0.035);
    rightArm.add(book);
  }

  person.userData.parts = { body, head, leftArm, rightArm };
  group.add(person);
  registerAnimation(renderer, group, person, kind, { phase, duration });
  return person;
}

/**
 * Add tank unit.
 * Uses a GLB model if assets/models/tank.glb is present; falls back to procedural.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addTankUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0x53664f, phase = 0 } = {}) {
  // getModelSync returns a GLB clone when available, procedural model otherwise.
  const unit = getModelSync("tank", { color, scale });
  if (!unit) return;

  unit.position.set(x, y, z);
  group.add(unit);
  registerAnimation(renderer, group, unit, "patrol", { phase, duration: 11 });

  // Turret scan: procedural model marks the turret with rotationalAxis; GLB authors
  // should name the turret child "turret" or set userData.rotationalAxis = "y".
  const turret = unit.children.find(c => c.userData?.rotationalAxis === "y");
  if (turret) {
    registerAnimation(renderer, group, turret, "turretScan", { phase: phase + 1.1, duration: 9.5, amplitude: 0.75 });
  }
}

/**
 * Add plane unit.
 * Uses a GLB model if assets/models/plane.glb is present; falls back to procedural.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addPlaneUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0xb8c6d8, phase = 0 } = {}) {
  const unit = getModelSync("plane", { color, scale });
  if (!unit) return;

  unit.position.set(x, y, z);
  group.add(unit);
  registerAnimation(renderer, group, unit, "fly", { phase, duration: 12 });
}

/**
 * Add ship unit.
 * Uses a GLB model if assets/models/ship.glb is present; falls back to procedural.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addShipUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0x3f6f82, phase = 0 } = {}) {
  const unit = getModelSync("ship", { color, scale });
  if (!unit) return;

  unit.position.set(x, y, z);
  group.add(unit);
  registerAnimation(renderer, group, unit, "sail", { phase, duration: 10.5 });
  addWave(renderer, group, { x, y: y + 0.015, z: z - 0.12, radius: 0.18 * scale, phase: phase + 0.8 });
}

/**
 * Add infantry unit.
 * When assets/models/infantry.glb is present, uses the GLB (single model placed as-is).
 * Without a GLB, falls back to the procedural 3-soldier squad formation.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addInfantryUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0xe2dcc8, phase = 0 } = {}) {
  // GLB override: a single infantry.glb replaces the whole squad.
  if (hasGLB("infantry")) {
    const unit = getModelSync("infantry", { color, scale, ownerColor: color });
    if (unit) {
      unit.position.set(x, y, z);
      group.add(unit);
      registerAnimation(renderer, group, unit, "drillMarch", { phase, duration: 8.5 });
      return;
    }
  }

  // Procedural fallback: 3 soldiers in formation with staggered animation phases.
  const THREE = window.THREE;
  const squad = new THREE.Group();
  squad.position.set(x, y, z);
  squad.scale.setScalar(scale);

  const offsets = [
    [-0.12, -0.08],
    [0.08, -0.02],
    [-0.02, 0.12],
  ];

  offsets.forEach(([xOffset, zOffset], index) => {
    const soldier = createLowPolyInfantry({ color, scale: 0.8 });
    soldier.position.set(xOffset, 0, zOffset);
    squad.add(soldier);
    registerAnimation(renderer, group, soldier, "drillMarch", { phase: phase + index * 0.75, duration: 8.5 });
  });

  group.add(squad);
}
