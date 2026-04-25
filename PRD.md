# League of Nations PRD

## 1. Product Summary

**League of Nations** is a single-player, turn-based civilization management game for the browser. The player leads one nation on a shared 3D hex world map against 2-7 AI-controlled nations. The game teaches resource planning, population management, trade, diplomacy, industrialization, sustainability, and conflict through a clear staged progression.

The product is implemented as a static web app using `index.html`, `css/style.css`, vanilla JavaScript ES modules, and Three.js loaded from CDN. It must remain deployable to GitHub Pages without npm, bundlers, backend services, or framework dependencies.

## 2. Product Goals

1. Deliver a playable turn-based strategy game with a strong educational foundation.
2. Make every strategic system visible: food, people, money, workers, territory, diplomacy, technology, war, disasters, pollution, and victory.
3. Preserve the classroom spirit of the original activity while making it work as a solo digital game.
4. Keep the rules simple enough for students to understand, but deep enough to create meaningful tradeoffs.
5. Support save/continue through `localStorage`.
6. Keep all game-state changes deterministic from player action or explicit End Turn processing. No real-time simulation may advance game state.

## 3. Non-Goals

1. No multiplayer networking in the current product.
2. No backend database or accounts.
3. No npm or build pipeline.
4. No real-time strategy mechanics.
5. No automatic timers that advance turns, population, disasters, AI actions, or war.
6. No historically harmful roleplay content. The game should stay focused on systems, diplomacy, and strategy without simulating real-world atrocities or discriminatory harm.

## 4. Target Users

Primary users:
- Middle-school or high-school students learning global politics, economics, geography, resource management, and systems thinking.
- Teachers using the original classroom League of Nations activity as inspiration.
- Strategy game players who want a short-form civilization-style browser game.

Secondary users:
- Developers extending the static game.
- Educators adapting the mechanics into lesson plans.

## 5. Platform Requirements

| Area | Requirement |
| --- | --- |
| Runtime | Modern desktop browser with ES module support |
| Rendering | Three.js r128 via CDN |
| Deployment | Static files only; GitHub Pages compatible |
| Storage | `localStorage` save data |
| Input | Mouse and pointer events |
| Network | Only required for loading Three.js CDN |
| Build Tools | None |

## 6. Core Design Pillars

1. **Turn clarity**: Players always know whose turn it is and what phase is active.
2. **Visible consequences**: Every important action enters the event feed and archive.
3. **Resource pressure**: Population is both a workforce and a cost, so growth can become a liability without food.
4. **Staged complexity**: Stage 1 teaches basic economy; Stage 2 introduces diplomacy; Stage 3 introduces industry and war; Stage 4 introduces fleets and victory.
5. **Readable math**: Combat, starvation, production, trade, and victory should use formulas the player can reason about.
6. **Static simplicity**: Architecture must stay maintainable without a build system.

## 7. Game Setup

At game start, the player configures:

| Setting | Values |
| --- | --- |
| Nation name | Text input, default `Republic of Nova`, max 40 chars |
| Bot nations | 2-7 |
| Map size | Small, Medium, Large |
| Turn limit | 20, 30, 40, or Unlimited |
| Growth rate | Every turn or every 2 turns |

The game creates:
- One player nation.
- 2-7 bot nations.
- A procedural hex map.
- Randomized region assignments across region types 1-4.
- Bot personalities selected from archetypes.
- Starting territory clusters for all nations.

## 8. Nation Region Types

Each nation receives one region type at game start.

| Region Type | Name | Starting Tiles | Resource Cap | Starting Money | Starting People |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Abundant | 40 | Unlimited | 1000 | 40 |
| 2 | Moderate | 55 | 25 per resource | 2000 | 30 |
| 3 | Restricted | 65 | 20 per resource | 2500 | 20 |
| 4 | Limited | 80 | 20 per resource | 3500 | 15 |

Design intent:
- Region 1 has many people but less money and less land pressure.
- Region 4 has more land and money but fewer people.
- Region caps create asymmetry and encourage trade/diplomacy.

## 9. Game Object Model

### 9.1 Nation

Each nation stores:

```js
{
  id,
  name,
  color,
  regionType,
  money,
  population: {
    total,
    available,
    farmers,
    miners,
    scholars,
    soldiers
  },
  tiles: {
    farms,
    mines,
    schools,
    militaryBases,
    factories,
    empty
  },
  technologies: {
    tractors,
    excavators,
    universities,
    tanks,
    navalShips,
    tankFleets,
    navalFleets
  },
  government,
  alliances,
  atWarWith,
  treaties,
  archives,
  awards,
  isBot,
  personality
}
```

