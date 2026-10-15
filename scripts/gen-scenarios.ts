import { writeFile, mkdir } from "node:fs/promises";
import { BlockType, type BuildingDef, type PowerNode, type Scenario, type BuildingId, type VehicleId } from "../src/contracts/types";
import { ScenarioSchema } from "../src/contracts/schemas";

class GridBuilder {
  readonly w: number;
  readonly h: number;
  readonly ground: number[];
  readonly blocks: number[];
  readonly buildings: BuildingDef[] = [];
  readonly powerNodes: PowerNode[] = [];
  readonly powerEdges: [number, number][] = [];
  readonly bridges: { cell: number; deckHeight: number }[] = [];
  private nextBuildingId = 1;
  private nextPowerNodeId = 1;

  constructor(w: number, h: number, defaultGround = 2, defaultBlock = BlockType.Grass) {
    this.w = w;
    this.h = h;
    this.ground = Array(w * h).fill(defaultGround);
    this.blocks = Array(w * h).fill(defaultBlock);
  }

  idx(x: number, z: number): number {
    return z * this.w + x;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && x < this.w && z >= 0 && z < this.h;
  }

  setGround(x: number, z: number, height: number): void {
    if (this.inBounds(x, z)) this.ground[this.idx(x, z)] = height;
  }

  setBlock(x: number, z: number, block: BlockType): void {
    if (this.inBounds(x, z)) this.blocks[this.idx(x, z)] = block;
  }

  paintRoad(x0: number, z0: number, x1: number, z1: number): void {
    const xMin = Math.min(x0, x1);
    const xMax = Math.max(x0, x1);
    const zMin = Math.min(z0, z1);
    const zMax = Math.max(z0, z1);
    for (let x = xMin; x <= xMax; x++) {
      for (let z = zMin; z <= zMax; z++) {
        this.setBlock(x, z, BlockType.Road);
      }
    }
  }

  paintBridge(x0: number, z0: number, x1: number, z1: number, deckHeight: number): void {
    const xMin = Math.min(x0, x1);
    const xMax = Math.max(x0, x1);
    const zMin = Math.min(z0, z1);
    const zMax = Math.max(z0, z1);
    for (let x = xMin; x <= xMax; x++) {
      for (let z = zMin; z <= zMax; z++) {
        const cell = this.idx(x, z);
        this.blocks[cell] = BlockType.Bridge;
        this.bridges.push({ cell, deckHeight });
      }
    }
  }

