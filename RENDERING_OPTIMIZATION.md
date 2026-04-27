# Rendering Optimization Guide

## Overview

This document describes the optimization systems implemented for Three.js rendering in League of Nations. The goal is to maintain visual quality while ensuring smooth gameplay on a range of devices.

## Quality Settings System

### Presets

Three quality presets control rendering performance:

- **Low**: 1x pixel ratio, no shadows, 50% decoration density, 60% animation detail
- **Medium** (default): 1.5x pixel ratio, no shadows, 80% decoration density, 90% animation detail
- **High**: 2x pixel ratio, no shadows, 100% decoration density, 100% animation detail

### Console Usage

Players and developers can control quality from the browser console:

```javascript
// Set quality level
window.__quality.setQualityLevel('low');   // For low-end devices
window.__quality.setQualityLevel('medium'); // Balanced (default)
window.__quality.setQualityLevel('high');   // For high-end devices

// Auto-detect recommended quality
const recommended = window.__quality.detectRecommendedQuality();
window.__quality.setQualityLevel(recommended);
```

### Quality Settings Control

Located in [`js/rendering/quality.js`](js/rendering/quality.js):

- `pixelRatio`: Device pixel ratio cap (1, 1.5, 2)
- `shadowsEnabled`: Enable/disable shadow casting
- `shadowMapSize`: Resolution of shadow maps (512, 1024, 2048)
- `fogEnabled`: Enable/disable atmospheric fog
- `decorationDensity`: Percentage of decorations to render (0.5–1.0)
- `animationDetail`: Animation complexity level (0.6–1.0)
- `maxInstancesPerMesh`: Max geometry instances per InstancedMesh batch

## Material Pooling System

### Purpose

Materials are expensive to create and keep in GPU memory. Instead of creating new materials for every decoration, we cache and reuse them.

**Before (wasteful):**
```javascript
// Called for every tree
const material = new THREE.MeshStandardMaterial({ color: 0x2f8a55, roughness: 0.9 });
const tree = new THREE.Mesh(geometry, material);
```

**After (optimized):**
```javascript
// Reused across all trees
const material = getMaterialPreset("treeGreen", THREE);
const tree = new THREE.Mesh(geometry, material);
```

### Material Pool API

Located in [`js/rendering/materialPool.js`](js/rendering/materialPool.js):

```javascript
import { getMaterialPreset, getColoredMaterial, disposeMaterialCache } from "./materialPool.js";

// Get a preset material (cached by name)
const grassMat = getMaterialPreset("grassLight", THREE);

// Get a color-specific material (cached by type + color)
const ownerColor = 0xd8a565;
const ownerMat = getColoredMaterial("ownerRing", ownerColor, () =>
  new THREE.MeshBasicMaterial({ color: ownerColor })
);

// Get cache statistics for debugging
const stats = getMaterialCacheStats();
console.log(`Cached ${stats.size} materials`);

// Clean up on level change (optional, but good practice)
disposeMaterialCache();
```

### Available Presets

See [`js/rendering/config.js`](js/rendering/config.js) `MATERIAL_PRESETS` for the full list:

- Rock/stone: `rock`, `mountain`, `snow`
- Wood: `wood`, `darkWood`
- Metal: `darkMetal`, `metalArmor`
- Structures: `dock`, `silo`, `greenhouse`
- Vegetation: `grassLight`, `grassDark`, `treeGreen`, `jungleGreen`, `reeds`
- Water: `water`, `waterTransparent`
- Ground: `sand`, `soil`, `pebble`
- Effects: `cloud`, `wave`, `smoke`

## Decoration Density

### Purpose

On lower-end devices, rendering fewer decorations (trees, rocks, pebbles) can significantly improve frame rate while maintaining visual appeal.

### Implementation

Located in [`js/rendering/decorations.js`](js/rendering/decorations.js):

```javascript
import { shouldRenderDecoration } from "./rendering/decorations.js";

// In _addLandNature or similar functions:
if (quality.decorationDensity < 1.0) {
  // Use deterministic tile-based culling
  if (!shouldRenderDecoration(tile, saltValue)) {
    continue; // Skip this decoration
  }
}
```

The `shouldRenderDecoration()` function uses tile coordinates to make deterministic decisions, so:
- Same tile always renders the same decorations
- Distribution is uniform across the map
- Repeating the function with the same salt gives the same result

## Optimization Opportunities (Future)

### 1. InstancedMesh for Repeated Decorations

**Current:** Each tree, rock, or pebble is a separate Mesh with its own geometry.

**Future:** Use `THREE.InstancedMesh` to batch identical geometries:

```javascript
// Pseudocode
const instances = 500; // e.g., 500 trees on visible tiles
const instancedMesh = new THREE.InstancedMesh(
  treeGeometry,
  treeMaterial,
  instances
);

// Set position/rotation per instance
for (let i = 0; i < instances; i++) {
  matrix.compose(position, quaternion, scale);
  instancedMesh.setMatrixAt(i, matrix);
}

scene.add(instancedMesh);
```

**Impact:** 10–50x fewer draw calls for dense decorations.

