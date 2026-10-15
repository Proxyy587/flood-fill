import type { Voxel } from "./types";

/**
 * Helper class for procedurally painting voxels with overwrite semantics.
 * Guarantees zero duplicate coordinates.
 */
export class VoxelBuilder {
  private map = new Map<string, Voxel>();

  set(x: number, y: number, z: number, color: string): this {
    this.map.set(`${x},${y},${z}`, { x, y, z, color });
    return this;
  }

  box(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    color: string
  ): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
          this.set(x, y, z, color);
        }
      }
    }
    return this;
  }

  build(): Voxel[] {
    return Array.from(this.map.values());
  }
}
