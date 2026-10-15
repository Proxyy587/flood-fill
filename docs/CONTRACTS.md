# CONTRACTS

These are the **draft** shared types. AK and AJ finalise them in hour 0–2 and freeze them into `src/contracts/*.ts` (with Zod schemas alongside). Everyone else codes against them, using mocks until the sim exists.

```ts
// ---------- ids ----------
export type Brand<T, B> = T & { readonly __brand: B };
export type NpcId = Brand<number, 'Npc'>;
export type VehicleId = Brand<number, 'Vehicle'>;
export type BuildingId = Brand<number, 'Building'>;
export type RequestId = Brand<number, 'Request'>;

// ---------- blocks ----------
export enum BlockType {
  Grass, Dirt, Sand, Rock, Road, Bridge, Tree, Drainage, WaterSource,
  House, Apartment, Office, Shop,
  Hospital, PoliceStation, FloodHQ, BoatDepot, FireStation, Shelter, Helipad,
  PowerPlant, Substation, Pole, Levee,
}

// ---------- scenario (JSON on disk) ----------
export interface Scenario {
  schemaVersion: 1;
  name: string;
  size: { w: number; h: number };          // cells
  ground: number[];                        // w*h, voxel heights (RLE-compressible)
  blocks: number[];                        // w*h, BlockType
  buildings: BuildingDef[];
  districts: { id: number; name: string; cells: number[] }[]; // for fairness metrics
  population: PopulationDef;
  fleet: FleetDef;
  weather: WeatherDef;
  injected: InjectedEvent[];
  powerGrid: { nodes: PowerNode[]; edges: [number, number][] };
  defaults: { dispatchMode: 'negotiation' | 'centralised'; seed: number };
}

export interface BuildingDef {
  id: BuildingId; type: BlockType; cells: number[];
  capacity: number;                 // beds / residents / seats
  entrance: number;                 // cell index
  floorHeight: number;              // flood-entry height
  generator?: { fuelTicks: number };
  helipad?: boolean;
  powerNode?: number;
}

export interface PopulationDef {
  count: number;
  mix: { carOwners: number; limitedMobility: number; needsAssist: number };
  schedule: 'office-hours' | 'night' | 'custom';
}

export interface FleetDef {
  ambulances: number; policeCars: number; boats: number; helicopters: number;
  doctors: number; nurses: number; policeOfficers: number; boatOperators: number;
}

export interface WeatherDef {
  rain: { t: number; intensity: number }[];   // piecewise-linear, intensity 0..1
  wind: { t: number; speed: number }[];
  floodKind: 'growing' | 'flash' | 'compound';
  sources: { cell: number; startT: number; endT: number; rate: number }[];
  warningDelay: number;                        // ticks after hazard onset
}

export interface PowerNode {
  id: number; kind: 'plant' | 'substation' | 'load'; cell: number; building?: BuildingId;
}

// ---------- sliders ----------
export interface NpcParams {
  panicMean: number; complianceMean: number; riskToleranceMean: number;
  altruismMean: number; awarenessMean: number;
  carOwnership: number; warningDelay: number;
  falseReportRate: number; commsDelay: number; staffFatigueRate: number;
}

// ---------- editor ----------
export type EditCommand =
  | { kind: 'setBlock'; cell: number; block: BlockType; variant?: number }
  | { kind: 'paintRect'; x0: number; z0: number; x1: number; z1: number; block: BlockType }
  | { kind: 'setHeight'; cell: number; ground: number }
  | { kind: 'placeBuilding'; def: Omit<BuildingDef, 'id'> }
  | { kind: 'removeAt'; cell: number }
  | { kind: 'setPowerEdge'; a: number; b: number; on: boolean }
  | { kind: 'applyPatch'; patch: ScenarioPatch };   // from the AI critic

export interface ScenarioPatch {
  title: string; rationale: string;
  commands: EditCommand[];
  estimatedCost: number;                 // abstract units
}

// ---------- events (the append-only log) ----------
export type SimEventType =
  | 'WEATHER' | 'FLOOD_THRESHOLD' | 'ROAD_CLOSED' | 'ROAD_REOPENED' | 'BRIDGE_OVERTOPPED'
  | 'REPORT_CREATED' | 'REPORT_VERIFIED' | 'REPORT_FALSE'
  | 'REQUEST_CREATED' | 'BID' | 'ASSIGNED' | 'COMMIT_CANCELLED' | 'REROUTE' | 'SERVED'
  | 'HOSPITAL_ASSIGN' | 'HOSPITAL_DIVERT' | 'HOSPITAL_DIVERSION_ON' | 'SHELTER_OVERFLOW'
  | 'POWER_TRIP' | 'POWER_RESTORED' | 'BLACKOUT_ZONE' | 'GENERATOR_START' | 'GENERATOR_FUEL_LOW' | 'GENERATOR_EXHAUSTED' | 'SIGNAL_DARK'
  | 'GRIDLOCK' | 'VEHICLE_STALLED' | 'EVAC_ORDER' | 'NPC_STRANDED'
  | 'HELI_DISPATCH' | 'HELI_PICKUP' | 'HELI_DROPOFF' | 'HELI_GROUNDED' | 'ROOFTOP_RESCUE' | 'MEDEVAC'
  | 'INJECTED' | 'INVARIANT_VIOLATION';

export interface SimEvent {
  tick: number;
  type: SimEventType;
  actor?: NpcId | VehicleId | BuildingId;
  target?: NpcId | VehicleId | BuildingId | RequestId;
  cell?: number;
  data?: Record<string, number | string | boolean>;
  reason: string;                  // human-readable, REQUIRED for decisions
}

// ---------- render snapshot (worker → main, transferable) ----------
export interface RenderSnapshot {
  tick: number;
  water: Float32Array;             // w*h depth
  powered: Uint8Array;             // w*h
  npcs:   { id: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array; role: Uint8Array; state: Uint8Array };
  vehicles: { id: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array; kind: Uint8Array; state: Uint8Array };
  reports: { x: Float32Array; z: Float32Array; confidence: Float32Array; status: Uint8Array };
  dirtyChunks: number[];           // terrain chunks to rebuild (edits)
}

// ---------- inspector (on demand) ----------
export interface InspectorData {
  id: number; kind: 'npc' | 'vehicle' | 'building' | 'cell';
  title: string;
  attributes: Record<string, number | string>;
  assignment?: { requestId: RequestId; status: string; eta: number };
  route?: { cells: number[]; version: number };
  belief?: { knownClosures: number[]; staleness: number };
  lastDecision?: { tick: number; chosen: string; alternatives: { label: string; score: number }[]; reason: string };
}

// ---------- metrics ----------
export interface MetricsFrame {
  tick: number;
  tts: { mean: number; p50: number; p90: number };
  unmet: number;
  idleFrac: Record<string, number>;
  gini: number;
  hospitals: { id: BuildingId; util: number; diversion: boolean; onGenerator: boolean }[];
  evacDonePct: number; stranded: number; gridlockCells: number;
  floodedCells: number; maxDepth: number; unpoweredPopPct: number;
  heliRescues: number;
  routeViolations: number;
}

export interface RunSummary {
  scenario: string; seed: number; mode: 'negotiation' | 'centralised';
  metrics: MetricsFrame[]; events: SimEvent[];
  hotspots: { kind: 'gridlock' | 'isolated' | 'hospital_overload' | 'power'; cells: number[]; score: number }[];
}
```

