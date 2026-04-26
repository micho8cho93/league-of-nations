import {
  MAP_SIZES,
  HEX_DIRECTIONS,
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
import { STARTING_PROFILES, militaryPower } from "./nation.js";

const HEX_SIZE = 1;
const HEX_HEIGHT = 0.34;
const HEX_GAP = 0.035;
const LABEL_HIDE_RADIUS = 10;
const LABEL_FULL_RADIUS = 14;


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

  // Scatter mountain ranges across interior land tiles using layered noise
  for (const tile of tiles) {
    if (tile.terrain !== "land") continue;
    const edge = Math.max(Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r)) / radius;
    if (edge > 0.78) continue;
    const n1 = hash2d(tile.q * 3 + 11, tile.r * 4 - 7, seed + 7777);
    const n2 = hash2d(tile.q + 2, tile.r * 2 + 3, seed + 8831);
    if (n1 * 0.62 + n2 * 0.38 < 0.083) {
      tile.type = TILE_TYPES.MOUNTAIN;
    }
  }

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

function visualTierForTile(tile, nations) {
  const tech = nations[tile.ownerId]?.tech;
  if (!tech) return 0;
  if (tile.type === TILE_TYPES.FARM) return tech.farming || 0;
  if (tile.type === TILE_TYPES.MINE) return tech.mining || 0;
  if (tile.type === TILE_TYPES.SCHOOL) return tech.education || 0;
  if (tile.type === TILE_TYPES.MILITARY) return tech.military || 0;
  if (tile.type === TILE_TYPES.FACTORY) return Math.min(4, Math.max(tech.mining || 0, tech.education || 0));
  return 0;
}

function strongestBranchForTile(tile, nations) {
  if (tile.type !== TILE_TYPES.MILITARY) return { branch: tile.unit?.branch || "infantry", level: 0 };
  const nation = nations[tile.ownerId];
  const branches = nation?.tech?.branches || {};
  const focus = nation?.military?.branchFocus;
  if (focus && branches[focus] > 0) return { branch: focus, level: branches[focus] };
  return Object.entries(branches).reduce((best, [branch, level]) => {
    return level > best.level ? { branch, level } : best;
  }, { branch: tile.unit?.branch || "infantry", level: 0 });
}

function visualBranchesForUnit(unit) {
  if (!unit?.strength) return [];
  const branches = [];
  for (const branch of ["infantry", "tanks", "air", "naval"]) {
    const strength = Math.max(0, Number(unit.branches?.[branch] || 0));
    if (strength > 0) branches.push({ branch, strength });
  }
  if (!branches.length) branches.push({ branch: unit.branch || "infantry", strength: unit.strength });
  return branches;
}

function hexCorners(tile, radius = HEX_SIZE - HEX_GAP * 0.65) {
  const center = axialToWorld(tile.q, tile.r, HEX_SIZE);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    return {
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
    };
  });
}

function edgeCornersForDirection(direction) {
  if (direction.q === 1 && direction.r === 0) return [5, 0];
  if (direction.q === -1 && direction.r === 0) return [2, 3];
  if (direction.q === 0 && direction.r === 1) return [4, 5];
  if (direction.q === 0 && direction.r === -1) return [1, 2];
  if (direction.q === 1 && direction.r === -1) return [0, 1];
  return [3, 4];
}

function capitalScale(tile, nations, mapTiles = []) {
  const nation = nations[tile.ownerId];
  if (!nation) return 1;
  const territory = nation.territory?.length || mapTiles.filter((item) => item.ownerId === nation.id).length;
  const population = nation.population?.total || 0;
  const power = militaryPower(nation, mapTiles);
  return clamp(1 + territory * 0.012 + population / 900 + power * 0.006, 1, 1.68);
}

function targetIdFromAction(action) {
  if (!action) return null;
  if (typeof action === "string") return action;
  return action.toTileId || action.tileId || action.id || null;
}

function normalizeMilitaryHighlights(highlights = null) {
  return {
    sourceTileId: highlights?.sourceTileId || null,
    moveTargetIds: new Set((highlights?.moveTargets || []).map(targetIdFromAction).filter(Boolean)),
    attackTargetIds: new Set((highlights?.attackTargets || []).map(targetIdFromAction).filter(Boolean)),
  };
}

class MilitaryAnimationManager {
  constructor(mapRenderer) {
    this.mapRenderer = mapRenderer;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  }

  play(action) {
    try {
      if (!action || !this.mapRenderer.map) return;
      if (this.reducedMotion) {
        this.mapRenderer._flashTile(action.targetTileId);
        return;
      }
      if (action.action === "move") this.playMove(action);
      else if (action.action === "attack" || action.targetTileId) this.playAttack(action);
    } catch (error) {
      console.warn("Military animation failed", error);
    }
  }

  playMove(action) {
    const path = this.mapRenderer._tilePathToVectors(action.path || [action.fromTileId, action.targetTileId], action.unitType);
    if (path.length < 2) return;
    const mesh = this.mapRenderer._createUnitEffectMesh(action.unitType, action.nationId);
    mesh.position.copy(path[0]);
    this.mapRenderer.effectGroup.add(mesh);
    this.mapRenderer.effects.push({
      type: "unitMove",
      mesh,
      unitType: action.unitType || "infantry",
      path,
      start: performance.now(),
      duration: this.durationFor(action.unitType, path.length, false),
      targetTileId: action.targetTileId,
    });
  }

