export type Brand<T, B extends string> = T & { readonly __brand: B };
export type NpcId = Brand<number, "Npc">;
export type VehicleId = Brand<number, "Vehicle">;
export type BuildingId = Brand<number, "Building">;
export type RequestId = Brand<number, "Request">;

export enum BlockType {
  Grass, Dirt, Sand, Rock, Road, Bridge, Tree, Drainage, WaterSource,
  House, Apartment, Office, Shop, Hospital, PoliceStation, FloodHQ, BoatDepot,
  FireStation, Shelter, Helipad, PowerPlant, Substation, Pole, Levee,
}
export enum NpcRole { Civilian, Driver, Police, BoatOperator, Paramedic, Doctor, Nurse, HospitalStaff, Pilot, Dispatcher }
export enum NpcState { AtHome, Commute, Work, ReturnHome, Warned, Evacuate, ShelterInPlace, SeekHelp, Stranded, Respond, Rest }
export enum VehicleKind { Car, Bus, Ambulance, PoliceCar, Boat, Helicopter }
export enum VehicleState { Idle, Moving, Loading, Unloading, Failed, Grounded, Refuelling }
export enum ReportStatus { Unverified, Verified, Resolved, False }
export type DispatchMode = "negotiation" | "centralised";

export type InjectedEvent =
  | { kind: "bridge_closed" | "road_blocked_by_debris"; tick: number; cell: number }
  | { kind: "boat_failure"; tick: number; vehicleId: VehicleId }
  | { kind: "shelter_overflow"; tick: number; buildingId: BuildingId }
  | { kind: "substation_flooded"; tick: number; nodeId: number }
  | { kind: "false_report"; tick: number; cell: number; confidence: number }
  | { kind: "comms_outage"; tick: number; durationTicks: number }
  | { kind: "helicopter_grounded_wind"; tick: number; speed: number; durationTicks: number };

export interface BuildingDef {
  id: BuildingId; type: BlockType; cells: number[]; capacity: number;
  entrance: number; floorHeight: number;
  generator?: { fuelTicks: number }; helipad?: boolean; powerNode?: number;
}
export interface PopulationDef {
  count: number; mix: { carOwners: number; limitedMobility: number; needsAssist: number };
  schedule: "office-hours" | "night" | "custom";
}
export interface FleetDef {
  ambulances: number; policeCars: number; boats: number; helicopters: number;
  doctors: number; nurses: number; policeOfficers: number; boatOperators: number;
}
export interface WeatherDef {
  rain: { t: number; intensity: number }[]; wind: { t: number; speed: number }[];
  floodKind: "growing" | "flash" | "compound";
  sources: { cell: number; startT: number; endT: number; rate: number }[];
  warningDelay: number;
}
export interface PowerNode {
  id: number; kind: "plant" | "substation" | "load"; cell: number; building?: BuildingId;
}
export interface Scenario {
  schemaVersion: 1; name: string; size: { w: number; h: number };
  ground: number[]; blocks: number[]; buildings: BuildingDef[];
  districts: { id: number; name: string; cells: number[] }[];
  population: PopulationDef; fleet: FleetDef; weather: WeatherDef;
  injected: InjectedEvent[]; powerGrid: { nodes: PowerNode[]; edges: [number, number][] };
  defaults: { dispatchMode: DispatchMode; seed: number };
}
export interface NpcParams {
  panicMean: number; complianceMean: number; riskToleranceMean: number;
  altruismMean: number; awarenessMean: number; carOwnership: number; warningDelay: number;
  falseReportRate: number; commsDelay: number; staffFatigueRate: number;
}
// PatchCommand excludes applyPatch to prevent recursive/unbounded patch execution.
export type PatchCommand =
  | { kind: "setBlock"; cell: number; block: BlockType; variant?: number }
  | { kind: "paintRect"; x0: number; z0: number; x1: number; z1: number; block: BlockType }
  | { kind: "setHeight"; cell: number; ground: number }
  | { kind: "placeBuilding"; def: Omit<BuildingDef, "id"> }
  | { kind: "removeAt"; cell: number }
  | { kind: "setPowerEdge"; a: number; b: number; on: boolean };
export type EditCommand = PatchCommand | { kind: "applyPatch"; patch: ScenarioPatch };
export interface ScenarioPatch { title: string; rationale: string; commands: PatchCommand[]; estimatedCost: number }

