# Cleanup Report

## Logic moved to server authority

- Multiplayer tile actions are validated and applied by `server/src/game/actions.ts`: build, destroy, workers, training, movement, and attacks.
- Multiplayer diplomacy/trade actions are server-owned: direct trades, trade proposals, accept/reject, alliances, alliance breaks, embargoes, and war declarations.
- Multiplayer tech actions are server-owned: linear research and Era 4 branch research.
- Multiplayer turn advancement, action point reset, round production, global server events, victory checks, and snapshot broadcast are owned by `server/src/rooms/LeagueRoom.ts`.
- Client-side multiplayer gameplay now sends intent and waits for authoritative snapshots. Local `GameState` mutation methods reject mutation when `serverAuthoritative` is set.

## What remains client-only

- Offline/bot-match gameplay still uses `js/game.js`, `js/trade.js`, `js/war.js`, `js/tech.js`, and `js/events.js`.
- UI selection, dialogs, previews, tooltips, animations, projected resource flow, and tutorial state remain client-only.
- Rich offline bot AI remains local to `js/ai.js`.
- Offline-only round details such as famine/population growth depth, full bot turns, and era reflection flow are not expanded for online play.

## Known limitations

- The server has parallel validation logic for online play rather than importing browser modules directly.
- Online round economy is intentionally narrower than offline round simulation.
- Reconnect safety depends on live Colyseus room state; there is no durable persistence after room disposal.
- No authentication or account ownership exists beyond Colyseus session-to-nation assignment.
