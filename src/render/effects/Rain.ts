import * as THREE from 'three';

const DROPS = 6000;
const BOX = { x: 70, y: 40, z: 70 };

/** Cosmetic rain streaks around the camera target. Never feeds back into the sim. */
export class Rain {
  readonly lines: THREE.LineSegments;
  private positions = new Float32Array(DROPS * 6);
  private seeds = new Float32Array(DROPS * 3);
  private material = new THREE.LineBasicMaterial({ color: 0xc8d8e8, transparent: true, opacity: 0.45, depthWrite: false });
  private fall = 0;

  constructor() {
    // Cosmetic only, so a cheap LCG is fine here.
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < DROPS; i++) {
      this.seeds[i * 3] = rnd();
      this.seeds[i * 3 + 1] = rnd();
      this.seeds[i * 3 + 2] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 9;
    this.lines.name = 'rain';
  }

  update(dt: number, centre: THREE.Vector3, intensity: number, wind: number, enabled: boolean): void {
    const n = enabled ? Math.floor(DROPS * Math.min(1, intensity)) : 0;
    this.lines.visible = n > 0;
    if (!n) return;
    this.fall = (this.fall + dt * 1.6) % 1;
    const slant = 0.6 + wind * 2.2;
    const len = 0.9;
    const p = this.positions;
    for (let i = 0; i < n; i++) {
      const fy = (this.seeds[i * 3 + 1] - this.fall + 1) % 1;
      const x = centre.x + (this.seeds[i * 3] - 0.5) * BOX.x;
      const z = centre.z + (this.seeds[i * 3 + 2] - 0.5) * BOX.z;
      const y = centre.y + fy * BOX.y - 4;
      p[i * 6] = x;
      p[i * 6 + 1] = y;
      p[i * 6 + 2] = z;
      p[i * 6 + 3] = x - slant * 0.25;
      p[i * 6 + 4] = y - len;
      p[i * 6 + 5] = z - slant * 0.1;
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, n * 2);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.material.opacity = 0.25 + 0.35 * intensity;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
