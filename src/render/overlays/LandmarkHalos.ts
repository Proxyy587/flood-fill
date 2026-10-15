import * as THREE from 'three';
import { BlockType, type WorldSnapshot } from '../../contracts';
import type { LandmarkCategory } from '../../bridge/sceneStore';
import { LANDMARK_COLORS } from '../palette';
import { Y_SCALE } from '../units';

const PAD = 0.9;
const MAX = 128;

export const LANDMARK_CATEGORY: Partial<Record<BlockType, LandmarkCategory>> = {
  [BlockType.Hospital]: 'medical',
  [BlockType.Shelter]: 'shelter',
  [BlockType.PoliceStation]: 'police',
  [BlockType.FloodHQ]: 'command',
  [BlockType.FireStation]: 'fire',
  [BlockType.PowerPlant]: 'power',
  [BlockType.Substation]: 'power',
  [BlockType.BoatDepot]: 'boats',
  [BlockType.Helipad]: 'air',
};

export interface Footprint {
  id: number;
  category: LandmarkCategory;
  cells: number[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  ground: number;
}

/** Civic buildings in the world, grouped by building id. */
export const findLandmarks = (world: WorldSnapshot): Footprint[] => {
  const byId = new Map<number, Footprint>();
  const { w, h, blocks, buildingIndex, ground } = world;
  for (let c = 0; c < w * h; c++) {
    const id = buildingIndex[c];
    if (!id) continue;
    const category = LANDMARK_CATEGORY[blocks[c] as BlockType];
    if (!category) continue;
    const x = c % w;
    const z = Math.floor(c / w);
    const f = byId.get(id) ?? { id: id - 1, category, cells: [], minX: x, maxX: x, minZ: z, maxZ: z, ground: 0 };
    f.cells.push(c);
    f.minX = Math.min(f.minX, x);
    f.maxX = Math.max(f.maxX, x);
    f.minZ = Math.min(f.minZ, z);
    f.maxZ = Math.max(f.maxZ, z);
    f.ground = Math.max(f.ground, ground[c]);
    byId.set(id, f);
  }
  return [...byId.values()];
};

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec2 aSize;
varying vec2 vP;
varying vec2 vHalf;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vHalf = aSize * 0.5;
  vP = (uv - 0.5) * aSize;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vP;
varying vec2 vHalf;
varying vec3 vColor;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = sdRoundRect(vP, vHalf - vec2(${PAD.toFixed(2)}), 0.55);
  float line = 1.0 - smoothstep(0.05, 0.16, abs(d - 0.12));
  float glow = d > 0.0 ? exp(-d * 2.6) * (0.78 + 0.22 * sin(uTime * 2.0)) * 0.5 : 0.0;
  float a = (line * 0.95 + glow) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

/** A soft rounded outline in the category colour around each civic building's footprint. */
export class LandmarkHalos {
  readonly mesh: THREE.InstancedMesh;
  private geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private color = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  private size = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
  private material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Color();

  constructor() {
    this.geometry.setAttribute('aColor', this.color);
    this.geometry.setAttribute('aSize', this.size);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'landmark-halos';
  }

  setLandmarks(list: Footprint[]): void {
    const n = Math.min(MAX, list.length);
    for (let i = 0; i < n; i++) {
      const f = list[i];
      const sx = f.maxX - f.minX + 1 + PAD * 2;
      const sz = f.maxZ - f.minZ + 1 + PAD * 2;
      this.dummy.position.set((f.minX + f.maxX + 1) / 2, f.ground * Y_SCALE + 0.05, (f.minZ + f.maxZ + 1) / 2);
      this.dummy.scale.set(sx, 1, sz);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.tmp.setHex(LANDMARK_COLORS[f.category]);
      this.color.setXYZ(i, this.tmp.r, this.tmp.g, this.tmp.b);
      this.size.setXY(i, sx, sz);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.color.needsUpdate = true;
    this.size.needsUpdate = true;
  }

  update(now: number, opacity: number): void {
    this.material.uniforms.uTime.value = now / 1000;
    this.material.uniforms.uOpacity.value = opacity;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
