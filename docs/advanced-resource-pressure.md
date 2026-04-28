# Advanced Mode Resource Pressure System

## Overview

The Advanced Mode Resource Pressure system adds meaningful gameplay depth through recurring resource upkeep costs and cross-resource dependencies. Resources are no longer one-time construction requirements but become ongoing operational expenses that create strategic pressure throughout the game.

## Resource Roles

### Fruit (from Grassland)
- **Purpose**: Population growth and consumption
- **Source**: Grassland tiles (1 per turn)
- **Upkeep**: Based on population (0.08 per person per turn)
- **Deficit Effects**:
  - Reduced population growth rate
  - Happiness penalty (-3 when deficit exists)

### Hardwood (from Jungle)
- **Purpose**: Building construction and maintenance
- **Source**: Jungle tiles (1 per turn)
- **Upkeep**: Per building (varies 0.05-0.15 depending on building type)
- **Cross-Dependencies**:
  - Factories require 2 hardwood + 3 iron to build
  - All building construction costs hardwood
- **Deficit Effects**:
  - Building efficiency reduced (multiplier scales with deficit)
  - Reduced production from affected buildings

### Iron (from Arctic)
- **Purpose**: Factory construction and advanced unit training
- **Source**: Arctic tiles (1 per turn)
- **Upkeep**: Per factory and per advanced unit (varies 0.03-0.2)
- **Cross-Dependencies**:
  - Factories require 2 hardwood + 3 iron to build
  - Advanced units (tanks, air, naval) require 2 iron + X oil to train
- **Deficit Effects**:
  - Factory efficiency reduced
  - Reduced unit readiness/effectiveness

### Oil (from Desert)
- **Purpose**: Advanced unit deployment
- **Source**: Desert tiles (1 per turn)
- **Upkeep**: Per advanced unit (2 for tanks/naval, 3 for air)
- **Cross-Dependencies**:
  - Tanks require 2 iron + 2 oil
  - Air units require 2 iron + 3 oil
  - Naval units require 2 iron + 2 oil
- **Deficit Effects**:
  - Advanced unit readiness reduced
  - Combat effectiveness diminished

## Upkeep System

### Calculation Process

Each turn during the Round Processing phase:

1. **Collection**: Resources are gathered from controlled terrain
2. **Upkeep Calculation**: System calculates total requirements based on:
   - Population (fruit demand)
   - Building counts and types (hardwood, iron, oil)
   - Unit counts and branches (iron, oil)
3. **Deficit Determination**: If available < required, deficit is recorded
4. **Penalty Application**: Deficits apply soft penalties to nation stats

### Upkeep Formula

```
fruitRequired = population * 0.08
hardwoodRequired = sum of per-building costs
ironRequired = sum of factory costs + sum of unit costs
oilRequired = sum of unit costs
```

### Key Characteristics

- **No Destruction**: Deficits never automatically destroy buildings or units
- **Soft Penalties**: Efficiency modifiers range from 1.0 (no deficit) to 0.3-0.4 (severe deficit)
- **Server Enforcement**: Upkeep is calculated server-side; clients cannot bypass it
- **Lite Mode Unaffected**: Lite mode games do not apply upkeep or require advanced resources

## Cross-Resource Dependencies

### Building Construction

All buildings require money + workers/population. In Advanced mode, building-specific resources also required:

| Building | Cost |
|----------|------|
| Farm/Fishery | 1 hardwood |
| Mine/Mountain Mine | 1-2 hardwood |
| School/University | 2-3 hardwood |
| Military Base | 2 hardwood |
| **Factory** | **2 hardwood + 3 iron** |

### Unit Training

Infantry requires only money + population + materials/education/industry. Advanced branches in Advanced mode also require iron + oil:

| Unit Type | Requirements |
|-----------|--------------|
| Infantry | money + population + materials |
| Tanks | money + population + **2 iron + 2 oil** |
| Air | money + population + materials + education + **2 iron + 3 oil** |
| Naval | money + population + **2 iron + 2 oil** |

## Deficit Penalties

### Penalty Calculations

Penalties are applied as multiplicative modifiers to production/effectiveness:

```javascript
// Fruit deficit: affects population growth
populationGrowthModifier = max(0.3, 1 - (deficit.fruit * 0.15))

// Hardwood deficit: affects building efficiency
buildingEfficiencyModifier = max(0.4, 1 - (deficit.hardwood * 0.1))

// Iron deficit: affects factory efficiency
factoryEfficiencyModifier = max(0.3, 1 - (deficit.iron * 0.12))

// Oil deficit: affects unit readiness
unitReadinessModifier = max(0.4, 1 - (deficit.oil * 0.15))
```

### Effect Examples

- **Severe Fruit Deficit**: Growth rate drops to 30% of normal
- **Moderate Hardwood Deficit**: Building production falls to 60% of normal
- **Slight Iron Deficit**: Factories produce at 88-95% efficiency
- **Oil Shortage**: Advanced units have reduced combat effectiveness

## UI Display

### Resource Panel

Each Advanced mode resource shows:
- **Current Amount**: Total held
- **Upkeep**: Required per turn
- **Flow**: Projected change next turn
- **Status Class**: "good" (surplus) / "warn" (deficit coming) / "bad" (active deficit)
- **Tooltip**: Detailed explanation of effects

Example display:
```
Hardwood: 5 / upkeep 3
[━━━━━━─────] +2/turn
"Upkeep 3/turn. Building efficiency reduced."
```

### Action Buttons

When hovering over or attempting construction/training:
- Shows total cost including advanced resources
- Example: "Farm (1 hardwood)" or "Tanks (2 iron + 2 oil)"
- Greyed out if player lacks required resources

### Turn Summary Events