### 9.2 Tile

Each map tile stores:

```js
{
  q,
  r,
  type,
  owner,
  ownerColor,
  workers,
  workerType,
  hasTractor,
  disabledTurns,
  floodedTurns,
  bountifulTurns,
  mesh,
  outline
}
```

`mesh` and `outline` are rendering references and should not be serialized directly.

### 9.3 Game State

The central state tracks:

```js
{
  map,
  nations,
  playerId,
  botIds,
  turn,
  stage,
  growthEvery,
  turnLimit,
  lastSummary,
  events,
  diplomacy,
  alliances,
  stageUnlocks,
  gameOver,
  currentPhase,
  isProcessingTurn,
  tutorial
}
```

## 10. Map Design

### 10.1 Geometry

The world is a hex-shaped axial grid rendered as 3D flat-top hexagonal prisms.

Axial coordinate to world position:

```txt
x = size * (1.5 * q)
z = size * ((sqrt(3) / 2) * q + sqrt(3) * r)
```

Hex distance:

```txt
distance(a, b) =
  (abs(a.q - b.q) + abs(a.q + a.r - b.q - b.r) + abs(a.r - b.r)) / 2
```

Neighbor directions:

```txt
(+1, 0), (-1, 0), (0, +1), (0, -1), (+1, -1), (-1, +1)
```

### 10.2 Map Sizes

Current radius values:

| Label | Radius |
| --- | ---: |
| Small | 8 |
| Medium | 11 |
| Large | 14 |

Recommended radius also scales with nation count:

| Nation Count | Minimum Radius |
| ---: | ---: |
| 1-3 | 8 |
| 4-5 | 11 |
| 6-8 | 14 |

### 10.3 Tile Types and Colors

| Type | Color | Gameplay Role |
| --- | --- | --- |
| Empty | Brown/tan | Claimable and buildable land |
| Farm | Green | Food and population growth |
| Mine | Orange | Industry prerequisite and growth |
| School | Blue | Technology prerequisite and growth |
| Military Base | Red | War, defense, and military growth |
| Factory | Black/dark | Technology and fleet slots |
| Water | Blue | Blocks building and creates global route pressure |

### 10.4 Procedural Generation

Generation uses seeded hash values per tile:
- Outer rings are more likely to become water.
- Inner regions contain a weighted mix of empty land, farms, mines, schools, military tiles, and occasional water.
- Starting nation clusters are claimed on non-water tiles and converted to empty if needed.

Current terrain weights for interior generation:

| Type | Weight |
| --- | ---: |
| Empty | 0.45 |
| Farm | 0.20 |
| Mine | 0.12 |
| School | 0.10 |
| Military | 0.08 |
| Water | 0.05 |

## 11. Turn Structure

The game is strictly turn-based. Nothing changes unless the player acts or clicks End Turn.

Each round:

1. **Player Turn**
   - Player may build, assign workers, trade, form alliances, research, build fleets, declare war, and attack where unlocked.
   - There is no action-point limit.
   - Every action costs money, people, prerequisites, or risk.

2. **Bot Turns**
   - Bots act one at a time.
   - Each bot turn is surfaced in the event feed.
   - A short pause makes bot decisions visible.

3. **Round Processing**
   - Starvation is processed for all nations.
   - Growth is processed if the configured growth interval matches.
   - Temporary tile effects tick down.
   - Disasters may occur.
   - Stage progression is checked.
   - Pollution is checked.
   - Alliances may expire.
   - Victory is checked if Stage 4 is active.
   - Game auto-saves.

## 12. Stages and Unlocks

| Stage | Name | Unlock Trigger | Main Unlocks |
| --- | --- | --- | --- |
| 1 | Foundational Era | Start | Map, building, workers, food, growth |
| 2 | Trade Era | Turn >= 5 or any one basic resource type has >= 4 tiles | Government, alliances, global trade |
| 3 | Industrial Era | Stage 2 and turn >= 12, or >= 4 active mines and >= 4 active schools | Factories, technologies, warfare |
| 3.2 | Industrial Expansion | Stage 3 and turn >= 16, or >= 1 factory | Higher build costs |
| 4 | Modern Era | Stage 3.2 and turn >= 20, or >= 3 factories | Fleets, victory conditions, awards |