  canPlace(x: number, z: number, w: number, d: number): boolean {
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const targetX = x + dx;
        const targetZ = z + dz;
        if (!this.inBounds(targetX, targetZ)) return false;
        const cell = this.idx(targetX, targetZ);
        if (this.blocks[cell] !== BlockType.Grass && this.blocks[cell] !== BlockType.Dirt) {
          return false;
        }
      }
    }
    return true;
  }

  placeBuilding(
    type: BlockType,
    x: number,
    z: number,
    w: number,
    d: number,
    capacity: number,
    floorHeight = 1,
    opts: {
      generatorFuel?: number;
      helipad?: boolean;
      powerKind?: "plant" | "substation" | "load";
    } = {}
  ): BuildingDef {
    const cells: number[] = [];
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const cell = this.idx(x + dx, z + dz);
        this.blocks[cell] = type;
        cells.push(cell);
      }
    }

    const bId = this.nextBuildingId++ as BuildingId;
    const entrance = cells[0]; // Entrance is guaranteed to be in cells

    let powerNodeId: number | undefined;
    if (opts.powerKind) {
      powerNodeId = this.nextPowerNodeId++;
      this.powerNodes.push({
        id: powerNodeId,
        kind: opts.powerKind,
        cell: entrance,
        building: bId,
      });
    }

    const def: BuildingDef = {
      id: bId,
      type,
      cells,
      capacity,
      entrance,
      floorHeight,
      ...(opts.generatorFuel ? { generator: { fuelTicks: opts.generatorFuel } } : {}),
      ...(opts.helipad ? { helipad: true } : {}),
      ...(powerNodeId !== undefined ? { powerNode: powerNodeId } : {}),
    };

    this.buildings.push(def);
    return def;
  }

  placePowerPlant(x: number, z: number, w = 2, d = 2): BuildingDef {
    return this.placeBuilding(BlockType.PowerPlant, x, z, w, d, 10, 1, { powerKind: "plant" });
  }

  placeSubstation(x: number, z: number, w = 2, d = 2): BuildingDef {
    return this.placeBuilding(BlockType.Substation, x, z, w, d, 5, 1, { powerKind: "substation" });
  }

  addPole(x: number, z: number): number {
    const id = this.nextPowerNodeId++;
    const cell = this.idx(x, z);
    this.setBlock(x, z, BlockType.Pole);
    this.powerNodes.push({ id, kind: "load", cell });
    return id;
  }

  addPowerEdge(a: number, b: number): void {
    this.powerEdges.push([a, b]);
  }

  ensureRoadConnection(building: BuildingDef): void {
    // Check if building already touches a road or bridge
    for (const c of building.cells) {
      const x = c % this.w;
      const z = Math.floor(c / this.w);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (this.inBounds(nx, nz)) {
          const nc = this.idx(nx, nz);
          if (this.blocks[nc] === BlockType.Road || this.blocks[nc] === BlockType.Bridge) {
            return;
          }
        }
      }
    }

    // BFS to find the shortest path through terrain to a road or bridge
    const bCells = new Set(building.cells);
    const queue: number[] = [...building.cells];
    const parent = new Map<number, number>();
    const visited = new Set<number>(building.cells);

    let targetRoad: number | null = null;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const cx = cur % this.w;
      const cz = Math.floor(cur / this.w);

      if (this.blocks[cur] === BlockType.Road || this.blocks[cur] === BlockType.Bridge) {
        targetRoad = cur;
        break;
      }

      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (this.inBounds(nx, nz)) {
          const next = this.idx(nx, nz);
          if (!visited.has(next)) {
            const block = this.blocks[next];
            if (
              block === BlockType.Grass ||
              block === BlockType.Dirt ||
              block === BlockType.Sand ||
              block === BlockType.Road ||
              block === BlockType.Bridge
            ) {
              visited.add(next);
              parent.set(next, cur);
              queue.push(next);
            }
          }
        }
      }
    }

    if (targetRoad !== null) {
      let curr = targetRoad;
      while (curr !== undefined && !bCells.has(curr)) {
        if (this.blocks[curr] !== BlockType.Bridge) {
          this.blocks[curr] = BlockType.Road;
        }
        curr = parent.get(curr)!;
      }
    }
  }

  ensureAllBuildingsConnected(): void {
    for (const b of this.buildings) {
      this.ensureRoadConnection(b);
    }
  }
}

