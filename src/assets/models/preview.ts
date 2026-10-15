import type { VoxelModel } from "./types";
import { getModel } from "./index";

/**
 * Prints an ASCII layer-by-layer view of a voxel model for quick CLI inspection and verification.
 */
export function previewModel(modelOrName: VoxelModel | string): string {
  const model: VoxelModel = typeof modelOrName === "string" ? getModel(modelOrName) : modelOrName;
  const [width, height, depth] = model.size;

  // Build 3D grid [y][z][x]
  const grid: (string | null)[][][] = Array.from({ length: height }, () =>
    Array.from({ length: depth }, () => Array(width).fill(null))
  );

  for (const v of model.voxels) {
    if (v.y >= 0 && v.y < height && v.z >= 0 && v.z < depth && v.x >= 0 && v.x < width) {
      // Use single character shorthand from hex
      grid[v.y][v.z][v.x] = "#";
    }
  }

  const lines: string[] = [
    `=== Voxel Model: ${model.name} (${width}x${height}x${depth}, ${model.voxels.length} voxels) ===`,
  ];

  for (let y = height - 1; y >= 0; y--) {
    lines.push(`Layer Y=${y}:`);
    for (let z = 0; z < depth; z++) {
      let row = "";
      for (let x = 0; x < width; x++) {
        row += grid[y][z][x] ? "█" : ".";
      }
      lines.push(`  ${row}`);
    }
  }

  return lines.join("\n");
}