## 13. Building System

### 13.1 Build Eligibility

A tile can be built if:
- It exists.
- It is not water.
- It is not flooded.
- It is empty.
- It is owned by the builder, or unowned and adjacent to the builder's territory.
- The builder has enough money or available people for the chosen payment method.
- The tile type does not exceed the nation region cap.
- The tile type is unlocked for the current stage.
- Factory-specific prerequisites are met.

### 13.2 Build Costs

Payment is either money or people, not both.

| Stage | Farm | Mine | School | Military Base | Factory |
| --- | --- | --- | --- | --- | --- |
| 1-2 | $100 or 1 person | $200 or 2 people | $200 or 2 people | $400 or 4 people | Not available |
| 3.0-3.1 | $100 or 1 person | $200 or 2 people | $200 or 2 people | $400 or 4 people | $700 |
| 3.2+ | $300 or 3 people | $400 or 4 people | $400 or 4 people | $500 or 5 people | $1000 |

People used as build payment are removed from both `available` and `total` population.

### 13.3 Permanence

Built resource tile types are permanent. They can only be removed by war or disasters. Destroyed tiles return to empty, unowned land.

### 13.4 Factory Requirement

To build the next factory:

```txt
required active mines = (existing factories + 1) * 4
required active schools = (existing factories + 1) * 4
```

The current implementation checks this requirement for all nations.

## 14. Worker System

### 14.1 Worker Minimums

| Tile Type | Worker Field | Minimum Workers to Activate |
| --- | --- | ---: |
| Farm | farmers | 2 |
| Mine | miners | 3 |
| School | scholars | 3 |
| Military Base | soldiers | 4 |
| Factory | scholars | 5 |

Inactive tiles produce nothing and do not count for growth, food, or active prerequisites.

### 14.2 Assignment Rules

Workers are moved from `population.available` into the appropriate role.

Adding workers:

```txt
available -= delta
role += delta
tile.workers += delta
```

Removing workers:

```txt
tile.workers -= removed
role -= removed
available += removed
```

Workers can be reassigned during the player turn. The UI should always show whether a tile is active or inactive.

## 15. Food and Starvation

### 15.1 Food Capacity

Farm food:

```txt
normal active farm = feeds 10 people
tractor farm = feeds 40 people
bountiful farm = base food * 2 for the active effect duration
inactive, disabled, or flooded farm = feeds 0 people
```

Nation food capacity:

```txt
foodCapacity = sum(food from all farm tiles)
```

### 15.2 Starvation Formula

At round processing:

```txt
unfed = max(0, population.total - foodCapacity)
deaths = unfed > 0 ? ceil(unfed * 0.1) : 0
```

Death order:
1. Available population.
2. Soldiers.
3. Scholars.
4. Miners.
5. Farmers last, to avoid deepening famine too aggressively.

When assigned workers die, their tile worker counts decrease.

## 16. Growth and Economy

Growth is processed every `growthEvery` turns, configured at game start as every 1 or 2 turns.

### 16.1 Stage 1-2 Grouped Growth

Only active tiles count. Groups of 4 are counted first, then groups of 2, with leftovers producing nothing.

| Active Tile Group | People Gained | Money Gained |
| --- | ---: | ---: |
| 2 farms | 2 | 200 |
| 4 farms | 4 | 400 |
| 2 mines | 2 | 200 |
| 4 mines | 5 | 500 |
| 2 schools | 2 | 200 |
| 4 schools | 5 | 500 |
| 2 military bases | 2 | 200 |
| 4 military bases | 6 | 600 |

Example:

```txt
7 active farms =
  floor(7 / 4) = 1 group of 4 -> +4 people, +$400
  floor((7 % 4) / 2) = 1 group of 2 -> +2 people, +$200
  1 leftover -> +0
Total = +6 people, +$600
```

### 16.2 Stage 3+ Per-Tile Growth

Only active tiles count.

| Active Tile | People Gained | Money Gained |
| --- | ---: | ---: |
| Farm | 1 | 150 |
| Mine | 1 | 200 |
| School | 1 | 200 |
| Military Base | 1 | 200 |

Excavator and University effects:

```txt
effective mines = floor(active mines * 1.5) if nation has >= 1 excavator
effective schools = floor(active schools * 1.5) if nation has >= 1 university
```

## 17. Government

Governments unlock in Stage 2. The player must choose one before continuing normal Stage 2 play.

