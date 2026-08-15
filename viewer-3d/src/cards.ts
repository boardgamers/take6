import * as THREE from "three";
import type { Card } from "take6-engine";
import { animLog } from "./anim-log";
import { getTheme, onThemeChange } from "./theme";

/**
 * Cards are physical objects: a rounded-rect box with a canvas-painted face
 * texture. Face textures are cached per card number and regenerated when the
 * theme changes (edge shading differs slightly between light/dark).
 */

export const CARD_W = 6.3;
export const CARD_H = 8.8;
export const CARD_T = 0.22;
const FACE_RES = 256;

const geometryCache = new Map<string, THREE.BufferGeometry>();

/** Rounded-rect shape path reused for geometry + UV mapping. */
function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function cardGeometry(): THREE.BufferGeometry {
  const key = "card";
  if (!geometryCache.has(key)) {
    const shape = roundedRectShape(CARD_W, CARD_H, 0.55);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: CARD_T,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.045,
      bevelSegments: 2,
      curveSegments: 6
    });
    geo.translate(0, 0, -CARD_T / 2);
    // UVs from XY so the front face texture maps cleanly
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const size = new THREE.Vector3().subVectors(bb.max, bb.min);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (pos.getX(i) - bb.min.x) / size.x, (pos.getY(i) - bb.min.y) / size.y);
    }
    // ExtrudeGeometry lumps both caps into material group 0 (front AND back),
    // so the back cap would show the face texture and z-fight the back plane.
    // Split group 0 by triangle depth: front cap (z>0) keeps material 0, back
    // cap (z<0) becomes material 2 (the card back). Group 1 (side walls) is
    // untouched.
    const caps = geo.groups[0];
    const frontTris: number[] = [];
    const backTris: number[] = [];
    for (let i = caps.start; i < caps.start + caps.count; i += 3) {
      const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      (z > 0 ? frontTris : backTris).push(i, i + 1, i + 2);
    }
    const index = geo.getIndex();
    const reorder = (tris: number[]) => (index ? tris.map((v) => index.getX(v)) : tris);
    const frontIdx = reorder(frontTris);
    const backIdx = reorder(backTris);
    const sideIdx: number[] = [];
    const side = geo.groups[1];
    for (let i = side.start; i < side.start + side.count; i++) {
      sideIdx.push(index ? index.getX(i) : i);
    }
    geo.setIndex([...frontIdx, ...backIdx, ...sideIdx]);
    geo.clearGroups();
    geo.addGroup(0, frontIdx.length, 0); // front cap -> face texture
    geo.addGroup(frontIdx.length, backIdx.length, 2); // back cap -> card back
    geo.addGroup(frontIdx.length + backIdx.length, sideIdx.length, 1); // walls -> edge
    geo.computeVertexNormals();
    geometryCache.set(key, geo);
  }
  return geometryCache.get(key)!;
}

/* ------------------------------------------------------------------ */
/* Texture painting                                                    */
/* ------------------------------------------------------------------ */

/** Points -> face tint. */
function faceColors(points: number, dark: boolean): { top: string; bottom: string; accent: string } {
  switch (points) {
    case 7:
      return dark
        ? { top: "#3d2463", bottom: "#241343", accent: "#b39ddb" }
        : { top: "#f3e8ff", bottom: "#d9c2f5", accent: "#7e57c2" };
    case 5:
      return dark
        ? { top: "#5c1f28", bottom: "#3a1017", accent: "#ef9a9a" }
        : { top: "#ffebee", bottom: "#ffcdd2", accent: "#e53935" };
    case 3:
      return dark
        ? { top: "#0d3a5c", bottom: "#082238", accent: "#90caf9" }
        : { top: "#e3f2fd", bottom: "#bbdefb", accent: "#1e88e5" };
    case 2:
      return dark
        ? { top: "#4d420f", bottom: "#2e290a", accent: "#fff59d" }
        : { top: "#fffde7", bottom: "#fff9c4", accent: "#f9a825" };
    default:
      return dark
        ? { top: "#2b3138", bottom: "#1b1f24", accent: "#b0bec5" }
        : { top: "#ffffff", bottom: "#eceff1", accent: "#546e7a" };
  }
}

