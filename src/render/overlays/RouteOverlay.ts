import * as THREE from 'three';
import { UI_COLORS } from '../palette';

const WIDTH = 0.16;
const LIFT = 0.12;

/** Flat ribbon along the selected entity's planned route (from InspectorData.route). */
export class RouteOverlay {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  private material = new THREE.MeshBasicMaterial({
    color: UI_COLORS.route,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private xrayMaterial = new THREE.MeshBasicMaterial({
    color: UI_COLORS.route,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  /** Faint copy drawn over everything, so the route stays readable behind buildings. */
  private xray: THREE.Mesh;
  private cells: number[] = [];
  private w = 1;

  constructor() {
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'route';
    this.xray = new THREE.Mesh(this.geometry, this.xrayMaterial);
    this.xray.renderOrder = 9;
    this.xray.frustumCulled = false;
    this.mesh.add(this.xray);
  }

  setRoute(cells: number[] | null, w: number): void {
    this.cells = cells ?? [];
    this.w = w;
    this.mesh.visible = this.cells.length > 1;
  }

  /** Rebuilds the ribbon from `head` (the entity's live position) through the route cells. */
  update(head: THREE.Vector3 | null, surfaceY: (x: number, z: number) => number, now: number): void {
    if (this.cells.length < 2) {
      this.mesh.visible = false;
      return;
    }
    const pts: THREE.Vector3[] = [];
    const start = head ? 1 : 0;
    if (head) pts.push(new THREE.Vector3(head.x, surfaceY(head.x, head.z) + LIFT, head.z));
    for (let i = start; i < this.cells.length; i++) {
      const c = this.cells[i];
      const x = (c % this.w) + 0.5;
      const z = Math.floor(c / this.w) + 0.5;
      pts.push(new THREE.Vector3(x, surfaceY(x, z) + LIFT, z));
    }
    const pos = new Float32Array((pts.length - 1) * 4 * 3);
    const idx: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * WIDTH * 0.5;
      const nz = (dx / len) * WIDTH * 0.5;
      pos.set([a.x + nx, a.y, a.z + nz, a.x - nx, a.y, a.z - nz, b.x - nx, b.y, b.z - nz, b.x + nx, b.y, b.z + nz], i * 12);
      const v = i * 4;
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setIndex(idx);
    this.mesh.geometry = this.geometry;
    this.xray.geometry = this.geometry;
    this.material.opacity = 0.65 + Math.sin(now / 250) * 0.25;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.xrayMaterial.dispose();
  }
}
