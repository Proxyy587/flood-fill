import { BlockType, CHUNK_SIZE, type WorldSnapshot } from '../../contracts';
import { BLOCK_VISUALS } from '../palette';
import { hash01, Y_SCALE } from '../units';

/** Vertex roles: how a vertex reacts to the power layer. */
export const ROLE_STATIC = 0;
export const ROLE_BUILDING = 1;

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** Unlit base colour (rgb 0..1). */
  baseColors: Float32Array;
  roles: Uint8Array;
  /** Cell index per vertex, for power tinting. */
  cells: Uint32Array;
  indices: Uint32Array;
}

export interface ChunkMeshData {
  solid: MeshData;
  windows: MeshData;
}

type Dir = 'px' | 'nx' | 'pz' | 'nz' | 'py';
type Rgb = [number, number, number];

const rgb = (hex: number, k = 1): Rgb => [(((hex >> 16) & 255) / 255) * k, (((hex >> 8) & 255) / 255) * k, ((hex & 255) / 255) * k];

const NORMALS: Record<Dir, [number, number, number]> = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
  py: [0, 1, 0],
};

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  role: number[] = [];
  cell: number[] = [];
  idx: number[] = [];

  /** Axis-aligned face of the box [x0,x1]×[y0,y1]×[z0,z1] (y in world units). */
  face(dir: Dir, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: Rgb, role: number, cell: number, ao = 0.82): void {
    let v: number[][];
    switch (dir) {
      case 'px':
        v = [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]];
        break;
      case 'nx':
        v = [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]];
        break;
      case 'pz':
        v = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
        break;
      case 'nz':
        v = [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]];
        break;
      case 'py':
        v = [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]];
        break;
    }
    const base = this.pos.length / 3;
    const n = NORMALS[dir];
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      const k = dir !== 'py' && i < 2 ? ao : 1;
      this.col.push(color[0] * k, color[1] * k, color[2] * k);
      this.role.push(role);
      this.cell.push(cell);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Arbitrary planar quad, counter-clockwise seen from the front. */
  quad(v: [number, number, number][], color: Rgb, role: number, cell: number): void {
    const [a, b, d] = v;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = d[0] - a[0], wy = d[1] - a[1], wz = d[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    // A zero-area quad has no normal; lit in a shader it turns into NaN pixels that the bloom spreads over the frame.
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    const base = this.pos.length / 3;
    for (const p of v) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(color[0], color[1], color[2]);
      this.role.push(role);
      this.cell.push(cell);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Box without a bottom face. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: Rgb, role: number, cell: number): void {
    for (const d of ['px', 'nx', 'pz', 'nz', 'py'] as const) this.face(d, x0, x1, y0, y1, z0, z1, color, role, cell, 0.9);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      baseColors: new Float32Array(this.col),
      roles: new Uint8Array(this.role),
      cells: new Uint32Array(this.cell),
      indices: new Uint32Array(this.idx),
    };
  }
}

const structureHeight = (block: number): number => {
  const v = BLOCK_VISUALS[block as BlockType];
  return v && v.shape === 'structure' ? v.height : 0;
};

const isTinted = (block: number): boolean =>
  BLOCK_VISUALS[block as BlockType]?.shape === 'structure' && block !== BlockType.Levee && block !== BlockType.Helipad;

const heightCache = new WeakMap<WorldSnapshot, Float32Array>();

/**
 * Per-cell structure height in voxels. Render-only variety: every building
 * keeps one height across its footprint, and offices rise toward the densest
 * cluster so the business district reads as a skyline.
 */
