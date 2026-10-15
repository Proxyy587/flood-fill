// Stand-in for AK's `src/sim` until it lands. Pure and deterministic: same
// scenario + seed + inputs = identical event log. Behaviour is deliberately
// simple; it exists so the renderer, UI and critic can be built against real
// protocol traffic. Physics here is NOT the spec in docs/SIM_SPEC.md.

import { BlockType } from '../blocks';
import type { EditCommand } from '../edit';
import { NpcRole, NpcState, PowerState, ReportStatus, VehicleKind, VehicleState } from '../entities';
import type { EventActorKind, SimEvent, SimEventType } from '../events';
import { asBuildingId, asNpcId, asRequestId, asVehicleId, type EntityRef } from '../ids';
import type { InspectorData } from '../inspector';
import type { MetricsFrame, RunSummary } from '../metrics';
import { DEFAULT_NPC_PARAMS, type NpcParams } from '../params';
import type { BuildingDef, DispatchMode, InjectedEvent, Scenario } from '../scenario';
import { chunkOfCell, type RenderSnapshot, type WorldSnapshot } from '../snapshot';
import { bridgeDeckHeights } from '../world';
import { createMockRng, type MockRng } from './rng';
import { mockBuildingNames } from './scenario';

export const MOCK_LIMITS = {
  footSafe: 0.3,
  foot: 0.5,
  car: 0.3,
  emergency: 0.5,
  boatMin: 0.6,
  heliWind: 0.75,
  substationTrip: 0.4,
} as const;

const RIVER_BASE_STAGE = 1.4;
const LEVEE_HEIGHT = 3;
const BELIEF_REFRESH_TICKS = 120;

// Local (pluvial) flooding. Volumes are in cell·metres (1 cell = 16 m²).
/** Rain intensity 1.0 is a 150 mm/h cloudburst. */
export const RAIN_MM_PER_HOUR_AT_FULL = 150;
const RAIN_M_PER_TICK = RAIN_MM_PER_HOUR_AT_FULL / 1000 / 3600;
/** One storm-drain inlet with a pump: 0.05 m³/s. Gravity only (no power): 30 %. */
const DRAIN_CELL_M_PER_TICK = 0.05 / 16;
const DRAIN_UNPOWERED = 0.3;
/** Infiltration of ponded water, ~5 mm/h per wetted cell. */
const INFILTRATION_M_PER_TICK = 0.005 / 3600;
const LOCAL_FLOOD_STEPS = [0.3, 1];

/** Fraction of rainfall that runs off each surface. */
const RUNOFF: Partial<Record<BlockType, number>> = {
  [BlockType.Grass]: 0.3,
  [BlockType.Tree]: 0.15,
  [BlockType.Sand]: 0.2,
  [BlockType.Dirt]: 0.5,
  [BlockType.Rock]: 0.7,
  [BlockType.Levee]: 0.4,
  [BlockType.WaterSource]: 0,
};
const runoffOf = (block: number): number => RUNOFF[block as BlockType] ?? 0.9;

interface Pond {
  cells: number[];
  /** Ground of each pond cell, ascending. */
  grounds: Float64Array;
  spill: number;
  capacity: number;
  /** Cells whose rain drains here (including the pond itself). */
  catchment: number;
  /** Σ runoff coefficient over the catchment. */
  runoff: number;
  drains: number[];
  downstream: number;
  volume: number;
  inflow: number;
  level: number;
  /** Lowest cell, for naming and events. */
  low: number;
  announced: number;
}

interface Mover {
  cell: number;
  next: number;
  prev: number;
  progress: number;
  speed: number;
  lateral: number;
  x: number;
  z: number;
  heading: number;
  plan: number[];
  planVersion: number;
  lastReroute: number;
}

interface Walker extends Mover {
  id: number;
  role: NpcRole;
  state: NpcState;
  panic: number;
  compliance: number;
  risk: number;
  strandedAt: number;
  requestId: number;
  assignedTo: number;
  decision?: InspectorData['lastDecision'];
}

interface Vehicle extends Mover {
  id: number;
  kind: VehicleKind;
  state: VehicleState;
  depthLimit: number;
  base: number;
  targetNpc: number;
  phase: 'idle' | 'out' | 'hover' | 'back';
  hover: number;
  stuck: number;
  failed: boolean;
  tx: number;
  tz: number;
}

interface Report {
  id: number;
  x: number;
  z: number;
  confidence: number;
  status: ReportStatus;
  real: boolean;
  npc: number;
  createdAt: number;
  statusAt: number;
}

interface Substation {
  building: BuildingDef;
  name: string;
  tripped: boolean;
  forced: boolean;
  dryTicks: number;
}

interface Generator {
  building: BuildingDef;
  name: string;
  fuel: number;
  maxFuel: number;
  active: boolean;
  lowWarned: boolean;
  exhausted: boolean;
}

export interface MockSimOptions {
  dispatchMode?: DispatchMode;
  npcParams?: NpcParams;
}

const piecewise = <P extends { t: number }>(points: P[], value: (p: P) => number, t: number): number => {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return value(points[0]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) {
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return value(a) + (value(b) - value(a)) * f;
    }
  }
  return value(points[points.length - 1]);
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const ACTOR_KIND: Partial<Record<SimEventType, EventActorKind>> = {
  POWER_TRIP: 'building',
  POWER_RESTORED: 'building',
  BLACKOUT_ZONE: 'building',
  SIGNAL_DARK: 'building',
  GENERATOR_START: 'building',
  GENERATOR_FUEL_LOW: 'building',
  GENERATOR_EXHAUSTED: 'building',
  HOSPITAL_DIVERSION_ON: 'building',
  SHELTER_OVERFLOW: 'building',
  NPC_STRANDED: 'npc',
  REQUEST_CREATED: 'npc',
};
const NPC_TARGET = new Set<SimEventType>(['HELI_DISPATCH', 'HELI_PICKUP', 'ROOFTOP_RESCUE']);

export class MockSim {
  readonly scenario: Scenario;
  readonly seed: number;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  dispatchMode: DispatchMode;
  params: NpcParams;

  ground: Uint8Array;
  blocks: Uint8Array;
  buildingIndex: Uint16Array;
  water: Float32Array;
  power: Uint8Array;
  tick = 0;

  private rng: MockRng;
  private buildings: (BuildingDef | null)[];
  private buildingNames: string[];
  private deck: Int16Array = new Int16Array(0);
  /** Depression (pond) a cell belongs to, -1 if none. */
  private pondOf: Int32Array = new Int32Array(0);
  private ponds: Pond[] = [];
  private pondOrder: number[] = [];
  private spanOf: Int32Array = new Int32Array(0);
  private spanDeck: number[] = [];
  private overtopped = new Set<number>();
  private closedSpans = new Set<number>();
  private districtOf: Int16Array;
  private closed: Uint8Array;
  private debris: Uint8Array;
  private belief: Float32Array;
  private shelterDist: Int32Array;
  private shelterLoad = new Map<number, number>();
  private shelterOverflowed = new Set<number>();
  private intersections: number[] = [];
  private serviceSub: Int16Array;

  private walkers: Walker[] = [];
  private vehicles: Vehicle[] = [];
  private reports: Report[] = [];
  private substations: Substation[] = [];
  private generators: Generator[] = [];

  private stage = RIVER_BASE_STAGE;
  private rainSmooth = 0;
  private rain = 0;
  private wind = 0;
  private windOverrideUntil = -1;
  private commsDownUntil = -1;
  private bridgeClosed = false;
  private floodOnset = -1;
  private evacOrdered = false;
  private floodThresholdsHit = 0;
  private rainLevel = 0;
  private windGrounded = false;
  private nextRequest = 1;
  private nextReport = 1;
  private served: { created: number; served: number; district: number }[] = [];
  private requestCreated = new Map<number, number>();
  private heliRescues = 0;
  private hospitalLoad = new Map<number, number>();
  private pendingInjected: InjectedEvent[];
  private dirty = new Set<number>();

  private log: SimEvent[] = [];
  private pending: SimEvent[] = [];
  readonly metricsLog: MetricsFrame[] = [];