// ============================================================================
// 1. Riverside Town (64x64)
// ============================================================================
function generateRiversideTown(): Scenario {
  const W = 64;
  const H = 64;
  const gb = new GridBuilder(W, H, 2, BlockType.Grass);

  // River cuts vertically around x = 30..33
  for (let z = 0; z < H; z++) {
    const rx = Math.floor(30 + Math.sin(z / 8) * 3);
    for (let w = 0; w < 4; w++) {
      const cellX = rx + w;
      gb.setGround(cellX, z, 0); // river bed at 0
      gb.setBlock(cellX, z, BlockType.WaterSource);
    }
    // Riverbanks (sand / dirt)
    gb.setGround(rx - 1, z, 1);
    gb.setBlock(rx - 1, z, BlockType.Sand);
    gb.setGround(rx + 4, z, 1);
    gb.setBlock(rx + 4, z, BlockType.Sand);
  }

  // West side elevation slightly higher
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < 28; x++) {
      gb.setGround(x, z, 3);
    }
  }

  // East side gentle slope towards river
  for (let z = 0; z < H; z++) {
    for (let x = 36; x < W; x++) {
      gb.setGround(x, z, 2);
    }
  }

  // Main East-West cross arterial (z = 32)
  gb.paintRoad(4, 32, 28, 32); // West road
  gb.paintBridge(29, 32, 34, 32, 4); // Bridge over river (deck 4 > ground 0..1)
  gb.paintRoad(35, 32, 60, 32); // East road

  // West North-South road (x = 16)
  gb.paintRoad(16, 8, 16, 56);
  // East North-South road (x = 48)
  gb.paintRoad(48, 8, 48, 56);

  // Secondary grid roads
  gb.paintRoad(16, 16, 28, 16);
  gb.paintRoad(16, 48, 28, 48);
  gb.paintRoad(36, 16, 48, 16);
  gb.paintRoad(36, 48, 48, 48);

  // Drainage inlets along river road intersections
  gb.setBlock(28, 31, BlockType.Drainage);
  gb.setBlock(28, 33, BlockType.Drainage);
  gb.setBlock(35, 31, BlockType.Drainage);
  gb.setBlock(35, 33, BlockType.Drainage);

  // Trees and natural buffer
  for (let z = 10; z < 50; z += 5) {
    gb.setBlock(27, z, BlockType.Tree);
    gb.setBlock(37, z, BlockType.Tree);
  }

  // West Bank Medical Center (Hospital 1)
  const h1 = gb.placeBuilding(BlockType.Hospital, 12, 30, 3, 2, 80, 1, {
    generatorFuel: 3600,
    helipad: true,
    powerKind: "load",
  });

  // East Bank Community Hospital (Hospital 2)
  const h2 = gb.placeBuilding(BlockType.Hospital, 50, 30, 3, 2, 60, 1, {
    generatorFuel: 2400,
    powerKind: "load",
  });

  // Flood Command HQ (West bank, elevated)
  const hq = gb.placeBuilding(BlockType.FloodHQ, 12, 18, 3, 2, 30, 1, {
    generatorFuel: 7200,
    powerKind: "load",
  });

  // Emergency Shelter (East bank, inland)
  const shelter = gb.placeBuilding(BlockType.Shelter, 50, 18, 3, 2, 150, 2, {
    powerKind: "load",
  });

  // Police Station (West bank)
  gb.placeBuilding(BlockType.PoliceStation, 12, 44, 3, 2, 40, 1, {
    powerKind: "load",
  });

  // Boat Depot (Directly adjacent to river on East Bank, z = 40)
  gb.placeBuilding(BlockType.BoatDepot, 35, 40, 2, 2, 20, 1, {
    powerKind: "load",
  });
  gb.paintRoad(37, 40, 48, 40); // connect boat depot to East grid

  // Residential houses & shops
  for (let z = 10; z < 28; z += 4) {
    if (gb.canPlace(8, z, 2, 2)) gb.placeBuilding(BlockType.House, 8, z, 2, 2, 6);
    if (gb.canPlace(20, z, 2, 2)) gb.placeBuilding(BlockType.House, 20, z, 2, 2, 6);
    if (gb.canPlace(42, z, 2, 2)) gb.placeBuilding(BlockType.House, 42, z, 2, 2, 6);
    if (gb.canPlace(54, z, 2, 2)) gb.placeBuilding(BlockType.House, 54, z, 2, 2, 6);
  }
  for (let z = 36; z < 54; z += 4) {
    if (gb.canPlace(8, z, 2, 2)) gb.placeBuilding(BlockType.House, 8, z, 2, 2, 6);
    if (gb.canPlace(20, z, 2, 2)) gb.placeBuilding(BlockType.House, 20, z, 2, 2, 6);
    if (gb.canPlace(42, z, 2, 2)) gb.placeBuilding(BlockType.Shop, 42, z, 2, 2, 15);
    if (gb.canPlace(54, z, 2, 2)) gb.placeBuilding(BlockType.Apartment, 54, z, 2, 2, 24);
  }

  // Power grid: Power plant in North-West high terrain, Substation, feeder lines
  const plant = gb.placePowerPlant(6, 8, 3, 2);
  const subWest = gb.placeSubstation(14, 14, 2, 2);
  const subEast = gb.placeSubstation(46, 14, 2, 2);

  gb.addPowerEdge(plant.powerNode!, subWest.powerNode!);
  gb.addPowerEdge(subWest.powerNode!, subEast.powerNode!);
  if (h1.powerNode) gb.addPowerEdge(subWest.powerNode!, h1.powerNode);
  if (hq.powerNode) gb.addPowerEdge(subWest.powerNode!, hq.powerNode);
  if (h2.powerNode) gb.addPowerEdge(subEast.powerNode!, h2.powerNode);
  if (shelter.powerNode) gb.addPowerEdge(subEast.powerNode!, shelter.powerNode);

  // Ensure all buildings (including power plants and substations) have road connectivity
  gb.ensureAllBuildingsConnected();

  // 4 Districts
  const d1Cells: number[] = [];
  const d2Cells: number[] = [];
  const d3Cells: number[] = [];
  const d4Cells: number[] = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const c = gb.idx(x, z);
      if (x < 32 && z < 32) d1Cells.push(c);
      else if (x >= 32 && z < 32) d2Cells.push(c);
      else if (x < 32 && z >= 32) d3Cells.push(c);
      else d4Cells.push(c);
    }
  }

  const districts = [
    { id: 1, name: "Northwest Heights", cells: d1Cells },
    { id: 2, name: "Northeast Riverside", cells: d2Cells },
    { id: 3, name: "Southwest Civic", cells: d3Cells },
    { id: 4, name: "Southeast Suburbs", cells: d4Cells },
  ];

  return {
    schemaVersion: 1,
    name: "Riverside Town",
    size: { w: W, h: H },
    ground: gb.ground,
    blocks: gb.blocks,
    buildings: gb.buildings,
    bridges: gb.bridges,
    districts,
    population: {
      count: 400,
      mix: { carOwners: 0.5, limitedMobility: 0.08, needsAssist: 0.04 },
      schedule: "office-hours",
    },
    fleet: {
      ambulances: 4,
      policeCars: 6,
      boats: 3,
      helicopters: 1,
      doctors: 8,
      nurses: 16,
      policeOfficers: 12,
      boatOperators: 4,
    },
    weather: {
      rain: [
        { t: 0, intensity: 0 },
        { t: 300, intensity: 0.05 }, // 5 minutes dry/quiet period
        { t: 600, intensity: 0.4 },
        { t: 1200, intensity: 0.85 },
        { t: 2400, intensity: 0.3 },
      ],
      wind: [
        { t: 0, speed: 2 },
        { t: 600, speed: 6 },
        { t: 1200, speed: 18 },
        { t: 2400, speed: 5 },
      ],
      floodKind: "growing",
      sources: [
        { cell: gb.idx(31, 0), startT: 300, endT: 3600, rate: 0.8 },
        { cell: gb.idx(32, 0), startT: 300, endT: 3600, rate: 0.8 },
      ],
      warningDelay: 120,
    },
    injected: [
      { kind: "bridge_closed", tick: 1500, cell: gb.idx(31, 32) },
    ],
    powerGrid: {
      nodes: gb.powerNodes,
      edges: gb.powerEdges,
    },
    defaults: {
      dispatchMode: "negotiation",
      seed: 42,
    },
  };
}