  playAttack(action) {
    const path = this.mapRenderer._tilePathToVectors(action.path || [action.fromTileId, action.targetTileId], action.unitType);
    if (!path.length) return;
    const unitType = action.unitType || "infantry";
    if (unitType === "air") {
      const mesh = this.mapRenderer._createUnitEffectMesh(unitType, action.attackerId || action.nationId);
      mesh.position.copy(path[0]);
      this.mapRenderer.effectGroup.add(mesh);
      this.mapRenderer.effects.push({
        type: "unitMove",
        mesh,
        unitType,
        path,
        start: performance.now(),
        duration: this.durationFor(unitType, path.length, true),
        targetTileId: action.targetTileId,
        explodeAtEnd: true,
      });
      return;
    }

    const projectile = this.mapRenderer._createProjectileMesh(unitType, action.attackerId || action.nationId);
    projectile.position.copy(path[0]);
    this.mapRenderer.effectGroup.add(projectile);
    this.mapRenderer.effects.push({
      type: "projectile",
      mesh: projectile,
      unitType,
      path,
      start: performance.now(),
      duration: this.durationFor(unitType, path.length, true),
      targetTileId: action.targetTileId,
    });
  }

  durationFor(unitType, pathLength, attack) {
    const base = unitType === "air" ? 520 : unitType === "tanks" ? 620 : unitType === "naval" ? 760 : 520;
    return Math.max(320, base + Math.max(0, pathLength - 2) * (attack ? 80 : 140));
  }
}