  constructor(scenario: Scenario, seed: number, options: MockSimOptions = {}) {
    this.scenario = scenario;
    this.seed = seed;
    this.w = scenario.size.w;
    this.h = scenario.size.h;
    this.n = this.w * this.h;
    this.dispatchMode = options.dispatchMode ?? scenario.defaults.dispatchMode;
    this.params = options.npcParams ?? DEFAULT_NPC_PARAMS;
    this.rng = createMockRng(seed);

    this.ground = Uint8Array.from(scenario.ground);
    this.blocks = Uint8Array.from(scenario.blocks);
    this.buildingIndex = new Uint16Array(this.n);
    this.buildings = scenario.buildings.map((b) => ({ ...b, cells: [...b.cells] }));
    this.buildingNames = mockBuildingNames(scenario);
    this.buildings.forEach((b, i) => b?.cells.forEach((c) => (this.buildingIndex[c] = i + 1)));
    this.water = new Float32Array(this.n);
    this.power = new Uint8Array(this.n).fill(PowerState.Grid);
    this.closed = new Uint8Array(this.n);
    this.debris = new Uint8Array(this.n);
    this.belief = new Float32Array(this.n);
    this.shelterDist = new Int32Array(this.n);
    this.serviceSub = new Int16Array(this.n).fill(-1);
    this.districtOf = new Int16Array(this.n).fill(-1);
    scenario.districts.forEach((d, i) => d.cells.forEach((c) => (this.districtOf[c] = i)));
    this.pendingInjected = [...scenario.injected].sort((a, b) => a.t - b.t);

    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] === BlockType.WaterSource) this.water[c] = RIVER_BASE_STAGE - this.ground[c];
    }
    this.belief.set(this.water);
    this.rebuildCaches();
    this.setupPower();
    this.spawn();
  }

  // ---------- geometry helpers ----------

  private cx = (c: number) => c % this.w;
  private cz = (c: number) => Math.floor(c / this.w);
  private cellName = (c: number) => `(${this.cx(c)},${this.cz(c)})`;

  private neighbours(c: number): number[] {
    const x = this.cx(c);
    const z = this.cz(c);
    const out: number[] = [];
    if (x > 0) out.push(c - 1);
    if (x < this.w - 1) out.push(c + 1);
    if (z > 0) out.push(c - this.w);
    if (z < this.h - 1) out.push(c + this.w);
    return out;
  }

  private isRoad(c: number): boolean {
    const b = this.blocks[c];
    return b === BlockType.Road || b === BlockType.Bridge;
  }

  private passable(c: number, limit: number): boolean {
    if (!this.isRoad(c) || this.debris[c]) return false;
    if (this.blocks[c] === BlockType.Bridge) {
      const span = this.spanOf[c];
      return !this.bridgeClosed && !this.overtopped.has(span) && !this.closedSpans.has(span);
    }
    return this.water[c] <= limit;
  }

  /** Depth an agent standing on the cell experiences (bridge decks sit above the river). */
  private depthAt(c: number): number {
    const deck = this.deck[c];
    return deck >= 0 ? Math.max(0, this.ground[c] + this.water[c] - deck) : this.water[c];
  }

  private emit(type: SimEventType, reason: string, extra: Omit<SimEvent, 'tick' | 'type' | 'reason'> = {}): void {
    const ev: SimEvent = { tick: this.tick, type, reason, ...extra };
    if (ev.actor !== undefined && !ev.actorKind) ev.actorKind = ACTOR_KIND[type] ?? 'vehicle';
    if (ev.target !== undefined && !ev.targetKind) ev.targetKind = NPC_TARGET.has(type) ? 'npc' : 'request';
    this.log.push(ev);
    this.pending.push(ev);
  }

  private barrier(c: number): number {
    return this.ground[c] + (this.blocks[c] === BlockType.Levee ? LEVEE_HEIGHT : 0);
  }

  /**
   * Finds closed depressions and their catchments. A priority flood from the
   * map edge and the river gives every cell its spill level and a receiver
   * (`parent`) on its way out; cells whose spill level is above their barrier
   * form ponds, and every cell drains into the first pond on its receiver chain.
   */
  private computeDepressions(): void {
    const n = this.n;
    const spill = new Float32Array(n);
    const parent = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const heap = new MinHeap();
    for (let c = 0; c < n; c++) {
      const x = this.cx(c);
      const z = this.cz(c);
      const edge = x === 0 || z === 0 || x === this.w - 1 || z === this.h - 1;
      if (edge || this.blocks[c] === BlockType.WaterSource) {
        done[c] = 1;
        spill[c] = this.barrier(c);
        heap.push(c, spill[c]);
      }
    }
    while (heap.size) {
      const c = heap.pop();
      for (const nb of this.neighbours(c)) {
        if (done[nb]) continue;
        done[nb] = 1;
        parent[nb] = c;
        spill[nb] = Math.max(this.barrier(nb), spill[c]);
        heap.push(nb, spill[nb]);
      }
    }

    const previous = new Map(this.ponds.map((p) => [p.low, p.volume]));
    this.pondOf = new Int32Array(n).fill(-1);
    this.ponds = [];
    const stack: number[] = [];
    for (let c = 0; c < n; c++) {
      if (this.pondOf[c] >= 0 || spill[c] <= this.barrier(c)) continue;
      const id = this.ponds.length;
      const cells: number[] = [];
      stack.push(c);
      this.pondOf[c] = id;
      let level = 0;
      while (stack.length) {
        const k = stack.pop() as number;
        cells.push(k);
        level = Math.max(level, spill[k]);
        for (const nb of this.neighbours(k)) {
          if (this.pondOf[nb] >= 0 || spill[nb] <= this.barrier(nb)) continue;
          this.pondOf[nb] = id;
          stack.push(nb);
        }
      }
      const grounds = Float64Array.from(cells, (k) => this.ground[k]).sort();
      let low = cells[0];
      for (const k of cells) if (this.ground[k] < this.ground[low]) low = k;
      let capacity = 0;
      for (const g of grounds) capacity += level - g;
      this.ponds.push({
        cells,
        grounds,
        spill: level,
        capacity,
        catchment: 0,
        runoff: 0,
        drains: [],
        downstream: -1,
        volume: Math.min(capacity, previous.get(low) ?? 0),
        inflow: 0,
        level: grounds[0],
        low,
        announced: 0,
      });
    }

    // Catchments: follow receivers until the first pond (or the outlet).
    const target = new Int32Array(n).fill(-2);
    const path: number[] = [];
    for (let c = 0; c < n; c++) {
      if (target[c] !== -2) continue;
      path.length = 0;
      let k = c;
      while (k >= 0 && target[k] === -2 && this.pondOf[k] < 0) {
        path.push(k);
        k = parent[k];
      }
      const res = k < 0 ? -1 : this.pondOf[k] >= 0 ? this.pondOf[k] : target[k];
      for (const p of path) target[p] = res;
      if (this.pondOf[c] >= 0) target[c] = this.pondOf[c];
    }
    for (let c = 0; c < n; c++) {
      const p = this.pondOf[c] >= 0 ? this.pondOf[c] : target[c];
      if (p < 0) continue;
      const pond = this.ponds[p];
      pond.catchment++;
      pond.runoff += runoffOf(this.blocks[c]);
      if (this.blocks[c] === BlockType.Drainage) pond.drains.push(c);
    }
    // A full pond overflows at its pour point into whatever lies downhill.
    this.ponds.forEach((pond, id) => {
      for (const k of pond.cells) {
        const out = parent[k];
        if (out >= 0 && this.pondOf[out] !== id) {
          const next = this.pondOf[out] >= 0 ? this.pondOf[out] : target[out];
          pond.downstream = next === id ? -1 : next;
          break;
        }
      }
    });
    this.pondOrder = this.ponds.map((_, i) => i).sort((a, b) => this.ponds[b].spill - this.ponds[a].spill || a - b);
  }

  private computeSpans(): void {
    this.spanOf = new Int32Array(this.n).fill(-1);
    this.spanDeck = [];
    const stack: number[] = [];
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] !== BlockType.Bridge || this.spanOf[c] >= 0) continue;
      const id = this.spanDeck.length;
      this.spanDeck.push(this.deck[c]);
      stack.push(c);
      this.spanOf[c] = id;
      while (stack.length) {
        const k = stack.pop() as number;
        for (const nb of this.neighbours(k)) {
          if (this.blocks[nb] !== BlockType.Bridge || this.spanOf[nb] >= 0) continue;
          this.spanOf[nb] = id;
          stack.push(nb);
        }
      }
    }
  }

  /** Water level for a pond holding `volume` cell·metres. */
  private static levelFor(p: Pond, volume: number): number {
    let sum = 0;
    for (let i = 0; i < p.grounds.length; i++) {
      sum += p.grounds[i];
      const count = i + 1;
      const next = i + 1 < p.grounds.length ? p.grounds[i + 1] : p.spill;
      if (count * next - sum >= volume) return (volume + sum) / count;
    }
    return p.spill;
  }

  private rebuildCaches(): void {
    this.deck = bridgeDeckHeights(this.w, this.h, this.ground, this.blocks);
    this.computeDepressions();
    this.computeSpans();
    this.intersections = [];
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] !== BlockType.Road) continue;
      if (this.neighbours(c).filter((nb) => this.isRoad(nb)).length >= 3) this.intersections.push(c);
    }
    this.computeShelterField();
  }

  private computeShelterField(): void {
    this.shelterDist.fill(-1);
    const queue: number[] = [];
    this.buildings.forEach((b, i) => {
      if (!b || b.type !== BlockType.Shelter || this.shelterOverflowed.has(i)) return;
      if (this.shelterDist[b.entrance] !== 0) {
        this.shelterDist[b.entrance] = 0;
        queue.push(b.entrance);
      }
    });
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      for (const nb of this.neighbours(c)) {
        if (this.shelterDist[nb] >= 0 || !this.passable(nb, MOCK_LIMITS.footSafe)) continue;
        this.shelterDist[nb] = this.shelterDist[c] + 1;
        queue.push(nb);
      }
    }
  }

  private setupPower(): void {
    const nodes = this.scenario.powerGrid.nodes;
    const subNodes = nodes.filter((p) => p.kind === 'substation');
    for (const node of subNodes) {
      const b = node.building !== undefined ? this.buildings[node.building] : null;
      if (b) this.substations.push({ building: b, name: this.buildingNames[b.id], tripped: false, forced: false, dryTicks: 0 });
    }
    const parentSub = new Map<number, number>();
    for (const [a, b] of this.scenario.powerGrid.edges) {
      const si = subNodes.findIndex((s) => s.id === a);
      if (si >= 0) parentSub.set(b, si);
    }
    for (let c = 0; c < this.n; c++) {
      const bi = this.buildingIndex[c] - 1;
      const b = bi >= 0 ? this.buildings[bi] : null;
      if (b && b.powerNode !== undefined && parentSub.has(b.powerNode)) {
        this.serviceSub[c] = parentSub.get(b.powerNode) as number;
        continue;
      }
      let best = -1;
      let bestD = Infinity;
      subNodes.forEach((s, i) => {
        const d = Math.hypot(this.cx(s.cell) - this.cx(c), this.cz(s.cell) - this.cz(c));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      this.serviceSub[c] = best;
    }
    for (const b of this.buildings) {
      if (b?.generator) {
        this.generators.push({
          building: b,
          name: this.buildingNames[b.id],
          fuel: b.generator.fuelTicks,
          maxFuel: b.generator.fuelTicks,
          active: false,
          lowWarned: false,
          exhausted: false,
        });
      }
    }
  }

  private entrances(type: BlockType): number[] {
    return this.buildings.filter((b): b is BuildingDef => !!b && b.type === type && this.isRoad(b.entrance)).map((b) => b.entrance);
  }

  private roadCells(): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.n; c++) if (this.blocks[c] === BlockType.Road) out.push(c);
    return out;
  }

  private makeMover(cell: number, speed: number, lateral: number): Mover {
    return {
      cell,
      next: -1,
      prev: cell,
      progress: 0,
      speed,
      lateral,
      x: this.cx(cell) + 0.5,
      z: this.cz(cell) + 0.5,
      heading: 0,
      plan: [],
      planVersion: 0,
      lastReroute: -1000,
    };
  }

  private spawn(): void {
    const roads = this.roadCells();
    if (roads.length === 0) return;
    const pop = this.scenario.population;
    const fleet = this.scenario.fleet;
    const staff: [NpcRole, number][] = [
      [NpcRole.Police, fleet.policeOfficers],
      [NpcRole.Doctor, fleet.doctors],
      [NpcRole.Nurse, fleet.nurses],
      [NpcRole.BoatOperator, fleet.boatOperators],
      [NpcRole.Pilot, fleet.helicopters],
    ];
    const homes = this.buildings.filter((b): b is BuildingDef => !!b && (b.type === BlockType.House || b.type === BlockType.Apartment) && this.isRoad(b.entrance));
    const homeWeight = homes.reduce((s, b) => s + b.capacity, 0);
    const workplace: Partial<Record<NpcRole, number[]>> = {
      [NpcRole.Police]: this.entrances(BlockType.PoliceStation),
      [NpcRole.Doctor]: this.entrances(BlockType.Hospital),
      [NpcRole.Nurse]: this.entrances(BlockType.Hospital),
      [NpcRole.BoatOperator]: this.entrances(BlockType.BoatDepot),
      [NpcRole.Pilot]: this.entrances(BlockType.Hospital),
    };
    const startCell = (role: NpcRole): number => {
      const work = workplace[role];
      if (work?.length) return this.rng.pick(work);
      if (role !== NpcRole.Civilian || homeWeight === 0) return this.rng.pick(roads);
      let r = this.rng.next() * homeWeight;
      for (const b of homes) {
        r -= b.capacity;
        if (r <= 0) return b.entrance;
      }
      return homes[homes.length - 1].entrance;
    };
    let id = 1;
    const addWalker = (role: NpcRole) => {
      const cell = startCell(role);
      this.walkers.push({
        ...this.makeMover(cell, this.rng.range(0.18, 0.32), this.rng.range(-0.32, 0.32)),
        id: id++,
        role,
        state: role === NpcRole.Civilian ? NpcState.Commuting : NpcState.OnDuty,
        panic: Math.min(1, Math.max(0, this.params.panicMean + this.rng.range(-0.2, 0.2))),
        compliance: Math.min(1, Math.max(0, this.params.complianceMean + this.rng.range(-0.25, 0.25))),
        risk: Math.min(1, Math.max(0, this.params.riskToleranceMean + this.rng.range(-0.2, 0.2))),
        strandedAt: -1,
        requestId: -1,
        assignedTo: -1,
      });
    };
    const civilians = Math.max(0, pop.count - staff.reduce((s, [, k]) => s + k, 0));
    for (let i = 0; i < civilians; i++) addWalker(NpcRole.Civilian);
    for (const [role, k] of staff) for (let i = 0; i < k; i++) addWalker(role);

    let vid = 1;
    const entranceOf = (type: BlockType) => this.buildings.filter((b) => b?.type === type).map((b) => (b as BuildingDef).entrance);
    const hospitals = entranceOf(BlockType.Hospital);
    const police = entranceOf(BlockType.PoliceStation);
    const addVehicle = (kind: VehicleKind, cell: number, speed: number, depthLimit: number, state: VehicleState) => {
      this.vehicles.push({
        ...this.makeMover(cell, speed, 0.22),
        id: vid++,
        kind,
        state,
        depthLimit,
        base: cell,
        targetNpc: -1,
        phase: 'idle',
        hover: 0,
        stuck: 0,
        failed: false,
        tx: this.cx(cell) + 0.5,
        tz: this.cz(cell) + 0.5,
      });
    };
    const cars = Math.round((pop.count * pop.mix.carOwners) / 4);
    for (let i = 0; i < cars; i++) addVehicle(VehicleKind.Car, this.rng.pick(roads), this.rng.range(0.6, 0.9), MOCK_LIMITS.car, VehicleState.Driving);
    for (let i = 0; i < fleet.ambulances; i++) {
      addVehicle(VehicleKind.Ambulance, hospitals.length ? hospitals[i % hospitals.length] : this.rng.pick(roads), 1.0, MOCK_LIMITS.emergency, VehicleState.Responding);
    }
    for (let i = 0; i < fleet.policeCars; i++) {
      addVehicle(VehicleKind.PoliceCar, police.length ? police[i % police.length] : this.rng.pick(roads), 0.95, MOCK_LIMITS.emergency, VehicleState.Driving);
    }
    const depot = this.buildings.find((b) => b?.type === BlockType.BoatDepot);
    const boatHome = depot ? this.nearestWaterCell(depot.entrance) : this.nearestWaterCell(roads[0]);
    for (let i = 0; i < fleet.boats; i++) addVehicle(VehicleKind.Boat, boatHome, 0.5, Infinity, VehicleState.Parked);
    const pads = this.buildings.filter((b) => b?.type === BlockType.Helipad || b?.helipad) as BuildingDef[];
    for (let i = 0; i < fleet.helicopters; i++) {
      const pad = pads.length ? pads[i % pads.length] : null;
      addVehicle(VehicleKind.Helicopter, pad ? pad.cells[i % pad.cells.length] : roads[0], 1.6, Infinity, VehicleState.Landed);
    }
  }

  private nearestWaterCell(from: number): number {
    let best = from;
    let bestD = Infinity;
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] !== BlockType.WaterSource) continue;
      const d = Math.abs(this.cx(c) - this.cx(from)) + Math.abs(this.cz(c) - this.cz(from));
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // ---------- tick pipeline (same order as docs/ARCHITECTURE.md §3) ----------

  step(): void {
    this.tick++;
    this.runInjected();
    this.stepWeather();
    this.stepFlood();
    this.stepPower();
    this.stepHazards();
    this.stepReports();
    this.stepDecisions();
    this.stepMovement();
    if (this.tick % 10 === 0) this.metricsLog.push(this.metrics());
    if (this.tick % BELIEF_REFRESH_TICKS === 0) this.refreshBelief();
  }

  private runInjected(): void {
    while (this.pendingInjected.length && this.pendingInjected[0].t <= this.tick) {
      this.applyInjected(this.pendingInjected.shift() as InjectedEvent);
    }
  }

  private stepWeather(): void {
    const wx = this.scenario.weather;
    this.rain = piecewise(wx.rain, (p) => p.intensity, this.tick);
    this.wind = this.tick < this.windOverrideUntil ? 0.95 : piecewise(wx.wind, (p) => p.speed, this.tick);
    const level = this.rain >= 0.7 ? 2 : this.rain >= 0.3 ? 1 : 0;
    if (level !== this.rainLevel) {
      const label = ['Rain easing to light', 'Moderate rain', 'Heavy rain'][level];
      this.emit('WEATHER', `${label}: intensity ${round2(this.rain)}`, { data: { rain: round2(this.rain), wind: round2(this.wind) } });
      this.rainLevel = level;
    }
  }

  private stepFlood(): void {
    const wx = this.scenario.weather;
    this.rainSmooth += (this.rain - this.rainSmooth) / 300;
    const sourceBoost = wx.sources.some((s) => this.tick >= s.startT && this.tick <= s.endT) ? 0.5 : 0;
    const target = RIVER_BASE_STAGE + 2.5 * this.rainSmooth + sourceBoost;
    this.stage += (target - this.stage) * 0.01;
    this.stepPonds();

    const fill = new Float32Array(this.n);
    const queue: number[] = [];
    const seen = new Uint8Array(this.n);
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] === BlockType.WaterSource) {
        seen[c] = 1;
        queue.push(c);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      fill[c] = Math.max(0, this.stage - this.ground[c]);
      for (const nb of this.neighbours(c)) {
        if (seen[nb] || this.barrier(nb) >= this.stage) continue;
        seen[nb] = 1;
        queue.push(nb);
      }
    }

    for (const p of this.ponds) {
      if (p.level <= p.grounds[0]) continue;
      for (const c of p.cells) fill[c] = Math.max(fill[c], p.level - this.ground[c]);
    }

    for (let c = 0; c < this.n; c++) {
      this.water[c] += (fill[c] - this.water[c]) * 0.15;
      if (this.water[c] < 0.005) this.water[c] = 0;
    }
  }

  /** Rain → runoff → hollows; drains and infiltration empty them; full ones spill downhill. */
  private stepPonds(): void {
    const rain = this.rain * RAIN_M_PER_TICK;
    for (const id of this.pondOrder) {
      const p = this.ponds[id];
      let v = p.volume + p.inflow + rain * p.runoff;
      p.inflow = 0;
      if (v > 0) {
        for (const d of p.drains) v -= DRAIN_CELL_M_PER_TICK * (this.power[d] === PowerState.Off ? DRAIN_UNPOWERED : 1);
        let wet = 0;
        for (const g of p.grounds) if (g < p.level) wet++;
        v -= INFILTRATION_M_PER_TICK * wet;
      }
      v = Math.max(0, v);
      if (v > p.capacity) {
        if (p.downstream >= 0) this.ponds[p.downstream].inflow += v - p.capacity;
        v = p.capacity;
      }
      p.volume = v;
      p.level = MockSim.levelFor(p, v);
      const depth = p.level - p.grounds[0];
      while (p.announced < LOCAL_FLOOD_STEPS.length && depth >= LOCAL_FLOOD_STEPS[p.announced] && p.cells.length >= 3) {
        const district = this.scenario.districts[this.districtOf[p.low]]?.name ?? 'the city';
        const pumped = p.drains.filter((d) => this.power[d] !== PowerState.Off).length;
        const drains = p.drains.length
          ? `${p.drains.length} storm drain${p.drains.length === 1 ? '' : 's'} (${pumped} pumped) can't keep up`
          : 'no storm drain serves this hollow';
        this.emit(
          'LOCAL_FLOOD',
          `Rain ponding in a ${district} hollow at ${this.cellName(p.low)}: ${round2(depth)} m deep. ${p.catchment} cells drain here; ${drains} at ${Math.round(this.rain * RAIN_MM_PER_HOUR_AT_FULL)} mm/h`,
          { cell: p.low, data: { depth: round2(depth), catchment: p.catchment, drains: p.drains.length, cells: p.cells.length } },
        );
        p.announced++;
      }
    }
  }

  private stepPower(): void {
    for (let i = 0; i < this.substations.length; i++) {
      const s = this.substations[i];
      const depth = Math.max(...s.building.cells.map((c) => this.water[c]));
      if (!s.tripped && depth > MOCK_LIMITS.substationTrip) {
        this.tripSubstation(i, `${s.name} flooded: depth ${round2(depth)} > trip threshold ${MOCK_LIMITS.substationTrip}`);
      } else if (s.tripped && !s.forced) {
        s.dryTicks = depth < 0.05 ? s.dryTicks + 1 : 0;
        if (s.dryTicks > 120) {
          s.tripped = false;
          this.emit('POWER_RESTORED', `${s.name} dry for 120 ticks; feeder re-energised`, {
            actor: asBuildingId(s.building.id),
            cell: s.building.entrance,
          });
        }
      }
    }
    for (let c = 0; c < this.n; c++) {
      const sub = this.serviceSub[c];
      this.power[c] = sub >= 0 && this.substations[sub]?.tripped ? PowerState.Off : PowerState.Grid;
    }
    for (const g of this.generators) {
      const sub = this.serviceSub[g.building.cells[0]];
      const gridDown = sub >= 0 && this.substations[sub]?.tripped;
      if (gridDown && !g.active && !g.exhausted) {
        g.active = true;
        this.emit('GENERATOR_START', `${g.name} lost grid power; backup generator engaged with ${g.fuel} ticks of fuel`, {
          actor: asBuildingId(g.building.id),
          cell: g.building.entrance,
          data: { fuelTicks: g.fuel },
        });
      }
      if (!gridDown && g.active) g.active = false;
      if (g.active) {
        g.fuel--;
        if (!g.lowWarned && g.fuel <= g.maxFuel * 0.25) {
          g.lowWarned = true;
          this.emit('GENERATOR_FUEL_LOW', `${g.name} generator below 25% fuel (${g.fuel} ticks left)`, {
            actor: asBuildingId(g.building.id),
            data: { fuelTicks: g.fuel },
          });
        }
        if (g.fuel <= 0) {
          g.active = false;
          g.exhausted = true;
          this.emit('GENERATOR_EXHAUSTED', `${g.name} generator out of fuel; hospital has no power`, { actor: asBuildingId(g.building.id) });
          this.emit('HOSPITAL_DIVERSION_ON', `${g.name} unpowered; diverting new patients`, { actor: asBuildingId(g.building.id) });
        }
      }
      if (g.active) for (const c of g.building.cells) this.power[c] = PowerState.Generator;
    }
  }

  private tripSubstation(i: number, reason: string, forced = false): void {
    const s = this.substations[i];
    if (s.tripped) return;
    s.tripped = true;
    s.forced = forced;
    s.dryTicks = 0;
    let cells = 0;
    let signals = 0;
    for (let c = 0; c < this.n; c++) if (this.serviceSub[c] === i) cells++;
    for (const c of this.intersections) if (this.serviceSub[c] === i) signals++;
    const actor = asBuildingId(s.building.id);
    this.emit('POWER_TRIP', reason, { actor, cell: s.building.entrance });
    this.emit('BLACKOUT_ZONE', `${cells} cells downstream of ${s.name} lost power`, { actor, data: { cells } });
    if (signals > 0) {
      this.emit('SIGNAL_DARK', `${signals} traffic signals dark; intersections fall back to 4-way stop (capacity ×0.5)`, {
        actor,
        data: { signals },
      });
    }
  }

  private stepHazards(): void {
    let newlyClosed = 0;
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] !== BlockType.Road) continue;
      const wet = this.water[c] > MOCK_LIMITS.car;
      if (wet && !this.closed[c]) {
        this.closed[c] = 1;
        newlyClosed++;
        this.emit('ROAD_CLOSED', `cell ${this.cellName(c)} depth ${round2(this.water[c])} > car limit ${MOCK_LIMITS.car}`, { cell: c });
      } else if (!wet && this.closed[c] && this.water[c] < MOCK_LIMITS.car * 0.5) {
        this.closed[c] = 0;
        this.emit('ROAD_REOPENED', `cell ${this.cellName(c)} drained to ${round2(this.water[c])}`, { cell: c });
      }
    }

    for (let span = 0; span < this.spanDeck.length; span++) {
      if (this.overtopped.has(span) || this.stage <= this.spanDeck[span]) continue;
      this.overtopped.add(span);
      const c = this.spanOf.indexOf(span);
      this.emit('BRIDGE_OVERTOPPED', `river stage ${round2(this.stage)} m above the ${this.spanDeck[span]} m deck at ${this.cellName(c)}; span closed to all traffic`, { cell: c });
      newlyClosed++;
    }
    if (newlyClosed > 0 || this.tick % 30 === 0) this.computeShelterField();

    let flooded = 0;
    let land = 0;
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] === BlockType.WaterSource) continue;
      land++;
      if (this.water[c] > 0.1) flooded++;
    }
    const frac = land ? flooded / land : 0;
    const thresholds = [0.02, 0.05, 0.1, 0.2];
    while (this.floodThresholdsHit < thresholds.length && frac >= thresholds[this.floodThresholdsHit]) {
      const pct = thresholds[this.floodThresholdsHit] * 100;
      this.emit('FLOOD_THRESHOLD', `${pct}% of land cells flooded (> 0.1 depth)`, { data: { floodedCells: flooded, pct } });
      if (this.floodOnset < 0) this.floodOnset = this.tick;
      this.floodThresholdsHit++;
    }

    const windy = this.wind > MOCK_LIMITS.heliWind;
    if (windy !== this.windGrounded) {
      this.windGrounded = windy;
      for (const v of this.vehicles) {
        if (v.kind !== VehicleKind.Helicopter) continue;
        if (windy) {
          this.emit('HELI_GROUNDED_WIND', `wind ${round2(this.wind)} > helicopter limit ${MOCK_LIMITS.heliWind}`, { actor: asVehicleId(v.id) });
          if (v.phase === 'out' || v.phase === 'hover') this.abortHeli(v, 'grounded by wind mid-mission');
          if (v.phase === 'idle') v.state = VehicleState.Grounded;
        } else if (v.state === VehicleState.Grounded) {
          v.state = VehicleState.Landed;
        }
      }
    }

    if (!this.evacOrdered && this.floodOnset >= 0 && this.tick >= this.floodOnset + this.params.warningDelay) {
      this.evacOrdered = true;
      let complied = 0;
      for (const a of this.walkers) {
        if (a.role !== NpcRole.Civilian || a.state !== NpcState.Commuting) continue;
        const uEvac = round2(0.5 * a.compliance + 0.4 * a.panic + this.rng.range(-0.1, 0.1));
        const uStay = round2(0.35 + 0.3 * a.risk);
        const evac = uEvac > uStay;
        a.decision = {
          tick: this.tick,
          chosen: evac ? 'Evacuate' : 'Shelter in place',
          alternatives: [
            { label: 'Evacuate', score: uEvac },
            { label: 'Shelter in place', score: uStay },
          ],
          reason: evac
            ? `U(evacuate)=${uEvac} > U(stay)=${uStay}: compliance ${round2(a.compliance)}, panic ${round2(a.panic)}`
            : `U(stay)=${uStay} ≥ U(evacuate)=${uEvac}: risk tolerance ${round2(a.risk)}`,
        };
        if (evac) {
          a.state = NpcState.Evacuating;
          a.plan = [];
          a.planVersion++;
          complied++;
        }
      }
      this.emit('EVAC_ORDER', `HQ evacuation order ${this.params.warningDelay} ticks after flood onset; ${complied} civilians complied`, {
        data: { complied },
      });
    }
  }

  private stepReports(): void {
    const commsUp = this.tick >= this.commsDownUntil;
    if (commsUp && this.floodOnset >= 0 && this.rng.chance(this.params.falseReportRate * 0.01)) {
      this.createReport(-1, false);
    }
    for (const r of this.reports) {
      if (r.status === ReportStatus.Unverified && commsUp && this.tick - r.createdAt > this.params.commsDelay) {
        r.confidence = Math.min(0.95, r.confidence + (r.real ? 0.006 : 0.002));
        if (r.real && r.confidence >= 0.8) {
          r.status = ReportStatus.Verified;
          r.statusAt = this.tick;
          this.emit('REPORT_VERIFIED', `report #${r.id} corroborated (confidence ${round2(r.confidence)})`, { data: { report: r.id } });
        } else if (!r.real && this.tick - r.createdAt > 240) {
          r.status = ReportStatus.False;
          r.statusAt = this.tick;
          this.emit('REPORT_FALSE', `report #${r.id} not corroborated after 240 ticks; marked false`, { data: { report: r.id } });
        }
      }
    }
    this.reports = this.reports.filter(
      (r) => !((r.status === ReportStatus.False || r.status === ReportStatus.Resolved) && this.tick - r.statusAt > 90),
    );
  }

  private createReport(npc: number, real: boolean): void {
    let x: number;
    let z: number;
    if (npc >= 0) {
      const a = this.walkers[npc];
      x = a.x + this.rng.range(-2, 2);
      z = a.z + this.rng.range(-2, 2);
    } else {
      const roads = this.intersections.length ? this.intersections : [0];
      const c = this.rng.pick(roads);
      x = this.cx(c) + 0.5;
      z = this.cz(c) + 0.5;
    }
    const r: Report = {
      id: this.nextReport++,
      x: Math.min(this.w - 0.01, Math.max(0, x)),
      z: Math.min(this.h - 0.01, Math.max(0, z)),
      confidence: real ? 0.35 : 0.25,
      status: ReportStatus.Unverified,
      real,
      npc,
      createdAt: this.tick,
      statusAt: this.tick,
    };
    this.reports.push(r);
    this.emit('REPORT_CREATED', `${real ? 'call for help' : 'unconfirmed call'} near (${Math.floor(r.x)},${Math.floor(r.z)}), ±2 cells, confidence ${r.confidence}`, {
      cell: Math.floor(r.z) * this.w + Math.floor(r.x),
      data: { report: r.id, confidence: r.confidence },
    });
  }

  private stepDecisions(): void {
    // Stranding.
    this.walkers.forEach((a, i) => {
      if (a.state === NpcState.Sheltering || a.state === NpcState.Rescued || a.state === NpcState.Stranded) return;
      if (this.depthAt(a.cell) > MOCK_LIMITS.footSafe + 0.05) {
        a.state = NpcState.Stranded;
        a.strandedAt = this.tick;
        a.next = -1;
        a.progress = 0;
        a.requestId = this.nextRequest++;
        this.requestCreated.set(a.requestId, this.tick);
        this.emit('NPC_STRANDED', `depth ${round2(this.depthAt(a.cell))} at ${this.cellName(a.cell)} above safe wading depth ${MOCK_LIMITS.footSafe}`, {
          actor: asNpcId(a.id),
          cell: a.cell,
        });
        this.emit('REQUEST_CREATED', `rescue request for stranded ${NpcRole[a.role].toLowerCase()} #${a.id}`, {
          target: asRequestId(a.requestId),
          actor: asNpcId(a.id),
          cell: a.cell,
        });
        if (this.tick >= this.commsDownUntil && this.rng.chance(0.9)) this.createReport(i, true);
      }
    });

    if (this.tick % 5 !== 0) return;
    const waiting = this.walkers
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.state === NpcState.Stranded && a.assignedTo < 0)
      .sort((p, q) => p.a.strandedAt - q.a.strandedAt);
    for (const { a, i } of waiting) {
      const bids: { v: Vehicle; eta: number }[] = [];
      for (const v of this.vehicles) {
        if (v.failed || v.targetNpc >= 0) continue;
        const d = Math.hypot(v.x - a.x, v.z - a.z);
        if (v.kind === VehicleKind.Boat && this.deepNear(a.cell)) bids.push({ v, eta: Math.round(d / v.speed + 10) });
        if (v.kind === VehicleKind.Helicopter && v.phase === 'idle' && !this.windGrounded) bids.push({ v, eta: Math.round(d / v.speed + 30) });
      }
      if (bids.length === 0) continue;
      bids.sort((p, q) => p.eta - q.eta || p.v.id - q.v.id);
      const best = bids[0];
      if (this.dispatchMode === 'negotiation') {
        for (const b of bids.slice(0, 2)) {
          this.emit('BID', `${VehicleKind[b.v.kind]} #${b.v.id} bids ETA ${b.eta} ticks`, {
            actor: asVehicleId(b.v.id),
            target: asRequestId(a.requestId),
            data: { eta: b.eta },
          });
        }
      }
      const runnerUp = bids[1] ? `; next best ${VehicleKind[bids[1].v.kind]} #${bids[1].v.id} ETA ${bids[1].eta}` : '';
      const how = this.dispatchMode === 'negotiation' ? 'won contract-net auction' : 'central min-cost matching';
      this.emit('ASSIGNED', `${VehicleKind[best.v.kind]} #${best.v.id} ${how}, ETA ${best.eta} ticks${runnerUp}`, {
        actor: asVehicleId(best.v.id),
        target: asRequestId(a.requestId),
        cell: a.cell,
        data: { eta: best.eta },
      });
      a.assignedTo = best.v.id;
      best.v.targetNpc = i;
      best.v.stuck = 0;
      if (best.v.kind === VehicleKind.Helicopter) {
        best.v.phase = 'out';
        best.v.state = VehicleState.Flying;
        best.v.tx = a.x;
        best.v.tz = a.z;
        this.emit('HELI_DISPATCH', `rooftop rescue of #${a.id}; no ground unit can reach ${this.cellName(a.cell)}`, {
          actor: asVehicleId(best.v.id),
          target: asNpcId(a.id),
          cell: a.cell,
        });
      } else {
        best.v.state = VehicleState.Responding;
        best.v.phase = 'out';
      }
    }
  }

  private deepNear(c: number): boolean {
    if (this.water[c] >= MOCK_LIMITS.boatMin) return true;
    return this.neighbours(c).some((nb) => this.water[nb] >= MOCK_LIMITS.boatMin);
  }

  // ---------- movement ----------

  private stepMovement(): void {
    for (const a of this.walkers) {
      if (a.state === NpcState.Sheltering || a.state === NpcState.Rescued || a.state === NpcState.Stranded) continue;
      const evac = a.state === NpcState.Evacuating;
      const slow = 1 - Math.min(0.7, this.depthAt(a.cell) * 1.5);
      this.advanceOnRoads(a, MOCK_LIMITS.footSafe, evac ? 'evac' : 'wander', slow, evac ? `npc` : null, asNpcId(a.id));
      if (evac && this.shelterDist[a.cell] === 0) this.arriveAtShelter(a);
    }
    for (const v of this.vehicles) {
      if (v.failed) continue;
      if (v.kind === VehicleKind.Helicopter) this.moveHeli(v);
      else if (v.kind === VehicleKind.Boat) this.moveBoat(v);
      else this.moveRoadVehicle(v);
    }
  }

  private arriveAtShelter(a: Walker): void {
    const bi = this.buildings.findIndex((b) => b?.type === BlockType.Shelter && b.entrance === a.cell);
    if (bi < 0) return;
    const b = this.buildings[bi] as BuildingDef;
    const load = (this.shelterLoad.get(bi) ?? 0) + 1;
    if (load > b.capacity) {
      if (!this.shelterOverflowed.has(bi)) {
        this.shelterOverflowed.add(bi);
        this.emit('SHELTER_OVERFLOW', `${this.buildingNames[bi]} full (${b.capacity}); evacuees re-routed to next shelter`, {
          actor: asBuildingId(bi),
          cell: b.entrance,
        });
        this.computeShelterField();
      }
      a.plan = [];
      a.planVersion++;
      return;
    }
    this.shelterLoad.set(bi, load);
    a.state = NpcState.Sheltering;
  }

  private moveRoadVehicle(v: Vehicle): void {
    if (v.state === VehicleState.Stalled) return;
    if (this.depthAt(v.cell) > v.depthLimit) {
      v.state = VehicleState.Stalled;
      this.emit('VEHICLE_STALLED', `${VehicleKind[v.kind]} #${v.id} stalled: depth ${round2(this.depthAt(v.cell))} > limit ${v.depthLimit}`, {
        actor: asVehicleId(v.id),
        cell: v.cell,
      });
      return;
    }
    this.advanceOnRoads(v, v.depthLimit, 'wander', 1, VehicleKind[v.kind], asVehicleId(v.id));
  }

  private advanceOnRoads(
    m: Mover,
    limit: number,
    mode: 'wander' | 'evac',
    speedFactor: number,
    rerouteLabel: string | null,
    actor: SimEvent['actor'],
  ): void {
    if (m.next < 0 || !this.passable(m.next, limit)) {
      const blocked = m.next;
      this.replan(m, limit, mode);
      if (blocked >= 0 && rerouteLabel && this.tick - m.lastReroute > 60) {
        m.lastReroute = this.tick;
        const why =
          this.blocks[blocked] === BlockType.Bridge
            ? 'bridge closed'
            : `cell ${this.cellName(blocked)} depth ${round2(this.water[blocked])} > ${rerouteLabel === 'npc' ? 'safe wading' : 'vehicle'} limit ${limit}`;
        this.emit('REROUTE', why, {
          actor,
          actorKind: rerouteLabel === 'npc' ? 'npc' : 'vehicle',
          cell: blocked,
          data: { pathVersion: m.planVersion },
        });
      }
      if (m.next < 0) return;
    }
    m.progress += m.speed * speedFactor;
    while (m.progress >= 1) {
      m.progress -= 1;
      m.prev = m.cell;
      m.cell = m.next;
      if (m.plan.length < 4) this.extendPlan(m, limit, mode, 12);
      m.next = m.plan.shift() ?? -1;
      // A blocked next cell is kept so the next tick replans and explains why.
      if (m.next < 0 || !this.passable(m.next, limit)) {
        m.progress = 0;
        break;
      }
    }
    this.placeMover(m);
  }

  private replan(m: Mover, limit: number, mode: 'wander' | 'evac'): void {
    m.plan = [];
    m.planVersion++;
    m.progress = 0;
    m.next = -1;
    this.extendPlan(m, limit, mode, 12);
    m.next = m.plan.shift() ?? -1;
  }

  private extendPlan(m: Mover, limit: number, mode: 'wander' | 'evac', want: number): void {
    const chain = [m.prev, m.cell, ...(m.next >= 0 ? [m.next] : []), ...m.plan];
    let last = chain[chain.length - 1];
    let before = chain[chain.length - 2];
    while (m.plan.length < want) {
      const options = this.neighbours(last).filter((c) => this.passable(c, limit));
      if (options.length === 0) break;
      let choice: number;
      if (mode === 'evac') {
        const here = this.shelterDist[last];
        if (here === 0) break;
        let best = -1;
        for (const c of options) {
          const d = this.shelterDist[c];
          if (d >= 0 && (best < 0 || d < this.shelterDist[best])) best = c;
        }
        if (best < 0 || (here >= 0 && this.shelterDist[best] >= here)) {
          const fwd = options.filter((c) => c !== before);
          choice = this.rng.pick(fwd.length ? fwd : options);
        } else {
          choice = best;
        }
      } else {
        const fwd = options.filter((c) => c !== before);
        const straight = 2 * last - before;
        if (fwd.includes(straight) && this.rng.chance(0.6)) choice = straight;
        else choice = this.rng.pick(fwd.length ? fwd : options);
      }
      m.plan.push(choice);
      before = last;
      last = choice;
    }
  }

  private placeMover(m: Mover): void {
    const ax = this.cx(m.cell) + 0.5;
    const az = this.cz(m.cell) + 0.5;
    if (m.next < 0 || m.progress === 0) {
      m.x = ax + Math.cos(m.heading + Math.PI / 2) * m.lateral * 0.5;
      m.z = az + Math.sin(m.heading + Math.PI / 2) * m.lateral * 0.5;
      return;
    }
    const bx = this.cx(m.next) + 0.5;
    const bz = this.cz(m.next) + 0.5;
    const dx = bx - ax;
    const dz = bz - az;
    m.heading = Math.atan2(dz, dx);
    m.x = ax + dx * m.progress - dz * m.lateral;
    m.z = az + dz * m.progress + dx * m.lateral;
  }

  private moveBoat(v: Vehicle): void {
    const deep = (c: number) => this.water[c] >= MOCK_LIMITS.boatMin && this.buildingIndex[c] === 0;
    if (v.targetNpc >= 0) {
      const a = this.walkers[v.targetNpc];
      if (Math.hypot(v.x - a.x, v.z - a.z) < 1.8) {
        this.rescue(v, a, 'boat');
        return;
      }
      v.progress += v.speed;
      if (v.progress >= 1) {
        v.progress -= 1;
        const here = Math.hypot(this.cx(v.cell) + 0.5 - a.x, this.cz(v.cell) + 0.5 - a.z);
        let best = -1;
        let bestD = here;
        for (const nb of this.neighbours(v.cell)) {
          if (!deep(nb)) continue;
          const d = Math.hypot(this.cx(nb) + 0.5 - a.x, this.cz(nb) + 0.5 - a.z);
          if (d < bestD) {
            bestD = d;
            best = nb;
          }
        }
        if (best < 0) {
          v.stuck++;
          if (v.stuck > 30) this.cancelAssignment(v, `no navigable water toward #${a.id} (boat draft needs depth ≥ ${MOCK_LIMITS.boatMin})`);
        } else {
          v.prev = v.cell;
          v.cell = best;
          v.stuck = 0;
        }
      }
    } else if (deep(v.cell) && this.water[v.cell] > MOCK_LIMITS.boatMin + 0.4 && this.tick % 4 === 0) {
      const options = this.neighbours(v.cell).filter(deep);
      if (options.length) {
        v.prev = v.cell;
        v.cell = this.rng.pick(options);
      }
      v.state = VehicleState.Parked;
    }
    const tx = this.cx(v.cell) + 0.5;
    const tz = this.cz(v.cell) + 0.5;
    if (tx !== v.x || tz !== v.z) v.heading = Math.atan2(tz - v.z, tx - v.x);
    v.x += (tx - v.x) * 0.5;
    v.z += (tz - v.z) * 0.5;
  }

  private moveHeli(v: Vehicle): void {
    if (v.phase === 'idle') return;
    if (v.phase === 'hover') {
      v.hover--;
      if (v.hover <= 0) {
        const a = this.walkers[v.targetNpc];
        if (a) this.rescue(v, a, 'heli');
        v.phase = 'back';
        v.tx = this.cx(v.base) + 0.5;
        v.tz = this.cz(v.base) + 0.5;
      }
      return;
    }
    if (v.phase === 'out' && v.targetNpc >= 0) {
      const a = this.walkers[v.targetNpc];
      v.tx = a.x;
      v.tz = a.z;
    }
    const dx = v.tx - v.x;
    const dz = v.tz - v.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) v.heading = Math.atan2(dz, dx);
    if (d <= v.speed) {
      v.x = v.tx;
      v.z = v.tz;
      if (v.phase === 'out') {
        v.phase = 'hover';
        v.hover = 12;
      } else {
        v.phase = 'idle';
        v.state = this.windGrounded ? VehicleState.Grounded : VehicleState.Landed;
        v.cell = v.base;
      }
    } else {
      v.x += (dx / d) * v.speed;
      v.z += (dz / d) * v.speed;
    }
  }

  private abortHeli(v: Vehicle, why: string): void {
    this.cancelAssignment(v, why);
    v.phase = 'back';
    v.state = VehicleState.Returning;
    v.tx = this.cx(v.base) + 0.5;
    v.tz = this.cz(v.base) + 0.5;
  }

  private cancelAssignment(v: Vehicle, why: string): void {
    const a = v.targetNpc >= 0 ? this.walkers[v.targetNpc] : null;
    if (a) {
      a.assignedTo = -1;
      this.emit('COMMIT_CANCELLED', `${VehicleKind[v.kind]} #${v.id}: ${why}; request re-queued`, {
        actor: asVehicleId(v.id),
        target: asRequestId(a.requestId),
      });
    }
    v.targetNpc = -1;
    v.stuck = 0;
    if (v.kind === VehicleKind.Boat) {
      v.phase = 'idle';
      v.state = VehicleState.Parked;
    }
  }

  private rescue(v: Vehicle, a: Walker, how: 'boat' | 'heli'): void {
    a.state = NpcState.Rescued;
    v.targetNpc = -1;
    const created = this.requestCreated.get(a.requestId) ?? this.tick;
    this.served.push({ created, served: this.tick, district: Math.max(0, this.districtOf[a.cell]) });
    for (const r of this.reports) {
      if (r.npc === this.walkers.indexOf(a) && r.status !== ReportStatus.False) {
        r.status = ReportStatus.Resolved;
        r.statusAt = this.tick;
      }
    }
    if (how === 'heli') {
      this.heliRescues++;
      this.emit('HELI_PICKUP', `#${a.id} winched aboard`, { actor: asVehicleId(v.id), target: asNpcId(a.id), cell: a.cell });
      this.emit('ROOFTOP_RESCUE', `#${a.id} lifted from ${this.cellName(a.cell)} after ${this.tick - created} ticks`, {
        actor: asVehicleId(v.id),
        target: asNpcId(a.id),
      });
      const hosp = this.buildings.findIndex((b) => b?.type === BlockType.Hospital && this.power[b.entrance] !== PowerState.Off);
      if (hosp >= 0) this.hospitalLoad.set(hosp, (this.hospitalLoad.get(hosp) ?? 0) + 1);
    } else {
      v.phase = 'idle';
      v.state = VehicleState.Parked;
    }
    this.emit('SERVED', `request #${a.requestId} served by ${VehicleKind[v.kind]} #${v.id} in ${this.tick - created} ticks`, {
      actor: asVehicleId(v.id),
      target: asRequestId(a.requestId),
      data: { tts: this.tick - created },
    });
  }

  private refreshBelief(): void {
    const reveal = (cx: number, cz: number, r: number) => {
      for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(this.h - 1, Math.ceil(cz + r)); z++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.w - 1, Math.ceil(cx + r)); x++) {
          if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) this.belief[z * this.w + x] = this.water[z * this.w + x];
        }
      }
    };
    for (const r of this.reports) if (r.status !== ReportStatus.False) reveal(r.x, r.z, 6 + 4 * r.confidence);
    const hq = this.buildings.find((b) => b?.type === BlockType.FloodHQ);
    if (hq) reveal(this.cx(hq.entrance), this.cz(hq.entrance), 14);
    for (const v of this.vehicles) if (v.kind !== VehicleKind.Car) reveal(v.x, v.z, 5);
    for (let c = 0; c < this.n; c++) if (this.blocks[c] === BlockType.WaterSource) this.belief[c] = this.water[c];
  }

  // ---------- injected events and edits ----------

  inject(ev: InjectedEvent): void {
    if (ev.t > this.tick) {
      this.pendingInjected.push(ev);
      this.pendingInjected.sort((a, b) => a.t - b.t);
    } else {
      this.applyInjected(ev);
    }
  }

  private applyInjected(ev: InjectedEvent): void {
    const dur = ev.durationTicks ?? 600;
    switch (ev.kind) {
      case 'bridge_closed': {
        const span = ev.cell !== undefined && ev.cell >= 0 && ev.cell < this.n ? this.spanOf[ev.cell] : -1;
        if (span >= 0) this.closedSpans.add(span);
        else this.bridgeClosed = true;
        this.emit('INJECTED', `${span >= 0 ? `bridge at ${this.cellName(ev.cell as number)}` : 'all bridges'} closed by authorities (injected)`, {
          data: { kind: ev.kind },
          ...(span >= 0 ? { cell: ev.cell } : {}),
        });
        this.computeShelterField();
        break;
      }
      case 'substation_flooded': {
        const i = ev.target !== undefined ? this.substations.findIndex((s) => s.building.powerNode === ev.target) : this.substations.length - 1;
        this.emit('INJECTED', 'substation flooded (injected)', { data: { kind: ev.kind } });
        if (i >= 0) this.tripSubstation(i, `${this.substations[i].name} tripped by injected flood`, true);
        break;
      }
      case 'helicopter_grounded_wind':
        this.windOverrideUntil = this.tick + dur;
        this.emit('INJECTED', `gale-force gusts for ${dur} ticks (injected)`, { data: { kind: ev.kind } });
        break;
      case 'boat_failure': {
        const boat = this.vehicles.find((v) => v.kind === VehicleKind.Boat && !v.failed && (ev.target === undefined || v.id === ev.target));
        this.emit('INJECTED', `boat ${boat ? `#${boat.id} ` : ''}engine failure (injected)`, { data: { kind: ev.kind } });
        if (boat) {
          if (boat.targetNpc >= 0) this.cancelAssignment(boat, 'engine failure');
          boat.failed = true;
          boat.state = VehicleState.Stalled;
        }
        break;
      }
      case 'shelter_overflow': {
        const bi = this.buildings.findIndex((b) => b?.type === BlockType.Shelter && (ev.target === undefined || b.id === ev.target));
        this.emit('INJECTED', 'shelter reports it is full (injected)', { data: { kind: ev.kind } });
        if (bi >= 0) this.shelterLoad.set(bi, (this.buildings[bi] as BuildingDef).capacity);
        break;
      }
      case 'road_blocked_by_debris': {
        const c = ev.cell ?? this.intersections[0];
        if (c !== undefined) {
          this.debris[c] = 1;
          this.emit('ROAD_CLOSED', `debris blocking ${this.cellName(c)} (injected)`, { cell: c });
          this.computeShelterField();
        }
        break;
      }
      case 'false_report':
        this.emit('INJECTED', 'burst of unverified calls (injected)', { data: { kind: ev.kind } });
        for (let i = 0; i < 3; i++) this.createReport(-1, false);
        break;
      case 'comms_outage':
        this.commsDownUntil = this.tick + dur;
        this.emit('INJECTED', `radio and phone network down for ${dur} ticks (injected)`, { data: { kind: ev.kind } });
        break;
    }
  }

  /** Applies an edit and returns the terrain chunks that must be rebuilt. */
  applyEdit(cmd: EditCommand): number[] {
    const touched: number[] = [];
    const setCell = (c: number, block: BlockType) => {
      if (c < 0 || c >= this.n) return;
      const bi = this.buildingIndex[c] - 1;
      if (bi >= 0) this.removeBuilding(bi, touched);
      this.blocks[c] = block;
      touched.push(c);
    };
    switch (cmd.kind) {
      case 'setBlock':
        setCell(cmd.cell, cmd.block);
        break;
      case 'paintRect':
        for (let z = Math.min(cmd.z0, cmd.z1); z <= Math.max(cmd.z0, cmd.z1); z++) {
          for (let x = Math.min(cmd.x0, cmd.x1); x <= Math.max(cmd.x0, cmd.x1); x++) {
            if (x < this.w && z < this.h) setCell(z * this.w + x, cmd.block);
          }
        }
        break;
      case 'setHeight':
        if (cmd.cell >= 0 && cmd.cell < this.n) {
          this.ground[cmd.cell] = Math.max(0, Math.min(255, cmd.ground));
          touched.push(cmd.cell);
        }
        break;
      case 'placeBuilding': {
        const id = this.buildings.length;
        for (const c of cmd.def.cells) setCell(c, cmd.def.type);
        const def: BuildingDef = { ...cmd.def, id: asBuildingId(id) };
        this.buildings.push(def);
        this.buildingNames.push(`${BlockType[def.type]} #${id}`);
        for (const c of def.cells) this.buildingIndex[c] = id + 1;
        break;
      }
      case 'removeAt': {
        const bi = this.buildingIndex[cmd.cell] - 1;
        if (bi >= 0) this.removeBuilding(bi, touched);
        else setCell(cmd.cell, BlockType.Grass);
        break;
      }
      case 'setPowerEdge':
        break;
      case 'applyPatch': {
        const out = new Set<number>();
        for (const sub of cmd.patch.commands) for (const ch of this.applyEdit(sub)) out.add(ch);
        this.rebuildCaches();
        return [...out];
      }
    }
    this.rebuildCaches();
    const chunks = new Set<number>();
    for (const c of touched) {
      chunks.add(chunkOfCell(this.w, c));
      for (const nb of this.neighbours(c)) chunks.add(chunkOfCell(this.w, nb));
    }
    for (const ch of chunks) this.dirty.add(ch);
    return [...chunks];
  }

  private removeBuilding(bi: number, touched: number[]): void {
    const b = this.buildings[bi];
    if (!b) return;
    for (const c of b.cells) {
      this.blocks[c] = BlockType.Grass;
      this.buildingIndex[c] = 0;
      touched.push(c);
    }
    this.buildings[bi] = null;
  }

  // ---------- outputs ----------

  drainEvents(): SimEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  world(dirtyChunks: number[] = []): WorldSnapshot {
    return {
      w: this.w,
      h: this.h,
      ground: this.ground.slice(),
      blocks: this.blocks.slice(),
      buildingIndex: this.buildingIndex.slice(),
      dirtyChunks,
    };
  }

  snapshot(): RenderSnapshot {
    const npcs = this.walkers.filter((a) => a.state !== NpcState.Sheltering && a.state !== NpcState.Rescued);
    const reports = this.reports;
    const dirtyChunks = [...this.dirty];
    this.dirty.clear();
    return {
      tick: this.tick,
      water: this.water.slice(),
      powered: this.power.slice(),
      npcs: {
        id: Int32Array.from(npcs, (a) => a.id),
        x: Float32Array.from(npcs, (a) => a.x),
        z: Float32Array.from(npcs, (a) => a.z),
        heading: Float32Array.from(npcs, (a) => a.heading),
        role: Uint8Array.from(npcs, (a) => a.role),
        state: Uint8Array.from(npcs, (a) => a.state),
      },
      vehicles: {
        id: Int32Array.from(this.vehicles, (v) => v.id),
        x: Float32Array.from(this.vehicles, (v) => v.x),
        z: Float32Array.from(this.vehicles, (v) => v.z),
        heading: Float32Array.from(this.vehicles, (v) => v.heading),
        kind: Uint8Array.from(this.vehicles, (v) => v.kind),
        state: Uint8Array.from(this.vehicles, (v) => v.state),
      },
      reports: {
        x: Float32Array.from(reports, (r) => r.x),
        z: Float32Array.from(reports, (r) => r.z),
        confidence: Float32Array.from(reports, (r) => r.confidence),
        status: Uint8Array.from(reports, (r) => r.status),
      },
      dirtyChunks,
      weather: { rain: this.rain, wind: this.wind },
      hqBelief: { water: this.belief.slice() },
    };
  }

  metrics(): MetricsFrame {
    let flooded = 0;
    let maxDepth = 0;
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] === BlockType.WaterSource) continue;
      const d = this.depthAt(c);
      if (d > 0.1) flooded++;
      maxDepth = Math.max(maxDepth, d);
    }
    const civilians = this.walkers.filter((a) => a.role === NpcRole.Civilian);
    const stranded = this.walkers.filter((a) => a.state === NpcState.Stranded).length;
    const sheltered = civilians.filter((a) => a.state === NpcState.Sheltering).length;
    const evacuating = civilians.filter((a) => a.state === NpcState.Evacuating).length;
    const unpowered = civilians.filter((a) => a.state !== NpcState.Rescued && this.power[a.cell] === PowerState.Off).length;
    const tts = this.served.map((s) => s.served - s.created).sort((a, b) => a - b);
    const q = (p: number) => (tts.length ? tts[Math.min(tts.length - 1, Math.floor(p * tts.length))] : 0);
    const mean = tts.length ? tts.reduce((s, v) => s + v, 0) / tts.length : 0;
    const byDistrict = this.scenario.districts.map((_, i) => {
      const xs = this.served.filter((s) => s.district === i).map((s) => s.served - s.created);
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
    });
    const idle = (kind: VehicleKind) => {
      const vs = this.vehicles.filter((v) => v.kind === kind && !v.failed);
      return vs.length ? vs.filter((v) => v.targetNpc < 0).length / vs.length : 0;
    };
    return {
      tick: this.tick,
      tts: { mean: round2(mean), p50: q(0.5), p90: q(0.9) },
      unmet: stranded,
      idleFrac: { boat: round2(idle(VehicleKind.Boat)), helicopter: round2(idle(VehicleKind.Helicopter)), ambulance: 1 },
      gini: round2(gini(byDistrict)),
      hospitals: this.buildings
        .filter((b): b is BuildingDef => b?.type === BlockType.Hospital)
        .map((b) => {
          const g = this.generators.find((gg) => gg.building.id === b.id);
          return {
            id: b.id,
            util: round2((this.hospitalLoad.get(b.id) ?? 0) / Math.max(1, b.capacity)),
            diversion: g?.exhausted ?? false,
            onGenerator: g?.active ?? false,
          };
        }),
      evacDonePct: round2((100 * sheltered) / Math.max(1, sheltered + evacuating)),
      stranded,
      gridlockCells: 0,
      floodedCells: flooded,
      maxDepth: round2(maxDepth),
      unpoweredPopPct: round2((100 * unpowered) / Math.max(1, civilians.length)),
      heliRescues: this.heliRescues,
      routeViolations: 0,
    };
  }

  summary(): RunSummary {
    const powerCells: number[] = [];
    this.substations.forEach((s) => s.tripped && powerCells.push(...s.building.cells));
    const isolated = this.walkers.filter((a) => a.state === NpcState.Stranded).map((a) => a.cell);
    return {
      scenario: this.scenario.name,
      seed: this.seed,
      mode: this.dispatchMode,
      metrics: [...this.metricsLog],
      events: [...this.log],
      hotspots: [
        ...(powerCells.length ? [{ kind: 'power' as const, cells: powerCells, score: 1 }] : []),
        ...(isolated.length ? [{ kind: 'isolated' as const, cells: isolated, score: isolated.length }] : []),
      ],
    };
  }

  inspect(ref: EntityRef): InspectorData | null {
    if (ref.kind === 'npc') {
      const a = this.walkers.find((w) => w.id === ref.id);
      if (!a) return null;
      const closures = this.neighboursWithin(a.cell, 6).filter((c) => this.closed[c]);
      return {
        id: a.id,
        kind: 'npc',
        title: `${NpcRole[a.role]} #${a.id}`,
        attributes: {
          role: NpcRole[a.role],
          state: NpcState[a.state],
          cell: this.cellName(a.cell),
          depthHere: round2(this.water[a.cell]),
          panic: round2(a.panic),
          compliance: round2(a.compliance),
          riskTolerance: round2(a.risk),
          speed: round2(a.speed),
        },
        ...(a.assignedTo >= 0 ? { assignment: { requestId: asRequestId(a.requestId), status: `rescue by vehicle #${a.assignedTo}`, eta: 0 } } : {}),
        route: { cells: [a.cell, ...(a.next >= 0 ? [a.next] : []), ...a.plan], version: a.planVersion },
        belief: { knownClosures: closures, staleness: 0 },
        ...(a.decision ? { lastDecision: a.decision } : {}),
      };
    }
    if (ref.kind === 'vehicle') {
      const v = this.vehicles.find((vv) => vv.id === ref.id);
      if (!v) return null;
      const target = v.targetNpc >= 0 ? this.walkers[v.targetNpc] : null;
      const eta = target ? Math.round(Math.hypot(v.x - target.x, v.z - target.z) / v.speed) : 0;
      return {
        id: v.id,
        kind: 'vehicle',
        title: `${VehicleKind[v.kind]} #${v.id}`,
        attributes: {
          kind: VehicleKind[v.kind],
          state: VehicleState[v.state],
          cell: this.cellName(v.cell),
          depthLimit: Number.isFinite(v.depthLimit) ? v.depthLimit : v.kind === VehicleKind.Boat ? `min ${MOCK_LIMITS.boatMin}` : 'n/a',
          ...(v.kind === VehicleKind.Helicopter ? { windLimit: MOCK_LIMITS.heliWind, wind: round2(this.wind) } : {}),
          ...(v.failed ? { failure: 'engine failure' } : {}),
        },
        ...(target ? { assignment: { requestId: asRequestId(target.requestId), status: v.phase, eta } } : {}),
        route:
          v.kind === VehicleKind.Helicopter || v.kind === VehicleKind.Boat
            ? target
              ? { cells: this.lineCells(v.x, v.z, target.x, target.z), version: 0 }
              : undefined
            : { cells: [v.cell, ...(v.next >= 0 ? [v.next] : []), ...v.plan], version: v.planVersion },
      };
    }
    if (ref.kind === 'building') {
      const b = this.buildings[ref.id];
      if (!b) return null;
      const g = this.generators.find((gg) => gg.building.id === b.id);
      const power = this.power[b.cells[0]];
      return {
        id: b.id,
        kind: 'building',
        title: this.buildingNames[b.id],
        attributes: {
          type: BlockType[b.type],
          capacity: b.capacity,
          footprint: `${b.cells.length} cells`,
          power: PowerState[power],
          floodDepthAtEntrance: round2(this.water[b.entrance]),
          ...(g ? { generatorFuelTicks: g.fuel } : {}),
          ...(b.type === BlockType.Shelter ? { occupants: this.shelterLoad.get(b.id) ?? 0 } : {}),
          ...(b.type === BlockType.Hospital ? { patients: this.hospitalLoad.get(b.id) ?? 0 } : {}),
        },
      };
    }
    const c = ref.id;
    if (c < 0 || c >= this.n) return null;
    return {
      id: c,
      kind: 'cell',
      title: `Cell ${this.cellName(c)}`,
      attributes: {
        block: BlockType[this.blocks[c]],
        ground: this.ground[c],
        water: round2(this.water[c]),
        hqBelievesWater: round2(this.belief[c]),
        power: PowerState[this.power[c]],
        ...(this.closed[c] ? { closed: 'yes' } : {}),
      },
    };
  }

  private neighboursWithin(c: number, r: number): number[] {
    const out: number[] = [];
    const x0 = this.cx(c);
    const z0 = this.cz(c);
    for (let z = Math.max(0, z0 - r); z <= Math.min(this.h - 1, z0 + r); z++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(this.w - 1, x0 + r); x++) out.push(z * this.w + x);
    }
    return out;
  }

  private lineCells(x0: number, z0: number, x1: number, z1: number): number[] {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = Math.floor(x0 + ((x1 - x0) * i) / steps);
      const z = Math.floor(z0 + ((z1 - z0) * i) / steps);
      const c = z * this.w + x;
      if (out[out.length - 1] !== c) out.push(c);
    }
    return out;
  }
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

export const gini = (values: number[]): number => {
  const xs = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (xs.length < 2) return 0;
  const sum = xs.reduce((s, v) => s + v, 0);
  let acc = 0;
  xs.forEach((v, i) => (acc += (2 * (i + 1) - xs.length - 1) * v));
  return acc / (xs.length * sum);
};