export const structureHeights = (world: WorldSnapshot): Float32Array => {
  const cached = heightCache.get(world);
  if (cached) return cached;
  const { w, h, blocks, buildingIndex } = world;
  const n = w * h;
  const out = new Float32Array(n);
  const offices: number[] = [];
  for (let c = 0; c < n; c++) if (blocks[c] === BlockType.Office) offices.push(c);
  const centre = new Map<number, { x: number; z: number; k: number }>();
  for (let c = 0; c < n; c++) {
    const id = buildingIndex[c];
    if (!id) continue;
    const e = centre.get(id) ?? { x: 0, z: 0, k: 0 };
    e.x += c % w;
    e.z += Math.floor(c / w);
    e.k++;
    centre.set(id, e);
  }
  const perBuilding = new Map<number, number>();
  const heightOf = (id: number, block: BlockType): number => {
    const known = perBuilding.get(id);
    if (known !== undefined) return known;
    const r = hash01(id * 31 + 7);
    let v = structureHeight(block);
    if (block === BlockType.House) v = 2.5 + Math.round(r * 3) * 0.5;
    else if (block === BlockType.Shop) v = 3 + Math.round(r * 2) * 0.5;
    else if (block === BlockType.Apartment) v = 5 + Math.round(r * 3);
    else if (block === BlockType.Office) {
      const e = centre.get(id);
      let near = 0;
      if (e) {
        const cx = e.x / e.k;
        const cz = e.z / e.k;
        for (const o of offices) {
          const dx = (o % w) - cx;
          const dz = Math.floor(o / w) - cz;
          if (dx * dx + dz * dz < 81) near++;
        }
      }
      v = 7 + Math.round(r * 3) + Math.round(8 * Math.min(1, near / 40));
    }
    perBuilding.set(id, v);
    return v;
  };
  for (let c = 0; c < n; c++) {
    const id = buildingIndex[c];
    out[c] = id ? heightOf(id, blocks[c] as BlockType) : structureHeight(blocks[c]);
  }
  heightCache.set(world, out);
  return out;
};

/**
 * Blocks drawn by a separate model layer (a GLB) over a low plinth. The value
 * is the model's height in voxels, used for labels, picking boxes and the
 * camera; the chunk mesher only draws the plinth.
 */
export const PROP_HEIGHT: Partial<Record<BlockType, number>> = {
  [BlockType.PoliceStation]: 5,
};

/** Top of what the chunk mesher draws, in voxels. */
const drawnTop = (world: WorldSnapshot, c: number): number => world.ground[c] + structureHeights(world)[c];

/** Column top in voxels (ground + structure, or the model standing on it). */
export const columnTop = (world: WorldSnapshot, c: number): number => drawnTop(world, c) + (PROP_HEIGHT[world.blocks[c] as BlockType] ?? 0);

/** A road cell sloping up to a bridge deck: heights in world units at the cell's far and near edges. */
export interface Ramp {
  dx: number;
  dz: number;
  far: number;
  near: number;
}

const isRoadBlock = (b: number) => b === BlockType.Road;

/**
 * Approach ramp for a road cell one or two cells before a raised bridge deck.
 * Two-cell ramps split the climb so the slope stays gentle.
 */
export const rampAt = (world: WorldSnapshot, deck: Int16Array, c: number): Ramp | null => {
  const { w, h, blocks, ground } = world;
  if (!isRoadBlock(blocks[c])) return null;
  const x = c % w;
  const z = (c - x) / w;
  const cellOf = (px: number, pz: number) => (px < 0 || pz < 0 || px >= w || pz >= h ? -1 : pz * w + px);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const n1 = cellOf(x + dx, z + dz);
    if (n1 >= 0 && blocks[n1] === BlockType.Bridge && deck[n1] > ground[c]) {
      const back = cellOf(x - dx, z - dz);
      const top = deck[n1] * Y_SCALE;
      if (back >= 0 && isRoadBlock(blocks[back]) && deck[n1] - ground[back] >= 1) {
        const mid = (ground[back] * Y_SCALE + top) / 2;
        return { dx, dz, far: Math.max(mid, ground[c] * Y_SCALE), near: top };
      }
      return { dx, dz, far: ground[c] * Y_SCALE, near: top };
    }
    const n2 = cellOf(x + 2 * dx, z + 2 * dz);
    if (n1 >= 0 && n2 >= 0 && isRoadBlock(blocks[n1]) && blocks[n2] === BlockType.Bridge && deck[n2] - ground[c] >= 1) {
      const top = deck[n2] * Y_SCALE;
      return { dx, dz, far: ground[c] * Y_SCALE, near: Math.max(ground[n1] * Y_SCALE, (ground[c] * Y_SCALE + top) / 2) };
    }
  }
  return null;
};

