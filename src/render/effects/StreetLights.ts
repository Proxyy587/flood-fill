import * as THREE from 'three';
import { BlockType, PowerState, type WorldSnapshot } from '../../contracts';
import { hash01, Y_SCALE } from '../units';

const POLE_H = 2 * Y_SCALE;
const LAMP_WARM = new THREE.Color(0xffc879);
const LAMP_GENERATOR = new THREE.Color(0xff9f43);
const LAMP_DARK = new THREE.Color(0x2a2e35);

/** Kerbside road cells (next to open ground or buildings), every fourth along the street; never on bridges. */
export const lampCells = (world: WorldSnapshot): number[] => {
  const { w, h, blocks } = world;
  const road = (x: number, z: number) => x >= 0 && z >= 0 && x < w && z < h && (blocks[z * w + x] === BlockType.Road || blocks[z * w + x] === BlockType.Bridge);
  const out: number[] = [];
  for (let c = 0; c < w * h; c++) {
    if (blocks[c] !== BlockType.Road) continue;
    const x = c % w;
    const z = Math.floor(c / w);
    const kerb = !road(x + 1, z) || !road(x - 1, z) || !road(x, z + 1) || !road(x, z - 1);
    const junction = +road(x + 1, z) + +road(x - 1, z) + +road(x, z + 1) + +road(x, z - 1) >= 3;
    if (kerb && !junction && (x + z) % 4 === 0) out.push(c);
  }
  return out;
};

const glowTexture = (): THREE.Texture => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/**
 * Street lamps that switch on after dusk where their cell has grid or
 * generator power. A blackout shows as a run of dark lamps and no light pools.
 */
export class StreetLights {
  readonly group = new THREE.Group();
  private cells: number[] = [];
  private poles: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private pools: THREE.InstancedMesh | null = null;
  private poleGeo = new THREE.BoxGeometry(0.03, POLE_H, 0.03).translate(0, POLE_H / 2, 0);
  private headGeo = new THREE.BoxGeometry(0.16, 0.06, 0.1);
  private poolGeo = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
  private poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  private headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private poolMat: THREE.MeshBasicMaterial;
  private powered: Uint8Array | null = null;
  private night = 0;
  private dirty = true;
  private color = new THREE.Color();

  constructor() {
    this.group.name = 'street-lights';
    this.poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
  }

  setWorld(world: WorldSnapshot, deck: Int16Array): void {
    this.clear();
    this.cells = lampCells(world);
    const n = Math.max(1, this.cells.length);
    this.poles = new THREE.InstancedMesh(this.poleGeo, this.poleMat, n);
    this.heads = new THREE.InstancedMesh(this.headGeo, this.headMat, n);
    this.pools = new THREE.InstancedMesh(this.poolGeo, this.poolMat, n);
    this.heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const m = new THREE.Matrix4();
    this.cells.forEach((c, i) => {
      const x = c % world.w;
      const z = Math.floor(c / world.w);
      const side = hash01(c) < 0.5 ? 0.08 : 0.92;
      const y = (deck[c] >= 0 ? deck[c] : world.ground[c]) * Y_SCALE;
      this.poles!.setMatrixAt(i, m.makeTranslation(x + side, y, z + 0.5));
      this.heads!.setMatrixAt(i, m.makeTranslation(x + side + (side < 0.5 ? 0.07 : -0.07), y + POLE_H, z + 0.5));
      this.pools!.setMatrixAt(i, m.makeTranslation(x + 0.5, y + 0.03, z + 0.5));
    });
    for (const mesh of [this.poles, this.heads, this.pools]) {
      mesh.count = this.cells.length;
      mesh.frustumCulled = false;
    }
    this.poles.castShadow = true;
    this.pools.renderOrder = 2;
    this.group.add(this.poles, this.heads, this.pools);
    this.dirty = true;
    this.apply();
  }

  setPower(powered: Uint8Array): void {
    this.powered = powered;
    this.dirty = true;
  }

  /** 0 = day, 1 = full night. Cheap when nothing changed. */
  update(night: number): void {
    if (Math.abs(night - this.night) > 0.02) {
      this.night = night;
      this.dirty = true;
    }
    if (this.dirty) this.apply();
  }

  private apply(): void {
    this.dirty = false;
    if (!this.heads?.instanceColor || !this.pools?.instanceColor) return;
    const on = Math.min(1, Math.max(0, (this.night - 0.25) / 0.45));
    this.cells.forEach((c, i) => {
      const state = this.powered ? this.powered[c] : PowerState.Grid;
      const lit = state === PowerState.Off ? 0 : on;
      const lamp = state === PowerState.Generator ? LAMP_GENERATOR : LAMP_WARM;
      // Lit heads go past 1.0 so the bloom pass gives them a halo.
      this.heads!.setColorAt(i, this.color.copy(LAMP_DARK).lerp(lamp, lit).multiplyScalar(1 + lit * 2.4));
      this.pools!.setColorAt(i, this.color.copy(lamp).multiplyScalar(lit * 0.55));
    });
    this.heads.instanceColor.needsUpdate = true;
    this.pools.instanceColor.needsUpdate = true;
    this.pools.visible = on > 0;
  }

  private clear(): void {
    for (const mesh of [this.poles, this.heads, this.pools]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.poles = this.heads = this.pools = null;
  }

  dispose(): void {
    this.clear();
    this.poleGeo.dispose();
    this.headGeo.dispose();
    this.poolGeo.dispose();
    this.poleMat.dispose();
    this.headMat.dispose();
    this.poolMat.map?.dispose();
    this.poolMat.dispose();
  }
}
