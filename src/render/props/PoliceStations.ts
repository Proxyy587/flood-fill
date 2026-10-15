import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BlockType, PowerState, type WorldSnapshot } from '../../contracts';
import { BLOCK_VISUALS, LANDMARK_COLORS } from '../palette';
import { PROP_HEIGHT } from '../terrain/mesher';
import { CELL_METRES, Y_SCALE } from '../units';
import { findSites, fitMultiplier, yawFor, type PropSite } from './placement';

export const POLICE_MODEL_URL = '/assets/police.glb';
const PLINTH = BLOCK_VISUALS[BlockType.PoliceStation].height;
/** Drawn height cap in voxels; also what labels and picking use. */
const MAX_HEIGHT_VOXELS = PROP_HEIGHT[BlockType.PoliceStation] ?? 5;
/** Glass that lights up at night when the station has power. */
const GLASS = /window 2|door glass/i;

interface Template {
  /** Model normalised to metres: front along +x, centred, base at y = 0. */
  root: THREE.Object3D;
  size: { depth: number; width: number; height: number };
}

let templatePromise: Promise<Template> | null = null;

/** Loads the station once; the front is the side its entrance and doors face. */
const loadTemplate = (): Promise<Template> => {
  templatePromise ??= new GLTFLoader().loadAsync(POLICE_MODEL_URL).then((gltf) => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(scene);
    const front = new THREE.Box3();
    scene.traverse((o) => {
      if (/entrance|doors/i.test(o.name) && (o as THREE.Mesh).isMesh) front.union(new THREE.Box3().setFromObject(o));
    });
    const centre = all.getCenter(new THREE.Vector3());
    const toward = front.isEmpty() ? new THREE.Vector3(1, 0, 0) : front.getCenter(new THREE.Vector3()).sub(centre);
    const facing = Math.abs(toward.x) >= Math.abs(toward.z) ? { dx: Math.sign(toward.x) || 1, dz: 0 } : { dx: 0, dz: Math.sign(toward.z) };
    const turn = new THREE.Group();
    turn.add(scene);
    scene.position.set(-centre.x, -all.min.y, -centre.z);
    turn.rotation.y = -yawFor(facing);
    const root = new THREE.Group();
    root.add(turn);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The asset leaves metalness at the glTF default (1), which renders black without an environment map.
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.metalness = GLASS.test(m.name) ? 0.2 : 0;
          m.roughness = GLASS.test(m.name) ? 0.25 : 0.85;
        }
      }
    });
    return { root, size: { depth: size.x, width: size.z, height: size.y } };
  });
  return templatePromise;
};

interface Placed {
  site: PropSite;
  object: THREE.Object3D;
  glass: THREE.MeshStandardMaterial[];
}

/**
 * Police stations drawn with the authored `police.glb` model (W1 asset),
 * fitted to each station footprint and turned to face its street. Falls back
 * to a plain block if the model cannot be loaded.
 */
export class PoliceStations {
  readonly group = new THREE.Group();
  private placed: Placed[] = [];
  private world: WorldSnapshot | null = null;
  private template: Template | null = null;
  private failed = false;
  private powered: Uint8Array | null = null;
  private night = 0;
  private glow = new THREE.Color();

  constructor() {
    this.group.name = 'police-stations';
    loadTemplate()
      .then((t) => {
        this.template = t;
        this.rebuild();
      })
      .catch(() => {
        this.failed = true;
        this.rebuild();
      });
  }

  setWorld(world: WorldSnapshot): void {
    this.world = world;
    this.rebuild();
  }

  /** Night 0..1 and the power layer: lit glass needs both darkness and power. */
  setLighting(night: number, powered: Uint8Array | null): void {
    if (Math.abs(night - this.night) < 0.01 && powered === this.powered) return;
    this.night = night;
    this.powered = powered;
    for (const p of this.placed) {
      const state = powered ? powered[p.site.cells[0]] : PowerState.Grid;
      const on = state === PowerState.Off ? 0 : night;
      this.glow.setHex(state === PowerState.Generator ? 0xffa646 : 0xffe2a8).multiplyScalar(on * 1.6);
      for (const m of p.glass) m.emissive.copy(this.glow);
    }
  }

  dispose(): void {
    this.clear();
  }

  private clear(): void {
    for (const p of this.placed) {
      this.group.remove(p.object);
      p.glass.forEach((m) => m.dispose());
      if (this.failed) p.object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.placed = [];
  }

  private rebuild(): void {
    this.clear();
    const world = this.world;
    if (!world || (!this.template && !this.failed)) return;
    for (const site of findSites(world, BlockType.PoliceStation)) {
      const object = this.template ? this.instance(site, this.template) : this.fallback(site);
      const glass: THREE.MeshStandardMaterial[] = [];
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const own = list.map((m) => {
          if (!(m instanceof THREE.MeshStandardMaterial) || !GLASS.test(m.name)) return m;
          const copy = m.clone();
          glass.push(copy);
          return copy;
        });
        mesh.material = Array.isArray(mesh.material) ? own : own[0];
      });
      object.userData.building = site.building;
      this.group.add(object);
      this.placed.push({ site, object, glass });
    }
    const n = this.night;
    this.night = -1;
    this.setLighting(n, this.powered);
  }

  private instance(site: PropSite, t: Template): THREE.Object3D {
    // Uniform scale keeps the authored proportions (the voxel city exaggerates heights ×2; this model does not).
    const k = fitMultiplier(site, t.size, (MAX_HEIGHT_VOXELS * Y_SCALE * CELL_METRES));
    const holder = new THREE.Group();
    const model = t.root.clone(true);
    model.scale.setScalar(k / CELL_METRES);
    holder.add(model);
    holder.rotation.y = yawFor(site.facing);
    holder.position.set((site.x0 + site.x1 + 1) / 2, (site.ground + PLINTH) * Y_SCALE, (site.z0 + site.z1 + 1) / 2);
    return holder;
  }

  private fallback(site: PropSite): THREE.Object3D {
    const sx = site.x1 - site.x0 + 1;
    const sz = site.z1 - site.z0 + 1;
    const h = 4 * Y_SCALE;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx * 0.9, h, sz * 0.9).translate(0, h / 2, 0),
      new THREE.MeshLambertMaterial({ color: LANDMARK_COLORS.police }),
    );
    mesh.castShadow = true;
    mesh.position.set(site.x0 + sx / 2, (site.ground + PLINTH) * Y_SCALE, site.z0 + sz / 2);
    return mesh;
  }
}
