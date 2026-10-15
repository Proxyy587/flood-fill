import { BlockType } from '../blocks';
import { asBuildingId } from '../ids';
import type { BuildingDef, PowerNode, Scenario } from '../scenario';
import { createMockRng } from './rng';

// A synthetic test city, 96 × 96 cells (384 m × 384 m). The layout follows
// how real river towns grow: a meandering channel inside a floodplain park, a
// dense quay-side downtown, a low old town in a natural basin, a levee-backed
// suburb, hill estates with closed hollows, a rail embankment with
// underpasses, and a port and power station downstream.

const W = 96;
const H = 96;
/** Channel half-width, cells. */
const HALF = 2.4;
const AVENUE_Z = [44, 45];
const MILL_Z = 86;
const EMBANKMENT_Z = [50, 51];
const UNDERPASS_X = [60, 61, 82];

const WEST_STREETS_X = [8, 18, 19, 29];
const WEST_STREETS_Z = [6, 16, 26, 36, 44, 45, 56, 66, 76, MILL_Z];
const EAST_STREETS_X = [52, 60, 61, 67, 74, 82, 90];
const EAST_STREETS_Z = [8, 18, 28, 37, 44, 45, 56, 62, 70, 78, MILL_Z];

/** River centreline (x, in cells) for row z. */
export const riverCentre = (z: number): number => 41 + 6 * Math.sin((z + 4) / 13) + 1.5 * Math.sin(z / 5.3);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const bowl = (x: number, z: number, cx: number, cz: number, r: number) => smooth(0, 1, 1 - Math.hypot(x - cx, z - cz) / r);
const hill = (x: number, z: number, cx: number, cz: number, r: number) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

/** Floodplain park width beside the sand bank, per side. */
const floodplainWidth = (z: number, east: boolean): number => {
  if (east) return z >= 26 && z <= 60 ? 1 : z > 80 ? 3 : 5;
  return z < 40 ? 6 : z < 50 ? 3 : 2;
};

type Kind = 'channel' | 'sand' | 'plain' | 'urban';

const terrainAt = (x: number, z: number): { g: number; kind: Kind } => {
  const d = x + 0.5 - riverCentre(z + 0.5);
  const ad = Math.abs(d);
  const east = d > 0;
  if (ad <= HALF) return { g: 0, kind: 'channel' };
  if (ad <= HALF + 1) return { g: 2, kind: 'sand' };
  const fp = floodplainWidth(z, east);
  if (ad <= HALF + 1 + fp) return { g: 1, kind: 'plain' };
  const t = ad - (HALF + 1 + fp);
  let g: number;
  if (!east) {
    // Westridge climbs away from the river; Millbrook (south) stays low behind its levee.
    g = 4 + Math.min(9, t * 0.35) + 3.5 * hill(x, z, 6, 14, 16);
    g -= smooth(46, 58, z) * Math.min(6, t * 0.3 + 1);
  } else {
    g = 3 + Math.min(1.5, t * 0.12);
    g += 6 * smooth(68, 80, x) * (1 - smooth(40, 54, z));
    g -= 2.2 * bowl(x, z, 64, 70, 10);
    // Eastbank Heights estate is dished toward one hollow: high ground, but it still ponds.
    g -= 1.5 * bowl(x, z, 86, 28, 14) + 2.6 * bowl(x, z, 86, 28, 5.5);
  }
  return { g: Math.max(2, Math.round(g)), kind: 'urban' };
};

interface Landmark {
  name: string;
  type: BlockType;
  x: number;
  z: number;
  w: number;
  d: number;
  capacity: number;
  generator?: number;
  helipad?: boolean;
}

