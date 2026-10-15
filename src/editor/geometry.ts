import { BlockType, type Scenario } from '../contracts';

export const neighbours = (cell: number, w: number, h: number): number[] => {
  const x = cell % w, z = Math.floor(cell / w);
  return [x > 0 ? cell - 1 : -1, x < w - 1 ? cell + 1 : -1, z > 0 ? cell - w : -1, z < h - 1 ? cell + w : -1].filter(c => c >= 0);
};
export const isRoad = (block: number) => block === BlockType.Road || block === BlockType.Bridge;
export const rectCells = (a: number, b: number, w: number): number[] => {
  const result: number[] = [];
  for (let z = Math.min(Math.floor(a / w), Math.floor(b / w)); z <= Math.max(Math.floor(a / w), Math.floor(b / w)); z++)
    for (let x = Math.min(a % w, b % w); x <= Math.max(a % w, b % w); x++) result.push(z * w + x);
  return result;
};
/** Manhattan polyline: every successive road cell has a shared edge, including diagonal drags. */
export const lineCells = (a: number, b: number, w: number): number[] => {
  let x = a % w, z = Math.floor(a / w);
  const tx = b % w, tz = Math.floor(b / w), dx = Math.abs(tx - x), dz = Math.abs(tz - z);
  let ix = 0, iz = 0;
  const cells = [a];
  while (ix < dx || iz < dz) {
    if (ix < dx && (iz >= dz || (ix + 0.5) / dx <= (iz + 0.5) / dz)) { x += Math.sign(tx - x); ix++; }
    else { z += Math.sign(tz - z); iz++; }
    cells.push(z * w + x);
  }
  return cells;
};
export const footprint = (cell: number, size: number, w: number, h: number): number[] => {
  const x = cell % w, z = Math.floor(cell / w);
  if (cell < 0 || x + size > w || z + size > h) return [];
  return rectCells(cell, (z + size - 1) * w + x + size - 1, w);
};
export const validateFootprint = (s: Scenario, cells: number[], type: BlockType, ignoreId?: number): string[] => {
  if (!cells.length || cells.some(c => c < 0 || c >= s.blocks.length)) return ['Footprint is outside the city.'];
  const errors: string[] = [];
  const occupied = new Set(s.buildings.filter(b => b.id !== ignoreId).flatMap(b => b.cells));
  if (cells.some(c => occupied.has(c))) errors.push('Overlaps an existing building.');
  if (cells.some(c => isRoad(s.blocks[c]) || s.blocks[c] === BlockType.WaterSource || s.blocks[c] === BlockType.Levee)) errors.push('Keep roads, water, and flood barriers clear.');
  if (new Set(cells.map(c => s.ground[c])).size > 1) errors.push('Level the foundation with the height brush first.');
  const perimeter = [...new Set(cells.flatMap(c => neighbours(c, s.size.w, s.size.h)))].filter(c => !cells.includes(c));
  if (type === BlockType.Hospital && !perimeter.some(c => isRoad(s.blocks[c]))) errors.push('Hospital needs an adjacent road.');
  if (type === BlockType.BoatDepot && !perimeter.some(c => isRoad(s.blocks[c]) || s.blocks[c] === BlockType.WaterSource)) errors.push('Depot needs an adjacent road or water.');
  return errors;
};
