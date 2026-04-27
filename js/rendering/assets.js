/**
 * Procedural low-poly asset builders for Polytopia-style game.
 * Generates Three.js geometry procedurally — no external model files required.
 * All assets use grouped meshes with consistent scale and material palette.
 *
 * Future: These constructors allow GLB models to be swapped in without
 * changing gameplay code, just replace the geometry creation.
 */

import { hash2d } from "../utils.js";

const TAU = Math.PI * 2;

// ============================================================================
// MATERIAL PALETTE
// ============================================================================

function createMaterial(color, { roughness = 0.7, metalness = 0, emissive = null, transparent = false, opacity = 1 } = {}) {
  const THREE = window.THREE;
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: emissive ? new THREE.Color(emissive) : undefined,
    transparent,
    opacity,
    flatShading: false,
  });
  return mat;
}

// ============================================================================
// UNIT ASSETS
// ============================================================================

/**
 * Create low-poly infantry soldier (single figure with weapon).
 * @param {Object} options - { color, scale, phase }
 * @returns {THREE.Group}
 */
export function createLowPolyInfantry(options = {}) {
  const { color = 0xd4a574, scale = 1, phase = 0 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const skinMat = createMaterial(color);
  const uniformMat = createMaterial(0x4a5847, { roughness: 0.78 });
  const metalMat = createMaterial(0x5a6f6d, { metalness: 0.35, roughness: 0.4 });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), skinMat);
  head.position.set(0, 0.32, 0);
  head.castShadow = true;
  group.add(head);

  // Torso (uniform)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.09), uniformMat);
  torso.position.set(0, 0.18, 0);
  torso.castShadow = true;
  group.add(torso);

  // Belt accent
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.022, 0.095), createMaterial(0x3d342b));
  belt.position.set(0, 0.1, 0);
  group.add(belt);

  // Legs
  for (const xOffset of [-0.04, 0.04]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), uniformMat);
    leg.position.set(xOffset, 0.04, 0);
    leg.castShadow = true;
    group.add(leg);
  }

  // Weapon (rifle at shoulder angle)
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.3), metalMat);
  rifle.position.set(0.08, 0.22, -0.05);
  rifle.rotation.z = 0.25;
  rifle.rotation.x = 0.12;
  group.add(rifle);

  // Simple idle bob animation (stored for renderer to use)
  group.userData = { animationKind: "unitBob", baseY: 0 };

  return group;
}

/**
 * Create low-poly tank unit.
 * @param {Object} options - { color, scale, phase }
 * @returns {THREE.Group}
 */
export function createLowPolyTank(options = {}) {
  const { color = 0x4a6b4a, scale = 1, phase = 0 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const hullMat = createMaterial(color, { roughness: 0.72, metalness: 0.15 });
  const darkMat = createMaterial(0x2a3d2a, { roughness: 0.8, metalness: 0.2 });
  const metalMat = createMaterial(0x6b7f7f, { metalness: 0.4, roughness: 0.35 });

  // Lower hull (tracks and base)
  const baseHull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.28), hullMat);
  baseHull.position.set(0, 0.08, 0);
  baseHull.castShadow = true;
  group.add(baseHull);

  // Tracks (geometric representation)
  for (const zOffset of [-0.16, 0.16]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.05), darkMat);
    track.position.set(0, 0.04, zOffset);
    group.add(track);
  }

  // Turret (rotational body)
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.11, 0.2), hullMat);
  turret.position.set(0, 0.22, 0);
  turret.userData = { rotationalAxis: "y" }; // Hint for animation
  turret.castShadow = true;
  group.add(turret);

  // Gun barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.42, 8), metalMat);
  barrel.position.set(0.18, 0.22, 0);
  barrel.rotation.z = Math.PI / 2;
  group.add(barrel);

  // Gun mantlet (curved base)
  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.22), hullMat);
  mantlet.position.set(0.06, 0.22, 0);
  group.add(mantlet);

  group.userData = { animationKind: "patrol" };
  return group;
}

/**
 * Create low-poly aircraft (fighter).
 * @param {Object} options - { color, scale, phase }
 * @returns {THREE.Group}
 */
