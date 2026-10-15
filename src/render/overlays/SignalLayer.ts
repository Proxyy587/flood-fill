import * as THREE from 'three';
import { isSignalJunction, PowerState, signalPhase, type WorldSnapshot } from '../../contracts';
import { SIGNAL_COLORS } from '../palette';
import { Y_SCALE } from '../units';

/**
 * Traffic signals at junctions, one head per direction of traffic, showing the
 * same green/amber/red phase the sim uses. They go dark when their cell loses power.
 */
export class SignalLayer {
  readonly group = new THREE.Group();
  private poles: THREE.InstancedMesh | null = null;
  private lamps: THREE.InstancedMesh | null = null;
  private cells: number[] = [];
  private w = 1;
  private powered: Uint8Array | null = null;
  private poleGeo = new THREE.BoxGeometry(0.05, 1.4 * Y_SCALE, 0.05).translate(0, 0.7 * Y_SCALE, 0);
  private lampGeo = new THREE.BoxGeometry(0.1, 0.16, 0.1);
  private poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private color = new THREE.Color();
  private lastTick = -1;

  constructor() {
    this.group.name = 'signals';
  }

  setWorld(world: WorldSnapshot): void {
    const { w, h, blocks, ground } = world;
    this.w = w;
    this.cells = [];
    for (let c = 0; c < w * h; c++) if (isSignalJunction(w, h, blocks, c)) this.cells.push(c);
    this.clear();
    const n = this.cells.length;
    const heads = Math.max(1, n * 2);
    this.poles = new THREE.InstancedMesh(this.poleGeo, this.poleMat, heads);
    this.lamps = new THREE.InstancedMesh(this.lampGeo, this.lampMat, heads);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(heads * 3), 3);
    const m = new THREE.Matrix4();
    this.cells.forEach((c, i) => {
      const x = c % w;
      const z = Math.floor(c / w);
      const y = ground[c] * Y_SCALE;
      // Head 2i faces east–west traffic, 2i+1 north–south, on opposite corners.
      const corners: [number, number][] = [
        [x + 0.9, z + 0.1],
        [x + 0.1, z + 0.9],
      ];
      corners.forEach(([px, pz], k) => {
        this.poles?.setMatrixAt(i * 2 + k, m.makeTranslation(px, y, pz));
        this.lamps?.setMatrixAt(i * 2 + k, m.makeTranslation(px, y + 1.4 * Y_SCALE + 0.08, pz));
      });
    });
    this.poles.count = n * 2;
    this.lamps.count = n * 2;
    this.poles.frustumCulled = false;
    this.lamps.frustumCulled = false;
    this.group.add(this.poles, this.lamps);
    this.lastTick = -1;
    this.recolor(0);
  }

  setPower(powered: Uint8Array): void {
    this.powered = powered;
    this.lastTick = -1;
  }

  /** Shows the phase for this sim tick; cheap when the tick has not changed. */
  update(tick: number): void {
    const t = Math.floor(tick);
    if (t === this.lastTick) return;
    this.lastTick = t;
    this.recolor(t);
  }

  private recolor(tick: number): void {
    if (!this.lamps?.instanceColor) return;
    this.cells.forEach((c, i) => {
      const off = this.powered ? this.powered[c] === PowerState.Off : false;
      const phase = signalPhase(tick, c, this.w);
      (['x', 'z'] as const).forEach((axis, k) => {
        const hex = off ? SIGNAL_COLORS.dark : phase.green !== axis ? SIGNAL_COLORS.red : phase.amber ? SIGNAL_COLORS.amber : SIGNAL_COLORS.green;
        this.lamps?.setColorAt(i * 2 + k, this.color.setHex(hex));
      });
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
