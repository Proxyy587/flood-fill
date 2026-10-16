import { BlockType, asBuildingId, type BuildingDef, type Hotspot, type InjectedEvent, type Scenario } from '../../contracts';

/** Local presentation metadata; it never crosses the simulation worker boundary. */
export interface DistrictPlace {
  id: number;
  name: string;
  detail: string;
  source: 'reference' | 'illustrative';
  x: number;
  z: number;
}

/** District fills the slab with a slight wobble so the urban edge isn't a ruler line. */
export const SIX_MILE_BOUNDARY: readonly (readonly [number, number])[] = [
  [4, 6], [40, 3], [72, 4], [104, 6], [122, 18], [125, 48], [124, 80], [120, 108],
  [104, 122], [72, 125], [40, 124], [14, 118], [4, 90], [3, 52], [4, 22],
];

export const SIX_MILE_CHANNEL: readonly (readonly [number, number])[] = [
  [42, 6], [40, 18], [46, 30], [52, 40], [62, 48], [58, 54],
  [48, 60], [44, 68], [42, 78], [46, 88], [40, 98], [36, 110], [34, 122],
];

/** Central APDCL / Assam Power campus grove — middle of Six Mile. */
export const SIX_MILE_FOREST: readonly (readonly [number, number])[] = [
  [52, 52], [76, 50], [84, 58], [86, 74], [78, 86], [60, 88], [50, 78], [48, 62],
];

const pointInPoly = (poly: readonly (readonly [number, number])[], x: number, z: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
};

export function insideSixMile(x: number, z: number): boolean {
  return pointInPoly(SIX_MILE_BOUNDARY, x, z);
}

export function insideForest(x: number, z: number): boolean {
  return pointInPoly(SIX_MILE_FOREST, x, z);
}