export const SIM_EVENT_TYPES = [
  "RUN_STARTED", "RUN_FINISHED",
  "WEATHER", "FLOOD_THRESHOLD", "ROAD_CLOSED", "ROAD_REOPENED", "BRIDGE_OVERTOPPED",
  "REPORT_CREATED", "REPORT_VERIFIED", "REPORT_FALSE", "REQUEST_CREATED", "BID",
  "ASSIGNED", "COMMIT_CANCELLED", "REROUTE", "SERVED", "HOSPITAL_ASSIGN", "HOSPITAL_DIVERT",
  "HOSPITAL_DIVERSION_ON", "SHELTER_OVERFLOW", "POWER_TRIP", "POWER_RESTORED", "BLACKOUT_ZONE",
  "GENERATOR_START", "GENERATOR_FUEL_LOW", "GENERATOR_EXHAUSTED", "SIGNAL_DARK", "GRIDLOCK",
  "VEHICLE_STALLED", "EVAC_ORDER", "NPC_STRANDED", "HELI_DISPATCH", "HELI_PICKUP",
  "HELI_DROPOFF", "HELI_GROUNDED", "HELI_GROUNDED_WIND", "ROOFTOP_RESCUE", "MEDEVAC",
  "INJECTED", "INVARIANT_VIOLATION",
] as const;
export type SimEventType = typeof SIM_EVENT_TYPES[number];
export interface SimEvent {
  tick: number; type: SimEventType; actor?: NpcId | VehicleId | BuildingId;
  target?: NpcId | VehicleId | BuildingId | RequestId; cell?: number;
  data?: Record<string, number | string | boolean>; reason: string;
}
export interface RenderSnapshot {
  tick: number; water: Float32Array; powered: Uint8Array;
  npcs: { id: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array; role: Uint8Array; state: Uint8Array };
  vehicles: { id: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array; kind: Uint8Array; state: Uint8Array };
  reports: { x: Float32Array; z: Float32Array; confidence: Float32Array; status: Uint8Array };
  dirtyChunks: number[];
}
export type EntitySelection =
  | { id: NpcId; kind: "npc" }
  | { id: VehicleId; kind: "vehicle" }
  | { id: BuildingId; kind: "building" }
  | { id: number; kind: "cell" };
export type InspectorData = EntitySelection & {
  title: string;
  attributes: Record<string, number | string>;
  assignment?: { requestId: RequestId; status: string; eta: number };
  route?: { cells: number[]; version: number };
  belief?: { knownClosures: number[]; staleness: number };
  lastDecision?: { tick: number; chosen: string; alternatives: { label: string; score: number }[]; reason: string };
}
export interface MetricsFrame {
  tick: number; tts: { mean: number; p50: number; p90: number }; unmet: number;
  idleFrac: Record<string, number>; gini: number;
  hospitals: { id: BuildingId; util: number; diversion: boolean; onGenerator: boolean }[];
  evacDonePct: number; stranded: number; gridlockCells: number;
  floodedCells: number; maxDepth: number; unpoweredPopPct: number;
  heliRescues: number; routeViolations: number;
}
export interface RunSummary {
  scenario: string; seed: number; mode: DispatchMode;
  metrics: MetricsFrame[]; events: SimEvent[];
  hotspots: { kind: "gridlock" | "isolated" | "hospital_overload" | "power"; cells: number[]; score: number }[];
}
export interface RunOptions { durationTicks?: number; metricsEvery?: number }
export type MainToWorker =
  | { kind: "load"; scenario: Scenario; seed: number; options?: RunOptions }
  | { kind: "play" | "pause" | "step" | "exportLog" }
  | { kind: "setSpeed"; speed: 1 | 4 | 16 }
  | { kind: "edit"; command: EditCommand }
  | { kind: "inject"; event: InjectedEvent }
  | { kind: "setNpcParams"; params: NpcParams }
  | { kind: "setDispatchMode"; mode: DispatchMode }
  | { kind: "seek"; tick: number }
  | ({ kind: "inspect" } & (
      | { id: NpcId; entityKind: "npc" }
      | { id: VehicleId; entityKind: "vehicle" }
      | { id: BuildingId; entityKind: "building" }
      | { id: number; entityKind: "cell" }));
export type WorkerToMain =
  | { kind: "snapshot"; snapshot: RenderSnapshot }
  | { kind: "events"; events: SimEvent[] }
  | { kind: "metrics"; metrics: MetricsFrame }
  | { kind: "done"; summary: RunSummary }
  | { kind: "inspector"; inspector: InspectorData }
  | { kind: "error"; message: string };
