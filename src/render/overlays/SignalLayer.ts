import * as THREE from 'three';
import { BlockType, PowerState, type WorldSnapshot } from '../../contracts';
import { SIGNAL_COLORS } from '../palette';
import { Y_SCALE } from '../units';

/** Traffic signals at road intersections. They go dark when their cell loses power. */
export class SignalLayer {
  readonly group = new THREE.Group();
  private poles: THREE.InstancedMesh | null = null;
  private lamps: THREE.InstancedMesh | null = null;
  private cells: number[] = [];
  private powered: Uint8Array | null = null;
  private poleGeo = new THREE.BoxGeometry(0.05, 1.4 * Y_SCALE, 0.05).translate(0, 0.7 * Y_SCALE, 0);
  private lampGeo = new THREE.BoxGeometry(0.1, 0.16, 0.1);
  private poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private color = new THREE.Color();

  constructor() {
    this.group.name = 'signals';
  }

  setWorld(world: WorldSnapshot): void {
    const { w, h, blocks, ground } = world;
    const road = (x: number, z: number) =>
      x >= 0 && z >= 0 && x < w && z < h && (blocks[z * w + x] === BlockType.Road || blocks[z * w + x] === BlockType.Bridge);
    this.cells = [];
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        if (blocks[z * w + x] !== BlockType.Road) continue;
        const k = +road(x + 1, z) + +road(x - 1, z) + +road(x, z + 1) + +road(x, z - 1);
        if (k >= 3) this.cells.push(z * w + x);
      }
    }
    this.clear();
    const n = this.cells.length;
    this.poles = new THREE.InstancedMesh(this.poleGeo, this.poleMat, Math.max(1, n));
    this.lamps = new THREE.InstancedMesh(this.lampGeo, this.lampMat, Math.max(1, n));
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
    const m = new THREE.Matrix4();
    this.cells.forEach((c, i) => {
      const x = (c % w) + 0.88;
      const z = Math.floor(c / w) + 0.88;
      const y = ground[c] * Y_SCALE;
      this.poles?.setMatrixAt(i, m.makeTranslation(x, y, z));
      this.lamps?.setMatrixAt(i, m.makeTranslation(x, y + 1.4 * Y_SCALE + 0.08, z));
    });
    this.poles.count = n;
    this.lamps.count = n;
    this.poles.frustumCulled = false;
    this.lamps.frustumCulled = false;
    this.group.add(this.poles, this.lamps);
    this.recolor(0);
  }

  setPower(powered: Uint8Array): void {
    this.powered = powered;
  }

  /** Cycles green/amber on powered signals; called every frame. */
  update(now: number): void {
    this.recolor(now);
  }

  private recolor(now: number): void {
    if (!this.lamps?.instanceColor) return;
    const phase = Math.floor(now / 2500);
    this.cells.forEach((c, i) => {
      const off = this.powered ? this.powered[c] === PowerState.Off : false;
      const hex = off ? SIGNAL_COLORS.dark : (phase + c) % 2 === 0 ? SIGNAL_COLORS.green : SIGNAL_COLORS.amber;
      this.lamps?.setColorAt(i, this.color.setHex(hex));
    });
    this.lamps.instanceColor.needsUpdate = true;
  }

  private clear(): void {
    if (this.poles) {
      this.group.remove(this.poles);
      this.poles.dispose();
    }
    if (this.lamps) {
      this.group.remove(this.lamps);
      this.lamps.dispose();
    }
  }

  dispose(): void {
    this.clear();
    this.poleGeo.dispose();
    this.lampGeo.dispose();
    this.poleMat.dispose();
    this.lampMat.dispose();
  }
}
