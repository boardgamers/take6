import * as THREE from "three";
import { CARD_H, CARD_W } from "./cards";
import { feltTexture, woodTexture } from "./textures";
import { getTheme, onThemeChange, Theme, tweenColor } from "./theme";
import { tween, Easing } from "./anim";

/**
 * World layout (in world units, 1 unit ≈ 1cm at a real table):
 *
 *   - Board rows: 4 rows × up to 6 columns of cards, centered.
 *   - Player hand: a fan below the board, on a raised step.
 *   - Opponent zones: face-down picks around the table.
 *   - Deck: bottom-right corner (visual only).
 */

export const ROW_SPACING_X = CARD_W + 0.9;
export const ROW_SPACING_Z = CARD_H + 1.6;
export const BOARD_COLS = 6;
export const BOARD_ROWS = 4;

export interface SlotPos {
  x: number;
  z: number;
  rotZ: number;
}

/** World position of a board slot. */
export function boardSlot(row: number, col: number): SlotPos {
  return {
    x: (col - (BOARD_COLS - 1) / 2) * ROW_SPACING_X,
    z: (row - (BOARD_ROWS - 1) / 2) * ROW_SPACING_Z,
    rotZ: 0
  };
}

/**
 * World position of the slot where a player's chosen card sits before reveal.
 * Arc ABOVE the board (far edge), fanned like a stadium: staying over the
 * board area would hide the rows (especially a long closest row).
 */
export function pickSlot(index: number, total: number): SlotPos {
  const maxX = 16; // stays over the felt, short of the table's side edges
  const t = total > 1 ? index / (total - 1) : 0.5;
  const x = (t - 0.5) * 2 * Math.min(maxX, total * 3.2);
  const arc = x / maxX;
  const rotZ = arc * 0.18;
  // Row 0's top edge sits at z = -20. A resting card's bottom corner reaches
  // z + (CARD_H/2)·cos(rotZ) + (CARD_W/2)·sin|rotZ| ≈ z + 4.9, and a mid-flip
  // card standing on edge reaches z + CARD_H/2 = z + 4.4. Keep the arced ends
  // at z ≤ -25.2 so neither ever overlaps row 0 — the bulge must stay shallow.
  const z = -27 + arc * arc * 1.0;
  return { x, z, rotZ };
}

/** Hand card slot. `count` is total cards in hand, `i` the index. */
export function handSlot(i: number, count: number): SlotPos {
  // Spread cards across most of the felt width so numbers stay readable,
  // without spilling past the table edge.
  const maxWidth = 46;
  const spacing = Math.min(CARD_W * 0.9, maxWidth / Math.max(count - 1, 1));
  const totalWidth = (count - 1) * spacing;
  const x = i * spacing - totalWidth / 2;
  const arc = Math.abs(x) / Math.max(totalWidth / 2, 1);
  return {
    x,
    z: HAND_Z + arc * arc * 2.0,
    rotZ: -(x / Math.max(totalWidth, 1)) * 0.28
  };
}

/**
 * Resting height of hand card `i`. Cards in the fan overlap slightly, so each
 * one rests a hair higher than its left neighbor — otherwise the overlapping
 * faces share a depth plane and z-fight. The offset is far above float16
 * depth noise at this camera distance but far below the card thickness, so
 * the fan still reads as a single flat row.
 */
export function handY(i: number): number {
  return HAND_LIFT_Y + i * 0.03;
}

export const HAND_Z = 27.5;
/** Base height of the player's hand fan above the table. */
export const HAND_LIFT_Y = 1.6;
export const BOARD_HALF_W = ((BOARD_COLS - 1) / 2) * ROW_SPACING_X + CARD_W / 2 + 2;
export const BOARD_HALF_H = ((BOARD_ROWS - 1) / 2) * ROW_SPACING_Z + CARD_H / 2 + 2;

