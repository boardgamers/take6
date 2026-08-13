import * as THREE from "three";

/**
 * Procedural canvas textures for the environment (table felt, wood).
 * Cached per theme so a theme switch only regenerates once.
 */

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * alpha;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

const cache = new Map<string, THREE.CanvasTexture>();

export function feltTexture(base: string, dark: string): THREE.CanvasTexture {
  const key = `felt-${base}-${dark}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Flat base — the radial shading is done by the scene lighting instead of
  // being baked into a tiled texture (which produced a checkered look).
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Felt grain only
  noise(ctx, size, size, 0.05);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

export function woodTexture(base: string, grain: string): THREE.CanvasTexture {
  const key = `wood-${base}-${grain}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Wood grain: long wavy horizontal streaks
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h;
    const thickness = 0.6 + Math.random() * 2.4;
    const alpha = 0.04 + Math.random() * 0.1;
    ctx.strokeStyle = hexWithAlpha(grain, alpha);
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    for (let x = 0; x <= w + 10; x += 32) {
      ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 4 + (Math.random() - 0.5) * 2);
    }
    ctx.stroke();
  }

  // A few knots
  for (let i = 0; i < 5; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.strokeStyle = hexWithAlpha(grain, 0.25);
    for (let r = 2; r < 10; r += 2) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  noise(ctx, w, h, 0.05);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
}