| Government | Gameplay Meaning |
| --- | --- |
| Democracy | Advisor-vote flavor; receives one veto in state data |
| Dictatorship | Immediate decision flavor; rivals may fear direct rule |
| Monarchy | Leader breaks ties flavor |

Diplomacy effects when the player chooses government:
- Same government as a bot: relation +10.
- Player dictatorship: relation +4 with bots generally.
- Bot dictatorship when player is not dictatorship: relation -6.
- Player democracy with non-democracy bot: relation -2.

Bot governments are assigned by personality:

| Personality | Government |
| --- | --- |
| Diplomat | Democracy |
| Economist | Democracy |
| Militarist | Dictatorship |
| Expansionist | Monarchy |
| Isolationist | Monarchy |

## 18. Trade

### 18.1 Trade Eligibility

Player can trade with bot nations when:
- It is not currently bot or round processing.
- The partner exists and is not the player.
- A route is available.
- The player can afford the offer and any route cost.
- The partner can afford the requested bundle.

Route rules:
- Adjacent nations can trade at no route cost.
- Non-adjacent trade unlocks in Stage 2 and costs $100 as a global ship route.

### 18.2 Tradable Resources

Current implementation supports:
- Money.
- Available people.

People traded are removed from the sender's `available` and `total` population and added to the receiver's `available` and `total`.

### 18.3 Trade Valuation

Base values:

```txt
$1 = 1 value
1 person = 125 value
```

Partner personality modifies value and acceptance threshold:

| Personality | Threshold | Money Value | People Value |
| --- | ---: | ---: | ---: |
| Expansionist | 0.98 | 1.00 | 1.05 |
| Economist | 1.08 | 1.08 | 1.00 |
| Militarist | 1.02 | 1.00 | 1.12 |
| Diplomat | 0.90 | 1.00 | 1.00 |
| Isolationist | 1.18 | 1.00 | 0.90 |

Acceptance:

```txt
relationFactor = 1 - ((relation - 50) / 500)
trustBonus = min(0.1, successfulTrades * 0.02)
threshold = max(0.72, personalityThreshold * relationFactor - trustBonus)
requiredValue = requestValue * threshold
accepted = requestValue == 0 || offerValue >= requiredValue
gap = ceil(max(0, requiredValue - offerValue))
```

Accepted trade:
- Moves resources.
- Charges route cost if any.
- Relation +6.
- Successful trade count +1.
- Adds treaty and archive entries.

Rejected trade:
- Relation -3.
- Rejected trade count +1.
- Logs rejection reason.

## 19. Alliances

Alliances unlock in Stage 2 after the player chooses a government.

### 19.1 Alliance Draft

An alliance contains:

```js
{
  id,
  name,
  type,
  members,
  memberNames,
  terms,
  duration,
  createdTurn,
  expiresTurn,
  active
}
```

Types:
- Trade.
- Military.
- Political.

Terms:
- Share resources.
- Mutual defense.
- Trade exclusivity.

At least one term is required. Duration is clamped from 1 to 20 turns. Alliance names are max 48 characters.

### 19.2 Alliance Acceptance

Base score starts from current diplomacy relation.

Score modifiers:

| Condition | Modifier |
| --- | ---: |
| Partner Diplomat | +18 |
| Partner Isolationist | -20 |
| Partner Militarist and military alliance | +12 |
| Partner Economist and trade alliance | +10 |
| Partner Expansionist and mutual defense | +5 |
| Trade exclusivity term | -8 |
| Same government | +8 |
| Player dictatorship with democracy partner | -8 |

Thresholds:

| Partner Personality | Acceptance Threshold |
| --- | ---: |
| Diplomat | 46 |
| Isolationist | 70 |
| Other | 55 |

Accepted alliance:
- Adds alliance to shared list.
- Adds alliance id to both nations.
- Relation +12.
- Adds treaty and archive entries.
- Draws alliance line on map.

Rejected alliance:
- Relation -4.
- Logs rejection.

Alliances expire when:

```txt
current turn >= expiresTurn
```

## 20. Industry and Technology

Technology unlocks in Stage 3 and requires available factory slots.

### 20.1 Factory Slots

Only active factories count.

```txt
factory slot total = count(active factories)
factory slot used = sum(all technology and fleet counts)
factory slot available = max(0, total - used)
```

### 20.2 Technologies

