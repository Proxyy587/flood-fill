import type { Voxel, VoxelModel } from "./types";
import { NpcRole } from "../../contracts";
import { ROLE_PALETTE } from "../palette";

/**
 * Creates a compact voxel human figure (<= 12 voxels) colored according to their emergency or civic role.
 * Size: [1, 3, 1] voxels (Width=1, Height=3, Depth=1).
 */
export function createPerson(name: string, role: NpcRole, skinColor = "#e0ac69"): VoxelModel {
  const uniformColor = ROLE_PALETTE[role];
  const voxels: Voxel[] = [
    // Legs (y = 0)
    { x: 0, y: 0, z: 0, color: "#2d3436" }, // pants/shoes
    // Torso (y = 1)
    { x: 0, y: 1, z: 0, color: uniformColor }, // role uniform
    // Head / Face (y = 2)
    { x: 0, y: 2, z: 0, color: skinColor }, // face
  ];

  return {
    name,
    size: [1, 3, 1],
    voxels,
    pivot: [0, 0, 0],
  };
}

export function createAllPeople(): VoxelModel[] {
  return [
    createPerson("person_civilian", NpcRole.Civilian),
    createPerson("person_driver", NpcRole.Driver),
    createPerson("person_police", NpcRole.Police),
    createPerson("person_boat_operator", NpcRole.BoatOperator),
    createPerson("person_paramedic", NpcRole.Paramedic),
    createPerson("person_doctor", NpcRole.Doctor),
    createPerson("person_nurse", NpcRole.Nurse),
    createPerson("person_hospital_staff", NpcRole.HospitalStaff),
    createPerson("person_pilot", NpcRole.Pilot),
    createPerson("person_dispatcher", NpcRole.Dispatcher),
  ];
}
