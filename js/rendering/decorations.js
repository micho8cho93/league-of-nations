/**
 * Decoration and visual element builders for the game map.
 * Extracted from HexMapRenderer to improve code organization.
 *
 * Functions here are pure geometry builders that create Three.js meshes and groups.
 * They take a `renderer` parameter to register animations with the HexMapRenderer.
 */

import { hash2d } from "../utils.js";
import { getMaterialPreset } from "./config.js";

const TAU = Math.PI * 2;

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
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} color - Hex color value
 * @returns {THREE.Mesh}
 */
export function addCrate(renderer, group, x, y, z, color = 0xb88755) {
  const THREE = window.THREE;
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.12, 0.14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82 })
  );
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
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 * @param {number} crownColor - Crown color
 */
export function addTinyTree(renderer, group, x, y, z, scale = 1, crownColor = 0x2f8a55) {
  const THREE = window.THREE;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025 * scale, 0.032 * scale, 0.16 * scale, 5),
    new THREE.MeshStandardMaterial({ color: 0x6f4a2d, roughness: 0.86 })
  );
  trunk.position.set(x, y + 0.08 * scale, z);
  group.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.12 * scale, 0.24 * scale, 6),
    new THREE.MeshStandardMaterial({ color: crownColor, roughness: 0.9 })
  );
  crown.position.set(x, y + 0.25 * scale, z);
  group.add(crown);
}

/**
 * Add grass tuft (cone).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 * @param {number} color - Color
 */
export function addGrassTuft(renderer, group, x, y, z, scale = 1, color = 0x5aa65a) {
  const THREE = window.THREE;
  const tuft = new THREE.Mesh(
    new THREE.ConeGeometry(0.055 * scale, 0.15 * scale, 5),
    new THREE.MeshStandardMaterial({ color, roughness: 0.94 })
  );
  tuft.position.set(x, y + 0.07 * scale, z);
  tuft.rotation.z = 0.18;
  group.add(tuft);
}

/**
 * Add cactus (stem + arm).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 */
export function addCactus(renderer, group, x, y, z, scale = 1) {
  const THREE = window.THREE;
  const mat = new THREE.MeshStandardMaterial({ color: 0x4f8f55, roughness: 0.88 });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * scale, 0.035 * scale, 0.22 * scale, 6), mat);
  stem.position.set(x, y + 0.11 * scale, z);
  group.add(stem);

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * scale, 0.018 * scale, 0.12 * scale, 6), mat);
  arm.position.set(x + 0.055 * scale, y + 0.13 * scale, z);
  arm.rotation.z = Math.PI / 2;
  group.add(arm);
}

/**
 * Add pebble (dodecahedron).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 * @param {number} scale - Scale factor
 * @param {number} color - Color
 */
export function addPebble(renderer, group, x, y, z, scale = 1, color = 0x8b8578) {
  const THREE = window.THREE;
  const pebble = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.055 * scale, 0),
    new THREE.MeshStandardMaterial({ color, roughness: 0.96 })
  );
  pebble.position.set(x, y + 0.035 * scale, z);
  pebble.scale.y = 0.48;
  group.add(pebble);
}

/**
 * Add reeds (3 thin cylinders).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {number} x, y, z - Position
 */
export function addReeds(renderer, group, x, y, z) {
  const THREE = window.THREE;
  const mat = new THREE.MeshStandardMaterial({ color: 0x7ea65b, roughness: 0.9 });
  for (let i = 0; i < 3; i += 1) {
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.16 + i * 0.035, 5), mat);
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
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addTankUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0x53664f, phase = 0 } = {}) {
  const THREE = window.THREE;
  const unit = new THREE.Group();
  unit.position.set(x, y, z);
  unit.scale.setScalar(scale);

  const hullMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.08 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2f382f, roughness: 0.78 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.24), hullMaterial);
  hull.position.y = 0.07;
  unit.add(hull);

  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.16), hullMaterial);
  turret.position.set(0.02, 0.18, 0);
  unit.add(turret);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), darkMaterial);
  barrel.position.set(0.22, 0.18, 0);
  barrel.rotation.z = Math.PI / 2;
  unit.add(barrel);

  for (const zOffset of [-0.14, 0.14]) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.045, 0.055), darkMaterial);
    tread.position.set(0, 0.025, zOffset);
    unit.add(tread);
  }

  group.add(unit);
  registerAnimation(renderer, group, unit, "patrol", { phase, duration: 11 });
  registerAnimation(renderer, group, turret, "turretScan", { phase: phase + 1.1, duration: 9.5, amplitude: 0.75 });
}

