import type { BlockType } from './blocks';
import type { BuildingId } from './ids';

/** Shared display/physics scale: rain intensity 1.0 represents a 150 mm/h cloudburst. */
export const RAIN_MM_PER_HOUR_AT_FULL = 150;

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
  /** Explicit deck heights (voxels); bridge cells not listed use `bridgeDeckHeights`. */
  bridges?: { cell: number; deckHeight: number }[];
  /** For fairness metrics. */
  districts: { id: number; name: string; cells: number[] }[];
  /**
   * Named flood-prone spots (synthetic, or digitised from observed
   * waterlogging). Engines that do not model them ignore them.
   */
  hotspots?: Hotspot[];
  population: PopulationDef;
  fleet: FleetDef;
  weather: WeatherDef;
  injected: InjectedEvent[];
  powerGrid: { nodes: PowerNode[]; edges: [number, number][] };
  defaults: { dispatchMode: DispatchMode; seed: number };
}

/**
 * 'waterlogging': low streets that pond in heavy rain. 'landslide': a hill
 * road cut that can slide once the slope is saturated. 'levee': a weak
 * levee section that can breach when the river stays high against it.
 */
export type HotspotKind = 'waterlogging' | 'landslide' | 'levee';

export interface Hotspot {
  name: string;
  kind: HotspotKind;
  cells: number[];
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
  /** Required when `schedule` is 'custom'. Seconds of the day / ticks at work. */
  customSchedule?: { departAt: number; workTicks: number };
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
  | 'helicopter_grounded_wind'
  | 'rescue_teams_deployed';

/** From docs/SIM_SPEC.md §4. `t` is the tick the event fires at. */
export interface InjectedEvent {
  t: number;
  kind: InjectedEventKind;
  cell?: number;
  /** Vehicle, building or power-node id, depending on `kind`. */
  target?: number;
  durationTicks?: number;
  /** `false_report`: the report's stated confidence, 0..1. */
  confidence?: number;
  /** `helicopter_grounded_wind`: gust speed, normalised 0..1 like `WeatherDef.wind`. */
  speed?: number;
  /** `rescue_teams_deployed`: number of boat teams released. */
  count?: number;
}
