import { EventEmitter } from "events";
import type { GameState, Move } from "take6-engine";
import { GameController } from "./game";
import { applyHostTheme } from "./theme";

/**
 * Launch the 3D viewer inside the element matched by `selector`.
 *
 * Same contract as the other viewers: returns an EventEmitter.
 *  - in:  "state" (GameState), "player" ({index}),
 *         "gamelog" (either {log, availableMoves} after a fetchLog, or
 *         {start, end?, data: {log, availableMoves}} after a move),
 *         "preferences" ({dark?: boolean, devMode?: boolean} — devMode mounts
 *         the debug controls panel), "replay:start", "replay:to" (index),
 *         "replay:end"
 *  - out: "move", "fetchState", "fetchLog", "ready", "addLog" (string[]),
 *         "replaceLog" (string[]), "replay:info",
 *         "player:clicked" ({index, name}) — the host navigates to /user/<name>
 *
 * Inner-emitter naming: inbound game-log slices arrive on the inner emitter as
 * "addLog" ({start, log, availableMoves}) and are consumed by GameController.
 * Outbound text lines for the host sidebar use the "uplink:" prefix
 * ("uplink:addLog") so the forwarder below never re-fires for inbound objects.
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
  inner.on("uplink:addLog", (lines: string[]) => item.emit("addLog", lines));
  inner.on("replaceLog", (lines: string[]) => item.emit("replaceLog", lines));
  inner.on("player:clicked", (data: { index: number; name: string }) => item.emit("player:clicked", data));
  inner.on("replay:info", (info: { start: number; current: number; end: number }) =>
    item.emit("replay:info", info)
  );

  // Data coming from the host
  item.addListener("state", (G: GameState) => inner.emit("state", G));
  item.addListener("player", (data: { index: number }) => inner.emit("player", data));
  item.addListener("state:updated", () => item.emit("fetchLog", { start: 0 }));
  item.addListener(
    "gamelog",
    (logData: { start?: number; log?: any[]; availableMoves?: any[]; data?: { log: any[]; availableMoves?: any[] } }) => {
      // The platform sends the log slice two ways: bare { log, availableMoves } after a
      // fetchLog (StartedGame unwraps the body via `.then((r) => r.data)`), or wrapped
      // { start, data: { log, availableMoves } } after a move.
      const log = logData.log ?? logData.data?.log;
      const availableMoves = logData.availableMoves ?? logData.data?.availableMoves;
      inner.emit("addLog", { start: logData.start ?? 0, log, availableMoves });
    }
  );
  item.addListener("replay:start", () => inner.emit("replayStart"));
  item.addListener("replay:to", (to: number) => inner.emit("replayTo", to));
  item.addListener("replay:end", () => inner.emit("replayEnd"));

  // Host UI preferences: dark mode, plus the host's dev-mode signal which
  // mounts the same debug controls the local harness uses.
  item.addListener("preferences", (prefs: { dark?: boolean; devMode?: boolean } | null) => {
    if (prefs && typeof prefs.dark === "boolean") {
      applyHostTheme(prefs.dark);
    }
    if (prefs?.devMode === true) {
      controller.enableDevTools();
    }
  });


  // The site notifies the iframe about theme changes through a raw postMessage
  // (not re-emitted on the emitter)
  if (typeof window !== "undefined") {
    window.addEventListener("message", (event) => {
      if (event.data?.type === "theme" && typeof event.data.dark === "boolean") {
        applyHostTheme(event.data.dark);
      }
    });
  }

  // Cleanup hook for embedders that want it
  (item as any).dispose = () => controller.dispose();

  return item;
}

export default launch;