function roundedRect(w: number, h: number, r: number): THREE.Shape {
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

export interface TableBounds {
  halfW: number;
  halfH: number;
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 1, 400);
  readonly raycaster = new THREE.Raycaster();

  private table!: THREE.Mesh;
  private tableMat!: THREE.MeshStandardMaterial;
  private rim!: THREE.Mesh;
  private rimMat!: THREE.MeshStandardMaterial;
  private ground!: THREE.Mesh;
  private groundMat!: THREE.MeshStandardMaterial;
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private fill!: THREE.DirectionalLight;
  private slotMeshes: THREE.Mesh[] = [];
  private slotMats: THREE.MeshStandardMaterial[] = [];
  private fog!: THREE.Fog;

  /** Area the camera frames (grows when players are present around the table). */
  contentHalfW = BOARD_HALF_W;
  contentHalfH = BOARD_HALF_H;
  /** Current camera fit (smoothed). */
  private fitW = BOARD_HALF_W;
  private fitH = BOARD_HALF_H;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.buildLights();
    this.buildTable();
    this.buildSlots();
    this.applyTheme(getTheme(), false);
    onThemeChange((theme) => this.applyTheme(theme, true));
    this.resize();
  }

  /* ----------------------------- construction ----------------------------- */

  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.8);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff5e0, 1.6);
    this.key.position.set(-18, 42, 20);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 10;
    this.key.shadow.camera.far = 120;
    const s = 40;
    this.key.shadow.camera.left = -s;
    this.key.shadow.camera.right = s;
    this.key.shadow.camera.top = s;
    this.key.shadow.camera.bottom = -s;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key);

    this.fill = new THREE.DirectionalLight(0xbfe3ff, 0.5);
    this.fill.position.set(26, 24, -18);
    this.scene.add(this.fill);
  }

  private buildTable() {
    const theme = getTheme();

    // Ground plane (catches soft shadows around the table)
    this.groundMat = new THREE.MeshStandardMaterial({ color: theme.background, roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -2.6;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Table: wooden body with a felt top. Built as flat extruded rounded
    // rectangles (no cylinder scaling, which distorted + z-fought).
    const tableW = BOARD_HALF_W * 2 + 16;
    const tableH = BOARD_HALF_H * 2 + 28; // extra room for the hand area
    const woodShape = roundedRect(tableW, tableH, 6);
    this.rimMat = new THREE.MeshStandardMaterial({
      map: woodTexture("#8d5a2b", "#5f3a17"),
      roughness: 0.7,
      metalness: 0.05
    });
    // ExtrudeGeometry builds in +z; rotateX(-90) maps +z -> +y (up), so the
    // shape plane becomes the top face at y=0 and the body extends downward.
    const rimGeo = new THREE.ExtrudeGeometry(woodShape, { depth: 2.2, bevelEnabled: false, curveSegments: 10 });
    rimGeo.rotateX(-Math.PI / 2); // now occupies y in [0, 2.2]
    rimGeo.translate(0, -2.6, 0); // top face at y = -0.4
    this.rim = new THREE.Mesh(rimGeo, this.rimMat);
    this.rim.receiveShadow = true;
    this.rim.castShadow = true;
    this.scene.add(this.rim);

    // Felt playing surface (slightly inset, top face at y = 0)
    this.tableMat = new THREE.MeshStandardMaterial({
      map: feltTexture("#2e7d4f", "#1d5232"),
      roughness: 0.95,
      metalness: 0
    });
    const feltShape = roundedRect(tableW - 8, tableH - 8, 3.5);
    const feltGeo = new THREE.ExtrudeGeometry(feltShape, { depth: 0.5, bevelEnabled: false, curveSegments: 10 });
    feltGeo.rotateX(-Math.PI / 2); // y in [0, 0.5]
    feltGeo.translate(0, -0.5, 0); // top face at y = 0
    this.table = new THREE.Mesh(feltGeo, this.tableMat);
    // Scale felt texture so the weave reads at a natural density
    const feltMap = this.tableMat.map!;
    feltMap.repeat.set(tableW / 34, tableH / 34);
    this.table.receiveShadow = true;
    this.scene.add(this.table);

    this.fog = new THREE.Fog(theme.background, 400, 900);
    this.scene.fog = this.fog;
  }

  private buildSlots() {
    // Board slot outlines: rounded card silhouettes slightly recessed into the felt
    const slotGeo = new THREE.PlaneGeometry(CARD_W + 0.7, CARD_H + 0.7, 1, 1);
    // Round the corners visually with an alpha-ish look: use low opacity tint
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.07,
          roughness: 1,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(slotGeo, mat);
        const pos = boardSlot(row, col);
        mesh.position.set(pos.x, 0.02, pos.z);
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.slotMeshes.push(mesh);
        this.slotMats.push(mat);
      }
    }
  }

  /* ------------------------------- theming -------------------------------- */

  private applyTheme(theme: Theme, animate: boolean) {
    const duration = animate ? 0.6 : 0;
    const bg = new THREE.Color(theme.background);
    const feltA = `#${new THREE.Color(theme.felt).getHexString()}`;
    const feltB = `#${new THREE.Color(theme.feltEmissive).getHexString()}`;
    this.tableMat.map = feltTexture(feltA, feltB);
    this.tableMat.needsUpdate = true;
    this.rimMat.map = woodTexture(
      `#${new THREE.Color(theme.wood).getHexString()}`,
      `#${new THREE.Color(theme.woodDark).getHexString()}`
    );
    this.rimMat.needsUpdate = true;

    if (duration === 0) {
      (this.scene.background as THREE.Color | null) = null;
      this.scene.background = bg;
      this.fog.color.copy(bg);
      this.groundMat.color.copy(bg);
      this.hemi.color.set(theme.ambientSky);
      this.hemi.groundColor.set(theme.ambientGround);
      this.hemi.intensity = theme.ambientIntensity;
      this.key.color.set(theme.keyLight);
      this.key.intensity = theme.keyIntensity;
      this.fill.color.set(theme.fillLight);
      this.fill.intensity = theme.fillIntensity;
    } else {
      const fromBg = (this.scene.background as THREE.Color)?.clone() ?? bg.clone();
      const fromGround = this.groundMat.color.clone();
      const fromSky = this.hemi.color.clone();
      const fromHemiGround = this.hemi.groundColor.clone();
      const fromKey = this.key.color.clone();
      const fromFill = this.fill.color.clone();
      const fromKeyI = this.key.intensity;
      const fromFillI = this.fill.intensity;
      const fromHemiI = this.hemi.intensity;
      tween({
        duration,
        easing: Easing.easeInOutQuad,
        onUpdate: (t) => {
          const b = fromBg.clone().lerp(bg, t);
          this.scene.background = b;
          this.fog.color.copy(b);
          this.groundMat.color.copy(fromGround.clone().lerp(bg, t));
          this.hemi.color.copy(fromSky.clone().lerp(new THREE.Color(theme.ambientSky), t));
          this.hemi.groundColor.copy(fromHemiGround.clone().lerp(new THREE.Color(theme.ambientGround), t));
          this.hemi.intensity = fromHemiI + (theme.ambientIntensity - fromHemiI) * t;
          this.key.color.copy(fromKey.clone().lerp(new THREE.Color(theme.keyLight), t));
          this.key.intensity = fromKeyI + (theme.keyIntensity - fromKeyI) * t;
          this.fill.color.copy(fromFill.clone().lerp(new THREE.Color(theme.fillLight), t));
          this.fill.intensity = fromFillI + (theme.fillIntensity - fromFillI) * t;
        }
      });
    }
  }

  /* ------------------------------- camera --------------------------------- */

  setContentBounds(halfW: number, halfH: number) {
    this.contentHalfW = halfW;
    this.contentHalfH = halfH;
  }

  /** Frame all content in view, works for any aspect ratio. */
  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  updateCamera(dt: number, portraitBias: number) {
    // Smoothly approach the content bounds
    const k = 1 - Math.exp(-dt * 2.5);
    this.fitW += (this.contentHalfW - this.fitW) * k;
    this.fitH += (this.contentHalfH - this.fitH) * k;

    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);

    // Tilt: fairly top-down so the felt fills the frame. In portrait we go a
    // bit more top-down (to keep the rows readable) but not flat.
    const tilt = THREE.MathUtils.lerp(0.82, 1.0, portraitBias); // radians from horizontal

    // Account for perspective foreshortening: the far edge of the content
    // recedes, so the effective on-screen height shrinks with a lower tilt.
    const projected = Math.sin(tilt);
    const distV = this.fitH / (Math.tan(vFov / 2) * projected);
    const distH = this.fitW / Math.tan(hFov / 2);
    const dist = Math.max(distV, distH) * 1.02;

    const y = Math.sin(tilt) * dist;
    const z = Math.cos(tilt) * dist;
    // Center the view between the board and the hand.
    const lookZ = THREE.MathUtils.lerp(2, 0, portraitBias);

    const targetPos = new THREE.Vector3(0, y, z + 3);
    this.camera.position.lerp(targetPos, 1 - Math.exp(-dt * 3));
    this.camera.lookAt(0, 0, lookZ);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Which board row (if any) is under the given table-plane point. */
  rowAtPoint(x: number, z: number): number | null {
    for (let row = 0; row < BOARD_ROWS; row++) {
      const center = boardSlot(row, 0);
      const halfH = ROW_SPACING_Z / 2;
      if (Math.abs(z - center.z) <= halfH && x >= -BOARD_HALF_W - 2 && x <= BOARD_HALF_W + 2) {
        return row;
      }
    }
    return null;
  }

  /** Convert screen (pointer) coordinates to the table plane (y = 0). */
  screenToTable(clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;
    const t = -ray.origin.y / ray.direction.y;
    out.copy(ray.origin).addScaledVector(ray.direction, t);
    return out;
  }

  /** Raycast against given objects, return first hit. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(objects, true);
    return hits[0] ?? null;
  }

  setSlotHighlight(row: number, col: number, mode: "none" | "ok" | "danger" | "hint") {
    const theme = getTheme();
    const mat = this.slotMats[row * BOARD_COLS + col];
    if (!mat) {
      return;
    }
    switch (mode) {
      case "ok":
        mat.color.set(theme.slotOk);
        mat.opacity = 0.4;
        break;
      case "danger":
        mat.color.set(theme.slotDanger);
        mat.opacity = 0.45;
        break;
      case "hint":
        mat.color.set(theme.slotHighlight);
        mat.opacity = 0.3;
        break;
      default:
        mat.color.set(theme.slot);
        mat.opacity = 0.07;
    }
  }

  clearSlotHighlights() {
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        this.setSlotHighlight(r, c, "none");
      }
    }
  }

  dispose() {
    // Per-scene geometries + materials. Card views dispose themselves
    // (GameController); the cached card geometry and card/edge textures are
    // intentionally shared across launches and stay alive.
    const disposeMesh = (mesh: THREE.Mesh) => {
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        // Shared / cached textures (felt, wood) are kept for the next launch.
        mat.dispose();
      }
    };
    disposeMesh(this.ground);
    disposeMesh(this.rim);
    disposeMesh(this.table);
    for (const mesh of this.slotMeshes) {
      disposeMesh(mesh);
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

export { tweenColor };
