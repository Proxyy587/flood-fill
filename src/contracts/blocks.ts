export enum BlockType {
  Grass,
  Dirt,
  Sand,
  Rock,
  Road,
  Bridge,
  Tree,
  Drainage,
  WaterSource,
  House,
  Apartment,
  Office,
  Shop,
  Hospital,
  PoliceStation,
  FloodHQ,
  BoatDepot,
  FireStation,
  Shelter,
  Helipad,
  PowerPlant,
  Substation,
  Pole,
  Levee,
}

export const BLOCK_TYPE_COUNT = BlockType.Levee + 1;

export const ALL_BLOCK_TYPES: readonly BlockType[] = Array.from(
  { length: BLOCK_TYPE_COUNT },
  (_, i) => i as BlockType,
);