/**
 * Add plane unit.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addPlaneUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0xb8c6d8, phase = 0 } = {}) {
  const THREE = window.THREE;
  const unit = new THREE.Group();
  unit.position.set(x, y, z);
  unit.scale.setScalar(scale);
  unit.rotation.z = -0.35;

  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.22, roughness: 0.42, emissive: new THREE.Color(color).multiplyScalar(0.12) });

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.46, 3), material);
  body.rotation.z = -Math.PI / 2;
  unit.add(body);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.42), material);
  wing.position.set(-0.02, 0, 0);
  unit.add(wing);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.22), material);
  tail.position.set(-0.18, 0.02, 0);
  unit.add(tail);

  group.add(unit);
  registerAnimation(renderer, group, unit, "fly", { phase, duration: 12 });
}

/**
 * Add ship unit.
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addShipUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0x3f6f82, phase = 0 } = {}) {
  const THREE = window.THREE;
  const unit = new THREE.Group();
  unit.position.set(x, y, z);
  unit.scale.setScalar(scale);

  const hullMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08 });
  const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xb6c3c8, roughness: 0.5 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.18), hullMaterial);
  hull.position.y = 0.06;
  unit.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.18, 4), hullMaterial);
  bow.position.set(0.3, 0.06, 0);
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  unit.add(bow);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.12), deckMaterial);
  cabin.position.set(-0.04, 0.18, 0);
  unit.add(cabin);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 6), deckMaterial);
  mast.position.set(-0.12, 0.34, 0);
  unit.add(mast);

  group.add(unit);
  registerAnimation(renderer, group, unit, "sail", { phase, duration: 10.5 });
  addWave(renderer, group, { x, y: y + 0.015, z: z - 0.12, radius: 0.18 * scale, phase: phase + 0.8 });
}

/**
 * Add infantry unit (squad of 3 soldiers).
 * @param {HexMapRenderer} renderer - The renderer instance
 * @param {THREE.Group} group - Parent group
 * @param {Object} options - { x, y, z, scale, color, phase }
 */
export function addInfantryUnit(renderer, group, { x = 0, y = 0, z = 0, scale = 1, color = 0xe2dcc8, phase = 0 } = {}) {
  const THREE = window.THREE;
  const squad = new THREE.Group();
  squad.position.set(x, y, z);
  squad.scale.setScalar(scale);

  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.58, emissive: new THREE.Color(color).multiplyScalar(0.12) });
  const offsets = [
    [-0.12, -0.08],
    [0.08, -0.02],
    [-0.02, 0.12],
  ];

  offsets.forEach(([xOffset, zOffset], index) => {
    const soldier = new THREE.Group();
    soldier.position.set(xOffset, 0, zOffset);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.16, 8), material);
    body.position.y = 0.1;
    soldier.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), material);
    head.position.y = 0.21;
    soldier.add(head);

    const rifle = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.018, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x272a24, roughness: 0.8 })
    );
    rifle.position.set(0.045, 0.14, 0.03);
    rifle.rotation.y = 0.7;
    soldier.add(rifle);

    squad.add(soldier);
    registerAnimation(renderer, group, soldier, "drillMarch", { phase: phase + index * 0.75, duration: 8.5 });
  });

  group.add(squad);
}
