/**
 * World units: 1 cell = 1 unit horizontally (4 m). Heights are in voxels
 * (1 voxel = 1 m) drawn at Y_SCALE units each, i.e. ×2 vertical exaggeration
 * so the city reads from above.
 */
export const CELL_METRES = 4;
export const Y_SCALE = 0.5;

export const cellX = (w: number, c: number): number => c % w;
export const cellZ = (w: number, c: number): number => Math.floor(c / w);

export const cellAt = (w: number, h: number, x: number, z: number): number => {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  return cx < 0 || cz < 0 || cx >= w || cz >= h ? -1 : cz * w + cx;
};

/** Hash a cell index into [0, 1) for stable per-cell variation. */
export const hash01 = (n: number): number => {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
