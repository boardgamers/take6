/**
 * A tiny but powerful timeline-based animation system.
 *
 * Tweens are driven by wall-clock time so multiple tweens compose
 * deterministically into timelines (chainable via `.then()`).
 */

export const Easing = {
  linear: (t: number) => t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInQuad: (t: number) => t * t,
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInCubic: (t: number) => t * t * t,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounceOut: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    }
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

export type EasingFn = (t: number) => number;

export interface TweenOptions {
  duration?: number;
  delay?: number;
  easing?: EasingFn;
  /** Called every frame with eased progress in [0, 1]. */
  onUpdate?: (t: number) => void;
  /** Called once when the tween completes. */
  onComplete?: () => void;
  /** Optional tag so groups of tweens can be cancelled at once. */
  tag?: string;
}

interface ActiveTween extends Required<Pick<TweenOptions, "duration" | "delay" | "easing">> {
  onUpdate?: (t: number) => void;
  onComplete?: () => void;
  tag?: string;
  start: number;
  done: boolean;
}

const activeTweens: ActiveTween[] = [];
let time = 0;

export function tween(options: TweenOptions): ActiveTween {
  const tw: ActiveTween = {
    duration: options.duration ?? 0.5,
    delay: options.delay ?? 0,
    easing: options.easing ?? Easing.easeInOutCubic,
    onUpdate: options.onUpdate,
    onComplete: options.onComplete,
    tag: options.tag,
    start: time + (options.delay ?? 0),
    done: false
  };
  activeTweens.push(tw);
  return tw;
}

/** Returns a promise that resolves when the tween finishes. */
export function tweenAsync(options: TweenOptions): Promise<void> {
  return new Promise((resolve) => {
    tween({
      ...options,
      onComplete: () => {
        options.onComplete?.();
        resolve();
      }
    });
  });
}

export function delay(seconds: number): Promise<void> {
  return tweenAsync({ duration: 0.0001, delay: seconds });
}

/** Cancel all tweens with the given tag. */
export function cancelTweens(tag: string) {
  for (const tw of activeTweens) {
    if (tw.tag === tag) {
      tw.done = true;
    }
  }
}

/** Immediately finish all tweens with the given tag (runs their final state). */
export function flushTweens(tag: string) {
  for (const tw of activeTweens) {
    if (tw.tag === tag && !tw.done) {
      tw.onUpdate?.(1);
      tw.onComplete?.();
      tw.done = true;
    }
  }
}

/** Advance all tweens. Call once per frame with the delta in seconds. */
export function updateTweens(dt: number) {
  time += dt;
  for (let i = activeTweens.length - 1; i >= 0; i--) {
    const tw = activeTweens[i];
    if (tw.done) {
      activeTweens.splice(i, 1);
      continue;
    }
    const raw = (time - tw.start) / tw.duration;
    if (raw < 0) {
      continue;
    }
    const t = Math.min(raw, 1);
    tw.onUpdate?.(tw.easing(t));
    if (t >= 1) {
      tw.done = true;
      tw.onComplete?.();
      activeTweens.splice(i, 1);
    }
  }
}

export function clearAllTweens() {
  activeTweens.length = 0;
}

/** Simple spring integration for pointer-driven drag (critically damped-ish). */
export class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  constructor(
    public stiffness = 260,
    public damping = 22
  ) {}

  update(dt: number) {
    const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
  }

  snap(v: number) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }

  get settled() {
    return Math.abs(this.value - this.target) < 0.001 && Math.abs(this.velocity) < 0.001;
  }
}
