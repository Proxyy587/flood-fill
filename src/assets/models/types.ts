export interface Voxel {
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface VoxelModel {
  name: string;
  size: [number, number, number]; // [width (x), height (y), depth (z)]
  voxels: Voxel[];
  pivot: [number, number, number];
}