/** Height of a ramp at a point inside its cell (fx, fz in 0..1). */
export const rampHeight = (r: Ramp, fx: number, fz: number): number => {
  const t = r.dx > 0 ? fx : r.dx < 0 ? 1 - fx : r.dz > 0 ? fz : 1 - fz;
  return r.far + (r.near - r.far) * t;
};

const DIR_SEED: Record<Dir, number> = { px: 1, nx: 2, pz: 3, nz: 4, py: 5 };

/**
 * How brightly a window pane glows at night (stored in the window mesh's
 * vertex colour; `TerrainLayer` turns it into the `aLit` attribute). About a
 * third of panes stay dark so lit facades read as occupied, not uniform.
 */
export const windowLit = (c: number, row: number, pane: number, dir: Dir): number => {
  const r = hash01(c * 97 + row * 13 + pane * 7 + DIR_SEED[dir] * 31);
  return r < 0.34 ? 0.05 : 0.45 + hash01(r * 1e6 + 3) * 0.6;
};

/**
 * Builds the solid and window meshes for one 16×16 chunk. Faces between
 * columns are only emitted where the neighbour is lower (hidden-face culling).
 */
export const buildChunk = (world: WorldSnapshot, deck: Int16Array, chunkX: number, chunkZ: number): ChunkMeshData => {
  const { w, h, ground, blocks, buildingIndex } = world;
  const solid = new Builder();
  const windows = new Builder();
  const Y = Y_SCALE;
  const x0c = chunkX * CHUNK_SIZE;
  const z0c = chunkZ * CHUNK_SIZE;
  const sameBuilding = (c: number, nb: number) => nb >= 0 && buildingIndex[c] !== 0 && buildingIndex[nb] === buildingIndex[c];
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= h ? -1 : z * w + x);
  const heights = structureHeights(world);

  for (let z = z0c; z < Math.min(z0c + CHUNK_SIZE, h); z++) {
    for (let x = x0c; x < Math.min(x0c + CHUNK_SIZE, w); x++) {
      const c = z * w + x;
      const block = blocks[c] as BlockType;
      const vis = BLOCK_VISUALS[block] ?? BLOCK_VISUALS[BlockType.Grass];
      const g = ground[c];
      const top = g + heights[c];
      const vary = 1 + (hash01(c) - 0.5) * 0.08;
      const tinted = isTinted(block);
      const role = tinted ? ROLE_BUILDING : ROLE_STATIC;
      const terrainTop = vis.shape === 'tree' || vis.shape === 'pole' ? BLOCK_VISUALS[BlockType.Grass].top : vis.top;
      const groundSide = rgb(vis.shape === 'structure' || vis.shape === 'flat' ? 0x7a5c3e : vis.side, vary);
      const wall = rgb(vis.side, vary);

      // Top face.
      solid.face('py', x, x + 1, 0, top * Y, z, z + 1, rgb(vis.shape === 'structure' ? vis.top : terrainTop, vary), role, c);

      // Side faces, split into the terrain part and the structure part.
      const sides: [Dir, number][] = [
        ['px', at(x + 1, z)],
        ['nx', at(x - 1, z)],
        ['pz', at(x, z + 1)],
        ['nz', at(x, z - 1)],
      ];
      for (const [dir, nb] of sides) {
        const nTop = nb < 0 ? -1 : drawnTop(world, nb);
        if (nTop < g) solid.face(dir, x, x + 1, Math.max(nTop, -1) * Y, g * Y, z, z + 1, groundSide, ROLE_STATIC, c);
        if (top > g && nTop < top && !sameBuilding(c, nb)) {
          const from = Math.max(nTop, g);
          solid.face(dir, x, x + 1, from * Y, top * Y, z, z + 1, wall, role, c, 0.88);
          if (vis.windows) {
            for (let row = Math.ceil(from - g); row + 0.8 <= top - g; row++) {
              const y0 = (g + row + 0.35) * Y;
              const y1 = (g + row + 0.8) * Y;
              const e = 0.015;
              for (let pane = 0; pane < 2; pane++) {
                const a = pane ? 0.54 : 0.12;
                const b = pane ? 0.88 : 0.46;
                const lit = windowLit(c, row, pane, dir);
                const col: Rgb = [lit, lit, lit];
                if (dir === 'px') windows.face(dir, x + e, x + 1 + e, y0, y1, z + a, z + b, col, ROLE_BUILDING, c, 1);
                if (dir === 'nx') windows.face(dir, x - e, x + 1, y0, y1, z + a, z + b, col, ROLE_BUILDING, c, 1);
                if (dir === 'pz') windows.face(dir, x + a, x + b, y0, y1, z, z + 1 + e, col, ROLE_BUILDING, c, 1);
                if (dir === 'nz') windows.face(dir, x + a, x + b, y0, y1, z - e, z + 1, col, ROLE_BUILDING, c, 1);
              }
            }
          }
        }
        // Roof rim along the building's own outline, so neighbouring buildings of equal height read apart.
        if (buildingIndex[c] && tinted && top > g && !PROP_HEIGHT[block] && !sameBuilding(c, nb)) {
          const t = top * Y;
          const rim = rgb(vis.top, vary * 0.72);
          const k = 0.07;
          if (dir === 'px') solid.box(x + 1 - k, x + 1, t, t + 0.09, z, z + 1, rim, role, c);
          if (dir === 'nx') solid.box(x, x + k, t, t + 0.09, z, z + 1, rim, role, c);
          if (dir === 'pz') solid.box(x, x + 1, t, t + 0.09, z + 1 - k, z + 1, rim, role, c);
          if (dir === 'nz') solid.box(x, x + 1, t, t + 0.09, z, z + k, rim, role, c);
        }
      }

      decorate(solid, world, deck, c, x, z, top, vary);
    }
  }
  return { solid: solid.build(), windows: windows.build() };
};