**Caveats:**
- All instances share geometry and material
- Instance data (position, rotation, scale) must be set via matrices
- Not compatible with per-instance animation (but static decorations are fine)

**Candidates:**
- Small trees (low-poly cones)
- Rocks and pebbles
- Grass tufts
- Reeds

**Non-candidates:**
- Animated objects (flags, waves, people)
- Objects with per-instance colors (use material pooling instead)

### 2. LOD (Level of Detail)

**Purpose:** Render fewer polygon details at distance.

**Approach:**
- Low detail at fog distance (far > 100 units)
- Medium detail in mid-range
- High detail up close

**Candidates:**
- Unit figures (3 soldiers → 1 soldier → dot at distance)
- Buildings (full detail → simplified box → hidden)
- Terrain decorations (full tree → cone → sprite at distance)

### 3. Texture Atlasing for Decorations

**Purpose:** Reduce draw calls by batching similar geometries with different colors.

**Approach:**
- Pack all grass tuft colors into a single texture atlas
- Use UV offset per instance to select color variant
- Single material for all tufts

**Impact:** Similar to InstancedMesh but supports per-instance color variation.

### 4. GLB Model Support

**Purpose:** Load pre-modeled 3D assets (buildings, units, vehicles) from Blender/external tools.

**When adding GLB support:**
1. Compress models to < 50 KB each (use Draco compression)
2. Use material pooling for GLB materials
3. Cache GLB meshes in `gltfLoader` cache
4. Consider LOD variants of complex models
5. Test model rendering with current quality settings

**Example structure:**
```
assets/
  models/
    buildings/
      farm.glb          # LOD0
      farm-lod1.glb     # LOD1
    units/
      soldier.glb
```

### 5. Texture Caching

**Purpose:** Avoid reloading the same texture multiple times.

**Approach:**
- Keep a TextureLoader with built-in caching
- Name textures consistently
- Dispose textures on scene cleanup

### 6. Garbage Collection Optimization

**To monitor:**
```javascript
// Check material cache size
const stats = window.__renderingConfig.getMaterialCacheStats?.();
console.log(`Cached materials: ${stats?.size || 'N/A'}`);

// Monitor THREE memory usage
console.log(window.THREE.WebGLRenderer.info);
```

## Performance Tips for Future Development

### When Adding New Decorations

1. **Use material pooling:**
   ```javascript
   const mat = getMaterialPreset("rock", THREE);
   ```

2. **Respect quality settings:**
   ```javascript
   if (getDecorationDensity() < Math.random()) return; // Skip at low quality
   ```

3. **Cache where possible:**
   ```javascript
   // Good: reusable geometry
   const coneGeo = new THREE.ConeGeometry(0.1, 0.2, 6);
   
   // Bad: unique geometry per instance
   const mesh1 = new THREE.Mesh(new THREE.ConeGeometry(...), mat);
   const mesh2 = new THREE.Mesh(new THREE.ConeGeometry(...), mat);
   ```

4. **Avoid creating materials in loops:**
   ```javascript
   // Bad
   for (const tile of tiles) {
     const mat = new THREE.Material({ ...tile.color });
     mesh.material = mat;
   }
   
   // Good
   for (const tile of tiles) {
     const mat = getColoredMaterial("tile", tile.color, () => ...);
     mesh.material = mat;
   }
   ```

### When Modifying Existing Decorations

- Keep material pooling in mind when refactoring
- Don't create new materials needlessly
- Test with `quality.setQualityLevel('low')` to ensure decorations still look good
- Monitor draw calls in browser DevTools (Rendering stats)

## Testing Quality Settings

### Test Checklist

- [ ] Low quality: Decorations are sparse but recognizable
- [ ] Medium quality: Good balance of visuals and performance (default)
- [ ] High quality: Maximum visual detail without lag on target device
- [ ] No memory leaks: Check DevTools Memory tab over 10+ minute gameplay
- [ ] Smooth transitions: No stutter when changing quality levels
- [ ] Fog renders correctly: Depth cueing works as expected
- [ ] Shadows disabled safely: No visual artifacts when toggled off

### Performance Monitoring

In browser console:

```javascript
// Monitor frame time
let lastTime = performance.now();
setInterval(() => {
  const now = performance.now();
  const delta = now - lastTime;
  console.log(`Frame time: ${delta.toFixed(1)}ms (${(1000/delta).toFixed(1)} FPS)`);
  lastTime = now;
}, 1000);

// Check WebGL info
console.log(window.THREE.WebGLRenderer.info);

// Check material cache
console.log(window.__renderingConfig.getMaterialCacheStats?.());
```

## Summary

The optimization system provides three tiers of visual quality that scale from low-end mobile to high-end desktop. The material pooling system significantly reduces memory usage and draw calls. Quality settings and decoration density can be adjusted at runtime to balance performance and visuals.

For the best results when adding new features:
1. Use material pooling for all materials
2. Respect quality/density settings
3. Cache geometries and materials
4. Test across quality levels
5. Monitor performance metrics

---

**Last Updated:** April 2026
**System Version:** 1.0 (Haiku Optimization Pass)