| Technology | Cost | Field | Effect |
| --- | ---: | --- | --- |
| Tractor | 500 | tractors | One farm feeds 40 instead of 10; cannot be moved |
| Excavator | 750 | excavators | +50% effective mine count for Stage 3+ growth |
| University | 750 | universities | +50% effective school count for Stage 3+ growth |
| Tank | 1000 | tanks | Each tank adds 5 soldier-equivalent strength |
| Naval Ship | 1000 | navalShips | Enables future global military/trade reach design |

Current tractor behavior:
- On purchase, it is assigned to the first active farm without a tractor, or otherwise the first farm without a tractor.

## 21. Warfare

Warfare unlocks in Stage 3.

### 21.1 Declaration

The player can declare war when:
- Stage >= 3.
- The target exists.
- The target is not the player.
- The player is not already at war with the target.
- Turn processing is not active.

Declaration adds each nation to the other's `atWarWith` list and logs the event.

### 21.2 Attack Eligibility

An attack requires:
- Attacker is at war with defender.
- Attacker has a military base adjacent to the target tile.
- Target tile is owned by a war opponent.
- Player is in a valid turn phase.

Current implementation supports adjacent attacks only.

### 21.3 Resource Tile Attack

Resource tile attack cost:

| Payment | Cost |
| --- | ---: |
| Money | 500 |
| People | 5 available people |

Result:
- Target resource tile is destroyed.
- Tile becomes empty and unowned.
- Workers on destroyed tile are removed from defender population.
- Combat report and event are created.

### 21.4 Military Base Combat

Military strength:

```txt
base strength = soldiers on selected military base
tank strength = tanks * 5
tank fleet strength = tankFleets * 20
total combat strength = base strength + tank strength + tank fleet strength
```

Resolution:

```txt
difference = attackerStrength - defenderStrength

if difference > 0:
  attacker wins
  defender base destroyed
  surviving attacker strength = difference
else:
  defender wins
  attacker base destroyed
  surviving defender strength = abs(difference)
```

Survivors are applied in this order:
1. Soldiers up to remaining strength.
2. Tank fleets in chunks of 20.
3. Tanks in chunks of 5.

If the attacker wins but remaining strength is less than 4, the attacker base disbands because it cannot hold territory.

### 21.5 Current War Limitations

The original classroom rules mention moving military bases through enemy territory for $100 or 1 person per tile. The current digital implementation does not yet include multi-tile movement or retreat. Attacks are adjacent from existing military bases.

## 22. Fleets

Fleets unlock in Stage 4.

| Fleet | Cost | Requirements | Effect |
| --- | ---: | --- | --- |
| Tank Fleet | 1000 | 1 excavator, 1 university, 1 factory slot | Adds 20 soldier-equivalents |
| Naval Fleet | 1000 | 1 excavator, 1 university, 1 factory slot | Represents 4 naval ships and future global reach |

Current implementation stores:
- `tankFleets`
- `navalFleets`

Tank fleets affect military strength. Naval fleets are available as a Stage 4 asset, with broader cross-water combat behavior reserved for future expansion.

## 23. Disasters and Environmental Events

Each nation has a 5% chance per round processing to receive one random disaster or positive event.

### 23.1 Event Types

| Event | Effect |
| --- | --- |
| Drought | One farm becomes disabled for 2 turns |
| Earthquake | One mine is destroyed |
| Plague | Nation loses 3-8 people |
| Flood | One owned coastal non-water tile is flooded for 1 turn |
| Bountiful Harvest | One farm feeds double next round |

Temporary effects decrement during round processing.

### 23.2 Pollution

Pollution checks active alliances.

If an active alliance has 6 or more total factories across members:

```txt
each member loses up to 15 people
```

Population is removed randomly across available people and worker roles. Pollution creates event and archive entries.

## 24. Victory and Awards

Victory only activates in Stage 4.

### 24.1 Victory Conditions

| Victory Type | Condition |
| --- | --- |
| Military | Only one nation still has military bases |
| Population | One nation's population is at least 3x all other nations combined |
| Territory | One nation owns at least 60% of all non-water tiles |
| Score | Turn limit is passed |

Score victory formula:

```txt
score = money + (population.total * 10) + (owned tile count * 100)
```

The highest score wins when turn limit is exceeded.

### 24.2 Recognition Awards

At game end, awards are computed across all nations.

| Award | Metric |
| --- | --- |
| Global Ambassador | Most treaties |
| Military Machine | Highest military power |
| Economic Engine | Most money |
| Farming Fanatic | Most farms |
| World Scholars | Most schools |
| Excavating Experts | Most mines |
| All-Arounder | Most combined resource tiles |

