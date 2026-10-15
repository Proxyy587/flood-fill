// Enum values carried in the RenderSnapshot `Uint8Array` columns.
// Append only: the numeric values cross the worker boundary.

export enum NpcRole {
  Civilian,
  Driver,
  Police,
  BoatOperator,
  Paramedic,
  Doctor,
  Nurse,
  HospitalStaff,
  Pilot,
  Dispatcher,
}

export enum NpcState {
  Idle,
  AtHome,
  Commuting,
  Working,
  ReturningHome,
  Warned,
  Evacuating,
  Sheltering,
  SeekingHelp,
  Stranded,
  Rescued,
  OnDuty,
}

export enum VehicleKind {
  Car,
  Bus,
  Ambulance,
  PoliceCar,
  Boat,
  Helicopter,
}

export enum VehicleState {
  Parked,
  Driving,
  Responding,
  Transporting,
  Stalled,
  Returning,
  Landed,
  Flying,
  Grounded,
}

export enum ReportStatus {
  Unverified,
  Verified,
  Resolved,
  False,
}

/** Value of `RenderSnapshot.powered[i]` and of the world `power` array. */
export enum PowerState {
  Off = 0,
  Grid = 1,
  Generator = 2,
}

export const NPC_ROLE_COUNT = NpcRole.Dispatcher + 1;
export const VEHICLE_KIND_COUNT = VehicleKind.Helicopter + 1;