// ============================================================================
// 2. Coastal Grid (96x96)
// ============================================================================
function generateCoastalGrid(): Scenario {
  const W = 96;
  const H = 96;
  const gb = new GridBuilder(W, H, 2, BlockType.Grass);

  // South coast ocean (z = 86..95)
  for (let z = 86; z < H; z++) {
    for (let x = 0; x < W; x++) {
      gb.setGround(x, z, 0);
      gb.setBlock(x, z, BlockType.WaterSource);
    }
  }
  // Sandy beach front (z = 80..85)
  for (let z = 80; z < 86; z++) {
    for (let x = 0; x < W; x++) {
      gb.setGround(x, z, 1);
      gb.setBlock(x, z, BlockType.Sand);
    }
  }

  // Central low-elevation flash-flood basin (x: 36..60, z: 40..60)
  for (let z = 40; z <= 60; z++) {
    for (let x = 36; x <= 60; x++) {
      gb.setGround(x, z, 1); // low depression
    }
  }

  // Grid streets (every 12 blocks)
  for (let x = 12; x <= 84; x += 12) {
    gb.paintRoad(x, 8, x, 78);
  }
  for (let z = 12; z <= 72; z += 12) {
    gb.paintRoad(8, z, 88, z);
  }

  // Drainage system in the low central basin
  gb.setBlock(48, 48, BlockType.Drainage);
  gb.setBlock(48, 52, BlockType.Drainage);
  gb.setBlock(44, 48, BlockType.Drainage);

  // Sea wall / levee along the beachfront road (z = 79)
  for (let x = 10; x <= 86; x++) {
    if (x % 12 !== 0) { // leave road gaps
      gb.setBlock(x, 79, BlockType.Levee);
    }
  }

  // Main Central Hospital (Inland, z = 24)
  const h1 = gb.placeBuilding(BlockType.Hospital, 45, 20, 4, 3, 100, 1, {
    generatorFuel: 4800,
    helipad: true,
    powerKind: "load",
  });

  // Coastal Clinic (Hospital 2, near waterfront)
  const h2 = gb.placeBuilding(BlockType.Hospital, 21, 68, 3, 2, 50, 1, {
    generatorFuel: 2400,
    powerKind: "load",
  });

  // Emergency Shelter (North-West elevated grounds, adjacent to grid road)
  const shelter = gb.placeBuilding(BlockType.Shelter, 21, 13, 3, 3, 200, 2, {
    powerKind: "load",
  });

  // Flood HQ
  const hq = gb.placeBuilding(BlockType.FloodHQ, 70, 20, 3, 2, 40, 1, {
    generatorFuel: 7200,
    powerKind: "load",
  });

  // Police Station
  gb.placeBuilding(BlockType.PoliceStation, 70, 44, 3, 2, 40, 1, {
    powerKind: "load",
  });

  // Boat Rescue Depot on coastal road
  gb.placeBuilding(BlockType.BoatDepot, 45, 75, 3, 2, 30, 1, {
    powerKind: "load",
  });

  // Dense housing grid
  for (let x = 14; x <= 80; x += 12) {
    for (let z = 14; z <= 66; z += 12) {
      if (gb.canPlace(x, z, 2, 2)) gb.placeBuilding(BlockType.House, x, z, 2, 2, 6);
      if (gb.canPlace(x + 3, z, 2, 2)) gb.placeBuilding(BlockType.House, x + 3, z, 2, 2, 6);
      if (gb.canPlace(x, z + 3, 2, 2)) gb.placeBuilding(BlockType.Apartment, x, z + 3, 2, 2, 24);
      if (gb.canPlace(x + 3, z + 3, 2, 2)) gb.placeBuilding(BlockType.Shop, x + 3, z + 3, 2, 2, 12);
    }
  }

  // Power grid
  const plant = gb.placePowerPlant(84, 10, 3, 2);
  const subNorth = gb.placeSubstation(48, 10, 2, 2);
  const subSouth = gb.placeSubstation(48, 68, 2, 2);

  gb.addPowerEdge(plant.powerNode!, subNorth.powerNode!);
  gb.addPowerEdge(subNorth.powerNode!, subSouth.powerNode!);
  if (h1.powerNode) gb.addPowerEdge(subNorth.powerNode!, h1.powerNode);
  if (hq.powerNode) gb.addPowerEdge(subNorth.powerNode!, hq.powerNode);
  if (shelter.powerNode) gb.addPowerEdge(subNorth.powerNode!, shelter.powerNode);
  if (h2.powerNode) gb.addPowerEdge(subSouth.powerNode!, h2.powerNode);

  // Ensure all buildings (including power plants and substations) have road connectivity
  gb.ensureAllBuildingsConnected();

  // 4 Districts
  const d1Cells: number[] = [];
  const d2Cells: number[] = [];
  const d3Cells: number[] = [];
  const d4Cells: number[] = [];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const c = gb.idx(x, z);
      if (x < 48 && z < 48) d1Cells.push(c);
      else if (x >= 48 && z < 48) d2Cells.push(c);
      else if (x < 48 && z >= 48) d3Cells.push(c);
      else d4Cells.push(c);
    }
  }

  const districts = [
    { id: 1, name: "Northwest Residential", cells: d1Cells },
    { id: 2, name: "Northeast Commercial", cells: d2Cells },
    { id: 3, name: "Coastal Basin South", cells: d3Cells },
    { id: 4, name: "Marina Industrial", cells: d4Cells },
  ];

  return {
    schemaVersion: 1,
    name: "Coastal Grid City",
    size: { w: W, h: H },
    ground: gb.ground,
    blocks: gb.blocks,
    buildings: gb.buildings,
    bridges: gb.bridges,
    districts,
    population: {
      count: 600,
      mix: { carOwners: 0.6, limitedMobility: 0.1, needsAssist: 0.05 },
      schedule: "office-hours",
    },
    fleet: {
      ambulances: 6,
      policeCars: 8,
      boats: 5,
      helicopters: 2,
      doctors: 12,
      nurses: 24,
      policeOfficers: 16,
      boatOperators: 6,
    },
    weather: {
      rain: [
        { t: 0, intensity: 0 },
        { t: 360, intensity: 0.1 }, // quiet opening
        { t: 720, intensity: 0.65 },
        { t: 1500, intensity: 0.95 },
        { t: 2700, intensity: 0.2 },
      ],
      wind: [
        { t: 0, speed: 4 },
        { t: 720, speed: 12 },
        { t: 1500, speed: 24 },
        { t: 2700, speed: 6 },
      ],
      floodKind: "compound",
      sources: [
        { cell: gb.idx(48, 48), startT: 360, endT: 3000, rate: 0.9 }, // flash burst in depression
        { cell: gb.idx(12, 85), startT: 600, endT: 3000, rate: 0.5 }, // storm surge
        { cell: gb.idx(72, 85), startT: 600, endT: 3000, rate: 0.5 },
      ],
      warningDelay: 150,
    },
    injected: [
      { kind: "road_blocked_by_debris", tick: 900, cell: gb.idx(48, 36) },
    ],
    powerGrid: {
      nodes: gb.powerNodes,
      edges: gb.powerEdges,
    },
    defaults: {
      dispatchMode: "negotiation",
      seed: 77,
    },
  };
}