At end of turn, one message per resource per nation reports major changes:
- "Fruit surplus supported N population growth."
- "Fruit shortage reduced population growth."
- "Hardwood shortage reduced building efficiency."
- "Iron shortage reduced factory efficiency."
- "Oil shortage reduced advanced unit readiness."

## Multiplayer Validation

### Server Authority

All resource validation occurs server-side:
- `buildTile` action validates hardwood/iron costs before mutating state
- `trainUnit` action validates iron/oil costs before mutating state
- Invalid actions are rejected with descriptive error messages
- Client-side validation is advisory only (UI feedback)

### Error Messages

```
"Requires 2 hardwood."
"Factory construction requires 2 hardwood and 3 iron."
"Advanced units require 2 iron."
"Tanks require 2 oil."
```

### Backward Compatibility

- Lite mode games ignore Advanced resources entirely
- Missing `mode` field defaults to Lite
- Old client snapshots work with new server (new resources treated as 0)
- New clients can read old Lite games without issues

## AI Behavior

The AI does not require special handling because:
1. `canBuild()` checks resource costs before attempting
2. `trainUnit()` validation rejects invalid requests
3. Failed actions are silently skipped; AI moves to next decision
4. AI benefits from terrain weights that favor biomes matching resource roles

## Balance Constants

All upkeep values are conservative to prevent the system from becoming punishing:

```javascript
// Building upkeep (per building per turn)
FARM/FISHERY: 0.05 hardwood
MINE: 0.08 hardwood, 0.02 iron
MOUNTAIN_MINE: 0.1 hardwood, 0.03 iron
SCHOOL: 0.06 hardwood, 0.04 iron
UNIVERSITY: 0.08 hardwood, 0.06 iron
MILITARY: 0.1 hardwood, 0.08 iron, 0.05 oil
FACTORY: 0.15 hardwood, 0.2 iron, 0.1 oil

// Unit upkeep (per strength point per turn)
INFANTRY: 0.03 iron
TANKS: 0.1 iron, 0.08 oil
AIR: 0.08 iron, 0.15 oil
NAVAL: 0.07 iron, 0.1 oil
```

These values ensure:
- Early game builds do not create immediate pressure
- Mid-game forces nations to manage 2-3 resource tiers
- Late-game military investment requires committed resource gathering
- Penalties encourage strategic expansion toward needed biomes

## Testing Checklist

### Lite Mode Protection
- [ ] Building flow does not require advanced resources in Lite mode
- [ ] Unit training ignores advanced costs in Lite mode
- [ ] Old Lite games load without errors
- [ ] Player can build/train with zero advanced resources in Lite mode

### Advanced Mode Upkeep
- [ ] Fruit upkeep calculated from population
- [ ] Hardwood upkeep calculated from building count
- [ ] Iron upkeep calculated from factory + unit count
- [ ] Oil upkeep calculated from unit count
- [ ] Deficits correctly identified when insufficient resources

### Advanced Mode Deficits
- [ ] Fruit deficit reduces happiness
- [ ] Hardwood deficit reduces building production
- [ ] Iron deficit reduces factory efficiency
- [ ] Oil deficit reduces unit readiness
- [ ] Multiple deficits can exist simultaneously

### Cross-Dependencies
- [ ] Factory build requires both hardwood and iron (both checked)
- [ ] Factory build rejected if either resource missing
- [ ] Advanced unit training requires iron + oil
- [ ] Infantry training does not require iron
- [ ] Error messages clearly state what resource is missing

### Multiplayer Safety
- [ ] Server rejects Advanced build without hardwood
- [ ] Server rejects Advanced build without iron
- [ ] Server rejects Advanced unit without iron
- [ ] Server rejects Advanced unit without oil
- [ ] Lite mode builds are never rejected for Advanced resources
- [ ] Game snapshot includes advanced resource status

### UI Clarity
- [ ] Resource panel shows upkeep requirements
- [ ] Resource panel highlights deficits in red/warning color
- [ ] Tooltips explain upkeep and deficit effects
- [ ] Action buttons show resource costs
- [ ] Turn summary reports major resource changes

### Turn Processing
- [ ] Resources collected from terrain
- [ ] Upkeep subtracted from available resources
- [ ] Deficits applied after upkeep
- [ ] Penalties included in next turn's calculations
- [ ] Multiple consecutive turns apply upkeep correctly

## Acceptance Criteria Met

✅ Lite mode behaves like the simpler current game
✅ Advanced mode has resource upkeep
✅ Fruit upkeep depends on population
✅ Hardwood upkeep depends on buildings
✅ Iron upkeep depends on factories
✅ Oil upkeep depends on advanced units
✅ Deficits create soft penalties, not instant destruction
✅ Factories require Hardwood + Iron in Advanced mode
✅ Advanced units require Iron + Oil in Advanced mode
✅ Server validates all Advanced costs in multiplayer
✅ Client UI previews costs but cannot bypass them
✅ Advanced UI shows upkeep and deficit warnings
✅ Event feed summarizes resource pressure
✅ AI avoids obviously invalid Advanced actions
✅ Tests demonstrate system correctness
✅ Documentation explains the system

## Future Enhancements

Possible future improvements (out of scope for this implementation):

1. **Resource Trading**: Propose trades with other nations for specific resources
2. **Strategic Resources**: Rare biomes offering double yields
3. **Tech Tree Resources**: Tech improvements reducing upkeep costs
4. **Market System**: Buy/sell resources at fluctuating prices
5. **Economic Alliances**: Share resource yields with allies
6. **Trade Routes**: Establish routes specifically for resource exchange
7. **Disasters**: Random events destroying resource tiles
8. **Stockpile Benefits**: Store resources beyond production for future use