Awards are displayed in the victory modal and stored in end-game state.

## 25. Bot AI

Bots use personality-driven heuristics. Current personalities:

- Expansionist.
- Economist.
- Militarist.
- Diplomat.
- Isolationist.

### 25.1 Bot Turn Priority

Each bot turn:

1. Check food shortage; build/staff farm if needed.
2. Staff inactive farms.
3. If Stage 3+ and at war, attempt an attack.
4. If Stage 3+ and no action yet, build factory if requirements are met.
5. If Stage 3+ and no action yet, research technology if slots are available.
6. Follow personality build order.
7. Staff inactive tiles as fallback.
8. If Stage 4+ and no action yet, assemble fleets.
9. If Stage 3+ and no war yet, consider declaring war.
10. Save resources if no viable action.

### 25.2 Build Priorities

| Personality | Build Order |
| --- | --- |
| Expansionist | Farm, Mine, School, Military |
| Economist | Mine, Farm, School, Mine |
| Militarist | Military, Farm, Mine, Military |
| Diplomat | School, Farm, Mine, School |
| Isolationist | Farm, Military, Mine, School |

### 25.3 War Declaration Logic

Bots do not consider war if:
- Personality is Isolationist, Diplomat, or Economist.
- Total military strength is below 8.
- Already at war.

Bots may declare war when:

```txt
botMilitaryStrength >= targetMilitaryStrength * 1.5
```

## 26. User Interface Requirements

### 26.1 Main Screen

The main game screen contains:
- Topbar with brand, nation, stage, turn, and End Turn button.
- 3D map canvas.
- Hover tooltip.
- Tutorial card.
- Sidebar panels.
- Event feed footer.
- Modals for trade, stage unlocks, government, technology, war, fleets, alliances, and victory.

### 26.2 Sidebar Panels

Required panels:
- Resources.
- Nations.
- Diplomacy.
- Tile.
- Last Round summary.
- Industrial Era controls.
- Modern Era controls.
- Controls.
- Settings.

### 26.3 Event Feed

The event feed should:
- Show current phase.
- Show latest event.
- Show recent events with turn numbers.
- Use nation colors when possible.
- Make bot actions visible.

### 26.4 Tile Panel

When a tile is selected, the tile panel should show:
- Coordinates.
- Type.
- Owner.
- Worker count.
- Active/inactive status.
- Food or prerequisite information where relevant.
- Build options if eligible.
- Worker assignment controls if owned by player.
- Attack options if war eligibility exists.

### 26.5 Modals

Required modals:
- Start/continue flow.
- Trade proposal.
- Stage unlock explanation.
- Government choice.
- Technology research.
- War declaration.
- War report.
- Fleet assembly.
- Victory and awards.
- Alliance agreement.

### 26.6 Visual Style

Current design direction:
- Dark strategy dashboard.
- Gold accents for status and progression.
- Nation colors for ownership.
- Green/orange/blue/red/black tile semantics.
- Compact panels and readable tactical data.
- Isometric 3D map with hover lift and colored outlines.

## 27. Save and Load

Save key:

```txt
league-of-nations-save-v1
```

Save data includes:
- Version.
- Saved timestamp.
- Player id.
- Bot ids.
- Turn.
- Stage.
- Growth interval.
- Turn limit.
- Last summary.
- Event feed.
- Diplomacy.
- Alliances.
- Stage unlock flags.
- Game over data.
- Tutorial state.
- Serialized nations.
- Map radius, seed, and tile state.

Deserialization must:
- Reject unsupported versions.
- Restore nation objects.
- Recreate tile ownership and tile buckets.
- Restore worker counts and temporary tile effects.
- Restore alliance lines.
- Reset processing phase to player phase.

## 28. Architecture

### 28.1 File Responsibilities

| File | Responsibility |
| --- | --- |
| `index.html` | Static DOM structure, modals, Three.js CDN, module entry |
| `css/style.css` | Full UI styling |
| `js/main.js` | App boot, start/continue flow, config, nation creation |
| `js/game.js` | Core state, turn loop, building, workers, diplomacy orchestration, combat mutation, saves, disasters, victory |
| `js/map.js` | Three.js map renderer, camera controls, tile picking, outlines, alliance lines |
| `js/nation.js` | Nation factory, region config, build costs, worker constants, food helpers |
| `js/bot.js` | Bot AI decisions |
| `js/ui.js` | Rendering panels, modals, event binding |
| `js/trade.js` | Pure trade normalization, valuation, execution |
| `js/war.js` | Pure combat helpers and attack target discovery |
| `js/stages.js` | Stage unlock constants, governments, technologies, fleets, awards |
| `js/utils.js` | Hex math, tile constants, seeded randomness |

