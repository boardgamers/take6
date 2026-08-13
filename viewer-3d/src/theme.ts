import * as THREE from "three";

/**
 * Palette used by the 3D scene. Two themes exist (light / dark); the active one
 * is derived from the `dark` class on the root <html> element (the viewer is
 * meant to be embedded, so we follow the host page). A manual override is kept
 * for the standalone page.
 */

export interface Theme {
  name: "light" | "dark";
  background: number;
  fog: number;
  felt: number;
  feltEmissive: number;
  wood: number;
  woodDark: number;
  brass: number;
  slot: number;
  slotHighlight: number;
  slotDanger: number;
  slotOk: number;
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
  keyLight: number;
  keyIntensity: number;
  fillLight: number;
  fillIntensity: number;
  shadowOpacity: number;
}

export const themes: Record<"light" | "dark", Theme> = {
  light: {
    name: "light",
    background: 0xcfd8dc,
    fog: 0xcfd8dc,
    felt: 0x2e7d4f,
    feltEmissive: 0x0a2e1b,
    wood: 0x8d5a2b,
    woodDark: 0x5f3a17,
    brass: 0xc9a227,
    slot: 0xffffff,
    slotHighlight: 0xffd54f,
    slotDanger: 0xef5350,
    slotOk: 0x69f0ae,
    ambientSky: 0xffffff,
    ambientGround: 0x8d6e63,
    ambientIntensity: 0.75,
    keyLight: 0xfff5e0,
    keyIntensity: 1.6,
    fillLight: 0xbfe3ff,
    fillIntensity: 0.5,
    shadowOpacity: 0.35
  },
  dark: {
    name: "dark",
    background: 0x10151d,
    fog: 0x10151d,
    felt: 0x14532d,
    feltEmissive: 0x03170c,
    wood: 0x4e3015,
    woodDark: 0x2c1a0a,
    brass: 0xd4af37,
    slot: 0x9aa5b1,
    slotHighlight: 0xffca28,
    slotDanger: 0xff5252,
    slotOk: 0x40c4ff,
    ambientSky: 0x8fa8c8,
    ambientGround: 0x1a120b,
    ambientIntensity: 0.65,
    keyLight: 0xffe0b3,
    keyIntensity: 1.25,
    fillLight: 0x5c7cfa,
    fillIntensity: 0.35,
    shadowOpacity: 0.55
  }
};

let current: Theme = document?.documentElement?.classList.contains("dark") ? themes.dark : themes.light;
let manualOverride: "light" | "dark" | null = null;

const listeners = new Set<(theme: Theme) => void>();

export function getTheme(): Theme {
  return current;
}

export function onThemeChange(cb: (theme: Theme) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function apply(theme: Theme) {
  if (theme.name === current.name) {
    return;
  }
  current = theme;
  for (const cb of listeners) {
    cb(theme);
  }
}

export function setThemeOverride(mode: "light" | "dark" | null) {
  manualOverride = mode;
  apply(resolveTheme());
}

export function toggleThemeOverride() {
  setThemeOverride(current.name === "dark" ? "light" : "dark");
}

function resolveTheme(): Theme {
  if (manualOverride) {
    return themes[manualOverride];
  }
  return document.documentElement.classList.contains("dark") ? themes.dark : themes.light;
}

// Follow the host page theme: watch the `dark` class on <html>.
if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  const observer = new MutationObserver(() => {
    if (!manualOverride) {
      apply(resolveTheme());
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  // In case the page already started in dark mode.
  current = resolveTheme();
}

/** Lerp a material color toward a target, used for smooth theme transitions. */
export function tweenColor(color: THREE.Color, target: number, t: number) {
  color.lerp(new THREE.Color(target), t);
}