## Change process
1. Open a line in `docs/REQUESTS.md`.
2. AK or AJ approves.
3. Update the type, the Zod schema, the mocks and `docs/CHANGELOG.md` in one commit.

## Mocks
Each consumer ships a mock in `src/contracts/mocks/` so work can start before the sim exists: `mockScenario()`, `mockSnapshotStream()`, `mockEvents()`, `mockRunSummary()`.

## Planned extension: bounded decisions and decision tape (2026-10-15)

**Design proposal only.** These fields do not currently exist in `src/contracts`. AK/AJ must review a coherent types + Zod + mocks + changelog change before consumers implement them. See [LAYA_MIGRATION_PLAN.md](LAYA_MIGRATION_PLAN.md).

| Proposed surface | Required information |
|---|---|
| Decision configuration | Policy (`rules`, `laya-shadow`, `laya-assisted`, or recorded replay), policy version, allowed decision classes, batching/cooldown/budget, eligibility/calibration policy, timing mode |
| Decision request | Run/episode identity, unique request ID, agent reference using existing branded IDs, origin/expiry ticks, observation/candidate hashes and schema version, navigation/resource versions, permitted belief observation, stable feasible candidate IDs and evidence |
| Decision result | Matching request/run/version identity, selected candidate ID or abstention, finite per-candidate probabilities, raw confidence fields with defined semantics, checkpoint/runtime/calibration revision, truncation/error/usage metadata |
| Decision record | Request identity and reproducible observation/candidate data, provider proposal, gate outcome, rejected/accepted alternatives, committed action or fallback, applied tick and reason |
| Versioned run archive | Scenario and seed, simulator/policy versions, injected inputs, decision tape, events/metrics, timing mode, model configuration and aggregate inference/cost usage |

Worker protocol additions must carry decision requests out and validated results in; they do not carry unrestricted executable commands. Simulation-side admission validates candidate membership, run generation, expiry, freshness, and current resource availability. Duplicate/late replies have no effects. Provider response types are translated at the adapter boundary rather than leaking an SDK throughout the app.

`dispatchMode` keeps its current negotiation/centralised meaning. Decision configuration is separate and optional, with a rules-only default. Old scenarios and archives remain loadable; old archives without tapes cannot be relabelled as reproducible assisted runs. A new archive/schema version must have an explicit migration path rather than silently changing `Scenario.schemaVersion: 1` semantics.

The current `SimEvent.data` accepts primitives, not nested probability arrays. Do not force a new decision record into that map with casts. Store detailed records in the tape and reference their decision ID from events; final event names and inspector extensions are part of the reviewed contract change. Existing safety events and `lastDecision` remain meaningful to older consumers.
