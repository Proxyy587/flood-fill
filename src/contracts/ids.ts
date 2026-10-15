export type Brand<T, B> = T & { readonly __brand: B };

export type NpcId = Brand<number, 'Npc'>;
export type VehicleId = Brand<number, 'Vehicle'>;
export type BuildingId = Brand<number, 'Building'>;
export type RequestId = Brand<number, 'Request'>;

export const asNpcId = (n: number): NpcId => n as NpcId;
export const asVehicleId = (n: number): VehicleId => n as VehicleId;
export const asBuildingId = (n: number): BuildingId => n as BuildingId;
export const asRequestId = (n: number): RequestId => n as RequestId;

export type EntityKind = 'npc' | 'vehicle' | 'building' | 'cell';

/** Addresses anything the user can select. For `cell`, `id` is the cell index `z * W + x`. */
export interface EntityRef {
  kind: EntityKind;
  id: number;
}

export const sameEntity = (a: EntityRef | null, b: EntityRef | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);
