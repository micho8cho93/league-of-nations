// Phase 1: 3D hex map. Renders grid, handles camera + picking.
// Uses global THREE loaded from CDN.


const HEX_SIZE = 1.0;
const HEX_HEIGHT = 0.4;
const HEX_GAP = 0.04; // small gap between hexes for visual separation

const HOVER_LIFT = 0.12;
const PLAYER_TERRITORY_NEON = 0x2ff7ff;
const PLAYER_EXPANSION_NEON = 0xe8ff4d;

function isWaterVisualType(type) {
  return type === TILE_TYPES.WATER || type === TILE_TYPES.UN || type === TILE_TYPES.ISLAND;
}

class HexMap {
  constructor(canvas, { radius = 8, seed = 12345 } = {}) {
    this.canvas = canvas;
    this.radius = radius;
    this.seed = seed;

    this.tiles = []; // array of tile records { q, r, type, mesh, baseY }
    this.tileByKey = new Map();

    this.hoveredTile = null;
    this.selectedTile = null;
    this.strategicPlayerId = null;

    this.onHover = null; // (tile|null, pointerEvent) => void
    this.onSelect = null; // (tile|null) => void

    this._initRenderer();
    this._initScene();
    this._initCameraControls();
    this._buildTiles();
    this._bindEvents();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    renderer.shadowMap.enabled = false;
    this.renderer = renderer;
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.background = null; // let CSS gradient show through

    // Warm directional light from above-left
    const key = new THREE.DirectionalLight(0xfff4d4, 0.9);
    key.position.set(10, 18, 8);
    scene.add(key);

    // Cool fill
    const fill = new THREE.DirectionalLight(0x6ba7ff, 0.35);
    fill.position.set(-10, 8, -6);
    scene.add(fill);

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    this.scene = scene;

    // Isometric-ish perspective camera
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
    this.camera = camera;

    // Camera state for orbit controls
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.camRadius = Math.max(18, this.radius * 2.6);
    this.camAzimuth = Math.PI / 4; // 45° around Y
    this.camPolar = Math.PI / 3.3; // ~55° from vertical
    this._updateCamera();
  }

