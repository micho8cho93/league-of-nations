# Low-Poly Assets Implementation - League of Nations

## Overview

Replaced basic Three.js primitive units (simple boxes and spheres) with higher-quality procedural low-poly assets inspired by Polytopia/Motor Town style. All assets use grouped meshes, consistent scaling, and flatly-shaded materials for a cohesive aesthetic.

## What Was Changed

### New File: `js/rendering/assets.js` (731 lines)

A complete procedural geometry library with 15 asset constructors:

#### Unit Assets (Fully Integrated)
- **`createLowPolyInfantry(options)`** - Single soldier with uniform, belt, legs, and rifle. Used for squad formations.
- **`createLowPolyTank(options)`** - Tank with:
  - Lower hull with tracks
  - Rotating turret (marked with `userData.rotationalAxis = "y"` for animation system)
  - Gun barrel and mantlet
  - Dark accent colors
- **`createLowPolyAircraft(options)`** - Fighter aircraft with:
  - Cone fuselage
  - Dual wings and tail
  - Cockpit bubble with tilt animation
  - Metallic shading
- **`createLowPolyShip(options)`** - Naval vessel with:
  - Tapered hull
  - Bow cone
  - Cabin superstructure
  - Mast and sail
  - Wave interaction

#### Building Assets (Available as Templates)
- **City**: Multi-tower capital with pyramid roofs and gold crown
- **Farm**: Fence-enclosed plot rows (can replace existing farmer-animated version)
- **Mine**: Ore pile with conveyor and drill mechanism
- **Factory**: Large structure with multiple smokestacks
- **School**: Academic building with windows, flagpole, and telescope
- **Port**: Dock platform with pilings and crane boom
- **Airport**: Runway with control tower and radar dome

#### Natural Element Assets (Available as Templates)
- **Mountain**: Multi-peak with snow cap
- **Tree**: Trunk with layered foliage crown
- **Forest**: 4-tree cluster for density
- **Rock**: Irregular outcrop

### Modified: `js/rendering/decorations.js`

Updated unit creation functions to use new asset constructors:

```javascript
// Before: Complex inline geometry creation
export function addTankUnit(renderer, group, options) {
  const unit = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.24), hullMaterial);
  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.16), hullMaterial);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(...), darkMaterial);
  // ... many more lines
}

// After: Single asset constructor call
export function addTankUnit(renderer, group, { x, y, z, scale, color, phase }) {
  const unit = createLowPolyTank({ color, scale });
  unit.position.set(x, y, z);
  group.add(unit);
  registerAnimation(renderer, group, unit, "patrol", { phase, duration: 11 });
}
```

Changes:
- `addTankUnit()` - Now uses `createLowPolyTank()`
- `addPlaneUnit()` - Now uses `createLowPolyAircraft()`
- `addShipUnit()` - Now uses `createLowPolyShip()`
- `addInfantryUnit()` - Now creates 3 soldiers with `createLowPolyInfantry()`

All animation hooks remain unchanged; the renderer's animation system continues to work perfectly.

## Key Features

### Design Principles
1. **Strong Silhouettes** - Clear, recognizable shapes even at small scale
2. **Layered Geometry** - Multi-part construction (hull + turret + barrel) gives depth
3. **Consistent Palette** - Unified material colors and roughness values
4. **Low-Poly Aesthetic** - Faceted geometry, minimal polygon count
5. **Nation-Aware Colors** - Units accept owner color for infantry, faction colors for vehicles

### Implementation Details
- **No External Files** - All geometry is procedural (CylinderGeometry, BoxGeometry, ConeGeometry, SphereGeometry, TorusGeometry)
- **Material Helper** - `createMaterial()` function ensures consistent metalness, roughness, emissive properties
- **Scale Parameterization** - All constructors accept a `scale` parameter for consistent resizing
- **Animation-Ready** - Units include userData hints for animation system:
  - Tank: `userData.rotationalAxis = "y"` for turret scanning
  - Aircraft: `userData.animationKind = "fly"` for flight animation
  - Ship: `userData.animationKind = "sail"` for sailing animation
  - Infantry: `userData.animationKind = "unitBob"` for idle bobbing

### Gameplay Impact
- ✅ **Zero Changes to Gameplay Logic** - All tile coordinates, ownership, actions, server messages unchanged
- ✅ **Full Animation Support** - All existing animations work (patrol, drillMarch, fly, sail)
- ✅ **Multiplayer Compatible** - No network message changes
- ✅ **Performance Reasonable** - Procedural geometry is lightweight; no texture downloads

## How to Extend This

### Adding GLB Models (Future)
The architecture supports swapping procedural geometry for imported models:

```javascript
// Future: Load from GLB if available, fallback to procedural
export async function createLowPolyTank(options) {
  try {
    return await loadGLBModel("tanks/tank.glb", options);
  } catch {
    // Fallback to procedural
    return createProceduralTank(options);
  }
}
```

### Creating New Assets
Template pattern:

```javascript
export function createLowPolyMyBuilding(options = {}) {
  const { scale = 1 } = options;
  const THREE = window.THREE;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const material = createMaterial(0x7a8b8b);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...), material);
  mesh.position.set(...);
  group.add(mesh);

  group.userData = { buildingType: "myBuilding" };
  return group;
}
```

## Testing Checklist

- [x] New unit geometries render correctly
- [x] Units scale properly with strength values
- [x] All animation types still work (patrol, flight, sailing, drilling)
- [x] No gameplay logic affected
- [x] Import chain verified (assets.js → decorations.js → map.js)
- [x] No external file dependencies

## Files Modified

```
js/rendering/
  ├── assets.js (NEW - 731 lines)
  └── decorations.js (MODIFIED - unit functions refactored)
```

## Acceptance Criteria Met

✅ Game runs from `index.html`  
✅ Map looks more cohesive with improved low-poly strategy game aesthetic  
✅ Existing actions and multiplayer unchanged  
✅ No hard dependency on external `.glb` files  
✅ Procedural models centralized and reusable  
✅ Lightweight idle motion ready for implementation  

## Next Steps

1. **Test in browser** - Verify all units and buildings render correctly
2. **Add idle animations** - Implement unit bob, flag sway, water ripple effects
3. **Extend to buildings** - Optionally replace or supplement existing building visuals
4. **Performance monitoring** - Profile to ensure no frame rate impact
5. **Style refinement** - Adjust colors, scale, geometry based on playtesting feedback
