import {
  createInitialServerGame,
  type InitialGameSettings,
  type SeatPlayer,
  type ServerGameState,
} from "./initialGame.js";

export function createInitialGameState(
  roomId: string,
  settings: InitialGameSettings,
  players: SeatPlayer[]
): ServerGameState {
  const game = createInitialServerGame(settings, players);

  game.gameId = roomId;
  game.roomId = roomId;
  game.status = "playing";
  game.turn = 1;
  game.turnNumber = 1;
  game.currentTurnIndex = 0;
  game.playerId = game.seats.find((seat) => seat.controllerType === "human")?.nationId || game.seats[0]?.nationId || "nation-1";

  return game;
}