  _updateCamera() {
    const r = this.camRadius;
    const sinP = Math.sin(this.camPolar);
    const cosP = Math.cos(this.camPolar);
    const x = this.camTarget.x + r * sinP * Math.cos(this.camAzimuth);
    const z = this.camTarget.z + r * sinP * Math.sin(this.camAzimuth);
    const y = this.camTarget.y + r * cosP;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.camTarget);
  }

  _initCameraControls() {
    const canvas = this.canvas;
    this._dragMode = null; // "orbit" | "pan" | null
    this._lastPointer = { x: 0, y: 0 };

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      this._lastPointer.x = e.clientX;
      this._lastPointer.y = e.clientY;
      if (e.button === 2) this._dragMode = "pan";
      else this._dragMode = "orbit";
      this._dragDistance = 0;
    });

    canvas.addEventListener("pointerup", (e) => {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      const wasDragging = this._dragDistance > 4;
      this._dragMode = null;
      if (!wasDragging && e.button === 0) this._handleClick(e);
    });

    canvas.addEventListener("pointerleave", () => {
      this._dragMode = null;
      this._setHover(null, null);
    });

    canvas.addEventListener("pointermove", (e) => {
      const dx = e.clientX - this._lastPointer.x;
      const dy = e.clientY - this._lastPointer.y;
      this._lastPointer.x = e.clientX;
      this._lastPointer.y = e.clientY;

      if (this._dragMode === "orbit") {
        this._dragDistance += Math.hypot(dx, dy);
        this.camAzimuth -= dx * 0.008;
        this.camPolar -= dy * 0.006;
        // clamp polar to keep horizon sensible
        const eps = 0.15;
        this.camPolar = Math.max(eps, Math.min(Math.PI / 2 - 0.05, this.camPolar));
        this._updateCamera();
      } else if (this._dragMode === "pan") {
        this._dragDistance += Math.hypot(dx, dy);
        const panScale = this.camRadius * 0.0015;
        // pan in camera's local XZ plane
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0; forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        this.camTarget.addScaledVector(right, -dx * panScale);
        this.camTarget.addScaledVector(forward, dy * panScale);
        this._updateCamera();
      } else {
        this._updateHoverFromEvent(e);
      }
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.0015);
        this.camRadius = Math.max(6, Math.min(80, this.camRadius * factor));
        this._updateCamera();
      },
      { passive: false }
    );

    window.addEventListener("resize", () => this._handleResize());
    this._handleResize();
  }

  _handleResize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = Math.max(0.01, w / h);
    this.camera.updateProjectionMatrix();
  }

  _generateTileType(q, r) {
    // Outer ring is mostly water. Interior is mixed terrain.
    const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
    const ratio = dist / this.radius;
    const n = hash2d(q, r, this.seed);

    if (ratio > 0.85 && n < 0.65) return TILE_TYPES.WATER;
    if (ratio > 0.7 && n < 0.25) return TILE_TYPES.WATER;

    // Inner biomes
    return pickWeighted(
      [
        [TILE_TYPES.EMPTY, 0.45],
        [TILE_TYPES.FARM, 0.2],
        [TILE_TYPES.MINE, 0.12],
        [TILE_TYPES.SCHOOL, 0.1],
        [TILE_TYPES.MILITARY, 0.08],
        [TILE_TYPES.WATER, 0.05],
      ],
      n
    );
  }

  // Place UN territory island clusters after main tile generation.
  // Islands are seeded pockets in the mid-ring that become claimable at Stage 3.2.
  _placeIslandClusters() {
    if (this.radius < 6) return;
    // Use seed to deterministically pick island centers in mid-ring (ratio 0.35–0.60)
    const islandCenters = [];
    const clusterCount = Math.max(2, Math.floor(this.radius / 4));
    for (let i = 0; i < clusterCount * 8 && islandCenters.length < clusterCount; i++) {
      const angle = (hash2d(i, 77, this.seed) * 2 * Math.PI);
      const r = this.radius * (0.35 + hash2d(i, 99, this.seed) * 0.25);
      const q = Math.round(r * Math.cos(angle));
      const row = Math.round(r * Math.sin(angle) / Math.sqrt(3));
      const tile = this.tileAt(q, row);
      if (!tile || tile.type === TILE_TYPES.WATER) continue;
      // Must be far enough from other island centers
      const tooClose = islandCenters.some(
        (c) => Math.hypot(c.q - q, c.r - row) < Math.floor(this.radius / 3)
      );
      if (tooClose) continue;
      islandCenters.push({ q, r: row });
    }

    // Convert center + 1-ring neighbors to hidden UN territory.
    for (const center of islandCenters) {
      const candidates = [center, ...axialNeighbors(center.q, center.r)];
      for (const coord of candidates) {
        const tile = this.tileAt(coord.q, coord.r);
        if (tile && tile.type !== TILE_TYPES.WATER) {
          this.setTileType(tile, TILE_TYPES.UN);
        }
      }
    }
  }

  // Reveal all UN territories — convert island tiles to empty claimable land.
  revealUNTerritories() {
    let count = 0;
    for (const tile of this.tiles) {
      if (tile.type === TILE_TYPES.UN || tile.type === TILE_TYPES.ISLAND) {
        this.setTileType(tile, TILE_TYPES.EMPTY);
        count++;
      }
    }
    return count;
  }

  _buildTiles() {
    const coords = hexMapCoords(this.radius);
    const radialSegments = 6;

    // Shared geometry — flat-top hex (rotate 30° so an edge faces +X/-X)
    const geom = new THREE.CylinderGeometry(
      HEX_SIZE - HEX_GAP,
      HEX_SIZE - HEX_GAP,
      HEX_HEIGHT,
      radialSegments
    );
    geom.rotateY(Math.PI / 6);
    this._hexGeom = geom;

    const group = new THREE.Group();
    this._tileGroup = group;
    this.scene.add(group);

    this._allianceGroup = new THREE.Group();
    this.scene.add(this._allianceGroup);

    this._strategicOverlayGroup = new THREE.Group();
    this.scene.add(this._strategicOverlayGroup);

    for (const { q, r } of coords) {
      const type = this._generateTileType(q, r);
      const { x, z } = axialToWorld(q, r, HEX_SIZE);
      const isWater = isWaterVisualType(type);
      const height = isWater ? HEX_HEIGHT * 0.35 : HEX_HEIGHT;
      const baseY = isWater ? -HEX_HEIGHT * 0.25 : 0;

      const material = new THREE.MeshStandardMaterial({
        color: TILE_COLORS[type],
        roughness: isWater ? 0.4 : 0.85,
        metalness: isWater ? 0.2 : 0.05,
        emissive: new THREE.Color(TILE_COLORS[type]).multiplyScalar(isWater ? 0.15 : 0.05),
      });

      const mesh = new THREE.Mesh(geom, material);
      mesh.scale.y = height / HEX_HEIGHT;
      mesh.position.set(x, baseY + (height / 2), z);

      const tile = {
        q,
        r,
        type,
        mesh,
        baseY: mesh.position.y,
        owner: null,
        ownerColor: null,
        outline: null,
        workers: 0,
        workerType: null,
      };
      mesh.userData.tile = tile;
      group.add(mesh);
      this.tiles.push(tile);
      this.tileByKey.set(`${q},${r}`, tile);
    }

    this._placeIslandClusters();

    // Subtle ground plane under map for depth
    const planeGeom = new THREE.CircleGeometry(this.radius * HEX_SIZE * 2.4, 64);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x0a1420,
      transparent: true,
      opacity: 0.75,
    });
    const plane = new THREE.Mesh(planeGeom, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.6;
    this.scene.add(plane);
  }

  _bindEvents() {
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
  }

  _pickTileFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    this._ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this._tileGroup.children, false);
    if (!hits.length) return null;
    return hits[0].object.userData.tile || null;
  }

  _updateHoverFromEvent(e) {
    const tile = this._pickTileFromEvent(e);
    this._setHover(tile, e);
  }

  _setHover(tile, pointerEvent) {
    if (tile === this.hoveredTile) {
      if (this.onHover) this.onHover(tile, pointerEvent);
      return;
    }
    if (this.hoveredTile) this._liftTile(this.hoveredTile, 0);
    this.hoveredTile = tile;
    if (tile) this._liftTile(tile, HOVER_LIFT);
    if (this.onHover) this.onHover(tile, pointerEvent);
  }

  _liftTile(tile, lift) {
    tile.mesh.position.y = tile.baseY + lift;
    this._repositionOutline(tile);
  }

  _handleClick(e) {
    const tile = this._pickTileFromEvent(e);
    this.selectTile(tile);
  }

  selectTile(tile) {
    if (this.selectedTile && this.selectedTile !== tile) {
      this._applyTileEmissive(this.selectedTile);
    }
    this.selectedTile = tile;
    if (tile) {
      tile.mesh.material.emissive = new THREE.Color(0xc9a84c).multiplyScalar(0.35);
    }
    if (this.onSelect) this.onSelect(tile);
  }

  tileAt(q, r) {
    return this.tileByKey.get(`${q},${r}`) || null;
  }

  focusOn(q, r) {
    const { x, z } = axialToWorld(q, r, HEX_SIZE);
    this.camTarget.set(x, 0, z);
    this._updateCamera();
  }

  setTileType(tile, type) {
    tile.type = type;
    const color = TILE_COLORS[type];
    tile.mesh.material.color = new THREE.Color(color);
    this._applyTileShape(tile);
    this._applyTileEmissive(tile);
    tile.mesh.material.needsUpdate = true;
  }

  _applyTileShape(tile) {
    const isWater = isWaterVisualType(tile.type);
    const height = isWater ? HEX_HEIGHT * 0.35 : HEX_HEIGHT;
    const baseY = isWater ? -HEX_HEIGHT * 0.25 : 0;
    tile.mesh.scale.y = height / HEX_HEIGHT;
    tile.baseY = baseY + (height / 2);
    tile.mesh.position.y = tile.baseY + (tile === this.hoveredTile ? HOVER_LIFT : 0);
    this._repositionOutline(tile);
  }

  setTileOwner(tile, nation) {
    tile.owner = nation ? nation.id : null;
    tile.ownerColor = nation ? nation.color : null;
    this._applyTileEmissive(tile);
    this._updateTileOutline(tile);
  }

  updateStrategicHighlights(playerId, claimableTiles = []) {
    this.strategicPlayerId = playerId || null;
    this._clearStrategicHighlights();
    if (!this._strategicOverlayGroup || !this.strategicPlayerId) return;

    const claimableKeys = new Set(
      claimableTiles.map((tile) => `${tile.q},${tile.r}`)
    );

    for (const tile of this.tiles) {
      if (tile.owner === this.strategicPlayerId) {
        this._addNeonHexRing(tile, {
          color: PLAYER_TERRITORY_NEON,
          opacity: 0.92,
          radius: HEX_SIZE - HEX_GAP + 0.02,
          tubeRadius: 0.018,
          yOffset: 0.065,
          phase: 0,
        });
        this._addNeonHexRing(tile, {
          color: PLAYER_TERRITORY_NEON,
          opacity: 0.26,
          radius: HEX_SIZE - HEX_GAP + 0.11,
          tubeRadius: 0.04,
          yOffset: 0.075,
          phase: Math.PI * 0.5,
        });
      } else if (claimableKeys.has(`${tile.q},${tile.r}`)) {
        this._addNeonHexRing(tile, {
          color: PLAYER_EXPANSION_NEON,
          opacity: 0.56,
          radius: HEX_SIZE - HEX_GAP - 0.035,
          tubeRadius: 0.014,
          yOffset: 0.06,
          phase: Math.PI,
        });
      }
    }
  }

  _clearStrategicHighlights() {
    if (!this._strategicOverlayGroup) return;
    while (this._strategicOverlayGroup.children.length) {
      const child = this._strategicOverlayGroup.children.pop();
      child.geometry.dispose();
      child.material.dispose();
    }
  }

  _addNeonHexRing(tile, { color, opacity, radius, tubeRadius, yOffset, phase }) {
    const geom = this._hexTubeGeometry(radius, tubeRadius);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Mesh(geom, mat);
    line.renderOrder = 30;
    line.userData.strategicHighlight = {
      tile,
      baseOpacity: opacity,
      yOffset,
      phase,
    };
    this._positionStrategicRing(line);
    this._strategicOverlayGroup.add(line);
  }

  _hexTubeGeometry(radius, tubeRadius) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (Math.PI / 3) * i;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const path = new THREE.CurvePath();
    for (let i = 0; i < 6; i++) {
      path.add(new THREE.LineCurve3(pts[i], pts[(i + 1) % 6]));
    }
    return new THREE.TubeGeometry(path, 72, tubeRadius, 6, false);
  }

  _positionStrategicRing(line) {
    const data = line.userData.strategicHighlight;
    if (!data || !data.tile) return;
    const tile = data.tile;
    const topY =
      tile.mesh.position.y + (tile.mesh.scale.y * HEX_HEIGHT) / 2 + data.yOffset;
    line.position.set(tile.mesh.position.x, topY, tile.mesh.position.z);
  }

  updateAllianceLines(alliances, nations) {
    if (!this._allianceGroup) return;
    while (this._allianceGroup.children.length) {
      const child = this._allianceGroup.children.pop();
      child.geometry.dispose();
      child.material.dispose();
    }

    for (const alliance of alliances || []) {
      if (!alliance.active || !alliance.members || alliance.members.length < 2) continue;
      const a = nations[alliance.members[0]];
      const b = nations[alliance.members[1]];
      const aCenter = this._nationCenter(a);
      const bCenter = this._nationCenter(b);
      if (!aCenter || !bCenter) continue;

      const points = [
        new THREE.Vector3(aCenter.x, 1.15, aCenter.z),
        new THREE.Vector3(bCenter.x, 1.15, bCenter.z),
      ];
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: alliance.type === "military" ? 0xd9534f : alliance.type === "political" ? 0x6c8ff0 : 0x4cc9a8,
        transparent: true,
        opacity: 0.85,
      });
      this._allianceGroup.add(new THREE.Line(geom, mat));
    }
  }

  _nationCenter(nation) {
    if (!nation) return null;
    const tiles = this.tiles.filter((tile) => tile.owner === nation.id);
    if (!tiles.length) return null;
    const sum = tiles.reduce(
      (acc, tile) => {
        acc.x += tile.mesh.position.x;
        acc.z += tile.mesh.position.z;
        return acc;
      },
      { x: 0, z: 0 }
    );
    return { x: sum.x / tiles.length, z: sum.z / tiles.length };
  }

  _applyTileEmissive(tile) {
    const base = new THREE.Color(TILE_COLORS[tile.type]).multiplyScalar(0.06);
    if (tile.ownerColor) {
      base.add(new THREE.Color(tile.ownerColor).multiplyScalar(0.35));
    }
    tile.mesh.material.emissive = base;
    tile.mesh.material.needsUpdate = true;
  }

  _updateTileOutline(tile) {
    if (tile.outline) {
      this._tileGroup.remove(tile.outline);
      tile.outline.geometry.dispose();
      tile.outline.material.dispose();
      tile.outline = null;
    }
    if (!tile.owner) return;

    const r = HEX_SIZE - HEX_GAP - 0.015;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (Math.PI / 3) * i;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    pts.push(pts[0].clone());

    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(tile.ownerColor),
    });
    const line = new THREE.Line(geom, mat);
    tile.outline = line;
    this._repositionOutline(tile);
    this._tileGroup.add(line);
  }

  _repositionOutline(tile) {
    if (!tile.outline) return;
    const topY =
      tile.mesh.position.y + (tile.mesh.scale.y * HEX_HEIGHT) / 2 + 0.02;
    tile.outline.position.set(tile.mesh.position.x, topY, tile.mesh.position.z);
  }

  getTileStats() {
    const counts = {};
    for (const t of this.tiles) counts[t.type] = (counts[t.type] || 0) + 1;
    return { total: this.tiles.length, counts };
  }

  _animate() {
    requestAnimationFrame(this._animate);
    if (this.selectedTile) {
      const t = performance.now() * 0.004;
      const pulse = 0.35 + Math.sin(t) * 0.15;
      this.selectedTile.mesh.material.emissive =
        new THREE.Color(0xc9a84c).multiplyScalar(pulse);
    }
    if (this._strategicOverlayGroup) {
      const t = performance.now() * 0.004;
      for (const line of this._strategicOverlayGroup.children) {
        const data = line.userData.strategicHighlight;
        if (!data) continue;
        this._positionStrategicRing(line);
        line.material.opacity =
          data.baseOpacity * (0.78 + Math.sin(t + data.phase) * 0.22);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
