import * as THREE from 'three';
import type { WorldSnapshot } from '../../contracts';

/**
 * No extra land past the playable map — the city slab alone (sides come from
 * the terrain mesher), matching the original riverside look.
 */
export class SkyIsland {
  readonly group = new THREE.Group();
  radius = 64;

  constructor() {
    this.group.name = 'city-apron';
  }

  setWorld(world: WorldSnapshot): void {
    this.radius = Math.hypot(world.w, world.h) / 2 + 2;
  }

  setHaze(_color: THREE.Color): void { /* no-op */ }
  setWater(_surfaceAt: (c: number) => number): void { void _surfaceAt; }
  update(_now: number, _day: number, _night: number): void { /* no-op */ }

  dispose(): void { /* nothing to free */ }
}