export function createLowPolyAircraft(options = {}) {
  const { color = 0x8fa3c8, scale = 1, phase = 0 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);
  group.rotation.z = -0.3; // Slight tilt for action pose

  const fuselageMat = createMaterial(color, { metalness: 0.22, roughness: 0.5 });
  const cockpitMat = createMaterial(0x5a8fd9, { metalness: 0.4, roughness: 0.35 });

  // Fuselage (cone body)
  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 8), fuselageMat);
  fuselage.rotation.z = Math.PI / 2; // Point forward
  fuselage.position.set(0, 0, 0);
  fuselage.castShadow = true;
  group.add(fuselage);

  // Wings (simple rectangles)
  const wingMat = createMaterial(color, { metalness: 0.18, roughness: 0.55 });
  for (const yOffset of [-0.08, 0.08]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.15), wingMat);
    wing.position.set(0, yOffset, 0);
    wing.castShadow = true;
    group.add(wing);
  }

  // Tail assembly
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.24), fuselageMat);
  tail.position.set(-0.22, 0, 0);
  group.add(tail);

  // Cockpit bubble
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), cockpitMat);
  cockpit.position.set(0.08, 0.03, 0);
  cockpit.scale.set(1, 0.7, 1.2);
  group.add(cockpit);

  group.userData = { animationKind: "fly" };
  return group;
}

/**
 * Create low-poly naval ship.
 * @param {Object} options - { color, scale, phase }
 * @returns {THREE.Group}
 */
export function createLowPolyShip(options = {}) {
  const { color = 0x3d5a72, scale = 1, phase = 0 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const hullMat = createMaterial(color, { roughness: 0.6, metalness: 0.12 });
  const deckMat = createMaterial(0xa8b8bf, { roughness: 0.55 });
  const metalMat = createMaterial(0x6b8890, { metalness: 0.3, roughness: 0.4 });

  // Hull (tapered box, wider at base)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.22), hullMat);
  hull.position.set(0, 0.07, 0);
  hull.scale.z = 1.1; // Slightly wider stern
  hull.castShadow = true;
  group.add(hull);

  // Bow (cone-like prow)
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 6), hullMat);
  bow.position.set(0.32, 0.07, 0);
  bow.rotation.z = -Math.PI / 2;
  bow.castShadow = true;
  group.add(bow);

  // Cabin/superstructure
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.14), deckMat);
  cabin.position.set(-0.08, 0.21, 0);
  cabin.castShadow = true;
  group.add(cabin);

  // Mast
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.32, 6), metalMat);
  mast.position.set(-0.14, 0.4, 0);
  group.add(mast);

  // Sail (decorative)
  const sail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.18), deckMat);
  sail.position.set(-0.16, 0.28, 0);
  sail.rotation.y = 0.15;
  group.add(sail);

  group.userData = { animationKind: "sail" };
  return group;
}

// ============================================================================
// BUILDING ASSETS
// ============================================================================

/**
 * Create low-poly city/capital building.
 * @param {Object} options - { color, ownerColor, scale }
 * @returns {THREE.Group}
 */
export function createLowPolyCity(options = {}) {
  const { color = 0xf4d8a1, ownerColor = 0xffd166, scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const roofMat = createMaterial(ownerColor, { metalness: 0.3, roughness: 0.5 });
  const wallMat = createMaterial(color, { roughness: 0.8 });
  const accentMat = createMaterial(0xa87f3d, { roughness: 0.75 });

  // Base platform
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.08, 6), accentMat);
  base.position.set(0, 0.04, 0);
  group.add(base);

  // Main tower (central structure)
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), wallMat);
  tower.position.set(0, 0.25, 0);
  tower.castShadow = true;
  group.add(tower);

  // Tower roof (pyramid)
  const roofGeom = new THREE.ConeGeometry(0.2, 0.2, 4);
  const roof = new THREE.Mesh(roofGeom, roofMat);
  roof.position.set(0, 0.62, 0);
  roof.castShadow = true;
  group.add(roof);

  // Side towers (smaller)
  for (const xOffset of [-0.24, 0.24]) {
    const sideTower = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.14), wallMat);
    sideTower.position.set(xOffset, 0.14, 0);
    group.add(sideTower);

    const sideRoof = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.12, 4), roofMat);
    sideRoof.position.set(xOffset, 0.4, 0);
    group.add(sideRoof);
  }

  // Decorative gold crown cap
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.08, 8), createMaterial(0xffd700, { metalness: 0.6, roughness: 0.25 }));
  crown.position.set(0, 0.65, 0);
  group.add(crown);

  group.userData = { buildingType: "city" };
  return group;
}

