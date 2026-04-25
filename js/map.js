import {
  MAP_SIZES,
  OWNER_COLORS,
  TILE_COLORS,
  TILE_TYPES,
  WORKER_MIN,
  axialNeighbors,
  axialToWorld,
  clamp,
  hash2d,
  hexDistance,
  hexMapCoords,
  isLand,
  mulberry32,
  randInt,
  shuffle,
  tileId,
} from "./utils.js";
import { STARTING_PROFILES } from "./nation.js";

const HEX_SIZE = 1;
const HEX_HEIGHT = 0.34;
const HEX_GAP = 0.035;

export function createMapData(settings) {
  const sizeInfo = MAP_SIZES[settings.mapSize] || MAP_SIZES.Medium;
  const radius = sizeInfo.radius;
  const seed = Number(settings.seed || 1);
  const coords = hexMapCoords(radius);
  const rng = mulberry32(seed);
  const targetLandRatio = 0.71 + rng() * 0.08;
  const continentCount = settings.nationCount <= 4 ? 2 : settings.nationCount <= 7 ? 3 : 4;
  const islandCount = Math.max(4, Math.floor(radius / 2));

  const centers = [];
  for (let i = 0; i < continentCount; i += 1) {
    centers.push({
      q: randInt(rng, -Math.floor(radius * 0.55), Math.floor(radius * 0.55)),
      r: randInt(rng, -Math.floor(radius * 0.55), Math.floor(radius * 0.55)),
      radius: radius * (0.48 + rng() * 0.22),
      weight: 1.8 + rng() * 0.5,
      kind: "continent",
    });
  }
  for (let i = 0; i < islandCount; i += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * (0.35 + rng() * 0.52);
    centers.push({
      q: Math.round(Math.cos(angle) * distance),
      r: Math.round(Math.sin(angle) * distance * 0.6),
      radius: 1.5 + rng() * 2.5,
      weight: 0.75 + rng() * 0.5,
      kind: "island",
    });
  }

  const scored = coords.map((coord) => {
    const edge = Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(coord.q + coord.r)) / radius;
    let score = 0.3 - edge * 0.22 + hash2d(coord.q, coord.r, seed) * 0.55;
    let nearestKind = "continent";
    let bestInfluence = 0;
    for (const center of centers) {
      const dist = hexDistance(coord, center);
      const influence = Math.max(0, 1 - dist / center.radius) * center.weight;
      if (influence > bestInfluence) {
        bestInfluence = influence;
        nearestKind = center.kind;
      }
      score += influence;
    }
    score += hash2d(coord.q * 3 + 17, coord.r * 5 - 11, seed + 91) * 0.2;
    return { ...coord, score, nearestKind };
  });

  const landCount = Math.round(scored.length * targetLandRatio);
  const landIds = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, landCount)
      .map((coord) => tileId(coord.q, coord.r))
  );

  const tiles = scored.map((coord) => {
    const land = landIds.has(tileId(coord.q, coord.r));
    return {
      id: tileId(coord.q, coord.r),
      q: coord.q,
      r: coord.r,
      terrain: land ? "land" : "water",
      landform: land ? coord.nearestKind : "sea",
      type: land ? TILE_TYPES.EMPTY : TILE_TYPES.WATER,
      ownerId: null,
      workers: 0,
      unit: null,
      regionId: null,
      isCapital: false,
      effects: {
        disabledTurns: 0,
        floodedTurns: 0,
        bountifulTurns: 0,
      },
    };
  });

  const map = {
    size: settings.mapSize,
    radius,
    seed,
    landRatio: landCount / scored.length,
    tiles,
  };
  assignRegions(map);
  return map;
}

export function buildTileIndex(tiles) {
  return new Map(tiles.map((tile) => [tile.id, tile]));
}

export function getTile(map, id) {
  return buildTileIndex(map.tiles).get(id) || null;
}

