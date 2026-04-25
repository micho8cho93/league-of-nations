# League of Nations — Full Game Build Prompt
## For Codex / Claude Code

---

## OVERVIEW

Build a **3D turn-based single-player civilization management game** called **"League of Nations"** using only **HTML, CSS, and JavaScript** (no build tools, no npm, no frameworks — must be deployable to GitHub Pages as a single `index.html` or a small folder of static files).

The player controls one nation on a shared world map and competes against **AI-controlled bot nations** (2–7 bots, configurable at game start). The game progresses through **4 historical stages** of increasing complexity: Foundational Era → Trade Era → Industrial Era → Modern Era.

The 3D world is rendered using **Three.js** (load via CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`).

---

## ⚠️ MVP MANDATE — READ THIS FIRST

**The game is strictly turn-based. There is no real-time simulation, no animation loops that advance game state, and no timers that trigger events automatically.** Nothing happens unless the player explicitly takes an action or clicks "End Turn."

**Build in this exact order — do not move to the next phase until the previous one works completely:**

| Phase | What to build | Done when... |
|-------|--------------|--------------|
| **Phase 1** | 3D hex map renders, camera works, tiles are clickable | Player can click tiles and see tooltips |
| **Phase 2** | Nation state, tile building, worker assignment | Player can build farms/mines/schools, assign people |
| **Phase 3** | Turn loop, population growth, starvation | End Turn advances the game, population grows correctly |
| **Phase 4** | Bot AI (basic) + event feed | Bots take turns visibly; player can see what they did |
| **Phase 5** | Trade modal + diplomacy panel | Player can negotiate trades with bots |
| **Phase 6** | Stage 2 unlocks (government, alliances, global trade) | Stage 2 activates at correct turn threshold |
| **Phase 7** | Stage 3 unlocks (factories, technology, warfare) | Combat works correctly with subtraction math |
| **Phase 8** | Stage 4 unlocks (fleets, victory conditions, awards) | Game ends correctly with victory screen |
| **Phase 9** | Polish (save/load, tutorial, disaster events) | Save/load works; tutorial completes |

**Do not skip phases or build Phase 9 before Phase 1 is solid.**

---

## FILE STRUCTURE

```
index.html          — main entry point, loads everything
css/
  style.css         — all UI styling
js/
  main.js           — entry point, initializes game
  game.js           — core game loop and state management
  map.js            — Three.js hex map renderer
  nation.js         — Nation class and resource logic
  bot.js            — AI bot decision-making
  ui.js             — HUD panels, modals, tooltips
  trade.js          — trade negotiation system
  war.js            — warfare system
  stages.js         — stage progression and unlocks
  utils.js          — shared helpers
```

---

## TECH STACK

- **Three.js r128** via CDN for 3D hex map rendering
- **Vanilla JS (ES6 modules)** — use `type="module"` in HTML
- **CSS custom properties** for theming
- **No external dependencies beyond Three.js**
- **localStorage** for saving game state between browser sessions

---

## STAGE 1: FOUNDATIONAL ERA — CORE SYSTEMS TO BUILD FIRST

Build these systems completely before adding later-stage features. Each system must be fully functional before moving on.

---

### 1. THE HEX MAP

**Visual requirements:**
- 3D hexagonal tile grid rendered with Three.js
- Camera: isometric perspective with mouse-drag orbit and scroll-wheel zoom
- Map size: configurable (small: ~200 tiles, medium: ~400 tiles, large: ~600 tiles)
- Each tile is a flat-top hexagonal prism (slightly extruded, like a coin)
- Tiles are color-coded by resource type:
  - 🟢 Green = Farm tiles
  - 🟠 Orange = Mine tiles
  - 🔵 Blue = School/Education tiles
  - 🔴 Red = Military Base tiles
  - ⚫ Black = Factory tiles (Stage 3+)
  - 🟫 Brown/Tan = Empty/unclaimed land
  - 💧 Blue flat = Water/ocean (impassable, required for ship routes)
- Nation territories are visually bordered (colored outline matching nation color)
- Hovering a tile shows a tooltip with tile info (owner, type, workers assigned, production)
- Clicking a tile opens an action panel (if owned by player)

**Map generation:**
- Procedurally generate the map on game start
- Nations start in different geographic regions with roughly equal total tile counts but different resource distributions (per the 4 region types below)
- Place water between non-adjacent nations to represent the need for ships
- Island territories exist on the map but are locked until Stage 3.2

**Nation region types (assigned randomly at game start to player and bots):**
| Region | Starting Tiles | Resource Cap | Starting Money | Starting People |
|--------|---------------|--------------|----------------|-----------------|
| 1 — Abundant | 40 | Unlimited per resource | $1,000 | 40 |
| 2 — Moderate | 55 | 25 max per resource | $2,000 | 30 |
| 3 — Restricted | 65 | 20 max per resource | $2,500 | 20 |
| 4 — Limited | 80 | 20 max per resource | $3,500 | 15 |

---

### 2. NATION STATE

Each nation (player or bot) tracks:

```js
{
  id: "nation_1",
  name: "String",
  color: "#hex",
  regionType: 1 | 2 | 3 | 4,
  money: Number,
  population: {
    total: Number,
    available: Number,     // unassigned people
    farmers: Number,
    miners: Number,
    scholars: Number,
    soldiers: Number,
  },
  tiles: {
    farms: [],             // array of tile objects
    mines: [],
    schools: [],
    militaryBases: [],
    factories: [],
    empty: [],
  },
  technologies: {
    tractors: Number,
    excavators: Number,
    universities: Number,
    tanks: Number,
    navalShips: Number,
  },
  government: null | "democracy" | "dictatorship" | "monarchy",
  alliances: [],           // array of nation IDs
  atWarWith: [],           // array of nation IDs
  treaties: [],            // signed agreements
  archives: [],            // log of all actions (documentation system)
  awards: [],              // Stage 3.3 recognition awards
}
```

---

### 3. RESOURCE & TILE SYSTEM

**Building a new tile:**
- Player selects an empty tile adjacent to their existing territory
- Cost to build:

| Stage | Farm | Mine | School | Military Base | Factory |
|-------|------|------|--------|--------------|---------|
| 1–2 | $100 or 1 person | $200 or 2 people | $200 or 2 people | $400 or 4 people | N/A |
| 3.1 | $100 or 1 | $200 or 2 | $200 or 2 | $400 or 4 | $700 |
| 3.2+ | $300 or 3 | $400 or 4 | $400 or 4 | $500 or 5 | $1,000 |

- Payment can be money OR people (not both); player chooses
- Once placed, tile type is permanent (cannot be changed)
- Tile is destroyed only by war or natural disaster events

**Worker assignment:**
- Each tile requires a minimum number of workers to be "active":
  - Farm: 2 farmers minimum
  - Mine: 3 miners minimum
  - School: 3 scholars minimum
  - Military Base: 4 soldiers minimum
- Workers come from the nation's available population
- A tile with fewer than minimum workers is INACTIVE (produces nothing)
- Player can reassign available (unassigned) people to tiles each turn

**Tile production (active tiles only):**
- Farm: feeds 10 people (prevents starvation)
- Mine: provides mining capacity (4 mines = 1 factory slot)
- School: provides education capacity (4 schools = 1 factory slot)
- Military Base: provides defensive/offensive capacity

**Starvation rule:**
- Each turn, check: `total_people_fed >= total_population`
- `total_people_fed = number_of_active_farms * 10`
- If underfed: population loses `(unfed_people * 0.1)` people per turn (rounded up)
- Show a warning indicator when a nation is at risk of starvation

---

### 4. POPULATION GROWTH SYSTEM

Population grows at the **end of each game round** (configurable: every 1 or 2 turns).

**Stage 1 & 2 growth formula:**

Count active tiles in groups:

| Tiles | People gained | Money gained |
|-------|--------------|--------------|
| 2 active farms | +2 people | +$200 |
| 4 active farms | +4 people | +$400 |
| 2 active mines | +2 people | +$200 |
| 4 active mines | +5 people | +$500 |
| 2 active schools | +2 people | +$200 |
| 4 active schools | +5 people | +$500 |
| 2 active military bases | +2 people | +$200 |
| 4 active military bases | +6 people | +$600 |

Calculate by largest group first, then remainder. Example: 7 farms = 4-farm group (4 people + $400) + 2-farm group (2 people + $200) + 1 leftover farm (nothing).

**Stage 3+ simplified formula:**
- 1 active farm = +1 person + $150
- 1 active mine = +1 person + $200
- 1 active school = +1 person + $200
- 1 active military base = +1 person + $200

---

### 5. TURN STRUCTURE

**The game is 100% turn-based. Nothing happens automatically. All progression is player-driven.**

Each **game round** consists of these sequential phases — the game waits at each phase until it is complete:

1. **Player's Turn** — Player takes as many actions as they want (each action costs resources). A large **"End Turn →"** button is always visible. Nothing advances until this is clicked.
2. **Bot Turns** — After player clicks End Turn, each bot nation executes its turn one at a time with a 600ms pause between bots and visible action log ("Bot Nation X built a farm", "Bot Nation Y declared war on..."). Player watches passively.
3. **End of Round Processing** — After all bots finish: population growth calculated, starvation checked, random event rolled, stage progression checked. Results shown in a summary panel before the next player turn begins.

**Player actions per turn (no action point limit — each action costs money/people):**
- Build new tiles
- Assign/reassign workers
- Initiate trade with a bot nation (opens trade modal)
- Declare war (Stage 3+)
- Purchase technology (Stage 3+)
- Form/break alliances (Stage 2+)
- Choose government type (Stage 2, one-time)
- Click "End Turn →" to proceed

**Turn counter** displayed prominently in HUD.

---

## STAGE 2: TRADE ERA — NEW MECHANICS

Unlock at turn 5 (or when player has 4+ of any resource tile — configurable).

### Government Selection
On Stage 2 unlock, player must choose government:
- **Democracy:** Every major decision shows a "vote" (3 random advisors vote; majority wins; player can override with a veto once per stage)
- **Dictatorship:** No restrictions; player decides everything immediately
- **Monarchy:** Random advisor votes happen, but player breaks ties

Government affects bot AI disposition toward the player (democracies are liked by democracy bots; dictatorships are feared; monarchies are neutral).

### Alliance System
- Player can propose an alliance to any bot nation (via diplomacy panel)
- Alliance types: Trade, Military, Political
- Alliance requires a written agreement (player fills in a simple form modal):
  - Alliance name
  - Member nations
  - Terms (checkboxes: share resources, mutual defense, trade exclusivity)
  - Duration (in turns)
- Alliances are displayed as colored connection lines between nations on the map

### Global Trade
- Trade with non-adjacent nations now possible, but costs $100 per transaction (ship cost)
- Trade negotiation modal:
  - Player offers: [resource type] [amount] OR [money amount]
  - Player requests: [resource type] [amount] OR [money amount]
  - Bot evaluates and accepts/counter-offers/rejects
  - Accepted trades are logged in National Archives

---

## STAGE 3: INDUSTRIAL ERA — FACTORIES & TECHNOLOGY

Unlock at turn 12 (configurable), or when player has 4+ mines AND 4+ schools.

### Factory Construction
- Requires: 4 active mines + 4 active schools (consumed/dedicated to factory)
- Cost: $700 (Stage 3.1), $1,000 (Stage 3.2+)
- Factory tile: black hexagon on map
- Each factory = 1 technology purchase slot

### Technologies (each costs 1 factory slot to research)

| Technology | Money Cost | Effect |
|------------|-----------|--------|
| **Tractor** | $500 | Place on 1 farm: increases that farm's production from 10 → 40 people fed. Cannot be moved. |
| **Excavator** | $750 | Permanently grants +50% mining capacity. (e.g. 4 mines → 6 effective mines) |
| **University** | $750 | Permanently grants +50% school capacity. (e.g. 6 schools → 9 effective schools) |
| **Tank** | $1,000 | Mobile military unit. +5 soldier equivalence. Can attach to a military base or move independently. 1 tank = 4 soldiers in combat. |
| **Naval Ship** | $300 (Stage 2 preview) / $1,000 (Stage 3 fleet) | Enables trade/military across water tiles. Required for attacking non-adjacent nations. |

**Visual indicator on map:** tiles with technologies show a small 3D icon floating above them (a miniature tractor, excavator arm, graduation cap, tank model, or ship model).

### Warfare System (Stage 3+)

**Declaring war:**
- Player opens Diplomacy panel → selects nation → "Declare War"
- A formal declaration modal appears: player writes reason (flavor text), confirms
- Declaration is logged in National Archives and shown in event feed
- The target bot nation and its allies are notified

**Turn-based combat:**
- War is conducted within the normal turn order
- On player's turn, they can move military bases into adjacent enemy tiles
- **Movement cost:** $100 or 1 person per tile moved
- **Attacking a resource tile:** costs $500 or 5 people; if successful, tile is destroyed (removed from map)
- **Attacking a military base:** combat resolution via soldier comparison:
  - Attacker soldiers + tank equivalents VS defender soldiers + tank equivalents
  - Subtract: `attacker_strength - defender_strength = remainder`
  - If remainder > 0: attacker wins; defender base destroyed; attacker base has `remainder` soldiers
  - If remainder ≤ 0: defender wins; attacker base destroyed; defender has `|remainder|` soldiers
  - If attacker remainder < 4 soldiers: base must retreat or disband (cannot hold territory)

**Soldier mobilization:**
- During wartime, player can assign more than the 4-soldier minimum to bases
- Extra soldiers come from available (unassigned) population
- Cannot pull workers from active farms/mines/schools (doing so deactivates that tile)

**Tank deployment:**
- Each tank adds +5 effective soldiers when attached to a base
- Tanks can also move independently as mobile units (no tile required)
- 1 tank in combat = 4 soldiers

**War report panel:**
At the end of each combat turn, show a report:
- Soldiers mobilized
- Tanks deployed
- Enemy tiles destroyed
- Player tiles lost
- Casualties (soldiers/tanks)
- Money spent
- Tiles advanced

### Discovered Territory (Stage 3.2)
- At Stage 3.2 unlock, reveal hidden island/territory tiles on the map
- These tiles are UN-controlled (neutral, rich in resources)
- Nations must pass through specific border nations to reach them
- First nation to place a tile on them claims ownership
- Creates natural conflict and race mechanics

### Pollution Mechanic (Stage 3.3)
- Track total factories per alliance group
- If an alliance has 6+ total factories: each member loses 15 people that round
- Show pollution warning on alliance panel
- Creates strategic tension: industrialize vs. stay clean

---

## STAGE 4: MODERN ERA — MILITARY DOMINANCE

Unlock at turn 20 (configurable), or when player has 3+ factories.

### Military Fleets
- **Fleet of 4 Tanks:** costs $1,000 + requires 1 excavator + 1 university + 1 factory; acts as a unified unit with 4x tank power
- **Fleet of 4 Naval Ships:** same cost/requirements; required for large-scale cross-water invasions

### End-Game Conditions
The game ends when one of the following is true:
1. One nation has eliminated all others' military bases (Military Victory)
2. A nation achieves 3x the population of all other nations combined (Population Victory)
3. A nation controls 60%+ of all map tiles (Territory Victory)
4. Player reaches a set turn limit (configurable; default 30 turns) — score-based winner

### Awards of Recognition (Stage 3.3–4)
At the end of Stage 3.3 and again at game end, award the following:
- 🌍 **Global Ambassador** — most treaties created and co-signed
- ⚔️ **Military Machine** — most military bases + tanks
- 💰 **Economic Engine** — most money
- 🌾 **Farming Fanatic** — most farms
- 📚 **World Scholars** — most schools
- ⛏️ **Excavating Experts** — most mines
- 🏆 **All-Arounder** — most combined resources

Show in a trophy/award modal with animations.

---

## AI BOT BEHAVIOR

Each bot has a personality archetype (randomly assigned at start):

| Archetype | Priority | Behavior |
|-----------|----------|----------|
| **Expansionist** | Territory | Builds tiles aggressively, declares war early, targets weakly defended nations |
| **Economist** | Money | Focuses on farms, mines, schools; trades heavily; avoids war unless provoked |
| **Militarist** | Military | Builds military bases rapidly, stockpiles soldiers and tanks, forms military alliances |
| **Diplomat** | Alliances | Proposes alliances to everyone, trades often, uses collective defense |
| **Isolationist** | Self-sufficiency | Rarely trades or allies; focuses on internal development; defends aggressively if attacked |

**Bot decision loop (each bot turn):**
1. Check starvation risk → if at risk, build/activate farms first
2. Evaluate current stage unlocks → purchase eligible technologies
3. Execute archetype priority action (expand, trade, build military, etc.)
4. If at war: move military units, attack if advantageous
5. If not at war and Militarist/Expansionist: evaluate whether to declare war (based on relative strength)
6. Log all actions to archives

**Bot trade AI:**
- Evaluates trade offers based on its resource surplus/deficit
- Accepts if trade ratio is favorable (it gets more value than it gives)
- Counter-offers if ratio is close
- Rejects if it would leave the bot below safe resource thresholds

**Bot war AI:**
- Only declares war if its military strength is ≥ 1.5x the target's strength
- Focuses attacks on resource tiles first (to weaken economy), then military bases
- Retreats if combat remainder drops below 4 soldiers

---

## UI / HUD DESIGN

### Main Screen Layout
```
┌─────────────────────────────────────────────────────┐
│  [Nation Name]  Stage: 1  Turn: 3    [End Turn Btn] │ ← Top bar
├────────────────────────┬────────────────────────────┤
│                        │  [Resource Panel]           │
│   3D HEX MAP           │  Money: $1,200              │
│   (Three.js canvas)    │  People: 40 (12 available) │
│                        │  Farms: 3 (active: 2)       │
│                        │  Mines: 2 (active: 1)       │
│                        │  Schools: 1                 │
│                        │  Military: 2                │
│                        ├────────────────────────────┤
│                        │  [Action Panel]             │
│                        │  [Build Tile ▼]             │
│                        │  [Assign Workers]           │
│                        │  [Diplomacy]                │
│                        │  [Archives]                 │
└────────────────────────┴────────────────────────────┘
│  [Event Feed — scrolling log of game events]         │
└─────────────────────────────────────────────────────┘
```

### Panels & Modals

**Tile Action Panel** (appears when player clicks owned tile):
- Shows: tile type, workers assigned, production output, upgrade options
- Actions: assign/remove workers, upgrade with technology (Stage 3+), destroy (if at war)

**Diplomacy Panel:**
- List of all nations with status indicators (ally 🟢 / neutral ⚪ / war 🔴)
- Actions: Propose Trade, Propose Alliance, Declare War, Send Message (flavor)
- Alliance details: current terms, duration remaining, pollution warning if applicable

**Trade Modal:**
- Nation portrait + name
- "You offer:" dropdown (resource type) + quantity input OR money input
- "You request:" same
- [Propose] button → bot responds with Accept / Counter-Offer / Reject
- Counter-offer shows bot's terms; player can Accept or Decline

**Technology Panel** (Stage 3+):
- Grid of available technologies
- Each shows: name, cost, effect, requirements
- Grayed out if requirements not met
- "Research" button deducts factory slot + money

**War Report Modal:**
- Opens automatically after any combat turn
- Shows statistics with color-coded gains (green) and losses (red)
- "Continue War" or "Propose Peace" buttons

**Stage Progression Modal:**
- Triggered when stage unlocks
- Shows: stage name, new mechanics unlocked, cost changes
- Animated reveal with historical flavor text

**National Archives Panel:**
- Full scrollable log of every action taken this game
- Entries: turn number, action type, details, cost
- Exportable as text (copy to clipboard button)

**End Game Screen:**
- Winner announcement with victory type
- All awards displayed
- Final stats comparison table for all nations
- "Play Again" button

---

## VISUAL STYLE

- **Dark theme:** deep navy/slate background (#0f1923)
- **Accent color:** gold (#c9a84c) for UI highlights and borders
- **Nation colors:** each nation gets a unique color (red, blue, green, purple, orange, teal, pink, yellow)
- **Tile glow:** active tiles have a subtle emissive glow matching their color
- **Water:** animated subtle wave shader or simple flat blue with opacity variation
- **UI panels:** semi-transparent dark panels with gold borders, clean sans-serif font
- **Hex grid lines:** thin white lines at low opacity between tiles
- **Camera:** smooth lerp/easing on all camera movements
- **Tile hover:** tile lifts slightly (Y position +0.1) on hover with highlight ring
- **Tile click:** brief scale pulse animation on selection

---

## GAME INITIALIZATION FLOW

1. **Start Screen:**
   - Game title "LEAGUE OF NATIONS"
   - Subtitle "A Civilization Strategy Game"
   - Settings:
     - Player nation name (text input)
     - Number of bot nations (2–7, slider)
     - Map size (Small / Medium / Large)
     - Turn limit (20 / 30 / 40 / Unlimited)
     - Growth rate (Every 1 turn / Every 2 turns)
   - [START GAME] button

2. **Nation Assignment:**
   - Each nation (player + bots) randomly assigned a region type (1–4)
   - Player shown their starting stats before map appears
   - Brief flavor text describing their nation's character

3. **Map Generation & Camera Intro:**
   - Map procedurally generated
   - Camera sweeps across the map before settling on player's territory
   - Tutorial tooltips appear on first interaction

4. **Tutorial (first 3 turns):**
   - Guided hints pointing to key UI elements
   - "Build your first farm" → "Assign workers" → "End turn to grow"
   - Can be dismissed by player

---

## SAVE SYSTEM

- Auto-save to `localStorage` at end of every turn
- "Continue Game" option on start screen if save exists
- Manual save button in settings menu
- Save data includes: full game state (all nations, map, turn, stage, archives)

---

## NATIONAL ARCHIVES (DOCUMENTATION SYSTEM)

Every action must be logged automatically:
```js
{
  turn: 5,
  type: "build_tile",
  details: "Built Farm tile at hex (3, -2, -1)",
  cost: { money: 100 },
  timestamp: Date.now()
}
```

Archive types to track:
- `build_tile` — new tile constructed
- `assign_workers` — population reassignment
- `trade_completed` — trade agreement finalized
- `alliance_formed` — new alliance created
- `war_declared` — war declaration
- `combat_resolved` — battle outcome
- `technology_researched` — new tech acquired
- `population_growth` — end-of-round growth event
- `starvation_event` — population loss from underfed
- `stage_unlocked` — new game stage reached
- `disaster_event` — natural disaster impact

---

## NATURAL DISASTER EVENTS (optional but recommended)

Random events that can occur each turn (low probability, ~5%):
- **Drought:** One random farm goes inactive for 2 turns
- **Earthquake:** One random mine is destroyed
- **Plague:** Nation loses 3–8 random people
- **Flood:** One coastal tile is temporarily impassable
- **Bountiful Harvest:** One farm produces double this turn

Events are announced in the event feed with flavor text. Bots are also affected.

---

## ETHICAL BOUNDARIES

The game explicitly prohibits:
- Any gameplay mechanic referencing slavery, genocide, torture, or cruel treatment
- If any dialog/flavor text generation is used, filter these terms
- Nations that exhibit these behaviors receive a UI warning and automatic resource/land penalty (handled by UN event)

---

## IMPLEMENTATION NOTES FOR THE AI

1. **Build in this order:** Map rendering → Nation state → Tile building → Worker assignment → Turn loop → Population growth → Trade → Stage 2 unlocks → Stage 3 unlocks → Warfare → Stage 4 unlocks → Bot AI → Polish

2. **Three.js hex grid:** Use axial coordinate system (q, r) for hex math. Each hex center: `x = size * (3/2 * q)`, `z = size * (sqrt(3)/2 * q + sqrt(3) * r)`. Use `THREE.CylinderGeometry` with 6 radial segments for hex prisms.

3. **Performance:** For maps with 400+ tiles, use `THREE.InstancedMesh` for hex rendering, not individual meshes.

4. **State management:** Keep all game state in a single `GameState` object. All functions read from and write to this object. Makes save/load trivial.

5. **Bot turn animation:** Add 500ms delays between bot actions with a visual "Bot is thinking..." indicator so the player can follow what's happening.

6. **Mobile note:** Optimize for desktop browsers primarily (1024px+ width). Touch support is a stretch goal.

7. **GitHub Pages deployment:** All asset paths must be relative. No server-side dependencies. No API calls. All data is client-side only.

---

## STRETCH GOALS (implement only after core is complete)

- Sound effects and ambient background music (Web Audio API)
- Animated unit sprites on hex tiles (Three.js sprites)
- Fog of war (tiles outside territory are hidden until adjacent)
- Historical event cards with real-world parallels (e.g., "The Industrial Revolution begins in your region — factories cost 20% less this stage")
- Leaderboard (local high scores via localStorage)
- Color-blind accessibility mode (alternate tile patterns instead of color alone)

---

*End of prompt. Build the complete game described above as a GitHub Pages-compatible static web app.*