/**
 * Create low-poly farm with plots.
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolyFarm(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const plotMat1 = createMaterial(0x7fb870, { roughness: 0.85 });
  const plotMat2 = createMaterial(0x5fa35a, { roughness: 0.85 });
  const fenceMat = createMaterial(0x6b4423, { roughness: 0.8 });

  // Three plot rows
  const plotCount = 3;
  for (let i = 0; i < plotCount; i++) {
    const xOffset = (i - 1) * 0.22;
    const plot = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.04, 0.62),
      i % 2 === 0 ? plotMat1 : plotMat2
    );
    plot.position.set(xOffset, 0.02, 0);
    group.add(plot);
  }

  // Fence posts
  for (const zOffset of [-0.35, 0.35]) {
    for (const xOffset of [-0.3, 0, 0.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), fenceMat);
      post.position.set(xOffset, 0.1, zOffset);
      group.add(post);
    }
  }

  group.userData = { buildingType: "farm" };
  return group;
}

/**
 * Create low-poly mine with extraction equipment.
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolyMine(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const rockMat = createMaterial(0x6b5d4f, { roughness: 0.95 });
  const metalMat = createMaterial(0x7a8d8d, { metalness: 0.4, roughness: 0.45 });
  const woodMat = createMaterial(0x8b6f47, { roughness: 0.8 });

  // Mine shaft entry (dark pit)
  const pit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), createMaterial(0x3d3d3d));
  pit.position.set(0, 0.04, 0);
  group.add(pit);

  // Ore pile
  const orePile = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 6), rockMat);
  orePile.position.set(0.28, 0.18, 0);
  group.add(orePile);

  // Conveyor structure
  const conveyorBase = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), woodMat);
  conveyorBase.position.set(-0.14, 0.06, 0);
  conveyorBase.rotation.z = 0.2;
  group.add(conveyorBase);

  // Drill head (rotating)
  const drillShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 6), metalMat);
  drillShaft.position.set(-0.36, 0.14, 0);
  drillShaft.rotation.x = Math.PI / 2;
  drillShaft.userData = { rotationalAxis: "x" };
  group.add(drillShaft);

  // Drill tip
  const drillTip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 5), metalMat);
  drillTip.position.set(-0.36, 0.06, 0);
  group.add(drillTip);

  group.userData = { buildingType: "mine" };
  return group;
}

/**
 * Create low-poly factory with smokestacks.
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolyFactory(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const structureMat = createMaterial(0x7a8b8b, { roughness: 0.82 });
  const roofMat = createMaterial(0x5a6b6b, { roughness: 0.8 });
  const smokeMat = createMaterial(0xaaa8a0, { roughness: 0.7, transparent: true, opacity: 0.8 });

  // Main factory block
  const mainBuilding = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.32), structureMat);
  mainBuilding.position.set(0, 0.12, 0);
  mainBuilding.castShadow = true;
  group.add(mainBuilding);

  // Roof overhang
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.4), roofMat);
  roof.position.set(0, 0.28, 0);
  group.add(roof);

  // Smokestacks (3)
  const stackPositions = [-0.18, 0, 0.18];
  for (const xOffset of stackPositions) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.38, 8), structureMat);
    stack.position.set(xOffset, 0.33, -0.12);
    stack.castShadow = true;
    group.add(stack);
  }

  // Door/window details
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.02), createMaterial(0x3d3d3d));
  door.position.set(-0.16, 0.1, 0.16);
  group.add(door);

  group.userData = { buildingType: "factory" };
  return group;
}

/**
 * Create low-poly school/research building.
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolySchool(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const wallMat = createMaterial(0x9db8d8, { roughness: 0.8 });
  const roofMat = createMaterial(0xa87f3d, { roughness: 0.75 });
  const windowMat = createMaterial(0x7fc6e0, { metalness: 0.4, roughness: 0.25 });

  // Main building block
  const building = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.3), wallMat);
  building.position.set(0, 0.14, 0);
  building.castShadow = true;
  group.add(building);

  // Roof (pyramidal)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.16, 4), roofMat);
  roof.position.set(0, 0.46, 0);
  roof.castShadow = true;
  group.add(roof);

  // Windows (2x2 grid on front)
  for (const row of [0, 1]) {
    for (const col of [0, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), windowMat);
      window.position.set(-0.1 + col * 0.12, 0.2 + row * 0.1, 0.15);
      group.add(window);
    }
  }

  // Flagpole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), createMaterial(0x4a4a3a));
  pole.position.set(0.2, 0.45, 0);
  group.add(pole);

  group.userData = { buildingType: "school" };
  return group;
}

/**
 * Create low-poly port/dock structure.
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolyPort(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const deckMat = createMaterial(0x8b7355, { roughness: 0.78 });
  const pileMat = createMaterial(0x6b5b4f, { roughness: 0.85 });
  const metalMat = createMaterial(0x9aafaf, { metalness: 0.35, roughness: 0.4 });

  // Dock platform
  const dock = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.22), deckMat);
  dock.position.set(0, 0.04, 0);
  group.add(dock);

  // Support pilings
  for (const xOffset of [-0.2, 0, 0.2]) {
    for (const zOffset of [-0.1, 0.1]) {
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.24, 6), pileMat);
      piling.position.set(xOffset, -0.08, zOffset);
      group.add(piling);
    }
  }

  // Crane-like loading structure
  const craneBase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.08), metalMat);
  craneBase.position.set(0.28, 0.1, 0);
  group.add(craneBase);

  const craneBoom = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.035), metalMat);
  craneBoom.position.set(0.15, 0.24, 0);
  group.add(craneBoom);

  group.userData = { buildingType: "port" };
  return group;
}

/**
 * Create low-poly airport/airfield structure.
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolyAirport(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const runwayMat = createMaterial(0xc0c0b8, { roughness: 0.85 });
  const terminalMat = createMaterial(0x8ba8c8, { roughness: 0.75 });
  const windowMat = createMaterial(0x7fc6e0, { metalness: 0.5 });

  // Runway
  const runway = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.12), runwayMat);
  runway.position.set(0, 0.01, 0);
  group.add(runway);

  // Runway center line (dashed)
  for (let i = 0; i < 5; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.003, 0.012), createMaterial(0xf4e7a0));
    dash.position.set(-0.32 + i * 0.16, 0.015, 0);
    group.add(dash);
  }

  // Terminal building
  const terminal = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.16), terminalMat);
  terminal.position.set(0.32, 0.08, 0);
  terminal.castShadow = true;
  group.add(terminal);

  // Terminal windows
  for (let i = 0; i < 3; i++) {
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), windowMat);
    window.position.set(0.24 + i * 0.08, 0.12, 0.08);
    group.add(window);
  }

  // Control tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), terminalMat);
  tower.position.set(-0.32, 0.15, 0);
  group.add(tower);

  // Radar dome on tower
  const radar = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), windowMat);
  radar.position.set(-0.32, 0.35, 0);
  group.add(radar);

  group.userData = { buildingType: "airport" };
  return group;
}

// ============================================================================
// NATURAL ELEMENT ASSETS
// ============================================================================

/**
 * Create low-poly mountain/peak.
 * @param {Object} options - { scale, hasSnowtop }
 * @returns {THREE.Group}
 */