export function assignRegions(map) {
  const index = buildTileIndex(map.tiles);
  let regionId = 1;
  for (const tile of map.tiles) tile.regionId = null;

  for (const start of map.tiles) {
    if (!isLand(start) || start.regionId) continue;
    const queue = [start];
    start.regionId = regionId;
    let size = 0;
    while (queue.length) {
      const current = queue.shift();
      size += 1;
      for (const coord of axialNeighbors(current.q, current.r)) {
        const neighbor = index.get(tileId(coord.q, coord.r));
        if (!neighbor || !isLand(neighbor) || neighbor.regionId) continue;
        neighbor.regionId = regionId;
        queue.push(neighbor);
      }
    }
    for (const tile of map.tiles) {
      if (tile.regionId === regionId && size <= 5) tile.landform = "island";
    }
    regionId += 1;
  }
}

export function assignStartingTerritories(map, nations, rng = mulberry32(map.seed + 101)) {
  const index = buildTileIndex(map.tiles);
  const land = map.tiles.filter((tile) => isLand(tile));
  const shuffledLand = shuffle(land, rng);
  const centers = [];
  const minSpacing = Math.max(4, Math.floor(map.radius * 0.55));

  for (const nation of nations) {
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of shuffledLand) {
      if (candidate.ownerId) continue;
      const nearbyLand = axialNeighbors(candidate.q, candidate.r)
        .map((coord) => index.get(tileId(coord.q, coord.r)))
        .filter((tile) => isLand(tile)).length;
      if (nearbyLand < 3) continue;
      const nearest = centers.length
        ? Math.min(...centers.map((center) => hexDistance(candidate, center)))
        : minSpacing;
      const centerBias = map.radius - Math.max(Math.abs(candidate.q), Math.abs(candidate.r), Math.abs(candidate.q + candidate.r));
      const score = nearest * 4 + centerBias + rng() * 3;
      if (nearest >= minSpacing && score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) {
      best = shuffledLand
        .filter((tile) => !tile.ownerId)
        .sort((a, b) => {
          const aDist = centers.length ? Math.min(...centers.map((center) => hexDistance(a, center))) : 0;
          const bDist = centers.length ? Math.min(...centers.map((center) => hexDistance(b, center))) : 0;
          return bDist - aDist;
        })[0];
    }
    if (!best) continue;
    centers.push(best);
    claimStartingCluster(map, nation, best, rng);
  }
}

function claimStartingCluster(map, nation, center, rng) {
  const index = buildTileIndex(map.tiles);
  const profile = STARTING_PROFILES[nation.profile] || STARTING_PROFILES.balanced;
  const target = profile.territoryTarget;
  const claimed = [];
  const queue = [center];
  const seen = new Set([center.id]);

  while (queue.length && claimed.length < target) {
    const tile = queue.shift();
    if (isLand(tile) && !tile.ownerId) {
      tile.ownerId = nation.id;
      claimed.push(tile);
    }
    const neighbors = shuffle(axialNeighbors(tile.q, tile.r), rng);
    for (const coord of neighbors) {
      const neighbor = index.get(tileId(coord.q, coord.r));
      if (!neighbor || seen.has(neighbor.id) || !isLand(neighbor)) continue;
      seen.add(neighbor.id);
      queue.push(neighbor);
    }
  }

  nation.territory = claimed.map((tile) => tile.id);
  const capital = claimed[0];
  if (capital) {
    capital.isCapital = true;
    capital.type = TILE_TYPES.MILITARY;
    capital.workers = WORKER_MIN[TILE_TYPES.MILITARY];
    capital.unit = {
      nationId: nation.id,
      strength: 4,
      branch: "infantry",
      movedTurn: 0,
    };
    nation.capitalTileId = capital.id;
  }

  const farm = claimed[1];
  if (farm) {
    farm.type = TILE_TYPES.FARM;
    farm.workers = WORKER_MIN[TILE_TYPES.FARM];
  }
  if (claimed[2]) claimed[2].type = TILE_TYPES.MINE;
  if (claimed[3]) claimed[3].type = TILE_TYPES.SCHOOL;
  if (claimed[4] && nation.profile !== "small") claimed[4].type = TILE_TYPES.FARM;
}

function terrainColor(tile) {
  return TILE_COLORS[tile.type] || TILE_COLORS[TILE_TYPES.EMPTY];
}

function colorFromHex(hex) {
  const value = String(hex || "#ffffff").replace("#", "");
  return Number.parseInt(value, 16);
}

