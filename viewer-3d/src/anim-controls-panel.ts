import { animLog } from "./anim-log";
import {
  isRecording,
  playback,
  startRecording,
  stepOnce,
  stopRecording,
  togglePlayback
} from "./anim-controls";

/**
 * Floating dev panel for the animation system: record the anim log, pause the
 * tween timeline, step it frame-by-frame, and export the captured log.
 *
 * Dev-harness only — mounted explicitly (not part of the platform bundle UI).
 * Rendered as a plain DOM overlay with its own injected CSS so it needs no
 * framework and disappears cleanly via the returned disposer.
 */

const CSS = `
.t6-animctl {
  position: absolute; left: 10px; bottom: 10px; z-index: 30;
  font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  background: rgba(18,22,30,0.88); color: #e8eef5;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 10px;
  padding: 8px; backdrop-filter: blur(8px);
  box-shadow: 0 4px 18px rgba(0,0,0,0.35);
  user-select: none;
}
.t6-animctl .t6ac-title {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: #8fa0b3; margin-bottom: 6px; cursor: pointer;
}
.t6-animctl .t6ac-dot { width: 8px; height: 8px; border-radius: 50%; background: #5b6b7b; flex: none; }
.t6-animctl.rec .t6ac-dot { background: #f87171; box-shadow: 0 0 6px #f87171; animation: t6ac-blink 1.1s infinite; }
@keyframes t6ac-blink { 50% { opacity: 0.35; } }
.t6-animctl .t6ac-row { display: flex; gap: 5px; flex-wrap: wrap; }
.t6-animctl button {
  font: inherit; font-size: 11px; font-weight: 600; line-height: 1;
  background: rgba(255,255,255,0.08); color: #e8eef5;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
  padding: 6px 8px; cursor: pointer; white-space: nowrap;
}
.t6-animctl button:hover { background: rgba(255,255,255,0.16); }
.t6-animctl button.on { background: #b3541e; border-color: #b3541e; color: #fff; }
.t6-animctl button:disabled { opacity: 0.4; cursor: default; }
.t6-animctl .t6ac-status { font-size: 10px; color: #8fa0b3; margin-top: 6px; min-height: 12px; font-variant-numeric: tabular-nums; }
.t6-animctl.min .t6ac-body { display: none; }
`;

export function mountAnimControls(container: HTMLElement): () => void {
  const style = document.createElement("style");
  style.textContent = CSS;
  container.appendChild(style);

  const root = document.createElement("div");
  root.className = "t6-animctl";
  root.innerHTML = `
    <div class="t6ac-title"><span class="t6ac-dot"></span><span>Anim</span><span class="t6ac-collapse">–</span></div>
    <div class="t6ac-body">
      <div class="t6ac-row">
        <button data-act="rec" title="Start/stop recording the animation log">⏺ Record</button>
        <button data-act="pause" title="Pause / resume the animation timeline">⏸ Pause</button>
        <button data-act="step" title="Advance one step while paused">⏭ Step</button>
      </div>
      <div class="t6ac-row" style="margin-top:5px">
        <button data-act="copy" title="Copy the recorded log to the clipboard">⧉ Copy</button>
        <button data-act="dl" title="Download the recorded log">⬇ Save</button>
        <button data-act="clear" title="Clear the recorded log">✕ Clear</button>
      </div>
      <div class="t6ac-status"></div>
    </div>`;
  container.appendChild(root);

  const status = root.querySelector<HTMLElement>(".t6ac-status")!;
  const recBtn = root.querySelector<HTMLButtonElement>('[data-act="rec"]')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-act="pause"]')!;
  const stepBtn = root.querySelector<HTMLButtonElement>('[data-act="step"]')!;

  let statusTimer: number | null = null;
  const flash = (msg: string) => {
    status.textContent = msg;
    if (statusTimer !== null) {
      window.clearTimeout(statusTimer);
    }
    statusTimer = window.setTimeout(() => refresh(), 2500);
  };

  function refresh() {
    const rec = isRecording();
    root.classList.toggle("rec", rec);
    recBtn.classList.toggle("on", rec);
    recBtn.textContent = rec ? "⏹ Stop" : "⏺ Record";
    pauseBtn.classList.toggle("on", playback.paused);
    pauseBtn.textContent = playback.paused ? "▶ Play" : "⏸ Pause";
    stepBtn.disabled = !playback.paused;
    const n = animLog.ordered().length;
    status.textContent = `${rec ? "rec" : "idle"} · ${playback.paused ? "paused" : "live"} · ${n} entries`;
  }

  root.querySelector(".t6ac-title")!.addEventListener("click", () => root.classList.toggle("min"));

  const onClick = (act: string) => {
    switch (act) {
      case "rec":
        if (isRecording()) {
          stopRecording();
        } else {
          startRecording();
        }
        break;
      case "pause":
        togglePlayback();
        break;
      case "step":
        stepOnce();
        break;
      case "copy":
        void animLog.copy().then(flash);
        break;
      case "dl":
        animLog.download();
        flash("downloaded");
        break;
      case "clear":
        animLog.clear();
        flash("cleared");
        break;
    }
    refresh();
  };

  const onClickHandler = (e: Event) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (btn) {
      onClick(btn.dataset.act!);
    }
  };
  root.addEventListener("click", onClickHandler);

  // Keyboard shortcuts: R = record, Space = pause/play, S = step (when not typing).
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      togglePlayback();
      refresh();
    } else if (e.key === "r" || e.key === "R") {
      onClick("rec");
    } else if (e.key === "s" || e.key === "S") {
      stepOnce();
      refresh();
    }
  };
  window.addEventListener("keydown", onKey);

  refresh();

  return () => {
    window.removeEventListener("keydown", onKey);
    if (statusTimer !== null) {
      window.clearTimeout(statusTimer);
    }
    root.remove();
    style.remove();
  };
}