export function createLowPolyMountain(options = {}) {
  const { scale = 1, hasSnowtop = true } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const rockMat = createMaterial(0x8a7d6b, { roughness: 0.92 });
  const snowMat = createMaterial(0xe8e4d8, { roughness: 0.88 });

  // Main peak
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.78, 6), rockMat);
  peak.position.set(-0.1, 0.35, 0.05);
  peak.castShadow = true;
  group.add(peak);

  // Secondary peak
  const peak2 = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.54, 6), rockMat);
  peak2.position.set(0.32, 0.26, -0.18);
  group.add(peak2);

  // Snow cap
  if (hasSnowtop) {
    const snow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 6), snowMat);
    snow.position.set(-0.1, 0.7, 0.05);
    group.add(snow);
  }

  // Rock outcrop at base
  const outcrop = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.2, 4), rockMat);
  outcrop.position.set(0, 0.08, -0.22);
  group.add(outcrop);

  group.userData = { decorationType: "mountain" };
  return group;
}

/**
 * Create low-poly tree (trunk + foliage crown).
 * @param {Object} options - { scale, crownColor }
 * @returns {THREE.Group}
 */
export function createLowPolyTree(options = {}) {
  const { scale = 1, crownColor = 0x3d7d4d } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const trunkMat = createMaterial(0x6f4a2d, { roughness: 0.88 });
  const crownMat = createMaterial(crownColor, { roughness: 0.9 });

  // Trunk
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.052, 0.22, 6), trunkMat);
  trunk.position.set(0, 0.11, 0);
  trunk.castShadow = true;
  group.add(trunk);

  // Crown (layered cones for fuller look)
  const crownLayers = [
    { radius: 0.2, height: 0.3, y: 0.32 },
    { radius: 0.14, height: 0.24, y: 0.48 },
    { radius: 0.08, height: 0.16, y: 0.6 },
  ];

  for (const layer of crownLayers) {
    const crown = new THREE.Mesh(new THREE.ConeGeometry(layer.radius, layer.height, 8), crownMat);
    crown.position.set(0, layer.y, 0);
    crown.castShadow = true;
    group.add(crown);
  }

  group.userData = { decorationType: "tree" };
  return group;
}