### 28.2 Architectural Principles

1. Keep pure rules in helper modules where possible.
2. Keep mutation centralized in `GameState`.
3. Keep UI rendering derived from state.
4. Keep map rendering separate from rule logic.
5. Serialize only data, never Three.js objects.
6. Emit events after state changes so UI can rerender consistently.
7. Keep all modules browser-native ES modules.

### 28.3 Event Model

`GameState` exposes a listener API:

```js
state.on((event) => { ... })
state.emit({ type, ...payload })
```

Important event types:
- `state_changed`
- `event_added`
- `turn_phase`
- `bot_thinking`
- `stage_unlocked`
- `war_report`
- `game_over`

## 29. Math Reference

### 29.1 Active Tile

```txt
active = tile.workers >= WORKER_MIN[tile.type]
         and tile.disabledTurns == 0
         and tile.floodedTurns == 0
```

### 29.2 Food

```txt
farmFood = activeFarm ? (hasTractor ? 40 : 10) : 0
if bountifulTurns > 0: farmFood *= 2
```

### 29.3 Starvation

```txt
unfed = max(0, totalPopulation - foodCapacity)
deaths = ceil(unfed * 0.1)
```

### 29.4 Factory Requirement

```txt
required = (existingFactories + 1) * 4
canBuildFactory = activeMines >= required && activeSchools >= required
```

### 29.5 Trade Acceptance

```txt
offerValue = moneyOffered + peopleOffered * 125 * partnerPeopleModifier
requestValue = moneyRequested + peopleRequested * 125 * partnerPeopleModifier
threshold = max(0.72, baseThreshold * relationFactor - trustBonus)
accepted = offerValue >= requestValue * threshold
```

### 29.6 Combat

```txt
strength = baseSoldiers + tanks * 5 + tankFleets * 20
difference = attackerStrength - defenderStrength
```

### 29.7 Score Victory

```txt
score = money + population.total * 10 + ownedTiles * 100
```

## 30. Documentation and Archives

Every major action should create an archive entry:
- Build tile.
- Assign workers.
- Trade accepted/rejected.
- Alliance formed/rejected.
- Government chosen.
- Technology researched.
- Fleet built.
- War declared.
- Combat resolved.
- Stage unlocked.
- Starvation.
- Disasters.
- Pollution.
- Tutorial completion.
- Game over.

The archive exists to preserve the original classroom rule that nations must document actions for them to count.

## 31. Accessibility and Usability Requirements

1. Buttons must have readable labels and disabled states.
2. Modal dialogs should use `role="dialog"` and `aria-modal="true"`.
3. Close buttons need accessible labels.
4. Color-coded information should also include text labels.
5. Numeric inputs should enforce min/max constraints.
6. Game should remain understandable without reading source code.
7. Important warnings, such as starvation risk, should be visible in the resource panel.

## 32. Content Safety Requirements

The game must avoid encouraging or simulating:
- Genocide.
- Slavery.
- Torture.
- Hate speech.
- Cruel treatment of real-world groups.

War is represented abstractly through tile destruction, soldiers, technology, and resource costs. The tone should remain educational and strategic.

## 33. Current Implementation Status

Implemented:
- Static app architecture.
- Start/continue flow.
- 3D hex map rendering and camera controls.
- Tile hover, selection, ownership outlines.
- Nation state and region types.
- Player building and worker assignment.
- Bot nations and personality AI.
- Turn loop with bot phase and round phase.
- Population growth.
- Starvation.
- Trade modal and acceptance math.
- Stage progression.
- Government choice.
- Alliances.
- Factories.
- Technology research.
- Warfare declaration and adjacent attacks.
- Combat reports.
- Fleets.
- Victory modal and awards.
- Disasters and bountiful harvest.
- Pollution.
- Save/load.
- Tutorial card.

Partially implemented or future-facing:
- Naval ships and naval fleets exist, but cross-water military operations are not fully implemented.
- Stage 3.2 island/UN territory concept is represented in design docs but not as a full map subsystem.
- Classroom-style UN mediation is represented through logs and rules, not an interactive moderator system.
- Multi-tile military movement and retreat are not implemented.
- Trade currently supports money and people, not temporary tile leases or resource-tile contracts.

