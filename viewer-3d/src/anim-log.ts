/**
 * Rolling in-memory log of animation triggers and per-frame card state, for
 * diagnosing visual glitches (stray cards, flip flicker) that only show up
 * mid-animation.
 *
 * A ring buffer keeps only the most recent `CAPACITY` entries, so it can stay
 * on during a whole game without unbounded growth. Enable with `?animlog=1`
 * (always on in dev), then grab the buffer from the console:
 *
 *   copy(__take6animlog.dump())   // copies a text report to the clipboard
 *   __take6animlog.dump()         // returns the report string
 *   __take6animlog.entries        // raw structured entries
 *   __take6animlog.clear()
 */

export type AnimLogEntry =
  | { kind: "tween"; t: number; id: number; card: string; action: "start" | "cancel" | "complete"; detail?: string }
  | { kind: "call"; t: number; name: string; detail?: string }
  | { kind: "frame"; t: number; card: string; x: number; y: number; z: number; flip: number; scale: number; lift: number; zone: string };

const CAPACITY = 4000;

/** Wall-clock ms since the logger module loaded (matches performance.now()). */
const t0 = performance.now();
const now = () => Math.round((performance.now() - t0) * 10) / 10;

class AnimLog {
  entries: AnimLogEntry[] = [];
  private head = 0;
  private filled = false;
  /** Last logged frame signature per card, to skip unchanged frames. */
  private lastFrame = new Map<string, string>();
  enabled: boolean;

  constructor() {
    let on = false;
    if (typeof location !== "undefined") {
      on = new URLSearchParams(location.search).has("animlog");
    }
    // Always available in dev (import.meta.env.DEV); opt-in via ?animlog=1 in prod.
    this.enabled = on || (typeof import.meta !== "undefined" && !!(import.meta as any).env?.DEV);
    this.entries = [];
  }

  private push(e: AnimLogEntry) {
    if (!this.enabled) {
      return;
    }
    if (this.entries.length < CAPACITY) {
      this.entries.push(e);
    } else {
      this.entries[this.head] = e;
      this.head = (this.head + 1) % CAPACITY;
      this.filled = true;
    }
  }

  tween(id: number, card: string, action: "start" | "cancel" | "complete", detail?: string) {
    this.push({ kind: "tween", t: now(), id, card, action, detail });
  }

  call(name: string, detail?: string) {
    this.push({ kind: "call", t: now(), name, detail });
  }

  frame(card: string, zone: string, a: { x: number; y: number; z: number; flip: number; scale: number }, lift: number) {
    // Skip frames where nothing moved (a static card logged every rAF would
    // swamp the ring buffer and drown out the actual animation).
    const sig = `${zone}|${r(a.x)}|${r(a.y)}|${r(a.z)}|${r(a.flip)}|${r(a.scale)}|${r(lift)}`;
    if (this.lastFrame.get(card) === sig) {
      return;
    }
    this.lastFrame.set(card, sig);
    this.push({
      kind: "frame",
      t: now(),
      card,
      zone,
      x: r(a.x),
      y: r(a.y),
      z: r(a.z),
      flip: r(a.flip),
      scale: r(a.scale),
      lift: r(lift)
    });
  }

  clear() {
    this.entries = [];
    this.head = 0;
    this.filled = false;
    this.lastFrame.clear();
  }

  /** Ordered oldest → newest (the ring buffer is not stored in order once full). */
  ordered(): AnimLogEntry[] {
    if (!this.filled) {
      return this.entries.slice();
    }
    return [...this.entries.slice(this.head), ...this.entries.slice(0, this.head)];
  }

  dump(): string {
    const lines = this.ordered().map(formatEntry);
    return `take6 anim log — ${lines.length} entries (ring capacity ${CAPACITY})\n` + lines.join("\n");
  }

  /** Copy the dump to the clipboard (falls back to a console print). */
  async copy(): Promise<string> {
    const text = this.dump();
    try {
      await navigator.clipboard.writeText(text);
      return `copied ${this.ordered().length} entries to clipboard`;
    } catch {
      console.log(text);
      return "clipboard unavailable — printed to console instead";
    }
  }

  /** Download the dump as a .log file. */
  download(filename = "take6-anim.log") {
    const blob = new Blob([this.dump()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

const r = (n: number) => Math.round(n * 100) / 100;

function formatEntry(e: AnimLogEntry): string {
  const t = `${e.t.toFixed(1)}ms`.padStart(11);
  switch (e.kind) {
    case "tween":
      return `${t} TWEEN #${e.id} ${e.action.padEnd(8)} ${e.card}${e.detail ? "  " + e.detail : ""}`;
    case "call":
      return `${t} CALL  ${e.name}${e.detail ? "  " + e.detail : ""}`;
    case "frame":
      return `${t} FRAME ${e.card.padEnd(8)} [${e.zone}] pos=(${e.x},${e.y},${e.z}) flip=${e.flip} scale=${e.scale} lift=${e.lift}`;
  }
}

export const animLog = new AnimLog();

// Console access: window.__take6animlog.dump() / .entries / .clear()
if (typeof window !== "undefined") {
  (window as any).__take6animlog = animLog;
}
