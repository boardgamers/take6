import { animLog } from "./anim-log";

/**
 * Dev-harness animation playback controls: pause / step / record the tween
 * timeline. Driven from the render loop via `advance(dt)`, which decides how
 * much animation time actually elapses this frame.
 *
 * Everything is no-op-ish in production: the panel is only mounted by the dev
 * harness (see `mountAnimControls`), but the controller itself is harmless if
 * left enabled — paused=false and a zero step budget means `advance` returns
 * its input unchanged.
 */

export type AnimPlayback = {
  /** When true, the timeline is frozen (advance returns 0 unless stepping). */
  paused: boolean;
  /** Fixed dt consumed one frame at a time by the "step" button. */
  stepBudget: number;
  /** Fixed dt applied per step (seconds). */
  stepSize: number;
};

export const playback: AnimPlayback = {
  paused: false,
  stepBudget: 0,
  stepSize: 1 / 30
};

/**
 * How much animation time should elapse this frame. Called once per rAF by the
 * render loop. When paused, returns 0 unless a step was requested, in which
 * case it returns the fixed step size and consumes the budget.
 */
export function advance(dt: number): number {
  if (!playback.paused) {
    return dt;
  }
  if (playback.stepBudget > 0) {
    playback.stepBudget--;
    return playback.stepSize;
  }
  return 0;
}

export function pausePlayback() {
  playback.paused = true;
}

export function resumePlayback() {
  playback.paused = false;
  playback.stepBudget = 0;
}

export function togglePlayback(): boolean {
  if (playback.paused) {
    resumePlayback();
  } else {
    pausePlayback();
  }
  return playback.paused;
}

/** Advance exactly one step while paused (pauses first if not already). */
export function stepOnce() {
  playback.paused = true;
  playback.stepBudget++;
}

/* ------------------------- recording (anim log) ------------------------- */

export function isRecording(): boolean {
  return animLog.enabled;
}

export function startRecording(clear = true) {
  if (clear) {
    animLog.clear();
  }
  animLog.enabled = true;
}

export function stopRecording() {
  animLog.enabled = false;
}

export function toggleRecording(): boolean {
  if (animLog.enabled) {
    stopRecording();
  } else {
    startRecording();
  }
  return animLog.enabled;
}

// Console access: __take6anim.pause() / .play() / .step() / .record() / .stop()
if (typeof window !== "undefined") {
  (window as any).__take6anim = {
    playback,
    pause: pausePlayback,
    play: resumePlayback,
    toggle: togglePlayback,
    step: stepOnce,
    record: startRecording,
    stop: stopRecording,
    recording: isRecording,
    log: animLog
  };
}
