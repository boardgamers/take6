import { cloneDeep } from "lodash";
import type { Move } from "take6-engine";
import { move as execMove, moveAI, setup, stripSecret } from "take6-engine";
import launch from "./launch";

/**
 * Standalone mode: play immediately against 5–9 AI players, no server needed.
 * Mirrors viewer-svg's self-contained launcher.
 */
export function launchSelfContained(selector: string | HTMLElement = "#app", numPlayers = 6) {
  const emitter = launch(selector);

  let gameState = setup(numPlayers, {});
  for (let i = 0; i < gameState.players.length; i++) {
    gameState.players[i].name = i === 0 ? "You" : `AI ${i}`;
  }
  for (const player of gameState.players.slice(1)) {
    player.isAI = true;
  }

  const ME = 0;

  function publish(start: number, delayMs = 0) {
    const snapshot = stripSecret(cloneDeep(gameState), ME);
    const payload = {
      start,
      data: {
        log: snapshot.log.slice(start),
        availableMoves: snapshot.players.map((pl) => pl.availableMoves)
      }
    };
    setTimeout(() => emitter.emit("gamelog", payload), delayMs);
  }

  function runAI(start: number) {
    // Let each AI move resolve one at a time so the player can follow along
    const step = () => {
      const idx = gameState.players.findIndex((pl) => pl.isAI && pl.availableMoves);
      if (idx === -1) {
        publish(start);
        return;
      }
      gameState = execMove(gameState, randomMove(idx), idx);
      publish(start);
      start = gameState.log.length;
      setTimeout(step, 350 + Math.random() * 400);
    };
    setTimeout(step, 400);
  }

  function randomMove(player: number): Move {
    const moves = gameState.players[player].availableMoves!;
    if (moves.chooseCard) {
      const card = moves.chooseCard[Math.floor(Math.random() * moves.chooseCard.length)];
      return { name: "chooseCard", data: card } as Move;
    }
    const place = moves.placeCard![Math.floor(Math.random() * moves.placeCard!.length)];
    return { name: "placeCard", data: place } as Move;
  }

  emitter.on("move", (move: Move) => {
    const start = gameState.log.length;
    try {
      gameState = execMove(gameState, move, ME);
    } catch (err) {
      console.error("Illegal move rejected", err);
      publish(gameState.log.length); // resync
      return;
    }
    publish(start);
    runAI(gameState.log.length);
  });

  emitter.on("fetchState", () => {
    emitter.emit("state", stripSecret(cloneDeep(gameState), ME));
  });

  emitter.emit("player", { index: ME });
  emitter.emit("state", stripSecret(cloneDeep(gameState), ME));
}

export default launchSelfContained;