/**
 * Create low-poly forest cluster (3-4 trees).
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolyForest(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const positions = [
    { x: -0.18, z: -0.1, scale: 0.9 },
    { x: 0.16, z: 0.12, scale: 1.05 },
    { x: -0.08, z: 0.22, scale: 0.85 },
    { x: 0.28, z: -0.16, scale: 0.95 },
  ];

  for (const pos of positions) {
    const tree = createLowPolyTree({ scale: pos.scale });
    tree.position.set(pos.x, 0, pos.z);
    group.add(tree);
  }

  group.userData = { decorationType: "forest" };
  return group;
}

/**
 * Create low-poly rock outcrop.
 * @param {Object} options - { scale }
 * @returns {THREE.Group}
 */
export function createLowPolyRock(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const rockMat = createMaterial(0x5a4a42, { roughness: 0.94 });

  // Main rock body (irregular cone)
  const rock = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.42, 5), rockMat);
  rock.position.set(0, 0.2, 0);
  rock.rotation.x = 0.15;
  rock.scale.set(1.1, 0.8, 1);
  rock.castShadow = true;
  group.add(rock);

  // Secondary rocks
  const rock2 = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 4), rockMat);
  rock2.position.set(0.26, 0.1, -0.15);
  group.add(rock2);

  group.userData = { decorationType: "rock" };
  return group;
}

// ============================================================================
// HELPER: Asset factory with sensible defaults
// ============================================================================

export const AssetFactory = {
  unit: {
    infantry: (opts) => createLowPolyInfantry(opts),
    tank: (opts) => createLowPolyTank(opts),
    aircraft: (opts) => createLowPolyAircraft(opts),
    ship: (opts) => createLowPolyShip(opts),
  },
  building: {
    city: (opts) => createLowPolyCity(opts),
    farm: (opts) => createLowPolyFarm(opts),
    mine: (opts) => createLowPolyMine(opts),
    factory: (opts) => createLowPolyFactory(opts),
    school: (opts) => createLowPolySchool(opts),
    port: (opts) => createLowPolyPort(opts),
    airport: (opts) => createLowPolyAirport(opts),
  },
  nature: {
    mountain: (opts) => createLowPolyMountain(opts),
    tree: (opts) => createLowPolyTree(opts),
    forest: (opts) => createLowPolyForest(opts),
    rock: (opts) => createLowPolyRock(opts),
  },
};
