# Multiplayer Action Audit

Scope inspected: `js/game.js`, `js/map.js`, `js/nation.js`, `js/tech.js`, `js/trade.js`, `js/war.js`, `js/events.js`, `js/ui.js`, `js/multiplayer/client.js`, `server/src/rooms/LeagueRoom.ts`, `server/src/game/actions.ts`, `server/src/game/createInitialGameState.ts`, `server/src/game/initialGame.ts`, and `server/src/rooms/LeagueRoom.test.ts`.

## Summary

Online play now uses the Colyseus room as the authority for core gameplay actions. The frontend sends action intent through `js/multiplayer/client.js`; the server validates the envelope in `LeagueRoom.ts`, mutates `ServerGameState` through `server/src/game/actions.ts`, checks victory, and broadcasts snapshots.

The browser `GameState` in `js/game.js` still owns local/offline gameplay and bot behavior. Multiplayer clients build a local render-only `GameState` from server snapshots in `js/main.js`.

## Actions

| Action | Frontend source | Local mutation? | Server handler | Current multiplayer status | Required fix |
| --- | --- | --- | --- | --- | --- |
| `startGame` | `js/main.js` lobby start button; `LeagueMultiplayerClient.startGame()` | No gameplay mutation; transitions UI after snapshot | `LeagueRoom.messages.startGame` | Supported | Done: server creates state, locks room, broadcasts snapshot. |
| `endTurn` / `END_TURN` | `GameUI` end-turn button | Offline: `game.endTurn()` mutates; online: sends intent | `LeagueRoom.acceptEndTurn` | Supported | Done: validates active player, advances active human nation, runs server round production on wrap, checks victory. |
| `buildTile` / `BUILD_TILE` | `GameUI.handleTileClick`, build buttons | Offline mutates via `GameState.buildTile`; online sends intent | `applyServerPlayerAction` -> `buildTile` | Supported | Done: server validates ownership, terrain, tech, adjacency, resources, actions. |
| `assignWorkers` / `ASSIGN_WORKERS` | `GameUI.handleTileClick`, worker buttons; AI uses `GameState.assignWorkers` offline | Offline mutates population/workers/tile; online sends intent | `applyServerPlayerAction` -> `assignWorkers` | Supported | Done: server validates tile owner, worker role, amount, population, money, action count. |
| `destroyTile` / `DESTROY_TILE` | `GameUI.handleTileClick`, destroy button | Offline mutates tile/workers/resources; online sends intent | `applyServerPlayerAction` -> `destroyTile` | Supported | Done: server validates own tile, non-capital, cost, action count. |
| `trainUnit` / `TRAIN_UNIT` | `GameUI.handleTileClick`, military training buttons | Offline mutates unit/resources/population; online sends intent | `applyServerPlayerAction` -> `trainUnit` | Supported | Done: server validates military base, branch unlock, resources, action count. |
| `moveOrAttackUnit` / `MOVE_OR_ATTACK_UNIT` | `GameUI.handleMapSelect` and tile military targeting | Offline mutates unit/tile/war state; online sends intent | `applyServerPlayerAction` -> `moveOrAttackUnit` | Supported | Done: server validates source, target, unit movement, war state, money, action count. |
| `declareWar` / `DECLARE_WAR` | `GameUI.handleDiplomacyClick`, diplomacy dialog | Offline mutates war/diplomacy; online sends intent | `applyServerPlayerAction` -> `declareWarAction` | Supported | Done: server validates era, target, alliance, existing war, money, action count. |
| `trade` / `TRADE` | `GameUI.openTradeDialog` submit | Offline mutates resources/diplomacy/routes; online sends intent | `applyServerPlayerAction` -> `tradeAction` | Supported | Done: server validates era, partner, bundles, affordability, action count. |
| `proposeAlliance` / `PROPOSE_ALLIANCE` | `GameUI.openAllianceDialog` | Offline mutates alliances/diplomacy; online sends intent | `applyServerPlayerAction` -> `proposeAllianceAction` | Supported | Done: server validates diplomacy gate, cost, action count. |
| `breakAlliance` / `BREAK_ALLIANCE` | `GameUI.handleDiplomacyClick` | Offline mutates alliance record; online sends intent | `applyServerPlayerAction` -> `breakAllianceAction` | Supported | Done: server validates member owns alliance break action. |
| `embargo` / `EMBARGO` | `GameUI.handleDiplomacyClick` | Offline mutates diplomacy/resources; online sends intent | `applyServerPlayerAction` -> `embargoAction` | Supported | Done: server validates diplomacy gate, target, war state, money, action count. |
| `research` / `RESEARCH` | `GameUI.handleTechClick` | Offline mutates tech/resources; online sends intent | `applyServerPlayerAction` -> `research` | Supported | Done: server validates category, active tile requirements, resources, money, action count. |
| `researchBranch` / `RESEARCH_BRANCH` | `GameUI.handleTechClick` | Offline mutates branch tech/resources; online sends intent | `applyServerPlayerAction` -> `researchBranch` | Supported | Done: server validates era 4, factory, military tier, resources, action count. |
| `submitEraReflection` / `SUBMIT_ERA_REFLECTION` | Present in local `GameState`; no current UI send path found | Offline can mutate pending era state | `applyServerPlayerAction` -> `submitEraReflection` | Partially supported | Server route exists; no active multiplayer UI flow found. Keep routed, not expanded. |
| Resource production / round economy | Offline: `GameState.processRound`, `produceForNation`, `consumeFood`; UI only projects | Offline mutates resources at end turn | `processServerRound` called from `LeagueRoom.advanceTurn` | Supported minimal | Done: server produces money/resources from active staffed tiles on full human turn wrap. Food consumption/growth remains richer offline-only. |
| Global/random events | `js/events.js`, called by offline `GameState.processRound` | Offline mutates resources/tiles/population | No dedicated server parity handler | Unsupported online | Intentionally not expanded; avoid broad event redesign. |
| Bot AI actions | `js/ai.js`, called by offline `GameState.endTurn` | Offline mutates bot nations | No online bot turn AI handler | Unsupported online | Online turn loop currently advances human seats and treats unfilled nations as bots for ownership only. Full bot AI parity remains out of scope. |
| Tile selection | `GameState.selectTile`, `GameUI.handleMapSelect` | Local UI selection only | No server handler | Client-only | No fix required; selection is presentation state. |

## Specific Findings

- `assignWorkers`: Previously had mixed client/server naming. Fixed with canonical uppercase schema plus legacy aliases.
- Resource creation: Offline production was richer and client-side. Added minimal server round production for online turn wrap.
- Tile actions: Build, destroy, train, move/attack are routed through server in online mode.
- End turn: Server-authoritative and now runs production/victory checks when turn order wraps.
- Start game: Server creates state and broadcasts snapshots. New joins remain blocked after start.
- Nation/player assignment: Server assigns unique `nation-N` seats and the frontend derives the assigned nation from server snapshot/session id.
- Trade/tech/war actions: Server handlers exist and return clean validation errors when invalid.
- Unsupported multiplayer action: Now returns structured `ACTION_ERROR` payload instead of throwing.
- Lobby startup and end-turn synchronization only: No longer accurate; core player actions are server-routed. Online bot AI and full offline round simulation parity remain unsupported.