/** Sloped road surface with side walls, plus low parapets so the climb reads as a bridge approach. */
const drawRamp = (b: Builder, r: Ramp, x: number, z: number, base: number, road: Rgb, c: number, open: { lo: boolean; hi: boolean }): void => {
  const hAt = (fx: number, fz: number) => rampHeight(r, fx, fz);
  const x1 = x + 1;
  const z1 = z + 1;
  b.quad([[x, hAt(0, 0), z], [x, hAt(0, 1), z1], [x1, hAt(1, 1), z1], [x1, hAt(1, 0), z]], road, ROLE_STATIC, c);
  const wall = rgb(0x8a7663);
  const rail = rgb(0xd0c8bc);
  const p = 0.12;
  if (r.dx !== 0) {
    if (open.hi) {
      b.quad([[x, base, z1], [x1, base, z1], [x1, hAt(1, 1), z1], [x, hAt(0, 1), z1]], wall, ROLE_STATIC, c);
      b.quad([[x, hAt(0, 1), z1], [x1, hAt(1, 1), z1], [x1, hAt(1, 1) + p, z1], [x, hAt(0, 1) + p, z1]], rail, ROLE_STATIC, c);
      b.quad([[x1, hAt(1, 1), z1 - 0.01], [x, hAt(0, 1), z1 - 0.01], [x, hAt(0, 1) + p, z1 - 0.01], [x1, hAt(1, 1) + p, z1 - 0.01]], rail, ROLE_STATIC, c);
    }
    if (open.lo) {
      b.quad([[x1, base, z], [x, base, z], [x, hAt(0, 0), z], [x1, hAt(1, 0), z]], wall, ROLE_STATIC, c);
      b.quad([[x1, hAt(1, 0), z], [x, hAt(0, 0), z], [x, hAt(0, 0) + p, z], [x1, hAt(1, 0) + p, z]], rail, ROLE_STATIC, c);
      b.quad([[x, hAt(0, 0), z + 0.01], [x1, hAt(1, 0), z + 0.01], [x1, hAt(1, 0) + p, z + 0.01], [x, hAt(0, 0) + p, z + 0.01]], rail, ROLE_STATIC, c);
    }
  } else {
    if (open.hi) {
      b.quad([[x1, base, z1], [x1, base, z], [x1, hAt(1, 0), z], [x1, hAt(1, 1), z1]], wall, ROLE_STATIC, c);
      b.quad([[x1, hAt(1, 1), z1], [x1, hAt(1, 0), z], [x1, hAt(1, 0) + p, z], [x1, hAt(1, 1) + p, z1]], rail, ROLE_STATIC, c);
      b.quad([[x1 - 0.01, hAt(1, 0), z], [x1 - 0.01, hAt(1, 1), z1], [x1 - 0.01, hAt(1, 1) + p, z1], [x1 - 0.01, hAt(1, 0) + p, z]], rail, ROLE_STATIC, c);
    }
    if (open.lo) {
      b.quad([[x, base, z], [x, base, z1], [x, hAt(0, 1), z1], [x, hAt(0, 0), z]], wall, ROLE_STATIC, c);
      b.quad([[x, hAt(0, 0), z], [x, hAt(0, 1), z1], [x, hAt(0, 1) + p, z1], [x, hAt(0, 0) + p, z]], rail, ROLE_STATIC, c);
      b.quad([[x + 0.01, hAt(0, 1), z1], [x + 0.01, hAt(0, 0), z], [x + 0.01, hAt(0, 0) + p, z], [x + 0.01, hAt(0, 1) + p, z1]], rail, ROLE_STATIC, c);
    }
  }
};

