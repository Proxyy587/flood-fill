import * as THREE from 'three';
import { ReportStatus, type RenderSnapshot } from '../../contracts';
import { REPORT_COLORS } from '../palette';

const MAX_RADIUS = 4;
const SAMPLES = 12;

/**
 * Uncertainty rings: radius shrinks as confidence grows; colour by report
 * status. Each ring floats at the highest surface under it, and an x-ray pass
 * keeps the part hidden behind buildings faintly visible.
 */
export class ReportRings {
  readonly mesh: THREE.Group = new THREE.Group();
  private capacity = 512;
  private geometry = new THREE.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2);
  private fillGeometry = new THREE.CircleGeometry(0.88, 48).rotateX(-Math.PI / 2);
  private material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  private xrayMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  private fillMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  private ring: THREE.InstancedMesh;
  private xray: THREE.InstancedMesh;
  private fill: THREE.InstancedMesh;
  private reports: RenderSnapshot['reports'] | null = null;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor() {
    this.ring = this.create(this.geometry, this.material, 6);
    this.xray = this.create(this.geometry, this.xrayMaterial, 9);
    this.fill = this.create(this.fillGeometry, this.fillMaterial, 5);
    this.xray.instanceMatrix = this.ring.instanceMatrix;
    this.xray.instanceColor = this.ring.instanceColor;
    this.fill.instanceMatrix = this.ring.instanceMatrix;
    this.fill.instanceColor = this.ring.instanceColor;
    this.mesh.name = 'report-rings';
    this.mesh.add(this.fill, this.ring, this.xray);
  }

  private create(geometry: THREE.BufferGeometry, material: THREE.Material, order: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geometry, material, this.capacity);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = order;
    return m;
  }

  setReports(reports: RenderSnapshot['reports']): void {
    this.reports = reports;
  }

  /** `surfaceY` gives the height to float the ring at (above water and ground). */
  update(now: number, surfaceY: (x: number, z: number) => number): void {
    const r = this.reports;
    const n = r ? Math.min(r.x.length, this.capacity) : 0;
    for (let i = 0; i < n && r; i++) {
      const conf = Math.min(1, Math.max(0, r.confidence[i]));
      const status = r.status[i] as ReportStatus;
      const pulse = status === ReportStatus.Unverified ? 1 + Math.sin(now / 300 + i) * 0.06 : 1;
      const radius = (0.6 + (1 - conf) * MAX_RADIUS) * pulse;
      const x = r.x[i];
      const z = r.z[i];
      let y = surfaceY(x, z);
      for (let k = 0; k < SAMPLES; k++) {
        const a = (k / SAMPLES) * Math.PI * 2;
        y = Math.max(y, surfaceY(x + Math.cos(a) * radius * 0.92, z + Math.sin(a) * radius * 0.92), surfaceY(x + Math.cos(a) * radius * 0.5, z + Math.sin(a) * radius * 0.5));
      }
      this.dummy.position.set(x, y + 0.12, z);
      this.dummy.scale.set(radius, 1, radius);
      this.dummy.updateMatrix();
      this.ring.setMatrixAt(i, this.dummy.matrix);
      this.ring.setColorAt(i, this.color.setHex(REPORT_COLORS[status] ?? 0xffffff));
    }
    this.ring.count = n;
    this.xray.count = n;
    this.fill.count = n;
    this.ring.instanceMatrix.needsUpdate = true;
    if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.ring.dispose();
    this.xray.dispose();
    this.fill.dispose();
    this.geometry.dispose();
    this.fillGeometry.dispose();
    this.material.dispose();
    this.xrayMaterial.dispose();
    this.fillMaterial.dispose();
  }
}