export class HexMapRenderer {
  constructor(canvas, { onSelect = null, onHover = null } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.tileMeshes = new Map();
    this.decorations = new Map();
    this.decorationSignatures = new Map();
    this.animated = [];
    this.effects = [];
    this.selectedTileId = null;
    this.hoveredTileId = null;
    this.map = null;
    this.nations = {};
    this._initThree();
    this._bindInput();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _initThree() {
    const THREE = window.THREE;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x091019);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.target = new THREE.Vector3(0, 0, 0);
    this.camRadius = 24;
    this.camAzimuth = Math.PI / 4;
    this.camPolar = Math.PI / 3.1;
    this._updateCamera();

    const key = new THREE.DirectionalLight(0xfff1cc, 1.05);
    key.position.set(10, 18, 12);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8bb7ff, 0.42);
    fill.position.set(-10, 8, -8);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.36));

    this.tileGroup = new THREE.Group();
    this.decorationGroup = new THREE.Group();
    this.effectGroup = new THREE.Group();
    this.scene.add(this.tileGroup);
    this.scene.add(this.decorationGroup);
    this.scene.add(this.effectGroup);

    this.hexGeometry = new THREE.CylinderGeometry(HEX_SIZE - HEX_GAP, HEX_SIZE - HEX_GAP, HEX_HEIGHT, 6);
    this.hexGeometry.rotateY(Math.PI / 6);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  setMap(map) {
    this.map = map;
    this.camRadius = Math.max(19, map.radius * 2.45);
    this.target.set(0, 0, 0);
    this._updateCamera();
    this._clearGroups();

    const THREE = window.THREE;
    for (const tile of map.tiles) {
      const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
      const isWaterTile = tile.type === TILE_TYPES.WATER;
      const material = new THREE.MeshStandardMaterial({
        color: terrainColor(tile),
        roughness: isWaterTile ? 0.45 : 0.86,
        metalness: isWaterTile ? 0.12 : 0.04,
        emissive: new THREE.Color(terrainColor(tile)).multiplyScalar(isWaterTile ? 0.14 : 0.04),
      });
      const mesh = new THREE.Mesh(this.hexGeometry, material);
      const heightScale = isWaterTile ? 0.34 : 1;
      mesh.scale.y = heightScale;
      mesh.position.set(x, isWaterTile ? -0.1 : HEX_HEIGHT / 2, z);
      mesh.userData.tileId = tile.id;
      this.tileGroup.add(mesh);
      this.tileMeshes.set(tile.id, mesh);
    }
  }

  renderState(map, nations, selectedTileId = null) {
    this.map = map;
    this.nations = nations || {};
    this.selectedTileId = selectedTileId;
    for (const tile of map.tiles) {
      this._updateTileMesh(tile);
      this._updateDecoration(tile);
    }
  }

  focusTile(tileIdValue) {
    if (!this.map) return;
    const tile = this.map.tiles.find((item) => item.id === tileIdValue);
    if (!tile) return;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    this.target.set(x, 0, z);
    this._updateCamera();
  }

  playBattle(report) {
    const THREE = window.THREE;
    const path = (report.path || [])
      .map((id) => this.map?.tiles.find((tile) => tile.id === id))
      .filter(Boolean)
      .map((tile) => {
        const pos = axialToWorld(tile.q, tile.r, HEX_SIZE);
        return new THREE.Vector3(pos.x, 0.9, pos.z);
      });
    if (!path.length && report.targetTileId) {
      const tile = this.map?.tiles.find((item) => item.id === report.targetTileId);
      if (tile) {
        const pos = axialToWorld(tile.q, tile.r, HEX_SIZE);
        path.push(new THREE.Vector3(pos.x, 0.9, pos.z));
      }
    }
    if (!path.length) return;

    const color = colorFromHex(this.nations[report.attackerId]?.color || OWNER_COLORS[0]);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12),
      new THREE.MeshBasicMaterial({ color })
    );
    sphere.position.copy(path[0]);
    this.effectGroup.add(sphere);
    this.effects.push({
      type: "move",
      mesh: sphere,
      path,
      start: performance.now(),
      duration: Math.max(420, path.length * 220),
      targetTileId: report.targetTileId,
    });
  }

  _updateTileMesh(tile) {
    const THREE = window.THREE;
    const mesh = this.tileMeshes.get(tile.id);
    if (!mesh) return;
    const base = new THREE.Color(terrainColor(tile));
    if (tile.ownerId && this.nations[tile.ownerId]) {
      base.lerp(new THREE.Color(this.nations[tile.ownerId].color), 0.35);
    }
    if (tile.effects?.floodedTurns > 0) base.lerp(new THREE.Color(0x3d9dcc), 0.5);
    mesh.material.color = base;
    const emissive = new THREE.Color(terrainColor(tile)).multiplyScalar(tile.type === TILE_TYPES.WATER ? 0.14 : 0.05);
    if (tile.id === this.selectedTileId) emissive.add(new THREE.Color(0xd8bd6a).multiplyScalar(0.38));
    if (tile.id === this.hoveredTileId) emissive.add(new THREE.Color(0xffffff).multiplyScalar(0.12));
    if (tile.ownerId && this.nations[tile.ownerId]) emissive.add(new THREE.Color(this.nations[tile.ownerId].color).multiplyScalar(0.18));
    mesh.material.emissive = emissive;
    mesh.material.needsUpdate = true;

    const isWaterTile = tile.type === TILE_TYPES.WATER;
    mesh.scale.y = isWaterTile ? 0.34 : 1;
    const selectedLift = tile.id === this.selectedTileId ? 0.08 : tile.id === this.hoveredTileId ? 0.05 : 0;
    mesh.position.y = (isWaterTile ? -0.1 : HEX_HEIGHT / 2) + selectedLift;
  }

  _updateDecoration(tile) {
    const signature = JSON.stringify({
      type: tile.type,
      ownerId: tile.ownerId,
      workers: tile.workers,
      unit: tile.unit?.strength || 0,
      capital: tile.isCapital,
      disabled: tile.effects?.disabledTurns || 0,
      flooded: tile.effects?.floodedTurns || 0,
    });
    if (this.decorationSignatures.get(tile.id) === signature) return;
    this.decorationSignatures.set(tile.id, signature);
    const existing = this.decorations.get(tile.id);
    if (existing) {
      this.decorationGroup.remove(existing);
      existing.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    const group = this._createDecoration(tile);
    if (group) {
      this.decorations.set(tile.id, group);
      this.decorationGroup.add(group);
    }
  }

  _createDecoration(tile) {
    if (tile.type === TILE_TYPES.EMPTY || tile.type === TILE_TYPES.WATER) return null;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const group = new THREE.Group();
    group.position.set(x, HEX_HEIGHT + 0.02, z);
    const ownerColor = colorFromHex(this.nations[tile.ownerId]?.color || "#e2dcc8");

    if (tile.isCapital) {
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.24, 0.16, 5),
        new THREE.MeshStandardMaterial({ color: 0xe7c86a, metalness: 0.25, roughness: 0.45 })
      );
      crown.position.set(0, 0.58, 0);
      group.add(crown);
    }

    if (tile.type === TILE_TYPES.FARM) {
      for (let i = -1; i <= 1; i += 1) {
        const plot = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.035, 0.72),
          new THREE.MeshStandardMaterial({ color: i === 0 ? 0x7fc66c : 0x5fb15b })
        );
        plot.position.set(i * 0.25, 0.03, 0);
        group.add(plot);
      }
      this._addWorkerDots(group, tile, 0xefe3a1, "bob");
    }

    if (tile.type === TILE_TYPES.MINE) {
      const rock = new THREE.Mesh(
        new THREE.ConeGeometry(0.36, 0.45, 5),
        new THREE.MeshStandardMaterial({ color: 0x4f4037, roughness: 0.9 })
      );
      rock.position.set(0, 0.22, 0);
      group.add(rock);
      const cart = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.16, 0.24),
        new THREE.MeshStandardMaterial({ color: 0xb98852 })
      );
      cart.position.set(0.38, 0.11, -0.18);
      group.add(cart);
      this.animated.push({ object: cart, kind: "slide", baseX: cart.position.x, phase: Math.random() * 6 });
    }

    if (tile.type === TILE_TYPES.SCHOOL) {
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.36, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x7aa2d8 })
      );
      building.position.set(0, 0.22, 0);
      group.add(building);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 0.2, 4),
        new THREE.MeshStandardMaterial({ color: 0xe4d6a5 })
      );
      roof.position.set(0, 0.52, 0);
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
      this._addWorkerDots(group, tile, 0xd9ecff, "orbit");
    }

    if (tile.type === TILE_TYPES.FACTORY) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, 0.38, 0.48),
        new THREE.MeshStandardMaterial({ color: 0x383d46, roughness: 0.7 })
      );
      body.position.set(0, 0.25, 0);
      group.add(body);
      const stack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 0.48, 12),
        new THREE.MeshStandardMaterial({ color: 0x707783 })
      );
      stack.position.set(0.22, 0.66, -0.12);
      group.add(stack);
      const gear = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.035, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xd6a84c, metalness: 0.15 })
      );
      gear.position.set(-0.24, 0.43, 0.26);
      gear.rotation.x = Math.PI / 2;
      group.add(gear);
      this.animated.push({ object: gear, kind: "spin", speed: 1.5 });
    }

    if (tile.type === TILE_TYPES.MILITARY) {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.48, 0.16, 6),
        new THREE.MeshStandardMaterial({ color: 0x733838 })
      );
      base.position.set(0, 0.1, 0);
      group.add(base);
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 0.48, 6),
        new THREE.MeshStandardMaterial({ color: 0xb55151 })
      );
      tower.position.set(0, 0.42, 0);
      group.add(tower);
      this._addWorkerDots(group, tile, ownerColor, "march");
    }

    if (tile.unit?.strength > 0) {
      const unit = new THREE.Mesh(
        new THREE.SphereGeometry(0.18 + Math.min(0.18, tile.unit.strength * 0.01), 16, 12),
        new THREE.MeshStandardMaterial({ color: ownerColor, emissive: new THREE.Color(ownerColor).multiplyScalar(0.18) })
      );
      unit.position.set(0.42, 0.62, 0.32);
      group.add(unit);
      this.animated.push({ object: unit, kind: "bob", baseY: unit.position.y, phase: Math.random() * 6 });
    }

    if (tile.effects?.disabledTurns > 0 || tile.effects?.floodedTurns > 0) {
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.54, 0.025, 8, 32),
        new THREE.MeshBasicMaterial({ color: tile.effects.floodedTurns > 0 ? 0x5ec8ff : 0xffd166 })
      );
      marker.position.set(0, 0.08, 0);
      marker.rotation.x = Math.PI / 2;
      group.add(marker);
    }

    return group;
  }

  _addWorkerDots(group, tile, color, kind) {
    const THREE = window.THREE;
    const count = Math.min(5, Math.max(1, Math.ceil((tile.workers || 0) / 2)));
    for (let i = 0; i < count; i += 1) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 6),
        new THREE.MeshStandardMaterial({ color })
      );
      const angle = (i / count) * Math.PI * 2;
      dot.position.set(Math.cos(angle) * 0.42, 0.18, Math.sin(angle) * 0.42);
      group.add(dot);
      this.animated.push({
        object: dot,
        kind,
        baseY: dot.position.y,
        baseX: dot.position.x,
        baseZ: dot.position.z,
        phase: i * 0.8 + Math.random(),
      });
    }
  }

  _bindInput() {
    this.dragMode = null;
    this.lastPointer = { x: 0, y: 0 };
    this.dragDistance = 0;
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.dragMode = event.button === 2 ? "pan" : "orbit";
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.dragDistance = 0;
    });
    this.canvas.addEventListener("pointerup", (event) => {
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch (_) {}
      const clicked = this.dragDistance < 5 && event.button === 0;
      this.dragMode = null;
      if (clicked) this._handleSelect(event);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (this.dragMode === "orbit") {
        this.dragDistance += Math.hypot(dx, dy);
        this.camAzimuth -= dx * 0.008;
        this.camPolar = clamp(this.camPolar - dy * 0.006, 0.18, Math.PI / 2 - 0.08);
        this._updateCamera();
      } else if (this.dragMode === "pan") {
        this.dragDistance += Math.hypot(dx, dy);
        const forward = new window.THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new window.THREE.Vector3().crossVectors(forward, new window.THREE.Vector3(0, 1, 0)).normalize();
        const scale = this.camRadius * 0.0018;
        this.target.addScaledVector(right, -dx * scale);
        this.target.addScaledVector(forward, dy * scale);
        this._updateCamera();
      } else {
        const tileIdValue = this._pickTile(event);
        if (tileIdValue !== this.hoveredTileId) {
          this.hoveredTileId = tileIdValue;
          if (this.onHover) this.onHover(tileIdValue, event);
        }
      }
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.camRadius = clamp(this.camRadius * Math.exp(event.deltaY * 0.0014), 7, 65);
        this._updateCamera();
      },
      { passive: false }
    );
    this.canvas.addEventListener("pointerleave", () => {
      this.hoveredTileId = null;
      if (this.onHover) this.onHover(null, null);
    });
  }

  _handleSelect(event) {
    const id = this._pickTile(event);
    if (this.onSelect) this.onSelect(id);
  }

  _pickTile(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.tileGroup.children, false);
    return hits[0]?.object?.userData?.tileId || null;
  }

  _resize() {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _updateCamera() {
    const THREE = window.THREE;
    const sinP = Math.sin(this.camPolar);
    const x = this.target.x + this.camRadius * sinP * Math.cos(this.camAzimuth);
    const z = this.target.z + this.camRadius * sinP * Math.sin(this.camAzimuth);
    const y = this.target.y + this.camRadius * Math.cos(this.camPolar);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  _clearGroups() {
    const groups = [this.tileGroup, this.decorationGroup, this.effectGroup];
    for (const group of groups) {
      while (group.children.length) {
        const child = group.children.pop();
        child.traverse?.((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    }
    this.tileMeshes.clear();
    this.decorations.clear();
    this.decorationSignatures.clear();
    this.animated = [];
    this.effects = [];
  }

  _animate(now) {
    requestAnimationFrame(this._animate);
    const time = now * 0.001;
    for (const item of this.animated) {
      if (!item.object.parent) continue;
      if (item.kind === "spin") item.object.rotation.z += 0.03 * (item.speed || 1);
      if (item.kind === "bob") item.object.position.y = item.baseY + Math.sin(time * 3 + item.phase) * 0.035;
      if (item.kind === "slide") item.object.position.x = item.baseX + Math.sin(time * 2 + item.phase) * 0.12;
      if (item.kind === "march") {
        item.object.position.x = item.baseX + Math.sin(time * 4 + item.phase) * 0.035;
        item.object.position.z = item.baseZ + Math.cos(time * 4 + item.phase) * 0.035;
      }
      if (item.kind === "orbit") {
        const angle = time * 0.8 + item.phase;
        const radius = Math.hypot(item.baseX, item.baseZ) || 0.35;
        item.object.position.x = Math.cos(angle) * radius;
        item.object.position.z = Math.sin(angle) * radius;
      }
    }
    this._updateEffects(now);
    this.renderer.render(this.scene, this.camera);
  }

  _updateEffects(now) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      if (effect.type === "move") {
        const t = clamp((now - effect.start) / effect.duration, 0, 1);
        const segmentCount = Math.max(1, effect.path.length - 1);
        const exact = t * segmentCount;
        const index = Math.min(segmentCount - 1, Math.floor(exact));
        const local = exact - index;
        const from = effect.path[index];
        const to = effect.path[Math.min(effect.path.length - 1, index + 1)];
        effect.mesh.position.lerpVectors(from, to, local);
        effect.mesh.position.y += Math.sin(t * Math.PI) * 0.35;
        if (t >= 1) {
          this.effectGroup.remove(effect.mesh);
          effect.mesh.geometry.dispose();
          effect.mesh.material.dispose();
          this.effects.splice(i, 1);
          this._flashTile(effect.targetTileId);
        }
      } else if (effect.type === "flash") {
        const t = clamp((now - effect.start) / effect.duration, 0, 1);
        effect.mesh.material.opacity = 1 - t;
        effect.mesh.scale.setScalar(1 + t * 0.8);
        if (t >= 1) {
          this.effectGroup.remove(effect.mesh);
          effect.mesh.geometry.dispose();
          effect.mesh.material.dispose();
          this.effects.splice(i, 1);
        }
      }
    }
  }

  _flashTile(tileIdValue) {
    if (!tileIdValue || !this.map) return;
    const THREE = window.THREE;
    const tile = this.map.tiles.find((item) => item.id === tileIdValue);
    if (!tile) return;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.035, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 1 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.72, z);
    this.effectGroup.add(ring);
    this.effects.push({ type: "flash", mesh: ring, start: performance.now(), duration: 520 });
  }
}
