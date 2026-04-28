# Scenario Mode Documentation

## Overview

Scenario Mode provides pre-designed, handcrafted maps with specific objectives and starting conditions. Unlike randomly-generated maps in Lite and Advanced modes, scenarios present tailored challenges with geographic and historical inspiration.

Scenarios use Advanced mode rules with the terrain resource system, gated construction, and factories.

## Implementing a Scenario

### Scenario Structure

Each scenario is defined in `js/scenarios.js` with:

1. **Metadata** - ID, name, description, mode
2. **Map Data** - Handcrafted tile layout with terrain/biomes
3. **Starting Positions** - Nation placements and initial resources
4. **Objectives** - Win conditions and progress tracking

### Map Design

Scenario maps are **handcrafted** using axial hexagon coordinates (q, r):

```javascript
// Define tiles by coordinate
const tiles = [];
const addTile = (q, r, terrain, biome, type) => {
  tiles.push({
    id: tileId(q, r),
    q, r,
    terrain,        // "land" or "water"
    landform,       // "continent", "island", "sea"
    biome,          // "grassland", "jungle", "arctic", "desert", "water"
    type,           // TILE_TYPES.EMPTY, FACTORY, etc.
    ownerId: null,
    workers: 0,
    unit: null,
    regionId: null,
    isCapital: false,
    effects: { disabledTurns: 0, floodedTurns: 0, bountifulTurns: 0 }
  });
};

// Build the map structure
const map = {
  size: "Small",
  radius: 10,
  seed: 12345,     // Fixed for consistency
  landRatio: ...,
  tiles: tiles,
};
```

### Terrain to Resource Mapping

In Advanced mode (used by scenarios):

| Terrain  | Resource | Purpose              |
|----------|----------|----------------------|
| Grassland | Fruit    | Population growth    |
| Jungle   | Hardwood | Building construction|
| Arctic   | Iron     | Factory construction |
| Desert   | Oil      | Advanced unit costs  |

### Starting Positions

Each nation gets:
- **Spawn tiles** - Initial territory (2-4 tiles recommended)
- **Starting resources** - Balanced to force expansion/trade
- **Optional name override** - Custom nation names for scenario flavor

Example:
```javascript
{
  nationIndex: 0,
  name: "Republic of Australia",
  startTiles: [[2, 2], [3, 2]],
  startingResources: { fruit: 3, hardwood: 1, iron: 0, oil: 0 }
}
```

### Objectives

Objectives define win/challenge conditions:

```javascript
{
  id: "unique-id",
  title: "Objective Title",
  description: "What to achieve",
  type: "terrain" | "buildings" | "factories" | "resources",
  
  // For terrain objectives:
  terrain: "grassland",
  target: 3,
  
  // For building/factory objectives:
  target: 5,
  
  // For resource objectives:
  resources: ["fruit", "hardwood", "iron", "oil"],
  
  progress: 0,
  completed: false
}
```

## Oceania Resource Frontiers Scenario

### Overview

A geographically inspired scenario set in Oceania where players compete for terrain resources across Australia, New Zealand, Papua New Guinea, and the Pacific islands.

### Map Layout

**Size:** Small (11x11 hexagon region)

**Landmasses:**
- **Australia** - Eastern grassland (fruit), central desert (oil), western grassland
- **Tasmania** - South of Australia, grassland
- **Papua New Guinea** - North, primarily jungle (hardwood)
- **New Zealand** - South, arctic terrain (iron)
- **Fiji & Pacific Islands** - East, grassland and jungle

**Water:** Surrounds and separates landmasses

### Starting Positions (4 Nations)

| Nation          | Start Location           | Starting Resources     |
|-----------------|--------------------------|------------------------|
| Republic of Australia (Player) | Eastern Australia | 3 fruit, 1 hardwood, 0 iron, 0 oil |
| Western Federation (Bot 1)     | Western Australia | 2 fruit, 0 hardwood, 0 iron, 2 oil |
| New Zealand Union (Bot 2)      | New Zealand       | 1 fruit, 1 hardwood, 2 iron, 0 oil |
| Papua Collective (Bot 3)       | Papua New Guinea  | 1 fruit, 3 hardwood, 0 iron, 0 oil |

### Objectives

1. **Secure Growth** (Terrain Challenge)
   - Control 3 grassland tiles
   - Focuses on food security

2. **Build Infrastructure** (Development Challenge)
   - Construct 5 buildings
   - Encourages economic development

3. **Industrialize** (Technology Challenge)
   - Build 2 factories
   - Requires iron and hardwood resources

4. **Strategic Resource Control** (Mastery Challenge)
   - Control at least 1 tile of each resource type
   - Requires diplomacy, trade, or conquest

### Regional Design Goals

- **Map diversity** - Handcrafted geography encourages varied strategies
- **Resource scarcity** - No player starts with all four resources
- **Forced interaction** - Players must expand, trade, or fight to survive
- **Recognizable shapes** - Simplified landmasses are geographically inspired
- **Single-player focus** - Built for solo play against 3 bots (safest implementation)

### Known Simplifications

- Water/ocean tiles are visual separators; no water/naval terrain
- Island clusters are simplified; Fiji represents multiple island chains
- Terrain distribution is approximate; geographic accuracy varies
- Starting cities are not marked; nations begin with just territory

## Adding New Scenarios

To create a new scenario:

1. Define scenario metadata in `SCENARIO_METADATA`
2. Create a map generator function (handcrafted or procedural)
3. Define `getScenarioMap(scenarioId)` export
4. Define starting positions
5. Create objectives array
6. Export `getScenarioStartingPositions()` and `getScenarioObjectives()`
7. Update UI scenario selection grid (handled automatically in `main.js`)
8. Test in browser: click Scenario → select scenario → start

## UI Integration

### Mode Selection Screen
- Button: "Scenario" → shows scenario grid
- Each scenario is a clickable card with name and description

### Scenario Selection Screen
- Grid of available scenarios
- Click to select → routes to setup screen
- Map size/water/diversity options hidden for scenarios

### In-Game Display
- Objectives panel shows all current objectives
- Progress updates in real-time as tiles are captured/built
- Checkbox appears when objective is completed
- Panel can be toggled open/closed

## Technical Notes

- Scenarios use `GameState.newGame()` with `scenarioId` in settings
- Custom maps override random generation
- Starting positions override `assignStartingTerritories()`
- Objectives are stored in `game.objectives[]`
- Mode is forced to Advanced (or Scenario) for all scenarios
- Nation count is fixed per scenario (not configurable)
- Multiplayer is disabled for scenarios (single-player only)
