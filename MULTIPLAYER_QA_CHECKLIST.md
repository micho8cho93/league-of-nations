# Multiplayer QA Checklist

## 2-player flow

1. Start the server from `server/` with `npm run dev`.
2. Open the frontend in two separate browser sessions.
3. Create an online match in session A.
4. Join the room code from session B.
5. Confirm each session receives a different nation assignment.
6. Start the game from the host session.
7. Confirm both clients show the same map, turn, active nation, resources, events, and action points.
8. Try an action from the inactive player and confirm a structured server error is shown.
9. End turn from the active player and confirm turn control moves to the second player.
10. End turn from the second player and confirm the turn number advances after server round processing.

## Trades

1. Advance or configure the game to Era 2.
2. Send a valid trade proposal from the active player.
3. Confirm the target player sees/accepts the proposal only on their turn.
4. Confirm resources transfer on both clients after the server snapshot.
5. Try a negative bundle value and confirm it is rejected with no resource or AP change.
6. Try an unaffordable offer and confirm it is rejected with no transfer.

## Attacks

1. Advance or configure the game to Era 3.
2. Declare war from the active player.
3. Attack a valid adjacent enemy tile and confirm both clients receive the same ownership/unit result.
4. Try attacking an unowned, missing, out-of-range, or non-war tile.
5. Confirm invalid attacks do not spend money or action points.

## Tech

1. Attempt research without active prerequisite tiles and confirm rejection.
2. Complete valid linear tech research and confirm resources/AP update from the server snapshot.
3. Advance or configure the game to Era 4.
4. Attempt branch research without required military tier/factory/resources and confirm rejection.
5. Complete valid branch research and confirm both clients show the same branch level.

## Events

1. Trigger or wait for server round processing.
2. Confirm event history and active event state are included in snapshots.
3. Confirm event-modified resource output is reflected after the server round.
4. Refresh both clients and confirm event state is derived from the server snapshot.

## Reconnect

1. Refresh the active player tab during their turn.
2. Confirm the client derives nation assignment, current turn, AP, resources, and selected state from the server snapshot.
3. Refresh the inactive player tab and confirm no local action can mutate state while waiting.
4. Disconnect and reconnect after game over and confirm actions remain rejected.
