# CONTRACTS

## Frozen M0 surface (2026-10-15, AK approval)

`src/contracts/types.ts` and `src/contracts/schemas.ts` are authoritative.
Import from `src/contracts` (or `src/contracts/messages` for worker messages).
Use `src/contracts/mocks` for explicitly labelled synthetic consumer fixtures.
The original draft below is retained as design history, not as a second type source.

Decisions frozen by AK:

- IDs are branded positive Int32-compatible numbers; cell indices may be zero.
  Integer snapshot IDs must be unique within their entity table. `EntitySelection`
  and inspector responses distinguish entity IDs from cell indices.
- BlockType retains the draft ordinal order. NpcRole, NpcState, VehicleKind,
  VehicleState and ReportStatus define snapshot integer encodings.
- `InjectedEvent` uses kind, tick and concrete targets. Weather sources use
  half-open `[startT,endT)` intervals. Power edges are undirected.
- Worker envelopes use `kind` and named payloads (`scenario`, `snapshot`, `metrics`,
  `summary`, `command`, `event`, `params`). MainToWorker includes step and inspect.
  WorkerToMain includes inspector and error responses. AJ owns the browser adapter.
- RunOptions has durationTicks (runner default 600; max 86400) and metricsEvery
  (default 10). One simulation tick is one second; speed is wall-time only.
- Patches contain only PatchCommand, excluding recursive applyPatch. Context-free
  command validation checks shape, building kind, unique footprint and entrance;
  command application must also check bounds, overlap, adjacency, cost and the
  critic whitelist against the current scenario.
- Scenario validation rejects wrong lengths, invalid ranges/versions, overlapping
  buildings/districts, unresolved power references and bad weather order. An entrance
  is inside its footprint; blocks agree with footprints. Optional building.powerNode
  references a node pointing back to that building.
- HELI_GROUNDED_WIND is included, matching the earlier changelog promise.
- RUN_STARTED/RUN_FINISHED delimit headless logs. The start event declares implemented
  capabilities so foundation metrics cannot be mistaken for dispatch evidence.
- Fleet IDs allocate contiguous positive ranges: ambulances, police cars, boats,
  helicopters, then civilian cars. A boat_failure target must be inside the boat
  range. The current foundation runner rejects unimplemented injected actions.
- Fleet allocation includes Math.round(population.count * mix.carOwners) civilian
  cars; total vehicles are capped at 10000 and total fleet staff at 10000. This
  bounds allocation and keeps every generated ID representable. Population.count
  counts civilians; staff are additional NPCs. runBatch accepts up to 1000 seeds
  and validates every entry, including sparse arrays, before any run starts.
- Existing Scenario/RenderSnapshot/MetricsFrame/RunSummary fields remain. Missing
  district TTS/recovery and UI metric data are tracked in REQUESTS.md.
- Building-type tiles require matching BuildingDef records (both directions).
  Floor heights are 0..255m. Source rates are 0..1000m/tick with at most 16384
  sources; these synthetic bounds preserve Float32 headroom over supported runs.

Health gate: `pnpm test src/contracts/contracts.test.ts`, `pnpm typecheck`, `pnpm lint`.

## Historical draft

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
