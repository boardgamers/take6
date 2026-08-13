import { EventEmitter } from "events";
import type { GameState, Move } from "take6-engine";
import { GameController } from "./game";

/**
 * Launch the 3D viewer inside the element matched by `selector`.
 *
 * Same contract as the other viewers: returns an EventEmitter.
 *  - in:  "state" (GameState), "player" ({index}), "gamelog" ({start, data:{log, availableMoves}})
 *  - out: "move", "fetchState", "fetchLog", "ready", "addLog", "replaceLog", "replay:info"
 */
export function launch(selector: string | HTMLElement): EventEmitter {
  const container =
    typeof selector === "string"
      ? (document.querySelector(selector) as HTMLElement | null)
      : selector;
  if (!container) {
    throw new Error(`take6-viewer-3d: no element matches selector "${selector}"`);
  }

  const item = new EventEmitter();
  const inner = new EventEmitter();

  const controller = new GameController(container, { emitter: inner, standalone: false });

  // Player moves go out
  inner.on("move", (move: Move) => item.emit("move", move));

  // Requests toward the host
  inner.on("fetchState", () => item.emit("fetchState"));
  inner.on("ready", () => item.emit("ready"));
  inner.on("replay:info", (info: { start: number; current: number; end: number }) =>
    item.emit("replay:info", info)
  );

  // Data coming from the host
  item.addListener("state", (G: GameState) => inner.emit("state", G));
  item.addListener("player", (data: { index: number }) => inner.emit("player", data));
  item.addListener("state:updated", () => item.emit("fetchLog", { start: 0 }));
  item.addListener("gamelog", (logData: { start: number; data: { log: any[]; availableMoves?: any[] } }) => {
    inner.emit("addLog", { start: logData.start, log: logData.data.log, availableMoves: logData.data.availableMoves });
  });
  item.addListener("replay:start", () => inner.emit("replayStart"));
  item.addListener("replay:to", (to: number) => inner.emit("replayTo", to));
  item.addListener("replay:end", () => inner.emit("replayEnd"));

  // Cleanup hook for embedders that want it
  (item as any).dispose = () => controller.dispose();

  return item;
}

export default launch;