function drawPointPip(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  // Simple filled ring pip — original artwork, no trademarked bull head
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBullPoints(ctx: CanvasRenderingContext2D, points: number, w: number, h: number, color: string) {
  // Row of small pips in the top-right diagonal
  const positions: [number, number][] = [];
  if (points === 1) {
    positions.push([0.82, 0.12]);
  } else if (points === 2) {
    positions.push([0.74, 0.1], [0.88, 0.18]);
  } else if (points === 3) {
    positions.push([0.7, 0.08], [0.82, 0.14], [0.92, 0.22]);
  } else if (points === 5) {
    positions.push([0.66, 0.07], [0.76, 0.11], [0.86, 0.16], [0.94, 0.22], [0.7, 0.2]);
  } else if (points === 7) {
    positions.push([0.62, 0.06], [0.72, 0.1], [0.81, 0.14], [0.9, 0.19], [0.65, 0.17], [0.75, 0.21], [0.87, 0.26]);
  }
  const pipRadius = w * 0.055;
  for (const [fx, fy] of positions) {
    drawPointPip(ctx, fx * w, fy * h, pipRadius, color);
  }
}

const textureCache = new Map<string, THREE.CanvasTexture>();

/** Textures kept across theme changes (per card number + back, per theme). */
const persistentTextures = new Set<THREE.Texture>();
let texturePrimedTheme: string | null = null;

/** Cache-backed textures are safe to hold onto; anything else can be disposed. */
function isCachedTexture(texture: THREE.Texture): boolean {
  return persistentTextures.has(texture);
}

/**
 * Pre-generate (and cache) every face texture + the back texture for the
 * current theme, so hidden cards materialize without a hitch and theme
 * switches never rebuild textures per-view. Points mirror the engine's
 * card rules (55 -> 7, doubles -> 5, multiples of 10 -> 3, of 5 -> 2).
 */
function primeTextureCache() {
  const theme = getTheme();
  if (texturePrimedTheme === theme.name) {
    return;
  }
  texturePrimedTheme = theme.name;
  persistentTextures.add(cardBackTexture());
  // Include the hidden-card face (number 0): every face-down placeholder
  // shares it via the cache, so it must never be disposed by setCard/dispose.
  for (let number = 0; number <= 104; number++) {
    persistentTextures.add(cardFaceTexture({ number, points: number === 0 ? 0 : cardPoints(number) }));
  }
}

function cardPoints(number: number): number {
  if (number === 55) {
    return 7;
  }
  if (number % 11 === 0) {
    return 5;
  }
  if (number % 10 === 0) {
    return 3;
  }
  if (number % 5 === 0) {
    return 2;
  }
  return 1;
}

export function cardFaceTexture(card: Card): THREE.CanvasTexture {
  const theme = getTheme();
  const key = `face-${theme.name}-${card.number}`;
  if (textureCache.has(key)) {
    return textureCache.get(key)!;
  }

  const w = FACE_RES;
  const h = Math.round((FACE_RES * CARD_H) / CARD_W);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const dark = theme.name === "dark";
  const colors = faceColors(card.points, dark);

  // Background with a soft vertical gradient + radial glow
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, colors.top);
  grad.addColorStop(1, colors.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h * 0.4, w * 0.7);
  glow.addColorStop(0, dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Inner border
  const inset = w * 0.045;
  ctx.strokeStyle = colors.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = w * 0.012;
  roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, w * 0.06);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Big number, center
  ctx.fillStyle = colors.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${w * 0.42}px "Arial Black", Arial, sans-serif`;
  ctx.fillText(String(card.number), w / 2, h * 0.52);

  // Small number, top-left corner
  ctx.font = `700 ${w * 0.15}px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(String(card.number), w * 0.08, h * 0.1);

  // Point pips
  drawBullPoints(ctx, card.points, w, h, colors.accent);

  // Big faded "6" watermark behind the number — no trademarked artwork
  ctx.globalAlpha = dark ? 0.1 : 0.08;
  ctx.fillStyle = colors.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${w * 0.85}px "Arial Black", Arial, sans-serif`;
  ctx.fillText("6", w / 2, h * 0.54);
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  textureCache.set(key, texture);
  return texture;
}

export function cardBackTexture(): THREE.CanvasTexture {
  const theme = getTheme();
  const key = `back-${theme.name}`;
  if (textureCache.has(key)) {
    return textureCache.get(key)!;
  }
  const w = FACE_RES;
  const h = Math.round((FACE_RES * CARD_H) / CARD_W);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const dark = theme.name === "dark";

  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (dark) {
    grad.addColorStop(0, "#7f1d1d");
    grad.addColorStop(1, "#450a0a");
  } else {
    grad.addColorStop(0, "#b71c1c");
    grad.addColorStop(1, "#7f1010");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Diagonal weave pattern
  ctx.strokeStyle = dark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.12)";
  ctx.lineWidth = 3;
  for (let i = -h; i < w + h; i += 22) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + h, 0);
    ctx.lineTo(i, h);
    ctx.stroke();
  }

  // Rosette
  ctx.strokeStyle = "rgba(255,235,200,0.85)";
  ctx.lineWidth = w * 0.012;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.34, 0, Math.PI * 2);
  ctx.stroke();

  // Neutral "6" emblem — avoids the trademarked bull-head logo
  ctx.fillStyle = "rgba(255,235,200,0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${w * 0.38}px "Arial Black", Arial, sans-serif`;
  ctx.fillText("6", w / 2, h / 2 + w * 0.02);

  const inset = w * 0.05;
  ctx.strokeStyle = "rgba(255,235,200,0.6)";
  ctx.lineWidth = w * 0.01;
  roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, w * 0.05);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  textureCache.set(key, texture);
  return texture;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Side/edge material, shared by all cards. */
