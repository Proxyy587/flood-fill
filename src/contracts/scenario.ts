import type { BlockType } from './blocks';
import type { BuildingId } from './ids';

export type DispatchMode = 'negotiation' | 'centralised';

export interface Scenario {
  schemaVersion: 1;
  name: string;
  /** Cells. */
  size: { w: number; h: number };
  /** w*h voxel heights. */
  ground: number[];
  /** w*h `BlockType`. */
  blocks: number[];
  buildings: BuildingDef[];
  /** For fairness metrics. */
  districts: { id: number; name: string; cells: number[] }[];
  population: PopulationDef;
  fleet: FleetDef;
  weather: WeatherDef;
  injected: InjectedEvent[];
  powerGrid: { nodes: PowerNode[]; edges: [number, number][] };
  defaults: { dispatchMode: DispatchMode; seed: number };
}

export interface BuildingDef {
  id: BuildingId;
  type: BlockType;
  cells: number[];
  /** Beds / residents / seats. */
  capacity: number;
  /** Cell index. */
  entrance: number;
  /** Flood-entry height. */
  floorHeight: number;
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
  ambulances: number;
  policeCars: number;
  boats: number;
  helicopters: number;
  doctors: number;
  nurses: number;
  policeOfficers: number;
  boatOperators: number;
}

export interface WeatherDef {
  /** Piecewise-linear, intensity 0..1. */
  rain: { t: number; intensity: number }[];
  wind: { t: number; speed: number }[];
  floodKind: 'growing' | 'flash' | 'compound';
  sources: { cell: number; startT: number; endT: number; rate: number }[];
  /** Ticks after hazard onset. */
  warningDelay: number;
}

export interface PowerNode {
  id: number;
  kind: 'plant' | 'substation' | 'load';
  cell: number;
  building?: BuildingId;
}

export type InjectedEventKind =
  | 'bridge_closed'
  | 'boat_failure'
  | 'shelter_overflow'
  | 'substation_flooded'
  | 'road_blocked_by_debris'
  | 'false_report'
  | 'comms_outage'
  | 'helicopter_grounded_wind';

/** From docs/SIM_SPEC.md §4. `t` is the tick the event fires at. */
export interface InjectedEvent {
  t: number;
  kind: InjectedEventKind;
  cell?: number;
  /** Vehicle, building or power-node id, depending on `kind`. */
  target?: number;
  durationTicks?: number;
}