// ============================================================================
// 3. Dense Basin City (96x96) & 4. Stress Triple (96x96)
// ============================================================================
function generateDenseBasinCity(isStress = false): Scenario {
  const W = 96;
  const H = 96;
  const gb = new GridBuilder(W, H, 4, BlockType.Grass);

  // Bowl-shaped terrain: center at (48, 48) with ground = 1, edges at ground = 6..8
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const distFromCenter = Math.sqrt((x - 48) ** 2 + (z - 48) ** 2);
      const elevation = Math.min(8, Math.max(1, Math.round(1 + (distFromCenter / 48) * 6)));
      gb.setGround(x, z, elevation);
    }
  }

  // Ring roads & Radial spokes
  // Inner ring: x,z in [36, 60]
  gb.paintRoad(36, 36, 60, 36);
  gb.paintRoad(36, 60, 60, 60);
  gb.paintRoad(36, 36, 36, 60);
  gb.paintRoad(60, 36, 60, 60);

  // Outer ring: x,z in [16, 80]
  gb.paintRoad(16, 16, 80, 16);
  gb.paintRoad(16, 80, 80, 80);
  gb.paintRoad(16, 16, 16, 80);
  gb.paintRoad(80, 16, 80, 80);

  // Radial arterial spokes (North, South, East, West)
  gb.paintRoad(48, 8, 48, 88);
  gb.paintRoad(8, 48, 88, 48);

  // Center lake / reservoir with drainage
  for (let z = 46; z <= 50; z++) {
    for (let x = 46; x <= 50; x++) {
      if (x === 48 || z === 48) continue; // keep central crossroads
      gb.setGround(x, z, 0);
      gb.setBlock(x, z, BlockType.WaterSource);
    }
  }
  // Bridge across the central basin channel (deck = 3 > ground 0)
  gb.paintBridge(48, 46, 48, 47, 3);
  gb.paintBridge(48, 49, 48, 50, 3);

  // Drainage wells in the basin bottom
  gb.setBlock(47, 45, BlockType.Drainage);
  gb.setBlock(49, 45, BlockType.Drainage);
  gb.setBlock(47, 51, BlockType.Drainage);
  gb.setBlock(49, 51, BlockType.Drainage);

  // Protective levee surrounding the critical low center
  for (let x = 43; x <= 53; x++) {
    if (x !== 48) {
      gb.setBlock(x, 43, BlockType.Levee);
      gb.setBlock(x, 53, BlockType.Levee);
    }
  }
  for (let z = 44; z <= 52; z++) {
    if (z !== 48) {
      gb.setBlock(43, z, BlockType.Levee);
      gb.setBlock(53, z, BlockType.Levee);
    }
  }

  // 3 Hospitals:
  // Hospital 1: North Hillside (Elevated, 7 beds, rooftop helipad)
  const h1 = gb.placeBuilding(BlockType.Hospital, 44, 12, 4, 3, 120, 2, {
    generatorFuel: 7200,
    helipad: true,
    powerKind: "load",
  });

  // Hospital 2: West Valley
  const h2 = gb.placeBuilding(BlockType.Hospital, 12, 44, 3, 3, 90, 1, {
    generatorFuel: 3600,
    powerKind: "load",
  });

  // Hospital 3: Southeast Ridge
  const h3 = gb.placeBuilding(BlockType.Hospital, 74, 52, 3, 3, 80, 2, {
    generatorFuel: 3600,
    powerKind: "load",
  });

  // Dedicated Downtown Helipad on high ground
  gb.placeBuilding(BlockType.Helipad, 52, 20, 3, 3, 10, 1);

  // Flood HQ (North Ridge)
  const hq = gb.placeBuilding(BlockType.FloodHQ, 52, 12, 3, 3, 50, 2, {
    generatorFuel: 7200,
    powerKind: "load",
  });

  // Emergency Shelter (East Rim, High Ground)
  const shelter = gb.placeBuilding(BlockType.Shelter, 74, 36, 4, 3, 250, 3, {
    powerKind: "load",
  });

  // Police Station
  gb.placeBuilding(BlockType.PoliceStation, 20, 44, 3, 3, 40, 1, {
    powerKind: "load",
  });

  // Rescue Boat Depot (adjacent to inner basin lake)
  gb.placeBuilding(BlockType.BoatDepot, 40, 45, 2, 2, 25, 1, {
    powerKind: "load",
  });

  // CRITICAL SUBSTATION in the low-lying basin (cell elevation = 1)
  const subBasin = gb.placeSubstation(41, 41, 2, 2);

  // Secondary Power Plant on high ridge
  const plant = gb.placePowerPlant(82, 82, 3, 2);
  const subNorth = gb.placeSubstation(48, 18, 2, 2);

  gb.addPowerEdge(plant.powerNode!, subNorth.powerNode!);
  gb.addPowerEdge(plant.powerNode!, subBasin.powerNode!);
  if (h1.powerNode) gb.addPowerEdge(subNorth.powerNode!, h1.powerNode);
  if (hq.powerNode) gb.addPowerEdge(subNorth.powerNode!, hq.powerNode);
  if (shelter.powerNode) gb.addPowerEdge(subNorth.powerNode!, shelter.powerNode);
  if (h2.powerNode) gb.addPowerEdge(subBasin.powerNode!, h2.powerNode);
  if (h3.powerNode) gb.addPowerEdge(subBasin.powerNode!, h3.powerNode);

  // Dense housing, apartments, offices spread in concentric zones
  for (let x = 20; x <= 72; x += 8) {
    for (let z = 20; z <= 72; z += 8) {
      if (Math.abs(x - 48) <= 10 && Math.abs(z - 48) <= 10) continue; // preserve inner basin
      if (gb.canPlace(x, z, 2, 2)) gb.placeBuilding(BlockType.Apartment, x, z, 2, 2, 28);
      if (gb.canPlace(x + 3, z, 2, 2)) gb.placeBuilding(BlockType.Office, x + 3, z, 2, 2, 35);
      if (gb.canPlace(x, z + 3, 2, 2)) gb.placeBuilding(BlockType.House, x, z + 3, 2, 2, 8);
      if (gb.canPlace(x + 3, z + 3, 2, 2)) gb.placeBuilding(BlockType.Shop, x + 3, z + 3, 2, 2, 15);
    }
  }

  // Ensure all buildings have road connectivity to the hospital road network
  gb.ensureAllBuildingsConnected();

  // 6 Districts for Gini Fairness metrics
  const dCells: number[][] = [[], [], [], [], [], []];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const c = gb.idx(x, z);
      const distFromCenter = Math.sqrt((x - 48) ** 2 + (z - 48) ** 2);
      if (distFromCenter <= 18) {
        dCells[0].push(c); // Central Basin
      } else if (distFromCenter <= 34) {
        if (x < 48) dCells[1].push(c); // Mid-West Slope
        else dCells[2].push(c); // Mid-East Commercial
      } else {
        if (z < 32) dCells[3].push(c); // North Highlands
        else if (z < 64) dCells[4].push(c); // Outer Industrial
        else dCells[5].push(c); // South Foothills
      }
    }
  }

  const districts = [
    { id: 1, name: "Central Basin Floodplain", cells: dCells[0] },
    { id: 2, name: "Mid-West Residential Slope", cells: dCells[1] },
    { id: 3, name: "Mid-East Commercial District", cells: dCells[2] },
    { id: 4, name: "North Highlands Medical", cells: dCells[3] },
    { id: 5, name: "Outer Industrial Zone", cells: dCells[4] },
    { id: 6, name: "South Foothills", cells: dCells[5] },
  ];

  // Injected events for Stress Scenario
  const stressInjected = isStress
    ? [
        { kind: "bridge_closed" as const, tick: 1200, cell: gb.idx(48, 46) }, // primary arterial bridge cut
        { kind: "boat_failure" as const, tick: 1200, vehicleId: 19 as VehicleId }, // rescue boat fails (10 ground + 1 boat)
        { kind: "shelter_overflow" as const, tick: 1200, buildingId: shelter.id }, // main shelter overflows
        { kind: "substation_flooded" as const, tick: 1200, nodeId: subBasin.powerNode! }, // basin substation trips, cutting hospital power
        { kind: "helicopter_grounded_wind" as const, tick: 1200, speed: 28, durationTicks: 600 }, // gale force winds ground helicopters
        { kind: "comms_outage" as const, tick: 1300, durationTicks: 400 }, // delayed emergency reports
        { kind: "false_report" as const, tick: 1400, cell: gb.idx(36, 36), confidence: 0.8 },
      ]
    : [
        { kind: "road_blocked_by_debris" as const, tick: 1800, cell: gb.idx(48, 60) },
      ];

  return {
    schemaVersion: 1,
    name: isStress ? "Stress Triple Disaster" : "Dense Basin City",
    size: { w: W, h: H },
    ground: gb.ground,
    blocks: gb.blocks,
    buildings: gb.buildings,
    bridges: gb.bridges,
    districts,
    population: {
      count: isStress ? 800 : 750,
      mix: { carOwners: 0.55, limitedMobility: 0.12, needsAssist: 0.06 },
      schedule: "office-hours",
    },
    fleet: {
      ambulances: 8,
      policeCars: 10,
      boats: 6,
      helicopters: 3,
      doctors: 18,
      nurses: 36,
      policeOfficers: 24,
      boatOperators: 8,
    },
    weather: {
      rain: [
        { t: 0, intensity: 0 },
        { t: 300, intensity: 0.08 }, // 5 min dry baseline
        { t: 900, intensity: 0.5 },
        { t: 1500, intensity: 1.0 }, // torrential peak
        { t: 2400, intensity: 0.4 },
        { t: 3600, intensity: 0.1 },
      ],
      wind: [
        { t: 0, speed: 3 },
        { t: 900, speed: 10 },
        { t: 1500, speed: 26 }, // gale force wind grounding threshold
        { t: 2400, speed: 12 },
        { t: 3600, speed: 4 },
      ],
      floodKind: "compound",
      sources: [
        { cell: gb.idx(48, 48), startT: 300, endT: 3600, rate: 1.2 }, // massive basin spring
        { cell: gb.idx(36, 36), startT: 600, endT: 3000, rate: 0.7 },
        { cell: gb.idx(60, 60), startT: 600, endT: 3000, rate: 0.7 },
      ],
      warningDelay: 120,
    },
    injected: stressInjected,
    powerGrid: {
      nodes: gb.powerNodes,
      edges: gb.powerEdges,
    },
    defaults: {
      dispatchMode: "negotiation",
      seed: isStress ? 99 : 55,
    },
  };
}