export function mapNoise(x: number, z: number, seed = 27): number {
  let n = Math.imul(x + seed, 374761393) ^ Math.imul(z, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

type SixMileCity = {
  scenario: Scenario;
  places: DistrictPlace[];
  landmarkCount: number;
  origin: { x: number; z: number };
};

/** Cached generation — atlas→sim transition must not rebuild the district twice. */
let sixMileCache: SixMileCity | null = null;

/** Image-inspired, compressed district. All capacities and hazards are synthetic. */
export function createSixMile(): SixMileCity {
  if (!sixMileCache) sixMileCache = buildSixMile();
  return {
    scenario: structuredClone(sixMileCache.scenario),
    places: sixMileCache.places.map((p) => ({ ...p })),
    landmarkCount: sixMileCache.landmarkCount,
    origin: { ...sixMileCache.origin },
  };
}

function buildSixMile(): SixMileCity {
  const w = 128, h = 128, n = w * h;
  const index = (x: number, z: number) => z * w + x;
  // High shelf (like the riverside mock): river stage can rise without drowning the city.
  const ground = Array<number>(n).fill(6);
  const blocks = Array<number>(n).fill(BlockType.Grass);
  const water = new Set<number>();
  const bridges = new Set<number>();
  const buildings: BuildingDef[] = [];
  const places: DistrictPlace[] = [];
  const occupied = new Set<number>();
  const road = (c: number) => blocks[c] === BlockType.Road || blocks[c] === BlockType.Bridge;
  const neighbours = (c: number) => [c % w > 0 ? c - 1 : -1, c % w < w - 1 ? c + 1 : -1, c >= w ? c - w : -1, c < n - w ? c + w : -1].filter(c => c >= 0);

  const stroke = (points: readonly (readonly [number, number])[], radius: number, paint: (c: number) => void) => {
    for (let p = 1; p < points.length; p++) {
      const [ax, az] = points[p - 1], [bx, bz] = points[p];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 3);
      for (let s = 0; s <= steps; s++) {
        const x = ax + (bx - ax) * s / steps, z = az + (bz - az) * s / steps;
        for (let dz = -Math.ceil(radius); dz <= Math.ceil(radius); dz++) for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
          const px = Math.round(x) + dx, pz = Math.round(z) + dz;
          if (px < 1 || pz < 1 || px >= w - 1 || pz >= h - 1 || dx * dx + dz * dz > radius * radius) continue;
          paint(index(px, pz));
        }
      }
    }
  };

  // Channel at 0; banks at 2; floodable corridor at 3; ridges at 8–9; shelf at 6 stays mostly dry.
  stroke(SIX_MILE_CHANNEL, 2.2, c => { water.add(c); blocks[c] = BlockType.WaterSource; ground[c] = 0; });
  for (let c = 0; c < n; c++) {
    if (!water.has(c) && neighbours(c).some(p => water.has(p))) { blocks[c] = BlockType.Sand; ground[c] = 2; }
  }
  // Named hollows (deep) + wider channel fringe + gentle ridges so some streets flood and others stay dry.
  const hollows: readonly { x: number; z: number; r: number; floor: number }[] = [
    { x: 70, z: 28, r: 10, floor: 2 }, // Six Mile junction
    { x: 56, z: 96, r: 9, floor: 2 },  // southern underpass
    { x: 24, z: 80, r: 8, floor: 2 },  // westbank low street
    { x: 96, z: 52, r: 7, floor: 2 },  // east of campus
    { x: 44, z: 70, r: 8, floor: 2 },  // channel-side lanes
    { x: 88, z: 88, r: 6, floor: 3 },  // southern side-street dip
  ];
  const ridges: readonly { x: number; z: number; r: number; crest: number }[] = [
    { x: 100, z: 30, r: 14, crest: 9 }, // northeast shelf
    { x: 30, z: 30, r: 12, crest: 8 },  // northwest rise
    { x: 108, z: 100, r: 11, crest: 8 }, // southeast rise
    { x: 70, z: 60, r: 9, crest: 7 },   // campus shoulder
  ];
  for (let c = 0; c < n; c++) {
    const x = c % w, z = Math.floor(c / w);
    if (!insideSixMile(x, z) || water.has(c)) continue;
    let nearWater = false;
    for (let dz = -8; dz <= 8 && !nearWater; dz++) for (let dx = -8; dx <= 8; dx++) {
      const px = x + dx, pz = z + dz;
      if (px < 0 || pz < 0 || px >= w || pz >= h) continue;
      if (water.has(index(px, pz)) && dx * dx + dz * dz <= 64) nearWater = true;
    }
    if (nearWater) ground[c] = Math.min(ground[c], 3);
    for (const hollow of hollows) {
      const d = Math.hypot(x - hollow.x, z - hollow.z);
      if (d < hollow.r) ground[c] = Math.min(ground[c], hollow.floor);
      else if (d < hollow.r + 4) ground[c] = Math.min(ground[c], hollow.floor + 1);
    }
    for (const ridge of ridges) {
      const d = Math.hypot(x - ridge.x, z - ridge.z) / ridge.r;
      if (d < 1) ground[c] = Math.max(ground[c], Math.round(ridge.crest - d * 2));
    }
    // Mild noise so lots aren't ruler-flat between hollow and ridge.
    if (ground[c] >= 5 && ground[c] <= 7) {
      const n0 = mapNoise(x, z, 41);
      if (n0 > 0.72) ground[c] = Math.min(9, ground[c] + 1);
      else if (n0 < 0.18) ground[c] = Math.max(4, ground[c] - 1);
    }
  }

  const paintRoad = (c: number) => {
    if (occupied.has(c)) return;
    blocks[c] = water.has(c) ? BlockType.Bridge : BlockType.Road;
    if (water.has(c)) { ground[c] = 0; bridges.add(c); }
    else if (ground[c] <= 3) { /* keep floodable grade */ }
    else if (ground[c] >= 8) ground[c] = Math.max(ground[c], 7); // ridge roads stay dry
    else ground[c] = Math.max(5, Math.min(ground[c], 6)); // mid shelf
  };
  stroke([...SIX_MILE_BOUNDARY, SIX_MILE_BOUNDARY[0]], 1, paintRoad);
  for (const z of [18, 28, 38, 48, 58, 68, 78, 88, 98, 108]) {
    let start = -1, end = -1;
    for (let x = 4; x < 124; x++) if (insideSixMile(x, z)) { if (start < 0) start = x; end = x; }
    if (start >= 0) stroke([[start - 1, z], [end + 1, z]], 0, paintRoad);
  }
  for (const x of [18, 28, 38, 48, 58, 68, 78, 88, 98, 108]) {
    let start = -1, end = -1;
    for (let z = 4; z < 124; z++) if (insideSixMile(x, z)) { if (start < 0) start = z; end = z; }
    if (start >= 0) stroke([[x, start - 1], [x, end + 1]], 0, paintRoad);
  }
  stroke([...SIX_MILE_FOREST, SIX_MILE_FOREST[0]], 1, paintRoad);

  // Sparse storm inlets beside hollows — imperfect drainage so the first score is improvable.
  for (const hollow of hollows) {
    for (let i = 0; i < 6; i += 2) {
      const ang = (i / 6) * Math.PI * 2;
      const x = Math.round(hollow.x + Math.cos(ang) * (hollow.r * 0.55));
      const z = Math.round(hollow.z + Math.sin(ang) * (hollow.r * 0.55));
      if (x < 1 || z < 1 || x >= w - 1 || z >= h - 1) continue;
      const c = index(x, z);
      if (!insideSixMile(x, z) || water.has(c) || occupied.has(c)) continue;
      if (blocks[c] !== BlockType.Grass && blocks[c] !== BlockType.Tree) continue;
      if (!neighbours(c).some((nb) => road(nb))) continue;
      blocks[c] = BlockType.Drainage;
      ground[c] = Math.min(ground[c], hollow.floor);
    }
  }

  const addBuilding = (x: number, z: number, bw: number, bd: number, type: BlockType, capacity: number, name: string, detail: string, source: DistrictPlace['source'], allowForest = false) => {
    const cells: number[] = [];
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) {
      const px = x + dx, pz = z + dz;
      const c = index(px, pz);
      if (!insideSixMile(px, pz) || (!allowForest && insideForest(px, pz)) || (blocks[c] !== BlockType.Grass && blocks[c] !== BlockType.Tree) || occupied.has(c)) return false;
      cells.push(c);
    }
    const parents = new Map<number, number>();
    const queue: number[] = [];
    const footprint = new Set(cells);
    for (const c of cells) for (const p of neighbours(c)) if (!footprint.has(p) && !occupied.has(p) && !water.has(p) && !parents.has(p)) { parents.set(p, -1); queue.push(p); }
    let end = -1;
    for (let i = 0; i < queue.length && i < 500; i++) {
      const c = queue[i];
      if (road(c)) { end = c; break; }
      for (const p of neighbours(c)) {
        const px = p % w, pz = Math.floor(p / w);
        if (!parents.has(p) && !footprint.has(p) && !occupied.has(p) && !water.has(p) && insideSixMile(px, pz)) {
          parents.set(p, c); queue.push(p);
        }
      }
    }
    if (end < 0) return false;
    let entrance = end;
    for (let c = end; c >= 0; c = parents.get(c) ?? -1) { paintRoad(c); entrance = c; }
    const id = asBuildingId(buildings.length + 1);
    const floor = Math.max(...cells.map(c => ground[c]), 6);
    for (const c of cells) { occupied.add(c); blocks[c] = type; ground[c] = floor; }
    buildings.push({ id, type, cells, capacity, entrance, floorHeight: 3,
      ...(type === BlockType.Hospital || type === BlockType.Shelter ? { generator: { fuelTicks: 3600 } } : {}),
      ...(type === BlockType.Helipad ? { helipad: true } : {}),
    });
    places.push({ id, name, detail, source, x: x + bw / 2, z: z + bd / 2 });
    return true;
  };
  const landmark = (x: number, z: number, bw: number, bd: number, type: BlockType, capacity: number, name: string, detail: string, source: DistrictPlace['source'] = 'illustrative', allowForest = false) => {
    for (let radius = 0; radius < 16; radius++) for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      if (addBuilding(x + dx, z + dz, bw, bd, type, capacity, name, detail, source, allowForest)) return;
    }
    throw new Error(`No valid site for ${name}`);
  };

  // APDCL campus sits in the geographic middle of Six Mile (forest grove + plant).
  landmark(62, 64, 6, 5, BlockType.Office, 120, 'APDCL campus', 'Assam Power Distribution campus at the centre of the reference image; footprint is illustrative.', 'reference', true);
  landmark(70, 70, 4, 4, BlockType.PowerPlant, 0, 'District power yard', 'Synthetic plant inside the central power campus.', 'illustrative', true);
  landmark(102, 78, 7, 6, BlockType.Hospital, 72, 'GNRC · Six Mile', 'Hospital landmark from the reference; footprint and 72-bed capacity are illustrative.', 'reference');
  landmark(88, 108, 3, 3, BlockType.Substation, 0, 'South substation', 'Added distribution node connected to every occupied building.');
  landmark(28, 52, 6, 4, BlockType.Shelter, 180, 'Community relief hall', 'Added elevated refuge with a backup generator; not a designated real shelter.');
  landmark(96, 48, 4, 4, BlockType.PoliceStation, 20, 'Six Mile response post', 'Added police staging and traffic-control post.');
  landmark(22, 96, 5, 4, BlockType.FloodHQ, 20, 'District coordination hub', 'Added flood coordination and dispatch building.');
  landmark(30, 72, 3, 3, BlockType.BoatDepot, 8, 'Channel boat landing', 'Added channel-side boat and equipment depot.');
  landmark(110, 88, 4, 4, BlockType.Helipad, 4, 'Medical landing pad', 'Added landing site near the hospital.');
  landmark(48, 112, 5, 4, BlockType.FireStation, 12, 'Emergency services yard', 'Added fire and first-response station.');
  const landmarks = places.length;

  const nearRoad = (x: number, z: number): boolean => {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const px = x + dx, pz = z + dz;
      if (px < 0 || pz < 0 || px >= w || pz >= h) continue;
      if (road(index(px, pz))) return true;
    }
    return false;
  };

  // Dense street parcels across the district (skip every other cell — mesh budget).
  for (let z = 4; z < 124; z += 2) {
    for (let x = 4; x < 124; x += 2) {
      if (!insideSixMile(x, z) || insideForest(x, z) || !nearRoad(x, z)) continue;
      const c = index(x, z);
      if (blocks[c] !== BlockType.Grass || occupied.has(c)) continue;
      const r = mapNoise(x, z);
      if (r < 0.1) continue;
      const type = r < 0.3 ? BlockType.Shop : r > 0.74 ? BlockType.Apartment : BlockType.House;
      const bw = type === BlockType.Apartment ? 3 : 2;
      const bd = type === BlockType.House ? 3 : 2;
      addBuilding(x, z, bw, bd, type,
        type === BlockType.Apartment ? 24 : type === BlockType.Shop ? 8 : 6,
        `${type === BlockType.Shop ? 'Neighbourhood shop' : type === BlockType.Apartment ? 'Courtyard apartments' : 'Lane-side home'} ${buildings.length + 1}`,
        'Generated infill that follows the reference street blocks. Not a surveyed property.', 'illustrative');
    }
  }

  // APDCL grove canopy; light yard trees. No tree belt filling empty map corners.
  for (let c = 0; c < n; c++) {
    if (blocks[c] !== BlockType.Grass || occupied.has(c)) continue;
    const x = c % w, z = Math.floor(c / w);
    if (insideForest(x, z) && mapNoise(x, z, 91) > 0.08) blocks[c] = BlockType.Tree;
    else if (insideSixMile(x, z) && mapNoise(x, z, 63) > 0.86) blocks[c] = BlockType.Tree;
  }
  // Very sparse bank drains — enough for a few dry pockets, not a solved city.
  for (let c = 0; c < n; c++) if (blocks[c] === BlockType.Sand && c % 19 === 0) blocks[c] = BlockType.Drainage;

  const plant = buildings.find(b => b.type === BlockType.PowerPlant)!;
  const sub = buildings.find(b => b.type === BlockType.Substation)!;
  const nodes: Scenario['powerGrid']['nodes'] = [
    { id: 0, kind: 'plant', cell: plant.cells[0], building: plant.id },
    { id: 1, kind: 'substation', cell: sub.cells[0], building: sub.id },
  ];
  const edges: [number, number][] = [[0, 1]];
  buildings.forEach(b => {
    if (b === plant) { b.powerNode = 0; return; }
    if (b === sub) { b.powerNode = 1; return; }
    const id = nodes.length;
    b.powerNode = id;
    nodes.push({ id, kind: 'load', cell: b.cells[0], building: b.id });
    edges.push([1, id]);
  });

  const roadsNear = (cx: number, cz: number, r: number) => {
    const out: number[] = [];
    for (let z = Math.max(0, cz - r); z <= Math.min(h - 1, cz + r); z++)
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        const c = index(x, z);
        if (Math.hypot(x - cx, z - cz) <= r && road(c)) out.push(c);
      }
    return out;
  };
  const hotspots: Hotspot[] = ([
    { name: 'Channel-side lanes', kind: 'waterlogging' as const, cells: roadsNear(44, 70, 8) },
    { name: 'Six Mile junction hollow', kind: 'waterlogging' as const, cells: roadsNear(70, 28, 8) },
    { name: 'Southern underpass', kind: 'waterlogging' as const, cells: roadsNear(56, 96, 7) },
    { name: 'Westbank low street', kind: 'waterlogging' as const, cells: roadsNear(24, 80, 7) },
    { name: 'East campus dip', kind: 'waterlogging' as const, cells: roadsNear(96, 52, 6) },
    { name: 'Southern side-street', kind: 'waterlogging' as const, cells: roadsNear(88, 88, 5) },
  ] satisfies Hotspot[]).filter(s => s.cells.length >= 3);

  const bridgeCell = [...bridges][Math.floor([...bridges].length / 2)] ?? [...water][0];
  const blockRoad = roadsNear(80, 60, 2)[0] ?? roadsNear(50, 50, 4)[0];
  // Stick to kinds both engines accept without notes so core batch runs stay clean.
  const injected: InjectedEvent[] = [
    { t: 3_600, kind: 'road_blocked_by_debris', cell: blockRoad },
    { t: 8_000, kind: 'bridge_closed', cell: bridgeCell },
    { t: 14_000, kind: 'substation_flooded', target: 1 },
    { t: 18_000, kind: 'comms_outage', durationTicks: 1_800 },
    { t: 40_000, kind: 'road_blocked_by_debris', cell: blockRoad },
  ];

  const districts: Scenario['districts'] = ['Westbank lanes', 'Six Mile junction', 'APDCL campus', 'Southern neighbourhood'].map((name, id) => ({ id, name, cells: [] }));
  for (let c = 0; c < n; c++) {
    const x = c % w, z = Math.floor(c / w);
    districts[insideForest(x, z) ? 2 : x < 40 ? 0 : z < 70 ? 1 : 3].cells.push(c);
  }

  const waterCells = [...water];
  // Channel sources follow the compound-flood design (docs/FLOOD_DESIGN.md):
  // day-1 rise, night hold — rates feed hollows/corridor, not a city-wide dunk.
  const sources = [36, 60, 84, 108].map((z, i) => {
    const cell = waterCells.find(c => Math.floor(c / w) === z && blocks[c] === BlockType.WaterSource)
      ?? waterCells.find(c => blocks[c] === BlockType.WaterSource)!;
    return { cell, startT: 1_200 + i * 90, endT: 58_000, rate: 0.018 };
  });

  // Crop the slab to the district bbox so empty map corners disappear.
  let minX = w, maxX = 0, minZ = h, maxZ = 0;
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    if (!insideSixMile(x, z) && !water.has(index(x, z))) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  minX = Math.max(0, minX - 1);
  minZ = Math.max(0, minZ - 1);
  maxX = Math.min(w - 1, maxX + 1);
  maxZ = Math.min(h - 1, maxZ + 1);
  const nw = maxX - minX + 1, nh = maxZ - minZ + 1;
  const remap = (c: number) => {
    const x = c % w - minX, z = Math.floor(c / w) - minZ;
    return z * nw + x;
  };
  const croppedGround: number[] = [];
  const croppedBlocks: number[] = [];
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const c = index(x, z);
    croppedGround.push(ground[c]);
    croppedBlocks.push(blocks[c]);
  }
  // Fill leftover grass outside the urban poly with trees so the slab isn't empty corners.
  for (let z = 0; z < nh; z++) for (let x = 0; x < nw; x++) {
    const ox = x + minX, oz = z + minZ;
    const i = z * nw + x;
    if (croppedBlocks[i] !== BlockType.Grass) continue;
    if (insideSixMile(ox, oz)) continue;
    croppedBlocks[i] = mapNoise(ox, oz, 19) > 0.4 ? BlockType.Tree : BlockType.Grass;
    croppedGround[i] = Math.max(croppedGround[i], 6);
  }

  const scenario: Scenario = {
    schemaVersion: 1, name: 'Six Mile · image-inspired district', size: { w: nw, h: nh },
    ground: croppedGround, blocks: croppedBlocks,
    buildings: buildings.map(b => ({
      ...b,
      cells: b.cells.map(remap),
      entrance: remap(b.entrance),
    })),
    bridges: [...bridges].map(cell => ({ cell: remap(cell), deckHeight: 6 })),
    districts: districts.map(d => ({ ...d, cells: d.cells.filter(c => {
      const x = c % w, z = Math.floor(c / w);
      return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
    }).map(remap) })),
    hotspots: hotspots.map(s => ({ ...s, cells: s.cells.map(remap) })),
    population: { count: 1100, mix: { carOwners: .32, limitedMobility: .08, needsAssist: .1 }, schedule: 'office-hours' },
    fleet: { ambulances: 5, policeCars: 4, boats: 4, helicopters: 1, doctors: 12, nurses: 24, policeOfficers: 16, boatOperators: 8 },
    weather: {
      // 24 h monsoon compound event from a morning start (ticks = seconds).
      // Early burst fills hollows for visible local waterlogging; ridges stay dry.
      rain: [
        { t: 0, intensity: 0.12 },
        { t: 900, intensity: 0.35 },
        { t: 1_800, intensity: 0.55 },
        { t: 3_600, intensity: 0.85 },
        { t: 6_000, intensity: 1.0 },
        { t: 10_000, intensity: 0.75 },
        { t: 16_000, intensity: 0.4 },
        { t: 24_000, intensity: 0.6 },
        { t: 36_000, intensity: 0.3 },
        { t: 48_000, intensity: 0.15 },
        { t: 60_000, intensity: 0.06 },
        { t: 72_000, intensity: 0 },
      ],
      wind: [
        { t: 0, speed: 0.15 },
        { t: 8_000, speed: 0.55 },
        { t: 20_000, speed: 0.4 },
        { t: 40_000, speed: 0.25 },
      ],
      floodKind: 'compound', warningDelay: 120,
      sources: sources.map(s => ({ ...s, cell: remap(s.cell) })),
    },
    injected: injected.map(e => e.cell !== undefined ? { ...e, cell: remap(e.cell) } : e),
    powerGrid: {
      nodes: nodes.map(node => ({ ...node, cell: remap(node.cell) })),
      edges,
    },
    defaults: { dispatchMode: 'negotiation', seed: 27 },
  };
  const croppedPlaces = places.map(p => ({ ...p, x: p.x - minX, z: p.z - minZ }));
  return { scenario, places: croppedPlaces, landmarkCount: landmarks, origin: { x: minX, z: minZ } };
}