/** Fixed civic sites. Positions are anchors; placement nudges to the nearest legal lot. */
export const MOCK_LANDMARKS: readonly Landmark[] = [
  { name: 'St. Avery General Hospital', type: BlockType.Hospital, x: 20, z: 28, w: 3, d: 3, capacity: 60, generator: 2400 },
  { name: 'Eastbank Medical Centre', type: BlockType.Hospital, x: 54, z: 39, w: 3, d: 3, capacity: 45, generator: 900 },
  { name: 'Eastbank Helipad', type: BlockType.Helipad, x: 57, z: 39, w: 2, d: 2, capacity: 2, helipad: true },
  { name: 'Westridge Community Hall', type: BlockType.Shelter, x: 10, z: 9, w: 3, d: 3, capacity: 180 },
  { name: 'Hilltop School', type: BlockType.Shelter, x: 84, z: 11, w: 3, d: 3, capacity: 220 },
  { name: 'Old Town Gym', type: BlockType.Shelter, x: 69, z: 64, w: 3, d: 3, capacity: 120 },
  { name: 'Central Police Station', type: BlockType.PoliceStation, x: 63, z: 32, w: 2, d: 2, capacity: 16 },
  { name: 'Flood Response HQ', type: BlockType.FloodHQ, x: 21, z: 47, w: 3, d: 2, capacity: 10 },
  { name: 'River Boat Depot', type: BlockType.BoatDepot, x: 49, z: 41, w: 2, d: 2, capacity: 8 },
  { name: 'Fire Station 3', type: BlockType.FireStation, x: 62, z: 72, w: 2, d: 2, capacity: 10 },
  { name: 'Southport Power Station', type: BlockType.PowerPlant, x: 64, z: 89, w: 3, d: 3, capacity: 0 },
  { name: 'Westridge Substation', type: BlockType.Substation, x: 11, z: 40, w: 2, d: 2, capacity: 0 },
  { name: 'Old Town Substation', type: BlockType.Substation, x: 63, z: 68, w: 2, d: 2, capacity: 0 },
  { name: 'Heights Substation', type: BlockType.Substation, x: 88, z: 31, w: 2, d: 2, capacity: 0 },
];

export const MOCK_DISTRICTS = ['Westridge', 'Millbrook', 'Downtown', 'Old Town', 'Eastbank Heights', 'Southport'] as const;

const districtOf = (x: number, z: number): number => {
  const east = x + 0.5 > riverCentre(z + 0.5);
  if (!east) return z < 50 ? 0 : 1;
  if (z >= 82) return 5;
  if (x >= 76 && z < 50) return 4;
  return z < 50 ? 2 : 3;
};

type Zone = 'estate' | 'suburb' | 'midrise' | 'cbd' | 'oldtown' | 'industrial' | 'park';

const PARKS = [
  { x0: 53, x1: 58, z0: 30, z1: 36 },
  { x0: 9, x1: 16, z0: 58, z1: 64 },
  { x0: 76, x1: 80, z0: 57, z1: 61 },
  { x0: 24, x1: 28, z0: 8, z1: 14 },
  { x0: 66, x1: 69, z0: 38, z1: 41 },
  { x0: 36, x1: 41, z0: 20, z1: 25 },
  { x0: 30, x1: 34, z0: 72, z1: 77 },
  { x0: 84, x1: 89, z0: 68, z1: 72 },
  { x0: 66, x1: 70, z0: 12, z1: 16 },
  { x0: 6, x1: 10, z0: 36, z1: 40 },
];

const zoneAt = (x: number, z: number): Zone => {
  if (PARKS.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1)) return 'park';
  const east = x + 0.5 > riverCentre(z + 0.5);
  if (!east) {
    if (z < 30 && x < 16) return 'estate';
    if (z >= 38 && z <= 52) return 'midrise';
    return 'suburb';
  }
  if (z >= 82) return 'industrial';
  if (x >= 76) return z < 50 ? 'suburb' : 'midrise';
  if (z < 24) return 'midrise';
  if (z < 50) return 'cbd';
  return 'oldtown';
};

/** Deterministic lattice value noise in [0, 1). */
const noise = (x: number, z: number, scale: number, seed: number): number => {
  const h = (ix: number, iz: number) => {
    let t = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2246822519);
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smooth(0, 1, fx - ix);
  const tz = smooth(0, 1, fz - iz);
  const a = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * tx;
  const b = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * tx;
  return a + (b - a) * tz;
};