// ============================================================================
// Main Execution
// ============================================================================
async function main() {
  const scenariosDir = "scenarios";
  await mkdir(scenariosDir, { recursive: true });

  const templates: { filename: string; scenario: Scenario; desc: string }[] = [
    {
      filename: "riverside-town.json",
      scenario: generateRiversideTown(),
      desc: "A river with one bridge dividing two medical centers, flood HQ, shelter and boat depot.",
    },
    {
      filename: "coastal-grid.json",
      scenario: generateCoastalGrid(),
      desc: "A flat coastal grid city with flash flood depression, marina depot, and levee defense.",
    },
    {
      filename: "dense-basin-city.json",
      scenario: generateDenseBasinCity(false),
      desc: "Bowl-shaped topography with 3 hospitals, 2 helipads, a floodplain substation, and 6 districts.",
    },
    {
      filename: "stress-triple.json",
      scenario: generateDenseBasinCity(true),
      desc: "Compound stress test: simultaneous bridge closure, boat failure, shelter overflow, substation blackout, and gale wind grounding.",
    },
  ];

  const manifest = [];

  for (const t of templates) {
    // Validate with Zod before writing
    ScenarioSchema.parse(t.scenario);

    const fullPath = `${scenariosDir}/${t.filename}`;
    await writeFile(fullPath, JSON.stringify(t.scenario, null, 2) + "\n", "utf8");
    console.log(`Generated and validated: ${fullPath} (${t.scenario.size.w}x${t.scenario.size.h}, ${t.scenario.districts.length} districts)`);

    manifest.push({
      id: t.filename.replace(".json", ""),
      name: t.scenario.name,
      file: t.filename,
      size: t.scenario.size,
      description: t.desc,
      districts: t.scenario.districts.length,
      population: t.scenario.population.count,
      floodKind: t.scenario.weather.floodKind,
      defaultMode: t.scenario.defaults.dispatchMode,
    });
  }

  // Write manifest index.json for UI editor load dropdown
  const indexPath = `${scenariosDir}/index.json`;
  await writeFile(indexPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Generated template manifest: ${indexPath} (${manifest.length} templates)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