export class HexMapRenderer {
  constructor(canvas, { onSelect = null, onHover = null } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.tileMeshes = new Map();
    this.decorations = new Map();
    this.decorationSignatures = new Map();
    this.territoryBorderSignature = "";
    this.nationLabels = new Map();
    this.nationLabelSignature = "";
    this.animated = [];
    this.effects = [];
    this.animationManager = new MilitaryAnimationManager(this);
    this.selectedTileId = null;
    this.militaryHighlights = normalizeMilitaryHighlights();
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
    this.territoryBorderGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.decorationGroup = new THREE.Group();
    this.effectGroup = new THREE.Group();
    this.scene.add(this.tileGroup);
    this.scene.add(this.territoryBorderGroup);
    this.scene.add(this.highlightGroup);
    this.scene.add(this.decorationGroup);
    this.scene.add(this.effectGroup);

    this.hexGeometry = new THREE.CylinderGeometry(HEX_SIZE - HEX_GAP, HEX_SIZE - HEX_GAP, HEX_HEIGHT, 6);
    this.hexGeometry.rotateY(Math.PI / 6);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "map-label-layer";
    this.canvas.parentElement?.append(this.labelLayer);
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

  renderState(map, nations, selectedTileId = null, militaryHighlights = null) {
    this.map = map;
    this.nations = nations || {};
    this.selectedTileId = selectedTileId;
    this.militaryHighlights = normalizeMilitaryHighlights(militaryHighlights);
    for (const tile of map.tiles) {
      this._updateTileMesh(tile);
      this._updateDecoration(tile);
    }
    this._renderTerritoryBorders();
    this._renderNationLabels();
    this._renderMilitaryHighlights();
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
    this.playMilitaryAction({ ...report, action: "attack", nationId: report.attackerId });
  }

  playMilitaryAction(action) {
    this.animationManager.play(action);
  }

  showBattleDelta(report) {
    if (!this.labelLayer || !this.map) return;
    const { losses, fromTileId, targetTileId } = report;
    if (fromTileId) {
      const text = losses.attacker > 0 ? `-${losses.attacker}` : "✦";
      this._spawnDeltaLabel(fromTileId, text, losses.attacker > 0 ? "#ff6b6b" : "#7ecfff", 80);
    }
    if (targetTileId) {
      const text = losses.defender > 0 ? `-${losses.defender}` : "✦";
      this._spawnDeltaLabel(targetTileId, text, losses.defender > 0 ? "#ff6b6b" : "#7ecfff", 0);
    }
  }

  showTileResourceDeltas(tileId, items) {
    items.forEach(({ text, color }, index) => {
      this._spawnResourceDelta(tileId, text, color, index);
    });
  }

  _spawnResourceDelta(tileId, text, color, stackIndex = 0) {
    const tile = this.map?.tiles.find((t) => t.id === tileId);
    if (!tile || !this.labelLayer || !this.camera) return;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const vector = new THREE.Vector3(x, 1.6, z).project(this.camera);
    if (vector.z >= 1) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = (vector.x * 0.5 + 0.5) * rect.width;
    const screenY = (-vector.y * 0.5 + 0.5) * rect.height;
    const label = document.createElement("div");
    label.className = "resource-delta-tile";
    label.textContent = text;
    label.style.left = `${screenX}px`;
    label.style.top = `${screenY - stackIndex * 22}px`;
    label.style.color = color;
    this.labelLayer.append(label);
    label.animate(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: "translate(-50%, -320%) scale(1.05)", opacity: 0 },
      ],
      { duration: 1500, easing: "ease-out", fill: "forwards" }
    ).onfinish = () => label.remove();
  }

  _spawnDeltaLabel(tileId, text, color, delayMs = 0) {
    const tile = this.map?.tiles.find((t) => t.id === tileId);
    if (!tile || !this.labelLayer || !this.camera) return;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const vector = new THREE.Vector3(x, 1.6, z).project(this.camera);
    if (vector.z >= 1) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = (vector.x * 0.5 + 0.5) * rect.width;
    const screenY = (-vector.y * 0.5 + 0.5) * rect.height;
    const label = document.createElement("div");
    label.className = "battle-delta";
    label.textContent = text;
    label.style.cssText = `left:${screenX}px;top:${screenY}px;color:${color}`;
    this.labelLayer.append(label);
    const anim = () => {
      label.animate(
        [
          { transform: "translate(-50%, -50%) scale(1.1)", opacity: 1 },
          { transform: "translate(-50%, -220%) scale(1.4)", opacity: 0 },
        ],
        { duration: 1700, easing: "ease-out", fill: "forwards" }
      ).onfinish = () => label.remove();
    };
    if (delayMs > 0) window.setTimeout(anim, delayMs);
    else anim();
  }

  _updateTileMesh(tile) {
    const THREE = window.THREE;
    const mesh = this.tileMeshes.get(tile.id);
    if (!mesh) return;
    const base = new THREE.Color(terrainColor(tile));
    if (tile.ownerId && this.nations[tile.ownerId]) {
      base.lerp(new THREE.Color(this.nations[tile.ownerId].color), 0.42);
    }
    if (tile.effects?.floodedTurns > 0) base.lerp(new THREE.Color(0x3d9dcc), 0.5);
    mesh.material.color = base;
    const emissive = new THREE.Color(terrainColor(tile)).multiplyScalar(tile.type === TILE_TYPES.WATER ? 0.14 : 0.05);
    const highlight = this._highlightKind(tile.id);
    if (highlight === "move") emissive.add(new THREE.Color(0x39d9a3).multiplyScalar(0.42));
    if (highlight === "attack") emissive.add(new THREE.Color(0xff7142).multiplyScalar(0.5));
    if (highlight === "source") emissive.add(new THREE.Color(0xffdf7a).multiplyScalar(0.58));
    if (tile.id === this.selectedTileId) emissive.add(new THREE.Color(0xd8bd6a).multiplyScalar(0.38));
    if (tile.id === this.hoveredTileId) emissive.add(new THREE.Color(0xffffff).multiplyScalar(0.12));
    if (tile.ownerId && this.nations[tile.ownerId]) emissive.add(new THREE.Color(this.nations[tile.ownerId].color).multiplyScalar(0.18));
    if (tile.isCapital) emissive.add(new THREE.Color(0xffd700).multiplyScalar(0.28));
    mesh.material.emissive = emissive;
    mesh.material.needsUpdate = true;

    const isWaterTile = tile.type === TILE_TYPES.WATER;
    mesh.scale.y = isWaterTile ? 0.34 : 1;
    const selectedLift = highlight ? 0.09 : tile.id === this.selectedTileId ? 0.08 : tile.id === this.hoveredTileId ? 0.05 : 0;
    const baseY = isWaterTile ? -0.1 : HEX_HEIGHT / 2;
    mesh.position.y = baseY + selectedLift;
  }

  _highlightKind(tileIdValue) {
    if (this.militaryHighlights.sourceTileId === tileIdValue) return "source";
    if (this.militaryHighlights.attackTargetIds.has(tileIdValue)) return "attack";
    if (this.militaryHighlights.moveTargetIds.has(tileIdValue)) return "move";
    return null;
  }

  _renderMilitaryHighlights() {
    this._clearHighlightGroup();
    if (!this.map) return;
    const source = this.militaryHighlights.sourceTileId ? this.map.tiles.find((tile) => tile.id === this.militaryHighlights.sourceTileId) : null;
    if (source) this._addHighlightRing(source, 0xffd166, { radius: 0.84, tube: 0.042, opacity: 0.96, yOffset: 0.12 });
    for (const tileIdValue of this.militaryHighlights.moveTargetIds) {
      const tile = this.map.tiles.find((item) => item.id === tileIdValue);
      if (tile) this._addHighlightRing(tile, 0x3ce0aa, { radius: 0.74, tube: 0.038, opacity: 0.78, yOffset: 0.1 });
    }
    for (const tileIdValue of this.militaryHighlights.attackTargetIds) {
      const tile = this.map.tiles.find((item) => item.id === tileIdValue);
      if (tile) this._addHighlightRing(tile, 0xff6a38, { radius: 0.76, tube: 0.048, opacity: 0.88, yOffset: 0.13 });
    }
  }

  _renderTerritoryBorders() {
    if (!this.map) return;
    const signature = this.map.tiles
      .filter((tile) => tile.ownerId)
      .map((tile) => `${tile.id}:${tile.ownerId}`)
      .sort()
      .join("|");
    if (signature === this.territoryBorderSignature) return;
    this.territoryBorderSignature = signature;
    this._clearObjectGroup(this.territoryBorderGroup);

    const THREE = window.THREE;
    const index = buildTileIndex(this.map.tiles);
    for (const tile of this.map.tiles) {
      if (!tile.ownerId || !this.nations[tile.ownerId]) continue;
      const ownerColor = colorFromHex(this.nations[tile.ownerId].color);
      const corners = hexCorners(tile);
      for (const direction of HEX_DIRECTIONS) {
        const neighbor = index.get(tileId(tile.q + direction.q, tile.r + direction.r));
        if (neighbor?.ownerId === tile.ownerId) continue;
        const [fromIndex, toIndex] = edgeCornersForDirection(direction);
        const from = corners[fromIndex];
        const to = corners[toIndex];
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dz);
        const angle = Math.atan2(dz, dx);
        const midX = (from.x + to.x) / 2;
        const midZ = (from.z + to.z) / 2;
        const glow = new THREE.Mesh(
          new THREE.BoxGeometry(length + 0.06, 0.005, 0.11),
          new THREE.MeshBasicMaterial({ color: ownerColor, transparent: true, opacity: 0.34, depthWrite: false })
        );
        glow.position.set(midX, HEX_HEIGHT + 0.012, midZ);
        glow.rotation.y = -angle;
        this.territoryBorderGroup.add(glow);

        const line = new THREE.Mesh(
          new THREE.BoxGeometry(length + 0.03, 0.006, 0.046),
          new THREE.MeshBasicMaterial({ color: ownerColor, transparent: true, opacity: 0.94, depthWrite: false })
        );
        line.position.set(midX, HEX_HEIGHT + 0.016, midZ);
        line.rotation.y = -angle;
        this.territoryBorderGroup.add(line);
      }
    }
  }

  _renderNationLabels() {
    if (!this.map || !this.labelLayer) return;
    const activeNations = Object.values(this.nations).filter((nation) => nation?.active !== false);
    const signature = activeNations
      .map((nation) => `${nation.id}:${nation.name}:${nation.color}:${nation.capitalTileId}:${nation.territory?.length || 0}`)
      .sort()
      .join("|");
    if (signature !== this.nationLabelSignature) {
      this.nationLabelSignature = signature;
      const activeIds = new Set(activeNations.map((nation) => nation.id));
      for (const [id, label] of this.nationLabels.entries()) {
        if (activeIds.has(id)) continue;
        label.remove();
        this.nationLabels.delete(id);
      }
      for (const nation of activeNations) {
        if (this.nationLabels.has(nation.id)) continue;
        const label = document.createElement("div");
        label.className = "nation-label";
        label.style.setProperty("--nation-color", nation.color);
        label.textContent = nation.name;
        this.labelLayer.append(label);
        this.nationLabels.set(nation.id, label);
      }
      for (const nation of activeNations) {
        const label = this.nationLabels.get(nation.id);
        if (!label) continue;
        label.textContent = nation.name;
        label.style.setProperty("--nation-color", nation.color);
      }
    }
    this._updateNationLabels();
  }

  _labelAnchorTile(nation) {
    if (!nation || !this.map) return null;
    const owned = this.map.tiles.filter((tile) => tile.ownerId === nation.id);
    if (!owned.length) return null;
    const capital = owned.find((tile) => tile.id === nation.capitalTileId || tile.isCapital);
    if (capital) return capital;
    const center = owned.reduce((sum, tile) => ({ q: sum.q + tile.q, r: sum.r + tile.r }), { q: 0, r: 0 });
    center.q /= owned.length;
    center.r /= owned.length;
    return owned.reduce((best, tile) => {
      const bestDistance = Math.hypot(best.q - center.q, best.r - center.r);
      const tileDistance = Math.hypot(tile.q - center.q, tile.r - center.r);
      return tileDistance < bestDistance ? tile : best;
    }, owned[0]);
  }

  _nationLabelVisibility() {
    if (this.camRadius <= LABEL_HIDE_RADIUS) return 0;
    if (this.camRadius >= LABEL_FULL_RADIUS) return 1;
    return (this.camRadius - LABEL_HIDE_RADIUS) / (LABEL_FULL_RADIUS - LABEL_HIDE_RADIUS);
  }

  _updateNationLabels() {
    if (!this.labelLayer || !this.map || !this.camera) return;
    const THREE = window.THREE;
    const rect = this.canvas.getBoundingClientRect();
    const opacity = this._nationLabelVisibility();
    for (const [nationId, label] of this.nationLabels.entries()) {
      const nation = this.nations[nationId];
      const anchor = this._labelAnchorTile(nation);
      if (!anchor || opacity <= 0.02) {
        label.hidden = true;
        continue;
      }
      const { x, z } = axialToWorld(anchor.q, anchor.r, HEX_SIZE);
      const scale = anchor.isCapital ? capitalScale(anchor, this.nations, this.map.tiles) : 1;
      const vector = new THREE.Vector3(x, 1.45 + scale * 0.24, z).project(this.camera);
      const visible = vector.z < 1 && vector.x > -1.16 && vector.x < 1.16 && vector.y > -1.18 && vector.y < 1.18;
      label.hidden = !visible;
      if (!visible) continue;
      const screenX = (vector.x * 0.5 + 0.5) * rect.width;
      const screenY = (-vector.y * 0.5 + 0.5) * rect.height;
      label.style.left = `${screenX}px`;
      label.style.top = `${screenY}px`;
      label.style.opacity = String(opacity);
    }
  }

  _addHighlightRing(tile, color, { radius, tube, opacity, yOffset }) {
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 8, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 6;
    ring.position.set(x, (tile.type === TILE_TYPES.WATER ? 0.08 : HEX_HEIGHT + 0.02) + yOffset, z);
    this.highlightGroup.add(ring);
  }

  _clearHighlightGroup() {
    if (!this.highlightGroup) return;
    this._clearObjectGroup(this.highlightGroup);
  }

  _clearObjectGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children.pop();
      child.traverse?.((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
  }

  _updateDecoration(tile) {
    const visualTier = visualTierForTile(tile, this.nations);
    const branch = strongestBranchForTile(tile, this.nations);
    const signature = JSON.stringify({
      type: tile.type,
      ownerId: tile.ownerId,
      workers: tile.workers,
      unit: tile.unit?.strength || 0,
      unitBranch: tile.unit?.branch || "infantry",
      unitBranches: tile.unit?.branches || null,
      visualTier,
      branch: branch.branch,
      branchLevel: branch.level,
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
    const hasUnit = tile.unit?.strength > 0;
    if (tile.type === TILE_TYPES.WATER && !hasUnit && !tile.ownerId) return null;
    const THREE = window.THREE;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);

    if (tile.type === TILE_TYPES.MOUNTAIN) {
      const group = new THREE.Group();
      group.position.set(x, HEX_HEIGHT + 0.02, z);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.96, metalness: 0 });
      const snowMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.88 });
      const peak = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.68, 7), rockMat);
      peak.position.set(-0.06, 0.36, 0.04);
      group.add(peak);
      const peak2 = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.46, 6), rockMat);
      peak2.position.set(0.31, 0.25, -0.2);
      group.add(peak2);
      const snow = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.25, 7), snowMat);
      snow.position.set(-0.06, 0.68, 0.04);
      group.add(snow);
      return group;
    }

    const group = new THREE.Group();
    group.position.set(x, tile.type === TILE_TYPES.WATER ? 0.08 : HEX_HEIGHT + 0.02, z);
    const ownerColor = colorFromHex(this.nations[tile.ownerId]?.color || "#e2dcc8");

    // Ownership ring — shown on every owned land tile so nation borders are unambiguous
    if (tile.ownerId && this.nations[tile.ownerId]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.74, 0.032, 6, 6),
        new THREE.MeshBasicMaterial({ color: ownerColor })
      );
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = Math.PI / 6; // align with hex flat-top orientation
      ring.position.set(0, 0.04, 0);
      group.add(ring);
    }

    if (tile.isCapital) {
      this._addCapitalMarker(group, tile, ownerColor);
    }

    if (tile.type === TILE_TYPES.WATER) {
      this._addUnitFigure(group, tile, ownerColor, { x: 0, y: 0.2, z: 0, scale: 1.08 });
      return group.children.length ? group : null;
    }

    // Empty owned tiles get the ownership ring plus any troops stationed there.
    if (tile.type === TILE_TYPES.EMPTY) {
      this._addUnitFigure(group, tile, ownerColor, { x: 0, y: 0.22, z: 0, scale: 1.08 });
      return group.children.length ? group : null;
    }

    const visualTier = visualTierForTile(tile, this.nations);
    const branch = strongestBranchForTile(tile, this.nations);
    const scale = 1 + visualTier * 0.055;

    if (tile.type === TILE_TYPES.FARM) {
      const plotCount = 3 + Math.min(2, Math.floor(visualTier / 2));
      for (let i = 0; i < plotCount; i += 1) {
        const plot = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.035, 0.64 + visualTier * 0.04),
          new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0x7fc66c : 0x5fb15b })
        );
        plot.position.set((i - (plotCount - 1) / 2) * 0.19, 0.03, 0);
        group.add(plot);
      }
      if (visualTier >= 2) {
        const silo = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.1, 0.34 + visualTier * 0.04, 12),
          new THREE.MeshStandardMaterial({ color: 0xded5a8, roughness: 0.62 })
        );
        silo.position.set(0.38, 0.2 + visualTier * 0.02, 0.22);
        group.add(silo);
      }
      if (visualTier >= 4) {
        const greenhouse = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.18, 0.24),
          new THREE.MeshStandardMaterial({ color: 0xb7e4d8, transparent: true, opacity: 0.76 })
        );
        greenhouse.position.set(-0.36, 0.16, -0.22);
        group.add(greenhouse);
      }
      this._addWorkerDots(group, tile, 0xefe3a1, "bob");
    }

    if (tile.type === TILE_TYPES.MINE) {
      const rock = new THREE.Mesh(
        new THREE.ConeGeometry(0.36 * scale, 0.45 + visualTier * 0.08, 5),
        new THREE.MeshStandardMaterial({ color: 0x4f4037, roughness: 0.9 })
      );
      rock.position.set(0, 0.22 + visualTier * 0.04, 0);
      group.add(rock);
      const cart = new THREE.Mesh(
        new THREE.BoxGeometry(0.32 + visualTier * 0.025, 0.16, 0.24),
        new THREE.MeshStandardMaterial({ color: 0xb98852 })
      );
      cart.position.set(0.38, 0.11, -0.18);
      group.add(cart);
      this.animated.push({ object: cart, kind: "slide", baseX: cart.position.x, phase: Math.random() * 6 });
      if (visualTier >= 2) {
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.58, 0.08),
          new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.8 })
        );
        beam.position.set(-0.36, 0.34, 0.18);
        group.add(beam);
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.62, 0.06, 0.06),
          new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.8 })
        );
        arm.position.set(-0.18, 0.62, 0.18);
        arm.rotation.z = -0.35;
        group.add(arm);
      }
      if (visualTier >= 4) {
        const drill = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.07, 0.42, 10),
          new THREE.MeshStandardMaterial({ color: 0xc8c2b8, metalness: 0.32, roughness: 0.45 })
        );
        drill.position.set(0.18, 0.34, 0.34);
        drill.rotation.z = 0.35;
        group.add(drill);
        this.animated.push({ object: drill, kind: "bob", baseY: drill.position.y, phase: Math.random() * 6 });
      }
    }

    if (tile.type === TILE_TYPES.SCHOOL) {
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(0.58 + visualTier * 0.05, 0.36 + visualTier * 0.06, 0.42 + visualTier * 0.025),
        new THREE.MeshStandardMaterial({ color: 0x7aa2d8 })
      );
      building.position.set(0, 0.22 + visualTier * 0.03, 0);
      group.add(building);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 0.2, 4),
        new THREE.MeshStandardMaterial({ color: 0xe4d6a5 })
      );
      roof.position.set(0, 0.52 + visualTier * 0.06, 0);
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
      if (visualTier >= 2) {
        for (const xOffset of [-0.38, 0.38]) {
          const wing = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.24 + visualTier * 0.035, 0.28),
            new THREE.MeshStandardMaterial({ color: 0x557fb8 })
          );
          wing.position.set(xOffset, 0.2 + visualTier * 0.025, -0.02);
          group.add(wing);
        }
      }
      if (visualTier >= 4) {
        const observatory = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0xd9ecff, metalness: 0.12 })
        );
        observatory.position.set(0.02, 0.82, 0.04);
        group.add(observatory);
      }
      this._addWorkerDots(group, tile, 0xd9ecff, "orbit");
    }

    if (tile.type === TILE_TYPES.FACTORY) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.72 + visualTier * 0.055, 0.38 + visualTier * 0.06, 0.48 + visualTier * 0.035),
        new THREE.MeshStandardMaterial({ color: 0x383d46, roughness: 0.7 })
      );
      body.position.set(0, 0.25 + visualTier * 0.03, 0);
      group.add(body);
      const stackCount = visualTier >= 3 ? 3 : visualTier >= 1 ? 2 : 1;
      for (let i = 0; i < stackCount; i += 1) {
        const stack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.1, 0.48 + visualTier * 0.08, 12),
          new THREE.MeshStandardMaterial({ color: 0x707783 })
        );
        stack.position.set(0.12 + i * 0.17, 0.66 + visualTier * 0.07, -0.12 + (i % 2) * 0.18);
        group.add(stack);
      }
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
        new THREE.CylinderGeometry(0.42 * scale, 0.48 * scale, 0.16 + visualTier * 0.02, 6),
        new THREE.MeshStandardMaterial({ color: 0x733838 })
      );
      base.position.set(0, 0.1, 0);
      group.add(base);
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 0.48 + visualTier * 0.08, 6),
        new THREE.MeshStandardMaterial({ color: 0xb55151 })
      );
      tower.position.set(0, 0.42 + visualTier * 0.04, 0);
      group.add(tower);
      if (branch.level > 0 || visualTier >= 3) {
        const hangar = new THREE.Mesh(
          new THREE.BoxGeometry(0.38, 0.2, 0.28),
          new THREE.MeshStandardMaterial({ color: 0x5f3437, roughness: 0.7 })
        );
        hangar.position.set(-0.34, 0.17, -0.16);
        group.add(hangar);
      }
      if (branch.branch === "tanks" && branch.level > 0) {
        this._addTankUnit(group, { x: 0.38, y: 0.23, z: 0.27, scale: 0.82, color: 0x53664f, phase: Math.random() * 6 });
      }
      if (branch.branch === "air" && branch.level > 0) {
        this._addPlaneUnit(group, { x: 0.38, y: 0.72, z: 0.18, scale: 0.82, color: 0xb8c6d8, phase: Math.random() * 6 });
      }
      if (branch.branch === "naval" && branch.level > 0) {
        this._addShipUnit(group, { x: 0.34, y: 0.2, z: -0.3, scale: 0.8, color: 0x3f6f82, phase: Math.random() * 6 });
      }
      this._addWorkerDots(group, tile, ownerColor, "march");
    }

    this._addUnitFigure(group, tile, ownerColor, { x: 0.42, y: 0.62, z: 0.32, scale: 1 });

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

  _addCapitalMarker(group, tile, ownerColor) {
    const THREE = window.THREE;
    const scale = capitalScale(tile, this.nations, this.map?.tiles || []);
    const capitalColor = new THREE.Color(0xffe066);
    const owner = new THREE.Color(ownerColor);

    const baseGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.74 * scale, 0.07, 8, 48),
      new THREE.MeshBasicMaterial({ color: ownerColor, transparent: true, opacity: 0.78, depthWrite: false })
    );
    baseGlow.rotation.x = Math.PI / 2;
    baseGlow.rotation.z = Math.PI / 6;
    baseGlow.position.set(0, 0.075, 0);
    group.add(baseGlow);
    this.animated.push({ object: baseGlow, kind: "pulse", baseOpacity: 0.78, phase: Math.random() * 6 });

    const goldRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.5 * scale, 0.055, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.96, depthWrite: false })
    );
    goldRing.rotation.x = Math.PI / 2;
    goldRing.position.set(0, 0.12, 0);
    group.add(goldRing);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26 * scale, 0.36 * scale, 0.24 * scale, 6),
      new THREE.MeshStandardMaterial({
        color: owner.lerp(capitalColor, 0.32),
        metalness: 0.18,
        roughness: 0.42,
        emissive: new THREE.Color(ownerColor).multiplyScalar(0.22),
      })
    );
    plinth.position.set(0, 0.25 * scale, 0);
    group.add(plinth);

    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17 * scale, 0.3 * scale, 0.28 * scale, 5),
      new THREE.MeshStandardMaterial({
        color: 0xffd166,
        metalness: 0.5,
        roughness: 0.28,
        emissive: new THREE.Color(0xffd166).multiplyScalar(0.36),
      })
    );
    crown.position.set(0, 0.58 * scale, 0);
    group.add(crown);
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

  _addUnitFigure(group, tile, ownerColor, position) {
    if (!tile.unit?.strength) return;
    const branches = visualBranchesForUnit(tile.unit);
    const multiple = branches.length > 1;
    const offsets = {
      infantry: [-0.16, 0.12],
      tanks: [0.16, 0.1],
      air: [0.02, -0.14],
      naval: [0.18, -0.16],
    };
    for (const entry of branches) {
      const [xOffset, zOffset] = multiple ? (offsets[entry.branch] || [0, 0]) : [0, 0];
      const strengthScale = 0.9 + Math.min(0.32, entry.strength * 0.018);
      const options = {
        ...position,
        x: position.x + xOffset,
        z: position.z + zOffset,
        scale: (position.scale || 1) * strengthScale,
        phase: Math.random() * 6,
      };
      if (entry.branch === "tanks") {
        this._addTankUnit(group, { ...options, color: 0x53664f });
      } else if (entry.branch === "air") {
        this._addPlaneUnit(group, { ...options, color: 0xb8c6d8 });
      } else if (entry.branch === "naval") {
        this._addShipUnit(group, { ...options, color: 0x3f6f82 });
      } else {
        this._addInfantryUnit(group, { ...options, color: ownerColor });
      }
    }
  }

  _addTankUnit(group, { x = 0, y = 0, z = 0, scale = 1, color = 0x53664f, phase = 0 } = {}) {
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
    this.animated.push({ object: unit, kind: "patrol", baseX: x, baseZ: z, phase });
  }

  _addPlaneUnit(group, { x = 0, y = 0, z = 0, scale = 1, color = 0xb8c6d8, phase = 0 } = {}) {
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
    this.animated.push({ object: unit, kind: "fly", baseX: x, baseY: y, baseZ: z, phase });
  }

  _addShipUnit(group, { x = 0, y = 0, z = 0, scale = 1, color = 0x3f6f82, phase = 0 } = {}) {
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
    this.animated.push({ object: unit, kind: "sail", baseY: y, phase });
  }

  _addInfantryUnit(group, { x = 0, y = 0, z = 0, scale = 1, color = 0xe2dcc8, phase = 0 } = {}) {
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
      this.animated.push({
        object: soldier,
        kind: "march",
        baseY: soldier.position.y,
        baseX: soldier.position.x,
        baseZ: soldier.position.z,
        phase: phase + index * 0.75,
      });
    });
    group.add(squad);
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
    this._updateNationLabels();
  }

  _updateCamera() {
    const THREE = window.THREE;
    const sinP = Math.sin(this.camPolar);
    const x = this.target.x + this.camRadius * sinP * Math.cos(this.camAzimuth);
    const z = this.target.z + this.camRadius * sinP * Math.sin(this.camAzimuth);
    const y = this.target.y + this.camRadius * Math.cos(this.camPolar);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
    this._updateNationLabels();
  }

  _clearGroups() {
    const groups = [this.tileGroup, this.territoryBorderGroup, this.highlightGroup, this.decorationGroup, this.effectGroup];
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
    this.territoryBorderSignature = "";
    this.nationLabelSignature = "";
    this.nationLabels.forEach((label) => label.remove());
    this.nationLabels.clear();
    this.animated = [];
    this.effects = [];
  }

  _animate(now) {
    requestAnimationFrame(this._animate);
    const time = now * 0.001;
    for (const item of this.animated) {
      if (!item.object.parent) continue;
      if (item.kind === "spin") item.object.rotation.z += 0.03 * (item.speed || 1);
      if (item.kind === "pulse") item.object.material.opacity = item.baseOpacity * (0.6 + 0.4 * Math.sin(time * 2.2 + item.phase));
      if (item.kind === "bob") item.object.position.y = item.baseY + Math.sin(time * 3 + item.phase) * 0.035;
      if (item.kind === "slide") item.object.position.x = item.baseX + Math.sin(time * 2 + item.phase) * 0.12;
      if (item.kind === "march") {
        item.object.position.x = item.baseX + Math.sin(time * 4 + item.phase) * 0.035;
        item.object.position.z = item.baseZ + Math.cos(time * 4 + item.phase) * 0.035;
      }
      if (item.kind === "patrol") {
        item.object.position.x = item.baseX + Math.sin(time * 1.7 + item.phase) * 0.08;
        item.object.position.z = item.baseZ + Math.cos(time * 1.7 + item.phase) * 0.035;
        item.object.rotation.y = Math.sin(time * 1.7 + item.phase) * 0.16;
      }
      if (item.kind === "fly") {
        item.object.position.x = item.baseX + Math.sin(time * 2.2 + item.phase) * 0.1;
        item.object.position.y = item.baseY + Math.sin(time * 3.2 + item.phase) * 0.06;
        item.object.position.z = item.baseZ + Math.cos(time * 2.2 + item.phase) * 0.1;
        item.object.rotation.y = Math.sin(time * 2.2 + item.phase) * 0.35;
      }
      if (item.kind === "sail") {
        item.object.position.y = item.baseY + Math.sin(time * 2 + item.phase) * 0.035;
        item.object.rotation.z = Math.sin(time * 2.4 + item.phase) * 0.08;
      }
      if (item.kind === "orbit") {
        const angle = time * 0.8 + item.phase;
        const radius = Math.hypot(item.baseX, item.baseZ) || 0.35;
        item.object.position.x = Math.cos(angle) * radius;
        item.object.position.z = Math.sin(angle) * radius;
      }
    }
    this._updateEffects(now);
    this._updateNationLabels();
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
      } else if (effect.type === "unitMove" || effect.type === "projectile") {
        const t = clamp((now - effect.start) / effect.duration, 0, 1);
        const segmentCount = Math.max(1, effect.path.length - 1);
        const exact = t * segmentCount;
        const index = Math.min(segmentCount - 1, Math.floor(exact));
        const local = exact - index;
        const from = effect.path[index];
        const to = effect.path[Math.min(effect.path.length - 1, index + 1)];
        effect.mesh.position.lerpVectors(from, to, local);
        const arcHeight = effect.unitType === "air" ? 1.35 : effect.type === "projectile" ? 0.72 : effect.unitType === "infantry" ? 0.14 : 0.22;
        effect.mesh.position.y += Math.sin(t * Math.PI) * arcHeight;
        if (effect.unitType === "infantry") {
          effect.mesh.position.x += Math.sin(t * Math.PI * 8) * 0.035;
          effect.mesh.rotation.y += 0.08;
        }
        if (effect.unitType === "tanks") {
          effect.mesh.rotation.z = Math.sin(t * Math.PI * 8) * 0.08;
        }
        if (effect.unitType === "naval") {
          effect.mesh.rotation.z = Math.sin(t * Math.PI * 4) * 0.08;
          effect.mesh.position.y += Math.sin(t * Math.PI * 5) * 0.04;
        }
        if (effect.unitType === "air") {
          effect.mesh.rotation.z = -0.42 + Math.sin(t * Math.PI * 2) * 0.12;
        }
        if (t >= 1) {
          this._disposeEffectMesh(effect.mesh);
          this.effects.splice(i, 1);
          if (effect.explodeAtEnd || effect.type === "projectile") this._explodeTile(effect.targetTileId, effect.unitType);
          else this._flashTile(effect.targetTileId);
        }
      } else if (effect.type === "flash") {
        const t = clamp((now - effect.start) / effect.duration, 0, 1);
        effect.mesh.material.opacity = 1 - t;
        effect.mesh.scale.setScalar(1 + t * 0.8);
        if (t >= 1) {
          this._disposeEffectMesh(effect.mesh);
          this.effects.splice(i, 1);
        }
      } else if (effect.type === "explosion") {
        const t = clamp((now - effect.start) / effect.duration, 0, 1);
        effect.mesh.children.forEach((child, index) => {
          child.material.opacity = Math.max(0, 1 - t);
          child.scale.setScalar(1 + t * (1.2 + index * 0.2));
        });
        if (t >= 1) {
          this._disposeEffectMesh(effect.mesh);
          this.effects.splice(i, 1);
        }
      }
    }
  }

  _tilePathToVectors(tileIds, unitType = "infantry") {
    const THREE = window.THREE;
    const height = unitType === "air" ? 1.15 : unitType === "naval" ? 0.34 : 0.86;
    return (tileIds || [])
      .map((id) => this.map?.tiles.find((tile) => tile.id === id))
      .filter(Boolean)
      .map((tile) => {
        const pos = axialToWorld(tile.q, tile.r, HEX_SIZE);
        return new THREE.Vector3(pos.x, height, pos.z);
      });
  }

  _createUnitEffectMesh(unitType = "infantry", nationId = null) {
    const THREE = window.THREE;
    const color = colorFromHex(this.nations[nationId]?.color || OWNER_COLORS[0]);
    const group = new THREE.Group();
    if (unitType === "tanks") {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.28), new THREE.MeshBasicMaterial({ color: 0x566850 }));
      const turret = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.16), new THREE.MeshBasicMaterial({ color: 0x6d8064 }));
      turret.position.set(0.04, 0.14, 0);
      group.add(hull, turret);
      return group;
    }
    if (unitType === "naval") {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.2), new THREE.MeshBasicMaterial({ color: 0x3f6f82 }));
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 4), new THREE.MeshBasicMaterial({ color: 0x4c8294 }));
      bow.position.set(0.34, 0, 0);
      bow.rotation.z = -Math.PI / 2;
      bow.rotation.y = Math.PI / 4;
      group.add(hull, bow);
      return group;
    }
    if (unitType === "air") {
      const material = new THREE.MeshBasicMaterial({ color: 0xc9d7e8 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.56, 3), material);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.5), material);
      body.rotation.z = -Math.PI / 2;
      group.add(body, wing);
      return group;
    }
    for (const offset of [-0.12, 0, 0.12]) {
      const soldier = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color }));
      soldier.position.set(offset, 0, Math.abs(offset) === 0.12 ? -0.04 : 0.1);
      group.add(soldier);
    }
    return group;
  }

  _createProjectileMesh(unitType = "infantry", nationId = null) {
    const THREE = window.THREE;
    const color = unitType === "tanks" ? 0xffb347 : unitType === "naval" ? 0xd7e7ef : 0xffd166;
    const radius = unitType === "infantry" ? 0.1 : 0.13;
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 8),
      new THREE.MeshBasicMaterial({ color })
    );
  }

  _explodeTile(tileIdValue, unitType = "infantry") {
    if (!tileIdValue || !this.map) return;
    const THREE = window.THREE;
    const tile = this.map.tiles.find((item) => item.id === tileIdValue);
    if (!tile) return;
    const { x, z } = axialToWorld(tile.q, tile.r, HEX_SIZE);
    const group = new THREE.Group();
    group.position.set(x, tile.type === TILE_TYPES.WATER ? 0.36 : 0.88, z);
    const colors = unitType === "infantry" ? [0xffd166, 0xffffff] : [0xff7a2f, 0xffd166, 0x3b2218];
    colors.forEach((color, index) => {
      const burst = new THREE.Mesh(
        new THREE.SphereGeometry(0.22 + index * 0.08, 16, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 - index * 0.12, depthWrite: false })
      );
      group.add(burst);
    });
    this.effectGroup.add(group);
    this.effects.push({ type: "explosion", mesh: group, start: performance.now(), duration: unitType === "infantry" ? 360 : 560 });
  }

  _disposeEffectMesh(mesh) {
    if (!mesh) return;
    this.effectGroup.remove(mesh);
    mesh.traverse?.((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
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
