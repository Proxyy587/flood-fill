import type { BuildingId, NpcId, RequestId, VehicleId } from './ids';

export const SIM_EVENT_TYPES = [
  'WEATHER',
  'FLOOD_THRESHOLD',
  /** Rainfall ponding in a local hollow (pluvial flooding), independent of the river. */
  'LOCAL_FLOOD',
  'ROAD_CLOSED',
  'ROAD_REOPENED',
  'BRIDGE_OVERTOPPED',
  'REPORT_CREATED',
  'REPORT_VERIFIED',
  'REPORT_FALSE',
  'REQUEST_CREATED',
  'BID',
  'ASSIGNED',
  'COMMIT_CANCELLED',
  'REROUTE',
  'SERVED',
  'HOSPITAL_ASSIGN',
  'HOSPITAL_DIVERT',
  'HOSPITAL_DIVERSION_ON',
  'SHELTER_OVERFLOW',
  'POWER_TRIP',
  'POWER_RESTORED',
  'BLACKOUT_ZONE',
  'GENERATOR_START',
  'GENERATOR_FUEL_LOW',
  'GENERATOR_EXHAUSTED',
  'SIGNAL_DARK',
  'GRIDLOCK',
  'VEHICLE_STALLED',
  'EVAC_ORDER',
  'NPC_STRANDED',
  'HELI_DISPATCH',
  'HELI_PICKUP',
  'HELI_DROPOFF',
  'HELI_GROUNDED',
  'HELI_GROUNDED_WIND',
  'ROOFTOP_RESCUE',
  'MEDEVAC',
  'INJECTED',
  'INVARIANT_VIOLATION',
  /** The river is above a storm-drain outfall, so unpumped drains back up instead of emptying. */
  'DRAIN_BACKFLOW',
  /** Water rose above the floor of homes in a district (aggregated). */
  'HOMES_FLOODED',
  /** Extra rescue teams (boats and crews) released into the city. */
  'TEAMS_DEPLOYED',
] as const;

export type SimEventType = (typeof SIM_EVENT_TYPES)[number];

export type EventActorKind = 'npc' | 'vehicle' | 'building';
export type EventTargetKind = EventActorKind | 'request';

export interface SimEvent {
  tick: number;
  type: SimEventType;
  actor?: NpcId | VehicleId | BuildingId;
  /** Set whenever `actor` is, so consumers can build an `EntityRef` (ids are only unique per kind). */
  actorKind?: EventActorKind;
  target?: NpcId | VehicleId | BuildingId | RequestId;
  targetKind?: EventTargetKind;
  cell?: number;
  data?: Record<string, number | string | boolean>;
  /** Human-readable, REQUIRED for decisions. */
  reason: string;
}
