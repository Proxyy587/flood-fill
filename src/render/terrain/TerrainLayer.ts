import * as THREE from 'three';
import { bridgeDeckHeights, chunkCountX, CHUNK_SIZE, PowerState, type WorldSnapshot } from '../../contracts';
import { BLACKOUT_TINT, WINDOW_COLORS } from '../palette';
import { buildChunk, ROLE_BUILDING, type MeshData } from './mesher';

interface Chunk {
  solid: THREE.Mesh;
  windows: THREE.Mesh;
  solidData: MeshData;
  windowData: MeshData;
}

const toRgb = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const WIN = {
  [PowerState.Grid]: toRgb(WINDOW_COLORS.grid),
  [PowerState.Generator]: toRgb(WINDOW_COLORS.generator),
  [PowerState.Off]: toRgb(WINDOW_COLORS.off),
};

/** Chunked voxel terrain + buildings. Rebuilds only dirty chunks. */
export class TerrainLayer {
  readonly group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private world: WorldSnapshot | null = null;
  private deck: Int16Array = new Int16Array(0);
  private powered: Uint8Array | null = null;
  private solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private windowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  constructor() {
    this.group.name = 'terrain';
  }

  get materials(): THREE.Material[] {
    return [this.solidMat, this.windowMat];
  }

  get meshes(): THREE.Object3D[] {
    return [...this.chunks.values()].map((c) => c.solid);
  }

  get current(): WorldSnapshot | null {
    return this.world;
  }

  get deckHeights(): Int16Array {
    return this.deck;
  }

  setWorld(world: WorldSnapshot): void {
    const resized = !this.world || this.world.w !== world.w || this.world.h !== world.h;
    this.world = world;
    this.deck = bridgeDeckHeights(world.w, world.h, world.ground, world.blocks);
    const cxCount = chunkCountX(world.w);
    const czCount = Math.ceil(world.h / CHUNK_SIZE);
    if (resized) {
      for (const id of [...this.chunks.keys()]) this.disposeChunk(id);
      this.powered = null;
    }
    const all = resized || world.dirtyChunks.length === 0;
    const ids = all ? Array.from({ length: cxCount * czCount }, (_, i) => i) : world.dirtyChunks;
    for (const id of ids) {
      if (id < 0 || id >= cxCount * czCount) continue;
      this.disposeChunk(id);
      const data = buildChunk(world, this.deck, id % cxCount, Math.floor(id / cxCount));
      const solid = new THREE.Mesh(this.geometry(data.solid), this.solidMat);
      solid.castShadow = true;
      solid.receiveShadow = true;
      solid.userData.chunk = id;
      const windows = new THREE.Mesh(this.geometry(data.windows), this.windowMat);
      this.group.add(solid, windows);
      const chunk = { solid, windows, solidData: data.solid, windowData: data.windows };
      this.chunks.set(id, chunk);
      this.tint(chunk);
    }
  }

  /** Re-tints only chunks whose cells changed power state. */
  setPower(powered: Uint8Array): void {
    if (!this.world || powered.length !== this.world.w * this.world.h) return;
    const prev = this.powered;
    this.powered = powered;
    if (!prev) {
      this.chunks.forEach((c) => this.tint(c));
      return;
    }
    const cxCount = chunkCountX(this.world.w);
    const changed = new Set<number>();
    for (let i = 0; i < powered.length; i++) {
      if (powered[i] === prev[i]) continue;
      const x = i % this.world.w;
      const z = (i - x) / this.world.w;
      changed.add(Math.floor(z / CHUNK_SIZE) * cxCount + Math.floor(x / CHUNK_SIZE));
    }
    for (const id of changed) {
      const c = this.chunks.get(id);
      if (c) this.tint(c);
    }
  }

  dispose(): void {
    for (const id of [...this.chunks.keys()]) this.disposeChunk(id);
    this.solidMat.dispose();
    this.windowMat.dispose();
  }

  private geometry(d: MeshData): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(d.baseColors), 3));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  private tint(chunk: Chunk): void {
    const powered = this.powered;
    const apply = (mesh: THREE.Mesh, d: MeshData, windows: boolean) => {
      const attr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      for (let v = 0; v < d.roles.length; v++) {
        const state = powered ? (powered[d.cells[v]] as PowerState) : PowerState.Grid;
        if (windows) {
          const col = WIN[state] ?? WIN[PowerState.Grid];
          out[v * 3] = col[0];
          out[v * 3 + 1] = col[1];
          out[v * 3 + 2] = col[2];
        } else {
          const dim = d.roles[v] === ROLE_BUILDING && state === PowerState.Off;
          out[v * 3] = d.baseColors[v * 3] * (dim ? BLACKOUT_TINT[0] : 1);
          out[v * 3 + 1] = d.baseColors[v * 3 + 1] * (dim ? BLACKOUT_TINT[1] : 1);
          out[v * 3 + 2] = d.baseColors[v * 3 + 2] * (dim ? BLACKOUT_TINT[2] : 1);
        }
      }
      attr.needsUpdate = true;
    };
    apply(chunk.solid, chunk.solidData, false);
    apply(chunk.windows, chunk.windowData, true);
  }

  private disposeChunk(id: number): void {
    const c = this.chunks.get(id);
    if (!c) return;
    this.group.remove(c.solid, c.windows);
    c.solid.geometry.dispose();
    c.windows.geometry.dispose();
    this.chunks.delete(id);
  }
}
