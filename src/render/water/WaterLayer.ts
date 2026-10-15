import * as THREE from 'three';
import type { WorldSnapshot } from '../../contracts';
import { WATER } from '../palette';
import { Y_SCALE } from '../units';

const MIN_DEPTH = 0.02;
const QUADS_PER_CELL = 5;
const VERTS_PER_CELL = QUADS_PER_CELL * 4;

/**
 * Voxel water: per cell a top quad at ground + depth and side skirts down to
 * the neighbour's surface, so floods read as stacked translucent blocks.
 */
export class WaterLayer {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  private mat: THREE.MeshPhongMaterial;
  private world: WorldSnapshot | null = null;
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private surface = new Float32Array(0);
  private shallow = new THREE.Color(WATER.shallow);
  private deep = new THREE.Color(WATER.deep);
  private beliefTint = new THREE.Color(WATER.belief);
  private tmp = new THREE.Color();

  constructor() {
    this.mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      shininess: 80,
      specular: new THREE.Color(0x99bbcc),
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.mat);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  setWorld(world: WorldSnapshot): void {
    const resized = !this.world || this.world.w !== world.w || this.world.h !== world.h;
    this.world = world;
    if (!resized) return;
    const n = world.w * world.h;
    this.positions = new Float32Array(n * VERTS_PER_CELL * 3);
    this.colors = new Float32Array(n * VERTS_PER_CELL * 3);
    this.surface = new Float32Array(n);
    const normals = new Float32Array(n * VERTS_PER_CELL * 3);
    const index = new Uint32Array(n * QUADS_PER_CELL * 6);
    const faceNormals = [
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (let c = 0; c < n; c++) {
      for (let q = 0; q < QUADS_PER_CELL; q++) {
        const v0 = c * VERTS_PER_CELL + q * 4;
        for (let k = 0; k < 4; k++) normals.set(faceNormals[q], (v0 + k) * 3);
        const i0 = (c * QUADS_PER_CELL + q) * 6;
        index.set([v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3], i0);
      }
    }
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry = this.geometry;
  }

  get material(): THREE.Material {
    return this.mat;
  }

  /** Water surface height (world units) at a cell, or -Infinity when dry. */
  surfaceAt(c: number): number {
    return this.surface[c] ?? -Infinity;
  }

  setWater(depth: Float32Array, belief: boolean): void {
    const world = this.world;
    if (!world || depth.length !== world.w * world.h) return;
    const { w, h, ground } = world;
    const n = w * h;
    const Y = Y_SCALE;
    for (let c = 0; c < n; c++) this.surface[c] = depth[c] > MIN_DEPTH ? (ground[c] + depth[c]) * Y : -Infinity;
    this.mat.opacity = belief ? 0.6 : 0.78;

    const p = this.positions;
    for (let c = 0; c < n; c++) {
      const x = c % w;
      const z = (c - x) / w;
      const s = this.surface[c];
      const base = c * VERTS_PER_CELL * 3;
      if (s === -Infinity) {
        p.fill(0, base, base + VERTS_PER_CELL * 3);
        continue;
      }
      // Top.
      p.set([x, s, z, x, s, z + 1, x + 1, s, z + 1, x + 1, s, z], base);
      // Skirts: +x, -x, +z, -z down to the neighbour's surface (or its ground).
      const low = (nb: number) => (nb < 0 ? 0 : this.surface[nb] !== -Infinity ? this.surface[nb] : ground[nb] * Y);
      const px = low(x < w - 1 ? c + 1 : -1);
      const nx = low(x > 0 ? c - 1 : -1);
      const pz = low(z < h - 1 ? c + w : -1);
      const nz = low(z > 0 ? c - w : -1);
      const b1 = base + 12;
      if (px < s) p.set([x + 1, px, z + 1, x + 1, px, z, x + 1, s, z, x + 1, s, z + 1], b1);
      else p.fill(0, b1, b1 + 12);
      const b2 = base + 24;
      if (nx < s) p.set([x, nx, z, x, nx, z + 1, x, s, z + 1, x, s, z], b2);
      else p.fill(0, b2, b2 + 12);
      const b3 = base + 36;
      if (pz < s) p.set([x, pz, z + 1, x + 1, pz, z + 1, x + 1, s, z + 1, x, s, z + 1], b3);
      else p.fill(0, b3, b3 + 12);
      const b4 = base + 48;
      if (nz < s) p.set([x + 1, nz, z, x, nz, z, x, s, z, x + 1, s, z], b4);
      else p.fill(0, b4, b4 + 12);

      const t = Math.min(1, depth[c] / WATER.deepAt);
      this.tmp.copy(this.shallow).lerp(this.deep, Math.sqrt(t));
      if (belief) this.tmp.lerp(this.beliefTint, 0.45);
      const col = this.colors;
      for (let v = 0; v < VERTS_PER_CELL; v++) {
        const k = v >= 4 && v % 4 < 2 ? 0.75 : 1;
        col[base + v * 3] = this.tmp.r * k;
        col[base + v * 3 + 1] = this.tmp.g * k;
        col[base + v * 3 + 2] = this.tmp.b * k;
      }
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}
