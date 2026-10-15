import type { VoxelModel } from "./types";
import {
  createHouseV1,
  createHouseV2,
  createApartment,
  createOffice,
  createShop,
  createHospital,
  createPoliceStation,
  createFloodHQ,
  createBoatDepot,
  createShelter,
  createHelipad,
  createSubstation,
  createPowerPlant,
  createDrainage,
  createTreeV1,
  createTreeV2,
  createLevee,
} from "./buildings";
import {
  createCar,
  createBus,
  createAmbulance,
  createPoliceCar,
  createBoat,
  createHelicopter,
  createHelicopterRotor,
} from "./vehicles";
import { createAllPeople } from "./people";

export * from "./types";
export * from "./preview";
export * from "./buildings";
export * from "./vehicles";
export * from "./people";

const allModelsList: VoxelModel[] = [
  // Buildings
  createHouseV1(),
  createHouseV2(),
  createApartment(),
  createOffice(),
  createShop(),
  createHospital(),
  createPoliceStation(),
  createFloodHQ(),
  createBoatDepot(),
  createShelter(),
  createHelipad(),
  createSubstation(),
  createPowerPlant(),
  createDrainage(),
  createTreeV1(),
  createTreeV2(),
  createLevee(),
  // Vehicles
  createCar("car_red", "#e74c3c"),
  createCar("car_blue", "#3498db"),
  createCar("car_yellow", "#f1c40f"),
  createBus(),
  createAmbulance(),
  createPoliceCar(),
  createBoat(),
  createHelicopter(),
  createHelicopterRotor(),
  // People
  ...createAllPeople(),
];

export const MODELS: Record<string, VoxelModel> = Object.fromEntries(
  allModelsList.map((m) => [m.name, m])
);

export function getModel(name: string): VoxelModel {
  const model = MODELS[name];
  if (!model) {
    throw new Error(`VoxelModel "${name}" not found. Available models: ${Object.keys(MODELS).join(", ")}`);
  }
  return model;
}
