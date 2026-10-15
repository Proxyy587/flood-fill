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
import type { BuildingDef, DispatchMode, HotspotKind, InjectedEvent, Scenario } from '../scenario';
import { chunkOfCell, ZONE, type RenderSnapshot, type WorldSnapshot } from '../snapshot';
import { bridgeDeckHeights, isSignalJunction, signalPhase } from '../world';
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
/**
 * Paved cities send rain to the river faster, raising its peak; green ground holds it back.
 * The rain-driven rise is scaled by BASE + SLOPE × (mean runoff coefficient of the land).
 */
const RIVER_RUNOFF_BASE = 0.64;
const RIVER_RUNOFF_SLOPE = 0.65;
const LEVEE_HEIGHT = 3;
const BELIEF_REFRESH_TICKS = 120;
const NEGOTIATION_VIEW = 3;

// Traffic. Progress runs 0..1 across a cell (4 m).
/** Bumper-to-bumper gap, as a fraction of a cell. */
const CAR_GAP = 0.45;
/** Vehicles a cell holds across all lanes before nobody else may enter. */
const CELL_VEHICLES = 3;
/** Where vehicles wait before a junction. */
const STOP_LINE = 0.85;
/** Ticks at a full stop before crossing a dark signal. */
const DARK_SIGNAL_STOP = 3;
/** Ticks held before a vehicle counts as gridlocked; after twice this it looks for another way. */
const GRIDLOCK_WAIT = 30;
const RESCUERS_PER_TEAM = 4;

// Emergency services.
/** Pedestrians walk this far (cells) off the road centreline, on the footpath. */
const FOOTPATH_OFFSET = 0.4;
const MAX_INJURIES = 14;
/** Minimum ticks between new injuries, so each one can be followed. */
const INJURY_GAP = 110;
/** Ticks without an ambulance that can reach before the casualty is handed to boats or helicopters. */
const AMBULANCE_UNREACHABLE = 120;
/** Ticks a closure waits for a police car before traffic police on foot put the barricades up. */
const ROADBLOCK_FALLBACK = 150;
/** Ticks a diversion stays marked after traffic was sent along it. */
const DETOUR_TICKS = 240;
/** Ticks dry before a waterlogged section reopens. */
const REOPEN_DRY = 120;
/** Seconds of saturating rain (intensity-weighted) before the hill cut slides. */
const SLOPE_FAILURE = 1500;
/** Metre-seconds of river standing high against a weak levee before it breaches. */
const LEVEE_FAILURE = 700;
/** The weak levee starts to seep once the river is this close to its crest (m). */
const LEVEE_FREEBOARD = 1.2;
/** Ticks between helicopter food drops to the same district. */
const DROP_INTERVAL = 600;
const PACKETS_PER_RESIDENT = 2;

// Local (pluvial) flooding. Volumes are in cell·metres (1 cell = 16 m²).
/** Rain intensity 1.0 is a 150 mm/h cloudburst. */
export const RAIN_MM_PER_HOUR_AT_FULL = 150;
const RAIN_M_PER_TICK = RAIN_MM_PER_HOUR_AT_FULL / 1000 / 3600;
/**
 * One storm-drain inlet with a pump: 0.05 m³/s. Gravity only (no power): 30 %,
 * and nothing at all once the river rises above the drain's outfall (backflow).
 */
const DRAIN_CELL_M_PER_TICK = 0.05 / 16;
const DRAIN_UNPOWERED = 0.3;
const LOCAL_FLOOD_STEPS = [0.3, 1];

/** Ponded water soaking into each surface, mm/h. Paved ground and roofs soak up nothing. */
const INFILTRATION_MM_PER_HOUR: Partial<Record<BlockType, number>> = {
  [BlockType.Grass]: 15,
  [BlockType.Tree]: 25,
  [BlockType.Sand]: 30,
  [BlockType.Dirt]: 10,
  [BlockType.Rock]: 1,
  [BlockType.Levee]: 2,
};
const soakOf = (block: number): number => (INFILTRATION_MM_PER_HOUR[block as BlockType] ?? 0) / 1000 / 3600;
const HOMES = new Set<number>([BlockType.House, BlockType.Apartment]);

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
  /** Infiltration (m/tick) of the cell at the same index in `grounds`. */
  soak: Float64Array;
  backflowAnnounced: boolean;
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
  /** Ticks spent unable to move (queue, red light, blocked junction). */
  wait: number;
  /** Ticks stopped at the line of a dark (unpowered) signal. */
  stopWait: number;
  /** Destination cell for routed trips (ambulance, police post), -1 to wander. */
  goal: number;
  /** Pedestrians keep to the footpath on this side of the street (+1 right, -1 left); 0 for vehicles. */
  foot: number;
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
  injuredAt: number;
  injury: string;
  decision?: InspectorData['lastDecision'];
}

/** What a vehicle is doing beyond its basic phase. */
type Mission = 'none' | 'patient' | 'hospital' | 'return' | 'roadblock' | 'post' | 'drop';

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
  mission: Mission;
  /** Walker index carried or sought (ambulances); closure index (police). */
  ref: number;
  /** Hospital index the ambulance is driving to. */
  hospital: number;
}

const MISSION_LABEL: Record<Mission, string> = {
  none: 'Standby',
  patient: 'Driving to a casualty',
  hospital: 'Taking a patient to hospital',
  return: 'Returning to base',
  roadblock: 'Driving to set up a roadblock',
  post: 'Holding a roadblock',
  drop: 'Food and water drop',
};

interface HotspotState {
  name: string;
  kind: HotspotKind;
  cells: number[];
  /** 0 quiet, 1 waterlogged / slid / breached. */
  hit: boolean;
  /** Ticks dry since it last flooded (waterlogging) or accumulated stress (levee, slope). */
  counter: number;
}

