import { BlockType, type WorldSnapshot } from '../../contracts';
import { CELL_METRES } from '../units';

/** A building drawn by a model: its footprint, ground and the side facing the street. */
export interface PropSite {
  /** Building id (buildingIndex − 1). */
  building: number;
  cells: number[];
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Highest ground under the footprint, in voxels. */
  ground: number;
  /** Unit direction of the street the front faces. */
  facing: { dx: number; dz: number };
}

const SIDES = [
  { dx: 1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: -1 },
] as const;

const isRoad = (b: number) => b === BlockType.Road || b === BlockType.Bridge;

/** Every building of `block` in the world, with the side that has the most road frontage. */
export const findSites = (world: WorldSnapshot, block: BlockType): PropSite[] => {
  const { w, h, blocks, buildingIndex, ground } = world;
  const byId = new Map<number, number[]>();
  for (let c = 0; c < w * h; c++) {
    if (blocks[c] !== block || buildingIndex[c] === 0) continue;
    const list = byId.get(buildingIndex[c]) ?? [];
    list.push(c);
    byId.set(buildingIndex[c], list);
  }
  const sites: PropSite[] = [];
  for (const [index, cells] of byId) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let g = 0;
    for (const c of cells) {
      const x = c % w;
      const z = Math.floor(c / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
      g = Math.max(g, ground[c]);
    }
    const own = new Set(cells);
    let best: (typeof SIDES)[number] = SIDES[1];
    let bestRoads = -1;
    for (const side of SIDES) {
      let roads = 0;
      for (const c of cells) {
        const x = (c % w) + side.dx;
        const z = Math.floor(c / w) + side.dz;
        if (x < 0 || z < 0 || x >= w || z >= h) continue;
        const nb = z * w + x;
        if (!own.has(nb) && isRoad(blocks[nb])) roads++;
      }
      if (roads > bestRoads) {
        bestRoads = roads;
        best = side;
      }
    }
    sites.push({ building: index - 1, cells, x0, x1, z0, z1, ground: g, facing: { dx: best.dx, dz: best.dz } });
  }
  return sites.sort((a, b) => a.building - b.building);
};

/** three.js y-rotation that turns a model facing +x toward `facing`. */
export const yawFor = (facing: { dx: number; dz: number }): number => Math.atan2(-facing.dz, facing.dx);

/**
 * Metre multiplier that fits a model (front along +x, sizes in metres) into
 * the footprint with a small margin, without exceeding `maxHeight` metres.
 */
export const fitMultiplier = (site: PropSite, size: { depth: number; width: number; height: number }, maxHeight: number, margin = 0.92): number => {
  const spanX = (site.x1 - site.x0 + 1) * CELL_METRES;
  const spanZ = (site.z1 - site.z0 + 1) * CELL_METRES;
  const along = site.facing.dx !== 0 ? spanX : spanZ;
  const across = site.facing.dx !== 0 ? spanZ : spanX;
  return Math.min((along * margin) / size.depth, (across * margin) / size.width, maxHeight / size.height);
};