let edgeMaterial: THREE.MeshStandardMaterial | null = null;
export function cardEdgeMaterial(): THREE.MeshStandardMaterial {
  if (!edgeMaterial) {
    edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.85, metalness: 0 });
    onThemeChange((theme) => {
      edgeMaterial!.color.set(theme.name === "dark" ? 0x8a8578 : 0xf5f0e6);
    });
  }
  return edgeMaterial;
}

/* ------------------------------------------------------------------ */
/* CardView: a physical card in the scene                              */
/* ------------------------------------------------------------------ */

export type CardAnim = {
  x: number;
  y: number;
  z: number;
  /** Rotation around Z (fan tilt), radians. */
  rotZ: number;
  /** 0 = face up, PI = face down. */
  flip: number;
  scale: number;
};

export class CardView {
  readonly group = new THREE.Group();
  readonly number: number;
  points: number;
  anim: CardAnim = { x: 0, y: 0, z: 0, rotZ: 0, flip: Math.PI, scale: 1 };
  /** Extra lift applied by interactions (hover / drag), world units. */
  lift = 0;
  /** Higher = rendered on top when overlapping. */
  zIndex = 0;

  private front: THREE.Mesh;
  private frontMaterial: THREE.MeshStandardMaterial;
  private backMaterial: THREE.MeshStandardMaterial;

  constructor(public card: Card) {
    this.number = card.number;
    this.points = card.points;
    // Make sure the texture set for the active theme is generated & cached,
    // so revealed hidden cards never need a synchronous texture build.
    primeTextureCache();
    this.frontMaterial = new THREE.MeshStandardMaterial({
      map: cardFaceTexture(card),
      roughness: 0.55,
      metalness: 0.02
    });
    this.backMaterial = new THREE.MeshStandardMaterial({
      map: cardBackTexture(),
      roughness: 0.6,
      metalness: 0.02
    });
    // One extruded body; the geometry's three material groups map front cap →
    // face texture, side walls → card stock, back cap → card back. No separate
    // back plane, so nothing z-fights mid-flip.
    this.front = new THREE.Mesh(cardGeometry(), [this.frontMaterial, cardEdgeMaterial(), this.backMaterial]);
    this.front.castShadow = true;
    this.group.add(this.front);
    this.applyAnim();

    // Debug tap: record who flips a card by a large amount in one assignment
    // (an instant snap, not a tween step) — with the call stack. Tween steps
    // move flip in small increments and never trigger this.
    if (animLog.enabled) {
      let flip = this.anim.flip;
      const view = this;
      Object.defineProperty(this.anim, "flip", {
        get: () => flip,
        set(v: number) {
          if (Math.abs(v - flip) > 0.5) {
            animLog.snap(`card#${view.card.number}`, "flip", flip, v);
          }
          flip = v;
        }
      });
    }
  }

  /** Swap the face texture (used when a hidden card is revealed, number 0 -> real). */
  setCard(card: Card) {
    this.card = card;
    this.points = card.points;
    this.swapMap(this.frontMaterial, cardFaceTexture(card));
  }

  refreshFace() {
    this.swapMap(this.frontMaterial, cardFaceTexture(this.card));
  }

  refreshBack() {
    this.swapMap(this.backMaterial, cardBackTexture());
  }

  /** Replace a material's texture, disposing the old per-view texture (shared cache entries are kept). */
  private swapMap(material: THREE.MeshStandardMaterial, texture: THREE.Texture) {
    const old = material.map;
    material.map = texture;
    material.needsUpdate = true;
    if (old && old !== texture && !isCachedTexture(old)) {
      old.dispose();
    }
  }

  /** Release per-view GPU resources (textures, materials). */
  dispose() {
    this.disposeMap(this.frontMaterial);
    this.disposeMap(this.backMaterial);
    this.frontMaterial.dispose();
    this.backMaterial.dispose();
  }

  private disposeMap(material: THREE.MeshStandardMaterial) {
    const map = material.map;
    if (map && !isCachedTexture(map)) {
      map.dispose();
    }
    material.map = null;
  }

  get faceUp() {
    return this.anim.flip < Math.PI / 2;
  }

  applyAnim() {
    const a = this.anim;
    this.group.position.set(a.x, a.y + this.lift, a.z);
    // Lying flat on the table: -PI/2 around X; flip adds PI for face-down.
    this.group.rotation.set(-Math.PI / 2 + a.flip, 0, a.rotZ);
    this.group.scale.setScalar(a.scale);
    this.group.renderOrder = this.zIndex;
  }
}

/**
 * Rebuild textures when the theme switches. The whole texture set is cached
 * per theme (see primeTextureCache), so this just swaps in the cached maps.
 */
export function refreshCardTextures(cards: Iterable<CardView>) {
  primeTextureCache();
  for (const card of cards) {
    card.refreshFace();
    card.refreshBack();
  }
}