/** A road section closed by the authorities, with its barricade points. */
interface Closure {
  name: string;
  cells: number[];
  barricades: number[];
  /** Police are on site and barricades are up. */
  policed: boolean;
  since: number;
  active: boolean;
  /** Water closures lift once the section drains; bridge and debris closures stay. */
  lifts: boolean;
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
  CAMP_OPENED: 'building',
  NPC_STRANDED: 'npc',
  REQUEST_CREATED: 'npc',
  INJURY_REPORTED: 'npc',
};
const NPC_TARGET = new Set<SimEventType>(['HELI_DISPATCH', 'HELI_PICKUP', 'ROOFTOP_RESCUE', 'AMBULANCE_DISPATCH', 'MEDEVAC', 'HOSPITAL_ASSIGN']);

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
  private signal: Uint8Array = new Uint8Array(0);
  /** Road vehicles per lane (cell × direction of travel), rebuilt every tick. */
  private lanes = new Map<number, Vehicle[]>();
  private gridlockCells = 0;
  private lastGridlockNews = -Infinity;
  private serviceSub: Int16Array;

  private walkers: Walker[] = [];
  private vehicles: Vehicle[] = [];
  private reports: Report[] = [];
  private substations: Substation[] = [];
  private generators: Generator[] = [];

  private stage = RIVER_BASE_STAGE;
  /** How strongly rain on the city feeds the river (see RIVER_RUNOFF_BASE). */
  private riverRunoff = 1;
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
  private nextNpcId = 1;
  private nextVehicleId = 1;
  private served: { created: number; served: number; district: number }[] = [];
  private requestCreated = new Map<number, number>();
  private heliRescues = 0;
  private hospitalLoad = new Map<number, number>();
  /** Homes whose floor has been under water at any point (damage does not drain away). */
  private floodedHomes = new Set<number>();
  private homesNews = new Map<number, { homes: number; residents: number; cell: number; last: number }>();
  private pendingInjected: InjectedEvent[];
  private dirty = new Set<number>();

  // Showcase: alerts, hotspots, closures, casualties.
  private hotspots: HotspotState[] = [];
  private closures: Closure[] = [];
  /** Police / authority closure: shut to private traffic and pedestrians, open to emergency units. */
  private authority: Uint8Array;
  private prone: Uint8Array;
  private breach: Uint8Array;
  private detourUntil: Int32Array;
  private alertIssued = false;
  private injuries = 0;
  private lastInjury = -Infinity;
  private teamWaves = 0;
  private openedCamps = new Set<number>();
  private admitted = new Map<number, { ambulance: number; heli: number }>();
  private dropsAt = new Map<number, number>();
  private bfsPrev: Int32Array;
  private bfsDist: Int32Array;
  private bfsQueue: Int32Array;

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
    this.authority = new Uint8Array(this.n);
    this.prone = new Uint8Array(this.n);
    this.breach = new Uint8Array(this.n);
    this.detourUntil = new Int32Array(this.n);
    this.bfsPrev = new Int32Array(this.n);
    this.bfsDist = new Int32Array(this.n);
    this.bfsQueue = new Int32Array(this.n);
    this.hotspots = (scenario.hotspots ?? [])
      .map((h) => ({ name: h.name, kind: h.kind, cells: h.cells.filter((c) => c >= 0 && c < this.n), hit: false, counter: 0 }))
      .filter((h) => h.cells.length > 0);

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

  /** Display name; names are stored by list position, which template ids need not match. */
  private nameOf(b: BuildingDef): string {
    return this.buildingNames[this.buildings.indexOf(b)] ?? `${BlockType[b.type]} #${b.id}`;
  }

  private isRoad(c: number): boolean {
    const b = this.blocks[c];
    return b === BlockType.Road || b === BlockType.Bridge;
  }

  private passable(c: number, limit: number): boolean {
    if (!this.isRoad(c) || this.debris[c]) return false;
    // Police barricades keep cars and people out; emergency units (deeper limit) are waved through.
    if (this.authority[c] && limit <= MOCK_LIMITS.car) return false;
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
      const sorted = [...cells].sort((a, b) => this.ground[a] - this.ground[b] || a - b);
      const grounds = Float64Array.from(sorted, (k) => this.ground[k]);
      const soak = Float64Array.from(sorted, (k) => soakOf(this.blocks[k]));
      let low = cells[0];
      for (const k of cells) if (this.ground[k] < this.ground[low]) low = k;
      let capacity = 0;
      for (const g of grounds) capacity += level - g;
      this.ponds.push({
        cells,
        grounds,
        soak,
        backflowAnnounced: false,
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
    let land = 0;
    let runoff = 0;
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] === BlockType.WaterSource) continue;
      land++;
      runoff += runoffOf(this.blocks[c]);
    }
    this.riverRunoff = RIVER_RUNOFF_BASE + RIVER_RUNOFF_SLOPE * (land ? runoff / land : 0);
    this.computeDepressions();
    this.computeSpans();
    this.intersections = [];
    this.signal = new Uint8Array(this.n);
    for (let c = 0; c < this.n; c++) {
      if (this.blocks[c] !== BlockType.Road) continue;
      if (this.neighbours(c).filter((nb) => this.isRoad(nb)).length >= 3) this.intersections.push(c);
      if (isSignalJunction(this.w, this.h, this.blocks, c)) this.signal[c] = 1;
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
      if (b) this.substations.push({ building: b, name: this.nameOf(b), tripped: false, forced: false, dryTicks: 0 });
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
          name: this.nameOf(b),
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
      wait: 0,
      stopWait: 0,
      goal: -1,
      foot: 0,
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
    const addWalker = (role: NpcRole) => this.addWalker(role, startCell(role));
    const civilians = Math.max(0, pop.count - staff.reduce((s, [, k]) => s + k, 0));
    for (let i = 0; i < civilians; i++) addWalker(NpcRole.Civilian);
    for (const [role, k] of staff) for (let i = 0; i < k; i++) addWalker(role);

    const entranceOf = (type: BlockType) => this.buildings.filter((b) => b?.type === type).map((b) => (b as BuildingDef).entrance);
    const hospitals = entranceOf(BlockType.Hospital);
    const police = entranceOf(BlockType.PoliceStation);
    const addVehicle = (kind: VehicleKind, cell: number, speed: number, depthLimit: number, state: VehicleState) => this.addVehicle(kind, cell, speed, depthLimit, state);
    const cars = Math.round((pop.count * pop.mix.carOwners) / 4);
    for (let i = 0; i < cars; i++) addVehicle(VehicleKind.Car, this.rng.pick(roads), this.rng.range(0.6, 0.9), MOCK_LIMITS.car, VehicleState.Driving);
    // Ambulances wait at their hospitals until a casualty is reported.
    for (let i = 0; i < fleet.ambulances; i++) {
      addVehicle(VehicleKind.Ambulance, hospitals.length ? hospitals[i % hospitals.length] : this.rng.pick(roads), 1.0, MOCK_LIMITS.emergency, VehicleState.Parked);
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

  private addWalker(role: NpcRole, cell: number): void {
    this.walkers.push({
      ...this.makeMover(cell, this.rng.range(0.18, 0.32), FOOTPATH_OFFSET),
      foot: this.rng.chance(0.5) ? 1 : -1,
      id: this.nextNpcId++,
      role,
      state: role === NpcRole.Civilian ? NpcState.Commuting : NpcState.OnDuty,
      panic: Math.min(1, Math.max(0, this.params.panicMean + this.rng.range(-0.2, 0.2))),
      compliance: Math.min(1, Math.max(0, this.params.complianceMean + this.rng.range(-0.25, 0.25))),
      risk: Math.min(1, Math.max(0, this.params.riskToleranceMean + this.rng.range(-0.2, 0.2))),
      strandedAt: -1,
      requestId: -1,
      assignedTo: -1,
      injuredAt: -1,
      injury: '',
    });
  }

  private addVehicle(kind: VehicleKind, cell: number, speed: number, depthLimit: number, state: VehicleState): Vehicle {
    const v: Vehicle = {
      ...this.makeMover(cell, speed, 0.22),
      id: this.nextVehicleId++,
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
      mission: 'none',
      ref: -1,
      hospital: -1,
    };
    this.vehicles.push(v);
    return v;
  }

  /** Releases boat teams from HQ (or the boat depot) onto the floodwater nearest to it. */
  private deployTeams(count: number, why = ''): void {
    const base = this.buildings.find((b) => b?.type === BlockType.FloodHQ) ?? this.buildings.find((b) => b?.type === BlockType.BoatDepot) ?? null;
    const from = base?.entrance ?? this.roadCells()[0] ?? 0;
    let launch = -1;
    let best = Infinity;
    for (let c = 0; c < this.n; c++) {
      if (this.water[c] < MOCK_LIMITS.boatMin || this.buildingIndex[c] !== 0) continue;
      const d = Math.abs(this.cx(c) - this.cx(from)) + Math.abs(this.cz(c) - this.cz(from));
      if (d < best) {
        best = d;
        launch = c;
      }
    }
    if (launch < 0) launch = this.nearestWaterCell(from);
    for (let i = 0; i < count; i++) {
      this.addVehicle(VehicleKind.Boat, launch, 0.55, Infinity, VehicleState.Parked);
      if (this.isRoad(from)) for (let k = 0; k < RESCUERS_PER_TEAM; k++) this.addWalker(NpcRole.BoatOperator, from);
    }
    const where = base ? this.nameOf(base) : 'the riverbank';
    this.emit(
      'TEAMS_DEPLOYED',
      `${why}${count} SDRF boat team${count === 1 ? '' : 's'} released at ${where}: ${count} boat${count === 1 ? '' : 's'} and ${count * RESCUERS_PER_TEAM} rescuers launch at ${this.cellName(launch)}, ${best === Infinity ? 'on the river' : `${best * 4} m from base`}`,
      { cell: launch, data: { teams: count, rescuers: count * RESCUERS_PER_TEAM, auto: why !== '' } },
    );
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
    this.stepEmergency();
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
    const target = RIVER_BASE_STAGE + 2.5 * this.rainSmooth * this.riverRunoff + sourceBoost;
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
        let backedUp = 0;
        for (const d of p.drains) {
          const pumped = this.power[d] !== PowerState.Off;
          const drowned = this.stage >= this.ground[d];
          if (drowned && !pumped) backedUp++;
          v -= DRAIN_CELL_M_PER_TICK * (pumped ? 1 : drowned ? 0 : DRAIN_UNPOWERED);
        }
        for (let i = 0; i < p.grounds.length && p.grounds[i] < p.level; i++) v -= p.soak[i];
        if (backedUp > 0 && !p.backflowAnnounced && p.level > p.grounds[0] + 0.05) {
          p.backflowAnnounced = true;
          const district = this.scenario.districts[this.districtOf[p.low]]?.name ?? 'the city';
          this.emit(
            'DRAIN_BACKFLOW',
            `River at ${round2(this.stage)} m is above the storm-drain outfalls in ${district}; ${backedUp} unpumped drain${backedUp === 1 ? '' : 's'} back up instead of emptying the hollow at ${this.cellName(p.low)}`,
            { cell: p.low, data: { drains: backedUp, stage: round2(this.stage) } },
          );
        }
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
        const green = p.soak.filter((s) => s > 0).length;
        const drains = p.drains.length
          ? `${p.drains.length} storm drain${p.drains.length === 1 ? '' : 's'} (${pumped} pumped) can't keep up`
          : 'no storm drain serves this hollow';
        const soil = green ? `${green} of ${p.cells.length} cells are green ground that soaks water` : 'the hollow is paved, so nothing soaks away';
        this.emit(
          'LOCAL_FLOOD',
          `Rain ponding in a ${district} hollow at ${this.cellName(p.low)}: ${round2(depth)} m deep. ${p.catchment} cells drain here; ${drains} at ${Math.round(this.rain * RAIN_MM_PER_HOUR_AT_FULL)} mm/h; ${soil}`,
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
    for (let c = 0; c < this.n; c++) if (this.signal[c] && this.serviceSub[c] === i) signals++;
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
      this.openClosure(`the bridge at ${this.cellName(c)}`, this.spanCells(span), false);
      newlyClosed++;
    }
    if (newlyClosed > 0 || this.tick % 30 === 0) this.computeShelterField();
    if (this.tick % 10 === 0) this.checkHomes();

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

  // ---------- emergency services and named hazards ----------

  private stepEmergency(): void {
    this.stepAlert();
    this.stepHotspots();
    this.stepClosures();
    this.stepTeams();
    if (this.tick % 10 === 0) this.stepInjuries();
    if (this.tick % 5 === 0) {
      this.dispatchAmbulances();
      this.dispatchFoodDrops();
    }
  }

  /** First response: the control room names the flood-prone areas as soon as heavy rain sets in. */
  private stepAlert(): void {
    if (this.alertIssued || this.rain < 0.3) return;
    this.alertIssued = true;
    const spots = this.hotspots.filter((h) => h.kind === 'waterlogging' || h.kind === 'levee');
    for (const h of this.hotspots) for (const c of h.cells) this.prone[c] = 1;
    const names = this.hotspots.map((h) => h.name);
    const list = names.length ? names.join(', ') : 'low-lying streets near the river';
    this.emit(
      'FLOOD_ALERT',
      `Heavy-rain alert at ${Math.round(this.rain * RAIN_MM_PER_HOUR_AT_FULL)} mm/h. Flood-prone areas: ${list}. Residents told to avoid them; police and NDRF on standby`,
      { ...(spots[0] ? { cell: this.centreOf(spots[0].cells) } : {}), data: { areas: this.hotspots.length } },
    );
  }

  private centreOf(cells: number[]): number {
    let sx = 0;
    let sz = 0;
    for (const c of cells) {
      sx += this.cx(c);
      sz += this.cz(c);
    }
    const mx = sx / cells.length;
    const mz = sz / cells.length;
    let best = cells[0];
    let bestD = Infinity;
    for (const c of cells) {
      const d = (this.cx(c) - mx) ** 2 + (this.cz(c) - mz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private stepHotspots(): void {
    for (const h of this.hotspots) {
      if (h.kind === 'waterlogging') {
        let deepest = h.cells[0];
        for (const c of h.cells) if (this.water[c] > this.water[deepest]) deepest = c;
        const depth = this.water[deepest];
        if (!h.hit && depth >= MOCK_LIMITS.car) {
          h.hit = true;
          h.counter = 0;
          const wet = h.cells.filter((c) => this.water[c] > 0.1).length;
          const why = this.blocks[deepest] === BlockType.Road && this.ground[deepest] < Math.max(...this.neighbours(deepest).map((nb) => this.ground[nb]))
            ? 'it sits below the streets around it'
            : 'drains cannot keep up';
          this.emit('WATERLOGGING', `${h.name} waterlogged: ${round2(depth)} m deep, ${wet} of ${h.cells.length} road cells under water; ${why}`, {
            cell: deepest,
            data: { depth: round2(depth), cells: wet, name: h.name },
          });
          this.openClosure(h.name, h.cells, true);
        } else if (h.hit) {
          h.counter = depth < 0.1 ? h.counter + 1 : 0;
          if (h.counter === REOPEN_DRY) {
            h.hit = false;
            const cl = this.closures.find((x) => x.name === h.name && x.active);
            if (cl) this.liftClosure(cl, `${h.name} drained below 0.1 m for ${REOPEN_DRY} s; barricades lifted`);
          }
        }
      } else if (h.kind === 'landslide' && !h.hit) {
        h.counter += this.rain;
        if (h.counter >= SLOPE_FAILURE) this.landslide(h);
      } else if (h.kind === 'levee' && !h.hit) {
        const crest = Math.min(...h.cells.map((c) => this.barrier(c)));
        const head = this.stage - (crest - LEVEE_FREEBOARD);
        if (head > 0) h.counter += head;
        if (h.counter >= LEVEE_FAILURE) this.leveeBreach(h, crest);
      }
    }
  }

  private landslide(h: HotspotState): void {
    h.hit = true;
    for (const c of h.cells) {
      this.debris[c] = 1;
      for (const v of this.vehicles) {
        if (v.cell === c && (v.kind === VehicleKind.Car || v.kind === VehicleKind.Bus)) {
          v.state = VehicleState.Stalled;
          this.emit('VEHICLE_STALLED', `${VehicleKind[v.kind]} #${v.id} trapped by the landslide at ${h.name}`, { actor: asVehicleId(v.id), cell: c });
        }
      }
    }
    const mm = Math.round((h.counter * RAIN_MM_PER_HOUR_AT_FULL) / 3600);
    const centre = this.centreOf(h.cells);
    this.emit('LANDSLIDE', `Rain-soaked slope above ${h.name} gave way after ~${mm} mm of rain; ${h.cells.length} road cells buried under mud and rock`, {
      cell: centre,
      data: { cells: h.cells.length, rainMm: mm, name: h.name },
    });
    // Someone on the road below is caught by the debris.
    let victim = -1;
    let best = 3.5;
    this.walkers.forEach((a, i) => {
      if (a.role !== NpcRole.Civilian || (a.state !== NpcState.Commuting && a.state !== NpcState.Evacuating)) return;
      const d = Math.hypot(a.x - this.cx(centre) - 0.5, a.z - this.cz(centre) - 0.5);
      if (d < best) {
        best = d;
        victim = i;
      }
    });
    if (victim >= 0) this.injure(victim, `struck by falling rock in the ${h.name} landslide`);
    this.openClosure(h.name, h.cells, false);
    this.computeShelterField();
  }

  private leveeBreach(h: HotspotState, crest: number): void {
    h.hit = true;
    // The middle of the weak section washes out.
    const sorted = [...h.cells].sort((a, b) => this.cz(a) - this.cz(b) || this.cx(a) - this.cx(b));
    const mid = Math.floor(sorted.length / 2);
    const gap = sorted.slice(Math.max(0, mid - 1), mid + 2);
    for (const c of gap) {
      this.blocks[c] = BlockType.Dirt;
      this.ground[c] = Math.max(0, this.ground[c] - 1);
      this.breach[c] = 1;
      this.dirty.add(chunkOfCell(this.w, c));
      for (const nb of this.neighbours(c)) this.dirty.add(chunkOfCell(this.w, nb));
    }
    this.rebuildCaches();
    const district = this.scenario.districts[this.districtOf[gap[0]]]?.name ?? 'the suburb';
    this.emit(
      'LEVEE_BREACH',
      `${h.name} breached: the river stood within ${LEVEE_FREEBOARD} m of the ${round2(crest)} m crest until seepage washed out ${gap.length} cells; water pours into ${district}`,
      { cell: gap[Math.floor(gap.length / 2)], data: { cells: gap.length, stage: round2(this.stage), name: h.name } },
    );
  }

  /** Opens an authority closure and sends the nearest free police car to hold its barricades. */
  private openClosure(name: string, cells: number[], lifts: boolean): void {
    const inside = new Set(cells);
    const barricades = new Set<number>();
    for (const c of cells) {
      for (const nb of this.neighbours(c)) if (!inside.has(nb) && this.isRoad(nb) && this.blocks[nb] !== BlockType.Bridge) barricades.add(nb);
    }
    const existing = this.closures.find((x) => x.name === name);
    const cl: Closure = existing ?? { name, cells, barricades: [...barricades], policed: false, since: this.tick, active: true, lifts };
    if (existing) Object.assign(existing, { cells, barricades: [...barricades], policed: false, since: this.tick, active: true });
    else this.closures.push(cl);
    const index = this.closures.indexOf(cl);
    if (cl.barricades.length === 0) return;
    let best: Vehicle | null = null;
    let bestD = Infinity;
    let goal = -1;
    for (const v of this.vehicles) {
      if (v.kind !== VehicleKind.PoliceCar || v.failed || v.state === VehicleState.Stalled || (v.mission !== 'none' && v.mission !== 'return')) continue;
      const dist = this.distancesFrom(v.cell, MOCK_LIMITS.emergency);
      for (const b of cl.barricades) {
        if (dist[b] >= 0 && dist[b] < bestD) {
          bestD = dist[b];
          best = v;
          goal = b;
        }
      }
    }
    if (!best) return;
    best.mission = 'roadblock';
    best.ref = index;
    best.state = VehicleState.Responding;
    best.goal = goal;
    best.stuck = 0;
    this.replan(best, best.depthLimit, 'route');
  }

  private liftClosure(cl: Closure, reason: string): void {
    cl.active = false;
    for (const c of cl.cells) this.authority[c] = 0;
    for (const v of this.vehicles) {
      if (v.kind === VehicleKind.PoliceCar && (v.mission === 'post' || v.mission === 'roadblock') && this.closures[v.ref] === cl) {
        v.mission = 'none';
        v.goal = -1;
        v.state = VehicleState.Driving;
      }
    }
    this.emit('ROAD_REOPENED', reason, { cell: this.centreOf(cl.cells) });
    this.computeShelterField();
  }

  /** Barricades go up when police arrive, or after a while by traffic police on foot. */
  private raiseBarricades(cl: Closure, by: string): void {
    if (cl.policed || !cl.active) return;
    cl.policed = true;
    for (const c of cl.cells) this.authority[c] = 1;
    // The signed diversion: the shortest way between the two barricades furthest apart.
    let a = -1;
    let b = -1;
    let far = -1;
    for (const p of cl.barricades) {
      for (const q of cl.barricades) {
        const d = Math.abs(this.cx(p) - this.cx(q)) + Math.abs(this.cz(p) - this.cz(q));
        if (d > far) {
          far = d;
          a = p;
          b = q;
        }
      }
    }
    const path = a >= 0 && b >= 0 && a !== b ? this.pathTo(a, b, MOCK_LIMITS.car) : null;
    if (path) for (const c of [a, ...path]) this.detourUntil[c] = this.tick + DETOUR_TICKS * 4;
    const via = path ? `traffic diverted around it (${(path.length + 1) * 4} m detour)` : 'no way round for traffic';
    this.emit('ROADBLOCK', `${by} seal off ${cl.name}: ${cl.barricades.length} barricade${cl.barricades.length === 1 ? '' : 's'} up; ${via}`, {
      cell: cl.barricades[0],
      data: { barricades: cl.barricades.length, detourCells: path ? path.length + 1 : 0, name: cl.name },
    });
    this.computeShelterField();
  }

  private stepClosures(): void {
    for (const cl of this.closures) {
      if (cl.active && !cl.policed && this.tick - cl.since >= ROADBLOCK_FALLBACK) this.raiseBarricades(cl, 'Traffic police on foot');
    }
  }

  /** HQ releases boat teams on its own once flooding passes set levels. */
  private stepTeams(): void {
    const stranded = this.walkers.filter((a) => a.state === NpcState.Stranded).length;
    if (this.teamWaves === 0 && (this.floodThresholdsHit >= 2 || stranded >= 6)) {
      this.teamWaves = 1;
      this.deployTeams(3, `HQ auto-release: ${this.floodThresholdsHit >= 2 ? 'flooding passed 5% of the city' : `${stranded} people stranded`}. `);
    } else if (this.teamWaves === 1 && (this.floodThresholdsHit >= 3 || stranded >= 16) && this.tick - this.lastTeamWave() > 300) {
      this.teamWaves = 2;
      this.deployTeams(3, `HQ second wave: ${this.floodThresholdsHit >= 3 ? 'flooding passed 10% of the city' : `${stranded} people stranded`}. `);
    }
  }

  private lastTeamWave(): number {
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i].type === 'TEAMS_DEPLOYED') return this.log[i].tick;
    return -Infinity;
  }

  /** Wading, debris, live wires and gale-blown branches hurt people; each one is a job for an ambulance. */
  private stepInjuries(): void {
    if (this.injuries >= MAX_INJURIES || this.rain < 0.3 || this.tick - this.lastInjury < INJURY_GAP) return;
    const wading: number[] = [];
    const shocked: number[] = [];
    const branches: number[] = [];
    this.walkers.forEach((a, i) => {
      if (a.role !== NpcRole.Civilian || (a.state !== NpcState.Commuting && a.state !== NpcState.Evacuating)) return;
      const d = this.depthAt(a.cell);
      if (d > 0.12) wading.push(i);
      if (d > 0.2 && this.power[a.cell] === PowerState.Grid) shocked.push(i);
      if (this.wind > 0.6 && this.neighbours(a.cell).some((nb) => this.blocks[nb] === BlockType.Tree)) branches.push(i);
    });
    // The first casualty comes as soon as people start wading; later ones are rarer.
    const chance = this.injuries === 0 ? 1 : 0.35;
    if (!this.rng.chance(chance)) return;
    if (shocked.length && this.rng.chance(0.3)) this.injure(this.rng.pick(shocked), 'electric shock from a submerged junction box');
    else if (branches.length && this.rng.chance(0.3)) this.injure(this.rng.pick(branches), 'hit by a branch torn off in the gale');
    else if (wading.length) this.injure(this.rng.pick(wading), this.rng.chance(0.5) ? 'slipped in fast-moving water and broke an ankle' : 'cut by debris hidden under the water');
  }

  private injure(i: number, how: string): void {
    const a = this.walkers[i];
    if (!a || a.state === NpcState.Injured || a.state === NpcState.Rescued || a.state === NpcState.Sheltering) return;
    a.state = NpcState.Injured;
    a.injuredAt = this.tick;
    a.injury = how;
    a.next = -1;
    a.progress = 0;
    a.plan = [];
    a.requestId = this.nextRequest++;
    a.assignedTo = -1;
    this.requestCreated.set(a.requestId, this.tick);
    this.injuries++;
    this.lastInjury = this.tick;
    const nth = this.injuries === 1 ? 'First casualty' : `Casualty ${this.injuries}`;
    this.emit('INJURY_REPORTED', `${nth}: civilian #${a.id} ${how} at ${this.cellName(a.cell)}; 108 call logged, ambulance requested`, {
      actor: asNpcId(a.id),
      cell: a.cell,
      data: { injuries: this.injuries },
    });
  }

  /** Nearest free ambulance by road answers each casualty, oldest first. */
  private dispatchAmbulances(): void {
    const waiting = this.walkers
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.state === NpcState.Injured && a.assignedTo < 0)
      .sort((p, q) => p.a.injuredAt - q.a.injuredAt);
    for (const { a, i } of waiting) {
      const free = this.vehicles.filter(
        (v) => v.kind === VehicleKind.Ambulance && !v.failed && v.state !== VehicleState.Stalled && (v.mission === 'none' || v.mission === 'return'),
      );
      if (!free.length) return;
      const dist = this.passable(a.cell, MOCK_LIMITS.emergency) ? this.distancesFrom(a.cell, MOCK_LIMITS.emergency) : null;
      let best: Vehicle | null = null;
      let bestD = Infinity;
      for (const v of free) {
        const d = dist ? dist[v.cell] : -1;
        if (d >= 0 && d < bestD) {
          bestD = d;
          best = v;
        }
      }
      if (!best) {
        if (this.tick - a.injuredAt >= AMBULANCE_UNREACHABLE) this.handOverCasualty(a, i);
        continue;
      }
      a.assignedTo = best.id;
      best.mission = 'patient';
      best.ref = i;
      best.goal = a.cell;
      best.state = VehicleState.Responding;
      best.stuck = 0;
      this.replan(best, best.depthLimit, 'route');
      const from = this.hospitalAt(best.cell);
      this.emit(
        'AMBULANCE_DISPATCH',
        `Ambulance #${best.id}${from >= 0 ? ` from ${this.buildingNames[from]}` : ''} sent to #${a.id} (${a.injury}): ${bestD * 4} m by road, ETA ~${Math.round(bestD / best.speed)} s`,
        { actor: asVehicleId(best.id), target: asNpcId(a.id), cell: a.cell, data: { eta: Math.round(bestD / best.speed), metres: bestD * 4 } },
      );
    }
  }

  /** No road reaches the casualty: it becomes a rescue request for boats and helicopters. */
  private handOverCasualty(a: Walker, i: number): void {
    a.state = NpcState.Stranded;
    a.strandedAt = this.tick;
    this.emit('NPC_STRANDED', `injured #${a.id} cut off at ${this.cellName(a.cell)}: no ambulance can reach by road for ${AMBULANCE_UNREACHABLE} s; boat or helicopter requested`, {
      actor: asNpcId(a.id),
      cell: a.cell,
    });
    if (this.tick >= this.commsDownUntil) this.createReport(i, true);
  }

  private hospitalAt(cell: number): number {
    return this.buildings.findIndex((b) => b?.type === BlockType.Hospital && b.entrance === cell);
  }

  /** Hospital index → beds in use. */
  private bedsUsed(i: number): number {
    return this.hospitalLoad.get(i) ?? 0;
  }

  /** A hospital may take patients only with power (grid or generator) and a free bed. */
  private hospitalProblem(i: number): string | null {
    const b = this.buildings[i];
    if (!b) return 'closed';
    if (this.power[b.cells[0]] === PowerState.Off) return 'no power';
    if (this.bedsUsed(i) >= b.capacity) return `full (${b.capacity}/${b.capacity} beds)`;
    return null;
  }

  private pickHospital(v: Vehicle): { index: number; note: string } | null {
    const dist = this.distancesFrom(v.cell, v.depthLimit);
    const options: { i: number; d: number }[] = [];
    this.buildings.forEach((b, i) => {
      if (b?.type !== BlockType.Hospital) return;
      const d = dist[b.entrance];
      if (d >= 0) options.push({ i, d });
    });
    options.sort((p, q) => p.d - q.d);
    if (!options.length) return null;
    const ok = options.find((o) => this.hospitalProblem(o.i) === null);
    if (!ok) return { index: options[0].i, note: `every reachable hospital is full or dark; declared overflow at ${this.buildingNames[options[0].i]}` };
    const nearest = options[0];
    if (nearest.i !== ok.i) {
      return { index: ok.i, note: `${this.buildingNames[nearest.i]} ${this.hospitalProblem(nearest.i)}, diverted to ${this.buildingNames[ok.i]}` };
    }
    return { index: ok.i, note: '' };
  }

  private arriveAmbulance(v: Vehicle): void {
    if (v.mission === 'patient') {
      const a = this.walkers[v.ref];
      if (!a || a.state !== NpcState.Injured) {
        this.sendBack(v);
        return;
      }
      a.state = NpcState.Rescued;
      const created = this.requestCreated.get(a.requestId) ?? a.injuredAt;
      this.served.push({ created, served: this.tick, district: Math.max(0, this.districtOf[a.cell]) });
      const h = this.pickHospital(v);
      if (!h) {
        this.emit('MEDEVAC', `#${a.id} loaded into Ambulance #${v.id} after ${this.tick - a.injuredAt} s, but no hospital is reachable by road; holding on scene`, {
          actor: asVehicleId(v.id),
          target: asNpcId(a.id),
          cell: v.cell,
        });
        v.mission = 'none';
        v.goal = -1;
        v.state = VehicleState.Parked;
        return;
      }
      v.mission = 'hospital';
      v.hospital = h.index;
      v.goal = (this.buildings[h.index] as BuildingDef).entrance;
      v.state = VehicleState.Transporting;
      this.replan(v, v.depthLimit, 'route');
      this.emit('MEDEVAC', `Paramedics load #${a.id} into Ambulance #${v.id} ${this.tick - a.injuredAt} s after the call; heading to ${this.buildingNames[h.index]}`, {
        actor: asVehicleId(v.id),
        target: asNpcId(a.id),
        cell: v.cell,
      });
      if (h.note) {
        this.emit('HOSPITAL_DIVERT', `Ambulance #${v.id}: ${h.note}`, { actor: asVehicleId(v.id), cell: v.cell });
      }
      return;
    }
    if (v.mission === 'hospital') {
      const i = v.hospital;
      const b = this.buildings[i] as BuildingDef;
      const used = this.bedsUsed(i) + 1;
      this.hospitalLoad.set(i, used);
      const adm = this.admitted.get(i) ?? { ambulance: 0, heli: 0 };
      adm.ambulance++;
      this.admitted.set(i, adm);
      const a = this.walkers[v.ref];
      this.emit('HOSPITAL_ASSIGN', `#${a?.id ?? '?'} admitted to ${this.buildingNames[i]} by Ambulance #${v.id}: ${used}/${b.capacity} beds in use`, {
        actor: asVehicleId(v.id),
        ...(a ? { target: asNpcId(a.id) } : {}),
        cell: b.entrance,
        data: { beds: used, capacity: b.capacity },
      });
      if (used === b.capacity) {
        this.emit('HOSPITAL_DIVERSION_ON', `${this.buildingNames[i]} full (${b.capacity} beds); new patients diverted`, { actor: asBuildingId(i), cell: b.entrance });
      }
      v.mission = 'none';
      v.goal = -1;
      v.ref = -1;
      v.base = v.cell;
      v.state = VehicleState.Parked;
      return;
    }
    if (v.mission === 'return') {
      v.mission = 'none';
      v.goal = -1;
      v.state = VehicleState.Parked;
    }
  }

  private sendBack(v: Vehicle): void {
    v.mission = 'return';
    v.goal = v.base;
    v.ref = -1;
    v.state = VehicleState.Returning;
    this.replan(v, v.depthLimit, 'route');
  }

  /** Idle helicopters carry food and water to people sheltering upstairs in flooded homes. */
  private dispatchFoodDrops(): void {
    if (this.windGrounded || this.floodedHomes.size === 0) return;
    // Rescues come first; supplies go out when the queue is short or people have waited too long for food.
    const waiting = this.walkers.filter((a) => a.state === NpcState.Stranded && a.assignedTo < 0).length;
    const lastDrop = Math.max(-Infinity, ...this.dropsAt.values());
    if (waiting > 2 && this.tick - lastDrop < DROP_INTERVAL * 1.5) return;
    const heli = this.vehicles.find((v) => v.kind === VehicleKind.Helicopter && v.phase === 'idle' && !v.failed && v.state !== VehicleState.Grounded);
    if (!heli) return;
    const byDistrict = new Map<number, { residents: number; cell: number }>();
    for (const i of this.floodedHomes) {
      const b = this.buildings[i];
      if (!b) continue;
      const d = Math.max(0, this.districtOf[b.entrance]);
      const acc = byDistrict.get(d) ?? { residents: 0, cell: b.cells[0] };
      acc.residents += b.capacity;
      byDistrict.set(d, acc);
    }
    let pick = -1;
    let most = 0;
    for (const [d, acc] of byDistrict) {
      if (this.tick - (this.dropsAt.get(d) ?? -Infinity) < DROP_INTERVAL) continue;
      if (acc.residents > most) {
        most = acc.residents;
        pick = d;
      }
    }
    if (pick < 0) return;
    const target = byDistrict.get(pick) as { residents: number; cell: number };
    this.dropsAt.set(pick, this.tick);
    heli.mission = 'drop';
    heli.ref = pick;
    heli.phase = 'out';
    heli.state = VehicleState.Flying;
    heli.tx = this.cx(target.cell) + 0.5;
    heli.tz = this.cz(target.cell) + 0.5;
    heli.goal = target.cell;
  }

  private foodDrop(v: Vehicle): void {
    const d = v.ref;
    let residents = 0;
    let homes = 0;
    for (const i of this.floodedHomes) {
      const b = this.buildings[i];
      if (!b || Math.max(0, this.districtOf[b.entrance]) !== d) continue;
      residents += b.capacity;
      homes++;
    }
    const district = this.scenario.districts[d]?.name ?? 'the city';
    this.emit(
      'FOOD_DROP',
      `Helicopter #${v.id} drops ${residents * PACKETS_PER_RESIDENT} food and water packets over ${district}: ${residents} residents of ${homes} flooded homes are sheltering upstairs`,
      { actor: asVehicleId(v.id), cell: v.goal, data: { packets: residents * PACKETS_PER_RESIDENT, residents, homes } },
    );
  }

  // ---------- routing ----------

  /** Road distance (cells) from `from` to every reachable cell, -1 elsewhere. Shared buffer. */
  private distancesFrom(from: number, limit: number): Int32Array {
    const dist = this.bfsDist;
    dist.fill(-1);
    const q = this.bfsQueue;
    let head = 0;
    let tail = 0;
    dist[from] = 0;
    q[tail++] = from;
    while (head < tail) {
      const c = q[head++];
      for (const nb of this.neighbours(c)) {
        if (dist[nb] >= 0 || !this.passable(nb, limit)) continue;
        dist[nb] = dist[c] + 1;
        q[tail++] = nb;
      }
    }
    return dist;
  }

  /** Shortest road path (excluding `from`) or null. */
  private pathTo(from: number, goal: number, limit: number, avoid = -1): number[] | null {
    if (from === goal) return [];
    if (!this.passable(goal, limit)) return null;
    const prev = this.bfsPrev;
    prev.fill(-1);
    const q = this.bfsQueue;
    let head = 0;
    let tail = 0;
    prev[from] = from;
    q[tail++] = from;
    while (head < tail) {
      const c = q[head++];
      for (const nb of this.neighbours(c)) {
        if (prev[nb] !== -1 || nb === avoid || !this.passable(nb, limit)) continue;
        prev[nb] = c;
        if (nb === goal) {
          const path: number[] = [];
          for (let k = goal; k !== from; k = prev[k]) path.push(k);
          return path.reverse();
        }
        q[tail++] = nb;
      }
    }
    return null;
  }

  private spanCells(span: number): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.n; c++) if (this.spanOf[c] === span) out.push(c);
    return out;
  }

  /** Marks the road ahead of a vehicle that just turned away from a closure. */
  private markDetour(m: Mover): void {
    const until = this.tick + DETOUR_TICKS;
    for (const c of m.plan.slice(0, 8)) if (this.blocks[c] === BlockType.Road) this.detourUntil[c] = Math.max(this.detourUntil[c], until);
  }

  /** Marks homes with water above their floor; one aggregated event per district per minute. */
  private checkHomes(): void {
    this.buildings.forEach((b, i) => {
      if (!b || !HOMES.has(b.type) || this.floodedHomes.has(i)) return;
      if (!b.cells.some((c) => this.water[c] > b.floorHeight)) return;
      this.floodedHomes.add(i);
      const d = this.districtOf[b.entrance];
      const acc = this.homesNews.get(d) ?? { homes: 0, residents: 0, cell: b.entrance, last: -Infinity };
      acc.homes++;
      acc.residents += b.capacity;
      this.homesNews.set(d, acc);
    });
    for (const [d, acc] of this.homesNews) {
      if (acc.homes === 0 || this.tick - acc.last < 60) continue;
      const district = this.scenario.districts[d]?.name ?? 'the city';
      let total = 0;
      for (const i of this.floodedHomes) if (this.buildings[i] && this.districtOf[(this.buildings[i] as BuildingDef).entrance] === d) total++;
      this.emit('HOMES_FLOODED', `${acc.homes} home${acc.homes === 1 ? '' : 's'} in ${district} took water above the floor; ${acc.residents} residents affected (${total} homes so far)`, {
        cell: acc.cell,
        data: { homes: acc.homes, residents: acc.residents, total },
      });
      this.homesNews.set(d, { homes: 0, residents: 0, cell: acc.cell, last: this.tick });
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
        a.assignedTo = -1;
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
    if (this.dispatchMode === 'negotiation') {
      // Contract net with local views: each free unit only bids on its nearest few
      // open requests; requests are awarded oldest first to the best bid they got.
      const local = new Map<number, Set<number>>();
      for (const v of this.vehicles) {
        if (v.failed || v.targetNpc >= 0) continue;
        const near = waiting
          .map(({ a }) => ({ a, d: Math.hypot(v.x - a.x, v.z - a.z) }))
          .sort((p, q) => p.d - q.d || p.a.strandedAt - q.a.strandedAt)
          .slice(0, NEGOTIATION_VIEW);
        local.set(v.id, new Set(near.map(({ a }) => a.requestId)));
      }
      for (const { a, i } of waiting) {
        const bids = this.bidsFor(a).filter((b) => local.get(b.v.id)?.has(a.requestId));
        if (bids.length === 0) continue;
        for (const b of bids.slice(0, 2)) {
          this.emit('BID', `${VehicleKind[b.v.kind]} #${b.v.id} bids ETA ${b.eta} ticks`, {
            actor: asVehicleId(b.v.id),
            target: asRequestId(a.requestId),
            data: { eta: b.eta },
          });
        }
        const runnerUp = bids[1] ? `; next best ${VehicleKind[bids[1].v.kind]} #${bids[1].v.id} ETA ${bids[1].eta}` : '';
        this.assign(a, i, bids[0], `won contract-net auction, ETA ${bids[0].eta} ticks${runnerUp}`);
      }
      return;
    }
    // Centralised baseline: HQ sees every open request and free unit at once and
    // greedily takes the globally shortest ETA pair first (approximate min-cost matching).
    const pairs: { a: Walker; i: number; v: Vehicle; eta: number }[] = [];
    for (const { a, i } of waiting) for (const b of this.bidsFor(a)) pairs.push({ a, i, v: b.v, eta: b.eta });
    pairs.sort((p, q) => p.eta - q.eta || p.a.strandedAt - q.a.strandedAt || p.v.id - q.v.id);
    for (const p of pairs) {
      if (p.a.assignedTo >= 0 || p.v.targetNpc >= 0) continue;
      this.assign(p.a, p.i, { v: p.v, eta: p.eta }, `central min-cost matching, ETA ${p.eta} ticks across ${waiting.length} open requests`);
    }
  }

  private bidsFor(a: Walker): { v: Vehicle; eta: number }[] {
    const bids: { v: Vehicle; eta: number }[] = [];
    for (const v of this.vehicles) {
      if (v.failed || v.targetNpc >= 0) continue;
      const d = Math.hypot(v.x - a.x, v.z - a.z);
      if (v.kind === VehicleKind.Boat && this.deepNear(a.cell)) bids.push({ v, eta: Math.round(d / v.speed + 10) });
      if (v.kind === VehicleKind.Helicopter && v.phase === 'idle' && !this.windGrounded) bids.push({ v, eta: Math.round(d / v.speed + 30) });
    }
    return bids.sort((p, q) => p.eta - q.eta || p.v.id - q.v.id);
  }

  private assign(a: Walker, i: number, best: { v: Vehicle; eta: number }, how: string): void {
    this.emit('ASSIGNED', `${VehicleKind[best.v.kind]} #${best.v.id} ${how}`, {
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

  private deepNear(c: number): boolean {
    if (this.water[c] >= MOCK_LIMITS.boatMin) return true;
    return this.neighbours(c).some((nb) => this.water[nb] >= MOCK_LIMITS.boatMin);
  }

  // ---------- movement ----------

  private stepMovement(): void {
    for (const a of this.walkers) {
      if (a.state === NpcState.Sheltering || a.state === NpcState.Rescued || a.state === NpcState.Stranded || a.state === NpcState.Injured) continue;
      const evac = a.state === NpcState.Evacuating;
      const slow = 1 - Math.min(0.7, this.depthAt(a.cell) * 1.5);
      this.advanceOnRoads(a, MOCK_LIMITS.footSafe, evac ? 'evac' : 'wander', slow, evac ? `npc` : null, asNpcId(a.id));
      if (evac && this.shelterDist[a.cell] === 0) this.arriveAtShelter(a);
    }
    this.lanes.clear();
    for (const v of this.vehicles) {
      if (v.failed || v.next < 0 || v.kind === VehicleKind.Helicopter || v.kind === VehicleKind.Boat) continue;
      const key = this.laneKey(v.cell, v.next);
      const lane = this.lanes.get(key);
      if (lane) lane.push(v);
      else this.lanes.set(key, [v]);
    }
    for (const v of this.vehicles) {
      if (v.failed) continue;
      if (v.kind === VehicleKind.Helicopter) this.moveHeli(v);
      else if (v.kind === VehicleKind.Boat) this.moveBoat(v);
      else this.moveRoadVehicle(v);
    }
    this.stepGridlock();
  }

  private laneKey(from: number, to: number): number {
    const d = to === from + 1 ? 0 : to === from - 1 ? 1 : to === from + this.w ? 2 : 3;
    return from * 4 + d;
  }

  private emergency(v: Vehicle): boolean {
    return v.kind === VehicleKind.Ambulance || (v.kind === VehicleKind.PoliceCar && v.state === VehicleState.Responding);
  }

  /**
   * How far along its current cell a road vehicle may go this tick: it keeps a
   * gap to the vehicle ahead in its lane, waits for room in the next cell, stops
   * at red lights, and treats a dark (unpowered) signal as a four-way stop.
   * Emergency vehicles run red lights with sirens but still never drive through another car.
   */
  private trafficCap(v: Vehicle): number {
    if (v.next < 0) return Infinity;
    let cap = Infinity;
    for (const o of this.lanes.get(this.laneKey(v.cell, v.next)) ?? []) {
      if (o !== v && o.progress > v.progress) cap = Math.min(cap, o.progress - CAR_GAP);
    }
    const dir = this.laneKey(v.cell, v.next) - v.cell * 4;
    let ahead = 0;
    for (let d = 0; d < 4; d++) {
      for (const o of this.lanes.get(v.next * 4 + d) ?? []) {
        if (o === v) continue;
        ahead++;
        // Same direction in the next cell: keep the gap across the cell boundary.
        if (d === dir) cap = Math.min(cap, 1 + o.progress - CAR_GAP);
      }
    }
    if (ahead >= CELL_VEHICLES) cap = Math.min(cap, STOP_LINE);
    if (this.signal[v.next] && !this.signal[v.cell] && v.progress <= STOP_LINE + 0.01) {
      if (this.power[v.next] === PowerState.Off) {
        // Dark signal: full stop, then go only when the junction is clear.
        v.stopWait = v.progress >= STOP_LINE - 0.05 ? v.stopWait + 1 : 0;
        if (v.stopWait < DARK_SIGNAL_STOP || ahead > 0) cap = Math.min(cap, STOP_LINE);
      } else if (!this.emergency(v)) {
        const axis = Math.abs(v.next - v.cell) === 1 ? 'x' : 'z';
        const phase = signalPhase(this.tick, v.next, this.w);
        if (phase.green !== axis || phase.amber) cap = Math.min(cap, STOP_LINE);
      }
    }
    return cap;
  }

  /** Vehicles held for a long time mark gridlocked cells; announced at most every two minutes. */
  private stepGridlock(): void {
    const cells = new Set<number>();
    let dark = 0;
    for (const v of this.vehicles) {
      if (v.failed || v.wait < GRIDLOCK_WAIT || v.kind === VehicleKind.Boat || v.kind === VehicleKind.Helicopter) continue;
      cells.add(v.cell);
      if (v.next >= 0 && this.signal[v.next] && this.power[v.next] === PowerState.Off) dark++;
    }
    this.gridlockCells = cells.size;
    if (cells.size >= 4 && this.tick - this.lastGridlockNews >= 120) {
      this.lastGridlockNews = this.tick;
      const first = cells.values().next().value as number;
      const district = this.scenario.districts[this.districtOf[first]]?.name ?? 'the city';
      const why = dark ? `${dark} waiting at dark signals` : 'flooded and blocked streets leave no way through';
      this.emit('GRIDLOCK', `Traffic jammed in ${district}: vehicles stuck for over ${GRIDLOCK_WAIT} s in ${cells.size} cells; ${why}`, {
        cell: first,
        data: { cells: cells.size, darkSignals: dark },
      });
    }
  }

  private arriveAtShelter(a: Walker): void {
    const bi = this.buildings.findIndex((b) => b?.type === BlockType.Shelter && b.entrance === a.cell);
    if (bi < 0) return;
    const b = this.buildings[bi] as BuildingDef;
    const load = (this.shelterLoad.get(bi) ?? 0) + 1;
    if (!this.openedCamps.has(bi) && load <= b.capacity) {
      this.openedCamps.add(bi);
      this.emit('CAMP_OPENED', `${this.buildingNames[bi]} opens as a relief camp: first evacuees registered; ${b.capacity} places, food, water and a medical desk`, {
        actor: asBuildingId(bi),
        cell: b.entrance,
        data: { capacity: b.capacity },
      });
    }
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
      if (v.mission === 'patient') {
        const a = this.walkers[v.ref];
        if (a) a.assignedTo = -1;
        this.emit('COMMIT_CANCELLED', `Ambulance #${v.id} stalled on the way; casualty re-queued for the next ambulance`, { actor: asVehicleId(v.id) });
      }
      return;
    }
    // Parked: ambulances on standby and police holding a barricade.
    if ((v.kind === VehicleKind.Ambulance && v.mission === 'none') || v.mission === 'post') {
      v.next = -1;
      v.progress = 0;
      this.placeMover(v);
      return;
    }
    if (v.mission === 'patient' && this.walkers[v.ref]?.state !== NpcState.Injured) this.sendBack(v);
    if (v.goal >= 0 && v.cell === v.goal) {
      this.arrive(v);
      return;
    }
    const routed = v.goal >= 0;
    // Cars crawl through standing water and slow down in heavy rain.
    const slow = (1 - Math.min(0.6, this.depthAt(v.cell) * 2)) * (1 - 0.2 * this.rain);
    const before = v.progress;
    const cell = v.cell;
    this.advanceOnRoads(v, v.depthLimit, routed ? 'route' : 'wander', slow, VehicleKind[v.kind], asVehicleId(v.id), this.trafficCap(v));
    v.wait = v.cell === cell && v.progress <= before + 1e-6 ? v.wait + 1 : 0;
    if (routed && v.next < 0) {
      v.stuck++;
      if (v.stuck > AMBULANCE_UNREACHABLE) this.abandonMission(v);
    } else if (routed) v.stuck = 0;
    if (v.wait > GRIDLOCK_WAIT * 2 && v.next >= 0) {
      // Give up on this way and turn around or take another street.
      this.replan(v, v.depthLimit, routed ? 'route' : 'wander', v.next);
      v.wait = GRIDLOCK_WAIT;
    }
  }

  private arrive(v: Vehicle): void {
    if (v.kind === VehicleKind.PoliceCar) {
      if (v.mission === 'roadblock') {
        const cl = this.closures[v.ref];
        v.mission = 'post';
        v.goal = -1;
        v.state = VehicleState.Parked;
        if (cl) this.raiseBarricades(cl, `Police unit #${v.id}`);
      } else {
        v.mission = 'none';
        v.goal = -1;
        v.state = VehicleState.Driving;
      }
      return;
    }
    this.arriveAmbulance(v);
  }

  private abandonMission(v: Vehicle): void {
    v.stuck = 0;
    if (v.mission === 'patient') {
      const a = this.walkers[v.ref];
      if (a) a.assignedTo = -1;
      this.emit('COMMIT_CANCELLED', `Ambulance #${v.id}: no road open to the casualty; returning, casualty re-queued`, { actor: asVehicleId(v.id) });
      this.sendBack(v);
      return;
    }
    if (v.mission === 'hospital') {
      // Hold the patient and try again for any hospital.
      const h = this.pickHospital(v);
      if (h) {
        v.hospital = h.index;
        v.goal = (this.buildings[h.index] as BuildingDef).entrance;
        this.replan(v, v.depthLimit, 'route');
      }
      return;
    }
    v.mission = 'none';
    v.goal = -1;
    v.state = v.kind === VehicleKind.Ambulance ? VehicleState.Parked : VehicleState.Driving;
  }

  private advanceOnRoads(
    m: Mover,
    limit: number,
    mode: 'wander' | 'evac' | 'route',
    speedFactor: number,
    rerouteLabel: string | null,
    actor: SimEvent['actor'],
    cap = Infinity,
  ): void {
    if (m.next < 0 || !this.passable(m.next, limit)) {
      const blocked = m.next;
      this.replan(m, limit, mode);
      if (blocked >= 0 && rerouteLabel !== 'npc') this.markDetour(m);
      if (blocked >= 0 && rerouteLabel && this.tick - m.lastReroute > 60) {
        m.lastReroute = this.tick;
        const why =
          this.blocks[blocked] === BlockType.Bridge
            ? 'bridge closed'
            : this.debris[blocked]
              ? `cell ${this.cellName(blocked)} blocked by debris`
              : this.authority[blocked] && this.water[blocked] <= limit
                ? `cell ${this.cellName(blocked)} closed by police barricade`
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
    m.progress = Math.max(m.progress, Math.min(m.progress + m.speed * speedFactor, cap));
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

  private replan(m: Mover, limit: number, mode: 'wander' | 'evac' | 'route', avoid = -1): void {
    m.plan = [];
    m.planVersion++;
    m.progress = 0;
    m.next = -1;
    if (mode === 'route') {
      m.plan = (m.goal >= 0 ? (this.pathTo(m.cell, m.goal, limit, avoid) ?? this.pathTo(m.cell, m.goal, limit)) : null) ?? [];
    } else {
      this.extendPlan(m, limit, mode, 12, avoid);
    }
    m.next = m.plan.shift() ?? -1;
  }

  private extendPlan(m: Mover, limit: number, mode: 'wander' | 'evac' | 'route', want: number, avoid = -1): void {
    if (mode === 'route') return;
    const chain = [m.prev, m.cell, ...(m.next >= 0 ? [m.next] : []), ...m.plan];
    let last = chain[chain.length - 1];
    let before = chain[chain.length - 2];
    while (m.plan.length < want) {
      const open = this.neighbours(last).filter((c) => this.passable(c, limit));
      const options = open.length > 1 ? open.filter((c) => c !== avoid) : open;
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
      const dx = Math.round(Math.cos(m.heading));
      const dz = Math.round(Math.sin(m.heading));
      const lat = m.foot ? this.footLateral(m.cell, dx, dz, m.foot) : m.lateral * 0.5;
      m.x = ax - dz * lat;
      m.z = az + dx * lat;
      return;
    }
    const bx = this.cx(m.next) + 0.5;
    const bz = this.cz(m.next) + 0.5;
    const dx = bx - ax;
    const dz = bz - az;
    m.heading = Math.atan2(dz, dx);
    // Pedestrians keep to the kerb side that has a footpath, easing across where the street turns.
    const lat = m.foot
      ? this.footLateral(m.cell, dx, dz, m.foot) * (1 - m.progress) + this.footLateral(m.next, dx, dz, m.foot) * m.progress
      : m.lateral;
    m.x = ax + dx * m.progress - dz * lat;
    m.z = az + dz * m.progress + dx * lat;
  }

  /**
   * Signed footpath offset for walking along (dx, dz) through `cell`: the
   * preferred side unless that side is more road (a wide avenue or a
   * junction), in which case the other kerb.
   */
  private footLateral(cell: number, dx: number, dz: number, side: number): number {
    const x = this.cx(cell);
    const z = this.cz(cell);
    const roadAt = (s: number) => {
      const nx = x - dz * s;
      const nz = z + dx * s;
      return nx >= 0 && nz >= 0 && nx < this.w && nz < this.h && this.isRoad(nz * this.w + nx);
    };
    const s = roadAt(side) && !roadAt(-side) ? -side : side;
    return s * FOOTPATH_OFFSET;
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
        if (v.mission === 'drop') {
          this.foodDrop(v);
          v.mission = 'none';
          v.goal = -1;
        } else {
          const a = this.walkers[v.targetNpc];
          if (a) this.rescue(v, a, 'heli');
        }
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
        v.hover = v.mission === 'drop' ? 20 : 12;
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
      // Casualties fly to a hospital with power and a bed; everyone else to a relief camp.
      const hosp = a.injury ? this.buildings.findIndex((b, i) => b?.type === BlockType.Hospital && this.hospitalProblem(i) === null) : -1;
      if (hosp >= 0) {
        this.hospitalLoad.set(hosp, this.bedsUsed(hosp) + 1);
        const adm = this.admitted.get(hosp) ?? { ambulance: 0, heli: 0 };
        adm.heli++;
        this.admitted.set(hosp, adm);
        this.emit('HELI_DROPOFF', `#${a.id} (${a.injury}) flown to ${this.buildingNames[hosp]}: ${this.bedsUsed(hosp)}/${(this.buildings[hosp] as BuildingDef).capacity} beds`, {
          actor: asVehicleId(v.id),
          cell: (this.buildings[hosp] as BuildingDef).entrance,
        });
      } else {
        this.toCamp(a, v, 'flown');
      }
    } else {
      v.phase = 'idle';
      v.state = VehicleState.Parked;
      this.toCamp(a, v, 'ferried');
    }
    this.emit('SERVED', `request #${a.requestId} served by ${VehicleKind[v.kind]} #${v.id} in ${this.tick - created} ticks`, {
      actor: asVehicleId(v.id),
      target: asRequestId(a.requestId),
      data: { tts: this.tick - created },
    });
  }

  /** Rescued people are registered at the nearest relief camp with room. */
  private toCamp(a: Walker, v: Vehicle, how: 'flown' | 'ferried'): void {
    let best = -1;
    let bestD = Infinity;
    this.buildings.forEach((b, i) => {
      if (b?.type !== BlockType.Shelter || (this.shelterLoad.get(i) ?? 0) >= b.capacity) return;
      const d = Math.hypot(this.cx(b.entrance) - a.x, this.cz(b.entrance) - a.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return;
    const b = this.buildings[best] as BuildingDef;
    const load = (this.shelterLoad.get(best) ?? 0) + 1;
    this.shelterLoad.set(best, load);
    if (!this.openedCamps.has(best)) {
      this.openedCamps.add(best);
      this.emit('CAMP_OPENED', `${this.buildingNames[best]} opens as a relief camp: first rescued residents registered; ${b.capacity} places, food, water and a medical desk`, {
        actor: asBuildingId(best),
        cell: b.entrance,
        data: { capacity: b.capacity },
      });
    }
    if (how === 'flown') {
      this.emit('HELI_DROPOFF', `#${a.id} flown to ${this.buildingNames[best]}: ${load}/${b.capacity} places taken`, { actor: asVehicleId(v.id), cell: b.entrance });
    }
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
        this.emit('INJECTED', `${span >= 0 ? `bridge at ${this.cellName(ev.cell as number)}` : 'all bridges'} closed by authorities: debris piling against the piers (injected)`, {
          data: { kind: ev.kind },
          ...(span >= 0 ? { cell: ev.cell } : {}),
        });
        if (span >= 0) this.openClosure(`the bridge at ${this.cellName(ev.cell as number)}`, this.spanCells(span), false);
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
          this.openClosure(`debris at ${this.cellName(c)}`, [c], false);
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
      case 'rescue_teams_deployed':
        this.deployTeams(Math.max(1, Math.min(20, ev.count ?? 3)));
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
      zones: this.zones(),
    };
  }

  private zones(): Uint8Array {
    const z = new Uint8Array(this.n);
    if (this.alertIssued) for (let c = 0; c < this.n; c++) if (this.prone[c]) z[c] |= ZONE.prone;
    for (let c = 0; c < this.n; c++) {
      if (this.isRoad(c) && (this.closed[c] || this.authority[c] || (this.blocks[c] === BlockType.Bridge && !this.passable(c, Infinity)))) z[c] |= ZONE.closed;
      if (this.debris[c]) z[c] |= ZONE.debris | ZONE.closed;
      if (this.breach[c]) z[c] |= ZONE.breach;
      if (this.detourUntil[c] > this.tick && this.isRoad(c) && !this.closed[c]) z[c] |= ZONE.detour;
    }
    for (const cl of this.closures) {
      if (!cl.active || !cl.policed) continue;
      for (const c of cl.barricades) z[c] |= ZONE.barricade;
    }
    return z;
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
      return vs.length ? vs.filter((v) => v.targetNpc < 0 && (v.mission === 'none' || v.mission === 'post')).length / vs.length : 0;
    };
    let roads = 0;
    let closedRoads = 0;
    for (let c = 0; c < this.n; c++) {
      if (!this.isRoad(c)) continue;
      roads++;
      if (this.closed[c] || this.debris[c] || (this.blocks[c] === BlockType.Bridge && !this.passable(c, Infinity))) closedRoads++;
    }
    let residentsAffected = 0;
    let homesFlooded = 0;
    for (const i of this.floodedHomes) {
      const b = this.buildings[i];
      if (!b) continue;
      homesFlooded++;
      residentsAffected += b.capacity;
    }
    return {
      tick: this.tick,
      tts: { mean: round2(mean), p50: q(0.5), p90: q(0.9) },
      unmet: stranded,
      idleFrac: { boat: round2(idle(VehicleKind.Boat)), helicopter: round2(idle(VehicleKind.Helicopter)), ambulance: round2(idle(VehicleKind.Ambulance)) },
      gini: round2(gini(byDistrict)),
      hospitals: this.buildings.flatMap((b, i) => {
        if (b?.type !== BlockType.Hospital) return [];
        const g = this.generators.find((gg) => gg.building.id === b.id);
        return [
          {
            id: b.id,
            util: round2(this.bedsUsed(i) / Math.max(1, b.capacity)),
            diversion: (g?.exhausted ?? false) || this.bedsUsed(i) >= b.capacity,
            onGenerator: g?.active ?? false,
          },
        ];
      }),
      evacDonePct: round2((100 * sheltered) / Math.max(1, sheltered + evacuating)),
      stranded,
      gridlockCells: this.gridlockCells,
      floodedCells: flooded,
      maxDepth: round2(maxDepth),
      unpoweredPopPct: round2((100 * unpowered) / Math.max(1, civilians.length)),
      heliRescues: this.heliRescues,
      routeViolations: 0,
      homesFlooded,
      residentsAffected,
      roadsClosedPct: round2((100 * closedRoads) / Math.max(1, roads)),
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
          ...(a.injury ? { injury: a.injury } : {}),
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
          ...(v.mission !== 'none' ? { task: MISSION_LABEL[v.mission] } : {}),
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
        title: this.nameOf(b),
        attributes: {
          type: BlockType[b.type],
          capacity: b.capacity,
          footprint: `${b.cells.length} cells`,
          power: PowerState[power],
          floodDepthAtEntrance: round2(this.water[b.entrance]),
          ...(g ? { generatorFuelTicks: g.fuel } : {}),
          ...(b.type === BlockType.Shelter ? this.campAttributes(ref.id, b) : {}),
          ...(b.type === BlockType.Hospital ? this.hospitalAttributes(ref.id, b) : {}),
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

  private campAttributes(i: number, b: BuildingDef): Record<string, number | string> {
    const occupants = Math.min(b.capacity, this.shelterLoad.get(i) ?? 0);
    return {
      occupants,
      status: this.shelterOverflowed.has(i) ? 'Full: sending evacuees on' : this.openedCamps.has(i) ? 'Open' : 'Standing by',
      familiesRegistered: Math.ceil(occupants / 4),
      mealsPerDay: occupants * 3,
    };
  }

  private hospitalAttributes(i: number, b: BuildingDef): Record<string, number | string> {
    const used = this.bedsUsed(i);
    const adm = this.admitted.get(i) ?? { ambulance: 0, heli: 0 };
    const problem = this.hospitalProblem(i);
    return {
      patients: used,
      beds: `${used} / ${b.capacity}`,
      byAmbulance: adm.ambulance,
      byHelicopter: adm.heli,
      ambulancesOnStandby: this.vehicles.filter((v) => v.kind === VehicleKind.Ambulance && v.mission === 'none' && v.cell === b.entrance).length,
      status: problem ? `Diverting (${problem})` : 'Accepting patients',
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