/** Procedural river city (96 × 96). Deterministic for a given seed. */
export const mockScenario = (seed = 7): Scenario => {
  const rng = createMockRng(seed);
  const n = W * H;
  const idx = (x: number, z: number) => z * W + x;
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;
  const ground = new Array<number>(n);
  const blocks = new Array<number>(n).fill(BlockType.Grass);
  const kind = new Array<Kind>(n);
  const owner = new Int32Array(n).fill(-1);

  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const t = terrainAt(x, z);
      const c = idx(x, z);
      ground[c] = t.g;
      kind[c] = t.kind;
      if (t.kind === 'channel') blocks[c] = BlockType.WaterSource;
      else if (t.kind === 'sand') blocks[c] = BlockType.Sand;
    }
  }

  const westEdge = (z: number) => {
    for (let x = Math.floor(riverCentre(z + 0.5)); x >= 0; x--) if (kind[idx(x, z)] === 'urban') return x;
    return 0;
  };
  const eastEdge = (z: number) => {
    for (let x = Math.ceil(riverCentre(z + 0.5)); x < W; x++) if (kind[idx(x, z)] === 'urban') return x;
    return W - 1;
  };
  const isEast = (x: number, z: number) => x + 0.5 > riverCentre(z + 0.5);

  // Rail embankment across the east side; roads pass under it.
  for (const z of EMBANKMENT_Z) {
    for (let x = eastEdge(z); x < W; x++) {
      const c = idx(x, z);
      if (UNDERPASS_X.includes(x)) continue;
      ground[c] += 2;
      blocks[c] = BlockType.Rock;
    }
  }

  const road = (x: number, z: number) => {
    if (!inside(x, z)) return;
    const c = idx(x, z);
    if (kind[c] !== 'urban' || blocks[c] === BlockType.Rock) return;
    blocks[c] = BlockType.Road;
  };

  // Riverside drives follow the floodplain edge on both banks.
  for (let z = 0; z < H; z++) {
    road(westEdge(z), z);
    road(eastEdge(z), z);
    if (z < H - 1) {
      for (const edge of [westEdge, eastEdge]) {
        const a = edge(z);
        const b = edge(z + 1);
        if (a < b) for (let x = a; x <= b; x++) road(x, z);
        else for (let x = b; x <= a; x++) road(x, z + 1);
      }
    }
  }
  for (const z of WEST_STREETS_Z) for (let x = 0; x <= westEdge(z); x++) road(x, z);
  for (const x of WEST_STREETS_X) for (let z = 0; z < H; z++) if (!isEast(x, z)) road(x, z);
  for (const z of EAST_STREETS_Z) for (let x = eastEdge(z); x < W; x++) road(x, z);
  for (const x of EAST_STREETS_X) for (let z = 0; z < H; z++) if (isEast(x, z)) road(x, z);

  // Underpasses: the road ramps down three metres to pass under the rail line.
  for (const x of UNDERPASS_X) {
    for (const z of EMBANKMENT_Z) {
      const c = idx(x, z);
      blocks[c] = BlockType.Road;
      ground[c] = Math.max(1, ground[c] - 3);
    }
    for (const [dz, drop] of [[1, 2], [2, 1]] as const) {
      for (const z of [EMBANKMENT_Z[0] - dz, EMBANKMENT_Z[1] + dz]) {
        const c = idx(x, z);
        if (blocks[c] === BlockType.Road) ground[c] = Math.max(1, ground[c] - drop);
      }
    }
  }

  // Avenue Bridge spans the whole floodplain (high deck). Mill Bridge spans only
  // the channel, so its approaches cross the floodplain at park level (low deck).
  for (const z of AVENUE_Z) {
    for (let x = westEdge(z) + 1; x < eastEdge(z); x++) blocks[idx(x, z)] = BlockType.Bridge;
  }
  for (let x = westEdge(MILL_Z) + 1; x < eastEdge(MILL_Z); x++) {
    const c = idx(x, MILL_Z);
    blocks[c] = kind[c] === 'channel' ? BlockType.Bridge : BlockType.Road;
  }

  // Millbrook levee on the floodplain edge.
  for (let z = 46; z < H; z++) {
    const x = westEdge(z) + 1;
    const c = idx(x, z);
    if (kind[c] === 'plain' && blocks[c] === BlockType.Grass) blocks[c] = BlockType.Levee;
  }

  const isRoad = (c: number) => blocks[c] === BlockType.Road || blocks[c] === BlockType.Bridge;
  const buildings: BuildingDef[] = [];

  const footprintCells = (x: number, z: number, w: number, d: number): number[] | null => {
    const cells: number[] = [];
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (!inside(x + dx, z + dz)) return null;
        cells.push(idx(x + dx, z + dz));
      }
    }
    return cells;
  };

  const touchesRoad = (x: number, z: number, w: number, d: number): number => {
    for (let dz = -1; dz <= d; dz++) {
      for (let dx = -1; dx <= w; dx++) {
        const edge = dz === -1 || dz === d || dx === -1 || dx === w;
        const corner = (dz === -1 || dz === d) && (dx === -1 || dx === w);
        if (!edge || corner || !inside(x + dx, z + dz)) continue;
        const c = idx(x + dx, z + dz);
        if (isRoad(c)) return c;
      }
    }
    return -1;
  };

  const canPlace = (x: number, z: number, w: number, d: number, margin: number): boolean => {
    const cells = footprintCells(x, z, w, d);
    if (!cells) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of cells) {
      if (owner[c] >= 0 || blocks[c] !== BlockType.Grass || kind[c] !== 'urban') return false;
      lo = Math.min(lo, ground[c]);
      hi = Math.max(hi, ground[c]);
    }
    if (hi - lo > 1) return false;
    for (let dz = -margin; dz < d + margin; dz++) {
      for (let dx = -margin; dx < w + margin; dx++) {
        if (inside(x + dx, z + dz) && owner[idx(x + dx, z + dz)] >= 0) return false;
      }
    }
    return touchesRoad(x, z, w, d) >= 0;
  };

  const place = (type: BlockType, x: number, z: number, w: number, d: number, extra: Partial<BuildingDef> & { capacity: number }): void => {
    const cells = footprintCells(x, z, w, d) as number[];
    const pad = Math.min(...cells.map((c) => ground[c]));
    for (const c of cells) {
      ground[c] = pad;
      blocks[c] = type;
      owner[c] = buildings.length;
    }
    buildings.push({
      id: asBuildingId(buildings.length + 1),
      type,
      cells,
      entrance: touchesRoad(x, z, w, d),
      floorHeight: 0.4,
      ...extra,
    });
  };

  for (const s of MOCK_LANDMARKS) {
    let spot: [number, number] | null = null;
    for (let r = 0; r <= 8 && !spot; r++) {
      for (let dz = -r; dz <= r && !spot; dz++) {
        for (let dx = -r; dx <= r && !spot; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (canPlace(s.x + dx, s.z + dz, s.w, s.d, 0)) spot = [s.x + dx, s.z + dz];
        }
      }
    }
    if (!spot) continue;
    place(s.type, spot[0], spot[1], s.w, s.d, {
      capacity: s.capacity,
      floorHeight: 0.5,
      ...(s.generator ? { generator: { fuelTicks: s.generator } } : {}),
      ...(s.helipad ? { helipad: true } : {}),
    });
  }

  // Lots: building type, footprint, spacing and density follow the zone.
  const capacityOf = (type: BlockType, cells: number): number =>
    type === BlockType.House ? 4 : type === BlockType.Apartment ? 10 * cells : type === BlockType.Office ? 8 * cells : 4 * cells;
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const zone = zoneAt(x, z);
      if (zone === 'park') continue;
      const roll = rng.next();
      const density = { estate: 0.3, suburb: 0.42, midrise: 0.45, cbd: 0.6, oldtown: 0.55, industrial: 0.45 }[zone];
      if (rng.next() > density) continue;
      let options: [BlockType, number, number][];
      let margin = 1;
      switch (zone) {
        case 'estate':
          options = [[BlockType.House, 2, 2]];
          break;
        case 'suburb':
          options = roll < 0.88 ? [[BlockType.House, 2, 2]] : [[BlockType.Apartment, 2, 2]];
          break;
        case 'midrise':
          options = roll < 0.55 ? [[BlockType.Apartment, 3, 2], [BlockType.Apartment, 2, 2]] : roll < 0.8 ? [[BlockType.Shop, 2, 2]] : [[BlockType.House, 2, 2]];
          break;
        case 'cbd':
          margin = roll < 0.3 ? 0 : 1;
          options = roll < 0.25 ? [[BlockType.Office, 3, 3], [BlockType.Office, 2, 2]] : roll < 0.6 ? [[BlockType.Office, 2, 2]] : roll < 0.85 ? [[BlockType.Apartment, 2, 2]] : [[BlockType.Shop, 2, 2]];
          break;
        case 'oldtown':
          margin = roll < 0.5 ? 0 : 1;
          options = roll < 0.4 ? [[BlockType.Apartment, 2, 2]] : roll < 0.75 ? [[BlockType.House, 2, 2]] : [[BlockType.Shop, 2, 2]];
          break;
        case 'industrial':
          options = [[BlockType.Shop, 4, 3], [BlockType.Shop, 3, 3]];
          break;
      }
      for (const [type, w, d] of options) {
        if (!canPlace(x, z, w, d, margin)) continue;
        place(type, x, z, w, d, { capacity: capacityOf(type, w * d) });
        break;
      }
    }
  }

  // Storm drains sit at the low points of each catchment; the underpasses have none.
  const drainsNear = (cx: number, cz: number, count: number) => {
    const spots: [number, number][] = [];
    for (let z = Math.max(0, cz - 10); z <= Math.min(H - 1, cz + 10); z++) {
      for (let x = Math.max(0, cx - 10); x <= Math.min(W - 1, cx + 10); x++) {
        const c = idx(x, z);
        if (blocks[c] !== BlockType.Grass || kind[c] !== 'urban' || owner[c] >= 0) continue;
        if (touchesRoad(x, z, 1, 1) < 0) continue;
        spots.push([ground[c] * 100 + Math.hypot(x - cx, z - cz), c]);
      }
    }
    spots.sort((a, b) => a[0] - b[0]);
    for (const [, c] of spots.slice(0, count)) blocks[c] = BlockType.Drainage;
  };
  drainsNear(64, 70, 4);
  drainsNear(56, 42, 2);
  drainsNear(86, 28, 1);
  drainsNear(16, 72, 3);

  // Vegetation: riparian woods, park groves, street trees on the avenues, yard trees.
  const arterial = (x: number, z: number) => [18, 19, 60, 61].includes(x) || AVENUE_Z.includes(z);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const c = idx(x, z);
      if (blocks[c] !== BlockType.Grass || owner[c] >= 0) continue;
      const nearRoad = touchesRoad(x, z, 1, 1) >= 0;
      const grove = noise(x, z, 5, seed);
      if (kind[c] === 'plain') {
        if (grove > 0.52 && !nearRoad) blocks[c] = BlockType.Tree;
        continue;
      }
      const zone = zoneAt(x, z);
      if (zone === 'park') {
        const p = PARKS.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
        const path = p && (x === Math.floor((p.x0 + p.x1) / 2) || z === Math.floor((p.z0 + p.z1) / 2));
        if (path) blocks[c] = BlockType.Dirt;
        else if (grove > 0.4) blocks[c] = BlockType.Tree;
        continue;
      }
      if (nearRoad) {
        const streetSide = (x + z) % 3 === 0;
        if (arterial(x - 1, z) || arterial(x + 1, z) || arterial(x, z - 1) || arterial(x, z + 1)) {
          if (streetSide) blocks[c] = BlockType.Tree;
        }
        continue;
      }
      const yard = zone === 'estate' ? 0.2 : zone === 'suburb' ? 0.12 : zone === 'industrial' ? 0.01 : 0.04;
      if (rng.chance(yard)) blocks[c] = BlockType.Tree;
    }
  }

  // Power grid: plant → substations → a load per building (nearest substation).
  const centre = (b: BuildingDef) => b.cells[Math.floor(b.cells.length / 2)];
  const plant = buildings.find((b) => b.type === BlockType.PowerPlant);
  const subs = buildings.filter((b) => b.type === BlockType.Substation);
  const nodes: PowerNode[] = [];
  const edges: [number, number][] = [];
  if (plant) {
    nodes.push({ id: 0, kind: 'plant', cell: centre(plant), building: plant.id });
    plant.powerNode = 0;
  }
  subs.forEach((s, i) => {
    const id = 1 + i;
    nodes.push({ id, kind: 'substation', cell: centre(s), building: s.id });
    s.powerNode = id;
    if (plant) edges.push([0, id]);
  });
  let nextNode = 1 + subs.length;
  for (const b of buildings) {
    if (b.type === BlockType.PowerPlant || b.type === BlockType.Substation) continue;
    const c = centre(b);
    let bestSub = subs[0];
    let bestD = Infinity;
    for (const s of subs) {
      const sc = centre(s);
      const d = Math.hypot((sc % W) - (c % W), Math.floor(sc / W) - Math.floor(c / W));
      if (d < bestD) {
        bestD = d;
        bestSub = s;
      }
    }
    const id = nextNode++;
    nodes.push({ id, kind: 'load', cell: c, building: b.id });
    b.powerNode = id;
    if (bestSub?.powerNode !== undefined) edges.push([bestSub.powerNode, id]);
  }

  const districtCells: number[][] = MOCK_DISTRICTS.map(() => []);
  for (let c = 0; c < n; c++) districtCells[districtOf(c % W, Math.floor(c / W))].push(c);

  return {
    schemaVersion: 1,
    name: 'riverside-test-city',
    size: { w: W, h: H },
    ground,
    blocks,
    buildings,
    districts: MOCK_DISTRICTS.map((name, id) => ({ id, name, cells: districtCells[id] })),
    population: { count: 560, mix: { carOwners: 0.4, limitedMobility: 0.1, needsAssist: 0.05 }, schedule: 'office-hours' },
    fleet: {
      ambulances: 5,
      policeCars: 5,
      boats: 4,
      helicopters: 2,
      doctors: 14,
      nurses: 28,
      policeOfficers: 16,
      boatOperators: 8,
    },
    weather: {
      rain: [
        { t: 0, intensity: 0 },
        { t: 240, intensity: 0 },
        { t: 600, intensity: 0.6 },
        { t: 900, intensity: 1 },
        { t: 1800, intensity: 1 },
        { t: 2400, intensity: 0.3 },
        { t: 3000, intensity: 0 },
      ],
      wind: [
        { t: 0, speed: 0.1 },
        { t: 900, speed: 0.4 },
        { t: 1300, speed: 0.85 },
        { t: 1600, speed: 0.85 },
        { t: 1900, speed: 0.4 },
        { t: 3000, speed: 0.1 },
      ],
      floodKind: 'compound',
      // Source rates are metres of depth per simulated second. Keep the test-city
      // river rise gradual enough for dispatch to act before low areas inundate.
      sources: [{ cell: idx(Math.round(riverCentre(0.5)), 0), startT: 600, endT: 2400, rate: 0.005 }],
      warningDelay: 120,
    },
    injected: [],
    powerGrid: { nodes, edges },
    defaults: { dispatchMode: 'negotiation', seed },
  };
};

/** Display names for buildings, by building id. Civic sites keep their names after small moves. */
export const mockBuildingNames = (scenario: Scenario): string[] => {
  const w = scenario.size.w;
  const names = scenario.buildings.map((b) => `${BlockType[b.type].replace(/([a-z])([A-Z])/g, '$1 $2')} #${b.id}`);
  const taken = new Set<number>();
  for (const s of MOCK_LANDMARKS) {
    let best = -1;
    let bestD = 9;
    scenario.buildings.forEach((b, i) => {
      if (b.type !== s.type || taken.has(i)) return;
      const d = Math.hypot((b.cells[0] % w) - s.x, Math.floor(b.cells[0] / w) - s.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      taken.add(best);
      names[best] = s.name;
    }
  }
  return names;
};