## 34. Future Enhancements

High priority:
1. Add explicit island/UN territory system for Stage 3.2+.
2. Implement cross-water attacks and routes using naval ships/fleets.
3. Add military movement and retreat costs.
4. Add treaty duration effects for resource or tile leasing.
5. Add an archive/history viewer for each nation.

Medium priority:
1. Add map generation presets for classroom-style nations 1-8.
2. Add advisor voting UI for democracy and monarchy flavor.
3. Add configurable disaster chance.
4. Add teacher/UN scenario controls.
5. Add better mobile/tablet layout.

Low priority:
1. Add sound cues.
2. Add optional animations for stage unlocks and combat reports.
3. Add exported end-game report.
4. Add achievements across saved games.

## 35. Acceptance Criteria

### 35.1 Core Loop

- Player can start a new game with 2-7 bots.
- Player can click tiles, inspect them, build eligible resource tiles, and assign workers.
- End Turn visibly runs bot turns and round processing.
- Population, money, starvation, and food update correctly after each round.
- Game state auto-saves and can be continued.

### 35.2 Stage Progression

- Stage 2 unlocks by turn threshold or resource threshold.
- Stage 3 unlocks by turn threshold or active mine/school threshold.
- Stage 3.2 unlocks by turn threshold or factory threshold.
- Stage 4 unlocks by turn threshold or factory threshold.
- UI panels and actions appear only after relevant unlocks.

### 35.3 Diplomacy

- Adjacent trade works before Stage 2.
- Non-adjacent trade requires Stage 2 and charges route cost.
- Trade acceptance reflects value, personality, relation, and trust.
- Alliances require Stage 2 and government.
- Alliances expire after duration.

### 35.4 Industry and War

- Factory construction requires active mines and schools.
- Technologies require money and factory slots.
- Tractor changes farm food output.
- Excavator and University affect Stage 3+ growth.
- War declaration requires Stage 3.
- Resource attacks destroy target tiles and charge cost.
- Military combat resolves by subtraction math.

### 35.5 Endgame

- Stage 4 enables victory checks.
- Military, population, territory, and score victories can end the game.
- Victory modal displays winner, victory type, awards, and stats.

## 36. Test Plan

Manual smoke tests:
1. Start game with 2 bots, small map.
2. Build a farm with money and assign enough workers.
3. End turn and confirm bot events appear.
4. Create starvation by growing beyond food capacity and confirm deaths.
5. Reach Stage 2, choose government, trade with a bot, and propose alliance.
6. Reach Stage 3, build required mines/schools, build factory, research tractor.
7. Declare war, destroy a resource tile, and attack a military base.
8. Reach Stage 4, build a fleet, trigger or simulate victory.
9. Save, refresh, continue, and confirm map/nations restore.

Unit-style candidates:
- `buildCost`.
- `isTileActive`.
- `foodCapacity`.
- `evaluateTrade`.
- `resolveCombat`.
- `qualifiesForTradeEra`.
- `qualifiesForIndustrialEra`.
- `qualifiesForIndustrialExpansionEra`.
- `qualifiesForModernEra`.
- `factorySlots`.
- `computeAwards`.

## 37. Open Questions

1. Should Stage 3.2 islands be procedurally generated, fixed-map landmarks, or separate scenario objects?
2. Should naval ships affect trade routes, war routes, or both?
3. Should alliances with mutual defense automatically trigger war declarations?
4. Should resource trades support temporary tile leasing and contract duration?
5. Should factories harm only alliance members or all nations globally after a pollution threshold?
6. Should the final score include awards, treaties, technologies, or military strength?
7. Should bot difficulty be configurable separately from bot count?

## 38. Glossary

| Term | Meaning |
| --- | --- |
| Active tile | A tile with enough workers and no disabling temporary effect |
| Available people | Unassigned population that can build, trade, or become workers |
| Bot | AI-controlled nation |
| Factory slot | Capacity from active factories used for technologies and fleets |
| Global trade | Non-adjacent trade route unlocked in Stage 2 |
| Region type | Starting nation profile defining land, money, people, and caps |
| Stage | Era of the game that controls feature unlocks |
| Treaty | A recorded trade or alliance agreement |
| Worker role | Farmer, miner, scholar, or soldier assignment |

