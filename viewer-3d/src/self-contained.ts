import { cloneDeep } from "lodash";
import type { Move } from "take6-engine";
import { move as execMove, moveAI, setup, stripSecret } from "take6-engine";
import launch from "./launch";

/**
 * Standalone mode: play immediately against AI opponents, no server needed.
 * Defaults to 6 players; override with the `players` query param or the
 * `numPlayers` argument.
 */
export function launchSelfContained(selector: string | HTMLElement = "#app", numPlayers?: number) {
  const emitter = launch(selector);

  // Dev/demo shortcuts: ?players=3 changes the table size, ?points=2&handSize=2
  // shortens the game (handy to reach the end screen quickly when testing locally).
  const params = new URLSearchParams(location.search);
  const players = Number(params.get("players"));
  if (players > 0) {
    numPlayers = players;
  }
  numPlayers ??= 6;
  const points = Number(params.get("points"));
  const handSize = Number(params.get("handSize"));
  const options = { ...(points > 0 ? { points } : null), ...(handSize > 0 ? { handSize } : null) };

  let gameState = setup(numPlayers, options);
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

  let aiRunning = false;

  function runAI(start: number) {
    // Only one AI chain at a time — a second chain would interleave duplicate
    // publishes and corrupt the viewer's log queue. If a chain is already
    // scheduled, it will see the latest gameState on its next step.
    if (aiRunning) {
      return;
    }
    aiRunning = true;
    // Let each AI move resolve one at a time so the player can follow along.
    // The pause between steps must exceed the viewer's per-item animation time
    // (~0.5s choose / ~0.6s place) or the human's place phase can be skipped.
    const step = () => {
      const idx = gameState.players.findIndex((pl) => pl.isAI && pl.availableMoves);
      if (idx === -1) {
        aiRunning = false;
        publish(start);
        return;
      }
      gameState = execMove(gameState, randomMove(idx), idx);
      publish(start);
      start = gameState.log.length;
      setTimeout(step, 1200);
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
      // An AI may still be waiting for its turn (e.g. the player clicked while
      // an AI move was being animated); resume the chain so the game proceeds.
      runAI(gameState.log.length);
      return;
    }
    publish(start);
    // Let the viewer animate the player's move before the AI answers. The
    // 3D viewer applies log items with animations (~1s per batch), and the
    // AI must not resolve the round before the human has had a chance to
    // see their own staged card and (if lowest) place it.
    setTimeout(() => runAI(gameState.log.length), 2500);
  });

  emitter.on("fetchState", () => {
    emitter.emit("state", stripSecret(cloneDeep(gameState), ME));
  });

  emitter.emit("player", { index: ME });
  emitter.emit("state", stripSecret(cloneDeep(gameState), ME));

  return emitter;
}

export default launchSelfContained;