const decorate = (b: Builder, world: WorldSnapshot, deck: Int16Array, c: number, x: number, z: number, top: number, vary: number): void => {
  const { w, h, blocks, buildingIndex } = world;
  const Y = Y_SCALE;
  const block = blocks[c] as BlockType;
  const ty = top * Y;
  const r = hash01(c * 7 + 3);
  const same = (dx: number, dz: number) => {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= w || nz >= h) return false;
    const nb = nz * w + nx;
    return buildingIndex[c] !== 0 ? buildingIndex[nb] === buildingIndex[c] : blocks[nb] === block;
  };
  const isRoadAt = (dx: number, dz: number) => {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= w || nz >= h) return false;
    const bl = blocks[nz * w + nx];
    return bl === BlockType.Road || bl === BlockType.Bridge;
  };
  const centreOfBuilding = same(1, 0) && same(-1, 0) && same(0, 1) && same(0, -1);
  const topLeft = !same(-1, 0) && !same(0, -1);

  // Pavement strips occupy open terrain beside streets (1.4 m wide). These
  // are visual surfaces only; pedestrian routing must come from AK's graph.
  if ([BlockType.Grass,BlockType.Dirt,BlockType.Sand,BlockType.Tree,BlockType.Pole].includes(block)) {
    const pavement=rgb(0xc4c6bd);
    if(isRoadAt(-1,0))b.box(x,x+.3,ty,ty+.03,z,z+1,pavement,ROLE_STATIC,c);
    if(isRoadAt(1,0))b.box(x+.7,x+1,ty,ty+.03,z,z+1,pavement,ROLE_STATIC,c);
    if(isRoadAt(0,-1))b.box(x,x+1,ty,ty+.03,z,z+.3,pavement,ROLE_STATIC,c);
    if(isRoadAt(0,1))b.box(x,x+1,ty,ty+.03,z+.7,z+1,pavement,ROLE_STATIC,c);
  }
  if (block===BlockType.Office || block===BlockType.Apartment) {
    const parapet=rgb(0x76868a);
    if(!same(-1,0))b.box(x,x+.035,ty,ty+.15,z,z+1,parapet,ROLE_BUILDING,c);
    if(!same(1,0))b.box(x+.965,x+1,ty,ty+.15,z,z+1,parapet,ROLE_BUILDING,c);
    if(!same(0,-1))b.box(x,x+1,ty,ty+.15,z,z+.035,parapet,ROLE_BUILDING,c);
    if(!same(0,1))b.box(x,x+1,ty,ty+.15,z+.965,z+1,parapet,ROLE_BUILDING,c);
    if(topLeft)b.box(x+.2,x+.55,ty,ty+.2,z+.2,z+.55,rgb(0xa0adb0),ROLE_BUILDING,c);
  }

  switch (block) {
    case BlockType.Tree: {
      const s = 0.55 + r * 0.25;
      const ox = x + 0.5 + (hash01(c + 11) - 0.5) * 0.3;
      const oz = z + 0.5 + (hash01(c + 17) - 0.5) * 0.3;
      b.box(ox - 0.08, ox + 0.08, ty, ty + 1.2 * Y, oz - 0.08, oz + 0.08, rgb(0x6f5640), ROLE_STATIC, c);
      const leaf = r < 0.5 ? 0x557f47 : 0x648c50;
      b.box(ox - s / 2, ox + s / 2, ty + 1 * Y, ty + (2.4 + r) * Y, oz - s / 2, oz + s / 2, rgb(leaf, vary), ROLE_STATIC, c);
      break;
    }
    case BlockType.Pole:
      b.box(x + 0.45, x + 0.55, ty, ty + 5 * Y, z + 0.45, z + 0.55, rgb(0x5b4636), ROLE_STATIC, c);
      b.box(x + 0.2, x + 0.8, ty + 4.6 * Y, ty + 4.8 * Y, z + 0.47, z + 0.53, rgb(0x5b4636), ROLE_STATIC, c);
      break;
    case BlockType.Road: {
      const ramp = rampAt(world, deck, c);
      if (ramp) {
        const twin = (sx: number, sz: number) => {
          const nx = x + sx;
          const nz = z + sz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) return false;
          const o = rampAt(world, deck, nz * w + nx);
          return !!o && o.dx === ramp.dx && o.dz === ramp.dz;
        };
        const open = ramp.dx !== 0 ? { lo: !twin(0, -1), hi: !twin(0, 1) } : { lo: !twin(-1, 0), hi: !twin(1, 0) };
        drawRamp(b, ramp, x, z, ty, rgb(BLOCK_VISUALS[BlockType.Road].top, vary), c, open);
        break;
      }
      const ew = isRoadAt(1, 0) && isRoadAt(-1, 0) && !isRoadAt(0, 1) && !isRoadAt(0, -1);
      const ns = isRoadAt(0, 1) && isRoadAt(0, -1) && !isRoadAt(1, 0) && !isRoadAt(-1, 0);
      const line = rgb(0xd9d2b8);
      if (ew) b.face('py', x + 0.3, x + 0.7, 0, ty + 0.01, z + 0.47, z + 0.53, line, ROLE_STATIC, c);
      if (ns) b.face('py', x + 0.47, x + 0.53, 0, ty + 0.01, z + 0.3, z + 0.7, line, ROLE_STATIC, c);
      // Raised kerb-side footway where the road meets anything but road; pedestrians keep to it.
      const kerb = rgb(0xb9bbb2, vary);
      const k = 0.15;
      const kh = ty + 0.05;
      if (!isRoadAt(-1, 0)) b.box(x, x + k, ty, kh, z, z + 1, kerb, ROLE_STATIC, c);
      if (!isRoadAt(1, 0)) b.box(x + 1 - k, x + 1, ty, kh, z, z + 1, kerb, ROLE_STATIC, c);
      if (!isRoadAt(0, -1)) b.box(x, x + 1, ty, kh, z, z + k, kerb, ROLE_STATIC, c);
      if (!isRoadAt(0, 1)) b.box(x, x + 1, ty, kh, z + 1 - k, z + 1, kerb, ROLE_STATIC, c);
      break;
    }
    case BlockType.Drainage:
      for (let i = 0; i < 3; i++) {
        b.face('py', x + 0.2, x + 0.8, 0, ty + 0.01, z + 0.25 + i * 0.2, z + 0.32 + i * 0.2, rgb(0x15252c), ROLE_STATIC, c);
      }
      break;
    case BlockType.Bridge: {
      const d = deck[c] >= 0 ? deck[c] : top + 2;
      const dy = d * Y;
      b.box(x, x + 1, dy - 0.25, dy, z, z + 1, rgb(0x8a7663, vary), ROLE_STATIC, c);
      const walk = rgb(0xb3ada3, vary);
      const rail = rgb(0xd0c8bc);
      if (!isRoadAt(0, -1)) {
        b.box(x, x + 1, dy, dy + 0.05, z + 0.06, z + 0.2, walk, ROLE_STATIC, c);
        b.box(x, x + 1, dy, dy + 0.18, z, z + 0.06, rail, ROLE_STATIC, c);
      }
      if (!isRoadAt(0, 1)) {
        b.box(x, x + 1, dy, dy + 0.05, z + 0.8, z + 0.94, walk, ROLE_STATIC, c);
        b.box(x, x + 1, dy, dy + 0.18, z + 0.94, z + 1, rail, ROLE_STATIC, c);
      }
      if (!isRoadAt(-1, 0)) {
        b.box(x + 0.06, x + 0.2, dy, dy + 0.05, z, z + 1, walk, ROLE_STATIC, c);
        b.box(x, x + 0.06, dy, dy + 0.18, z, z + 1, rail, ROLE_STATIC, c);
      }
      if (!isRoadAt(1, 0)) {
        b.box(x + 0.8, x + 0.94, dy, dy + 0.05, z, z + 1, walk, ROLE_STATIC, c);
        b.box(x + 0.94, x + 1, dy, dy + 0.18, z, z + 1, rail, ROLE_STATIC, c);
      }
      if ((x + z) % 2 === 0) b.box(x + 0.4, x + 0.6, 0, dy - 0.25, z + 0.4, z + 0.6, rgb(0x6f6458), ROLE_STATIC, c);
      break;
    }
    case BlockType.Hospital:
      if (centreOfBuilding) {
        const cross = rgb(0x1f9d63);
        b.box(x + 0.1, x + 0.9, ty, ty + 0.06, z + 0.38, z + 0.62, cross, ROLE_STATIC, c);
        b.box(x + 0.38, x + 0.62, ty, ty + 0.06, z + 0.1, z + 0.9, cross, ROLE_STATIC, c);
      }
      break;
    case BlockType.Helipad:
      if (topLeft) {
        const wx = same(1, 0) ? 2 : 1;
        const wz = same(0, 1) ? 2 : 1;
        const cx = x + wx / 2;
        const cz = z + wz / 2;
        const s = Math.min(wx, wz) * 0.32;
        const white = rgb(0xf5f5f5);
        b.box(cx - s, cx - s * 0.6, ty, ty + 0.04, cz - s, cz + s, white, ROLE_STATIC, c);
        b.box(cx + s * 0.6, cx + s, ty, ty + 0.04, cz - s, cz + s, white, ROLE_STATIC, c);
        b.box(cx - s * 0.6, cx + s * 0.6, ty, ty + 0.04, cz - s * 0.15, cz + s * 0.15, white, ROLE_STATIC, c);
      }
      break;
    case BlockType.FloodHQ:
      if (topLeft) {
        b.box(x + 0.42, x + 0.58, ty, ty + 6 * Y, z + 0.42, z + 0.58, rgb(0xb0b6bd), ROLE_STATIC, c);
        b.box(x + 0.38, x + 0.62, ty + 6 * Y, ty + 6.5 * Y, z + 0.38, z + 0.62, rgb(0xff3b30), ROLE_STATIC, c);
      }
      break;
    case BlockType.PowerPlant:
      if (centreOfBuilding || (topLeft && !same(1, 1))) {
        b.box(x + 0.3, x + 0.7, ty, ty + 7 * Y, z + 0.3, z + 0.7, rgb(0x9aa3a5), ROLE_STATIC, c);
        b.box(x + 0.28, x + 0.72, ty + 6.4 * Y, ty + 7 * Y, z + 0.28, z + 0.72, rgb(0xd04a3a), ROLE_STATIC, c);
      }
      break;
    case BlockType.Substation:
      b.box(x + 0.2, x + 0.45, ty, ty + 1.2 * Y, z + 0.25, z + 0.75, rgb(0x6f7678), ROLE_STATIC, c);
      b.box(x + 0.55, x + 0.8, ty, ty + 1.2 * Y, z + 0.25, z + 0.75, rgb(0x6f7678), ROLE_STATIC, c);
      break;
    case BlockType.BoatDepot:
      if (topLeft) b.box(x + 0.2, x + 1.0, ty, ty + 0.5 * Y, z + 0.3, z + 0.7, rgb(0xff7a1a), ROLE_STATIC, c);
      break;
    case BlockType.Shelter:
      if (centreOfBuilding) b.box(x + 0.3, x + 0.7, ty, ty + 0.06, z + 0.3, z + 0.7, rgb(0xffffff), ROLE_STATIC, c);
      break;
    default:
      break;
  }
};
