import { BlockType, NpcRole, VehicleKind } from "../contracts";

export interface BlockMetadata {
  name: string;
  icon: string;
  category: "terrain" | "transport" | "residential" | "commercial" | "emergency" | "utility" | "defense";
  heightVoxels: number;
  walkable: boolean;
  drivable: boolean;
  solid: boolean;
}

/**
 * Deterministic color variation function for voxel surfaces.
 * Returns a value in [-0.04, 0.04] based on cellIndex to add subtle texture without noise dependencies.
 */
export function variation(cellIndex: number): number {
  // Simple deterministic integer hash mapped to [-0.04, 0.04]
  let h = (cellIndex ^ 0x9e3779b9) * 0x85ebca6b;
  h = (h ^ (h >>> 13)) * 0xc2b2ae35;
  h = (h ^ (h >>> 16)) >>> 0;
  // Map uint32 [0, 0xffffffff] to [-0.04, 0.04]
  return (h / 0xffffffff) * 0.08 - 0.04;
}

/**
 * Helper to adjust a hex color by a fractional brightness delta [-1.0, 1.0].
 */
export function adjustHexBrightness(hex: string, delta: number): string {
  const cleanHex = hex.replace("#", "");
  const num = parseInt(cleanHex, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;

  const factor = 1 + delta;
  r = Math.min(255, Math.max(0, Math.round(r * factor)));
  g = Math.min(255, Math.max(0, Math.round(g * factor)));
  b = Math.min(255, Math.max(0, Math.round(b * factor)));

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Base hex colors for every BlockType.
 */
export const BLOCK_PALETTE: Record<BlockType, string> = {
  [BlockType.Grass]: "#5b8c3b",
  [BlockType.Dirt]: "#86654b",
  [BlockType.Sand]: "#d8cb94",
  [BlockType.Rock]: "#7a8288",
  [BlockType.Road]: "#3a3d40",
  [BlockType.Bridge]: "#6d747a",
  [BlockType.Tree]: "#2f5c24",
  [BlockType.Drainage]: "#4f5860",
  [BlockType.WaterSource]: "#2c6ca8",
  [BlockType.House]: "#c26d53",
  [BlockType.Apartment]: "#b59b7c",
  [BlockType.Office]: "#4f728c",
  [BlockType.Shop]: "#cc9a3b",
  [BlockType.Hospital]: "#e8ecef",
  [BlockType.PoliceStation]: "#2b4b7c",
  [BlockType.FloodHQ]: "#324353",
  [BlockType.BoatDepot]: "#3d647a",
  [BlockType.FireStation]: "#b83b32",
  [BlockType.Shelter]: "#3e825a",
  [BlockType.Helipad]: "#4a525a",
  [BlockType.PowerPlant]: "#63584e",
  [BlockType.Substation]: "#787268",
  [BlockType.Pole]: "#5a5045",
  [BlockType.Levee]: "#8c7d6b",
};

/**
 * Returns block color with deterministic subtle brightness variation per cell.
 */
export function getBlockColor(type: BlockType, cellIndex?: number): string {
  const base = BLOCK_PALETTE[type];
  if (cellIndex === undefined) return base;
  return adjustHexBrightness(base, variation(cellIndex));
}

/**
 * Water depth colors categorized by safety and operational thresholds:
 * - shallow: < 0.3m (drivable for cars)
 * - medium: 0.3m - 0.6m (cars stall, trucks/ambulances passable, foot unsafe)
 * - deep: 0.6m - 1.2m (boats operational, cars/foot submerged)
 * - torrential: > 1.2m (extreme flood risk)
 */
export const WATER_PALETTE = {
  shallow: "#5aa0d8",     // Translucent cyan-blue
  medium: "#3b80bf",      // Mid blue
  deep: "#245f9e",        // Deep naval blue
  torrential: "#133f73",  // Dark turbulent blue
  foam: "#e6f2ff",        // Surface foam/whitecap
};

export function getWaterColorForDepth(depthMeters: number): string {
  if (depthMeters <= 0.05) return WATER_PALETTE.shallow;
  if (depthMeters <= 0.3) return WATER_PALETTE.shallow;
  if (depthMeters <= 0.6) return WATER_PALETTE.medium;
  if (depthMeters <= 1.2) return WATER_PALETTE.deep;
  return WATER_PALETTE.torrential;
}

/**
 * Power-off tint multiplier to darken/desaturate unpowered buildings and blacked-out zones.
 */
export const POWER_OFF_TINT = {
  brightnessMultiplier: 0.45,
  tintColor: "#1a1f26",
};

/**
 * Applies power-off darkening to any hex color.
 */
export function applyPowerOffTint(hex: string): string {
  return adjustHexBrightness(hex, -0.55);
}

/**
 * UI Selection and highlight colors for editor and inspection.
 */
export const HIGHLIGHT_PALETTE = {
  hover: "#f39c12",
  selected: "#3498db",
  validPlacement: "#2ecc71",
  invalidPlacement: "#e74c3c",
  gridlock: "#d35400",
  isolatedZone: "#9b59b6",
  uncertaintyRing: "#e67e22",
};

/**
 * Distinctive NPC role colors (for uniforms, voxel heads/torsos).
 */
export const ROLE_PALETTE: Record<NpcRole, string> = {
  [NpcRole.Civilian]: "#4a69bd",
  [NpcRole.Driver]: "#6a89cc",
  [NpcRole.Police]: "#1e3799",
  [NpcRole.BoatOperator]: "#0c2461",
  [NpcRole.Paramedic]: "#eb2f06",
  [NpcRole.Doctor]: "#f8f9fa",
  [NpcRole.Nurse]: "#82ccdd",
  [NpcRole.HospitalStaff]: "#78e08f",
  [NpcRole.Pilot]: "#f6b93b",
  [NpcRole.Dispatcher]: "#38ada9",
};

/**
 * Vehicle colors by kind and variants.
 */
export const VEHICLE_PALETTE: Record<VehicleKind, string | string[]> = {
  [VehicleKind.Car]: ["#e55039", "#4a69bd", "#f6b93b", "#78e08f", "#ffffff"],
  [VehicleKind.Bus]: "#f39c12",
  [VehicleKind.Ambulance]: "#ffffff",
  [VehicleKind.PoliceCar]: "#1e3799",
  [VehicleKind.Boat]: "#fa983a",
  [VehicleKind.Helicopter]: "#2c3e50",
};

/**
 * Physical & architectural metadata for every BlockType.
 * Consumed by both simulation (hazard limits, passability) and UI editor (categories, heights, icons).
 */
export const BLOCK_META: Record<BlockType, BlockMetadata> = {
  [BlockType.Grass]: {
    name: "Grass",
    icon: "🌱",
    category: "terrain",
    heightVoxels: 1,
    walkable: true,
    drivable: false,
    solid: true,
  },
  [BlockType.Dirt]: {
    name: "Dirt",
    icon: "🟫",
    category: "terrain",
    heightVoxels: 1,
    walkable: true,
    drivable: false,
    solid: true,
  },
  [BlockType.Sand]: {
    name: "Sand",
    icon: "🏖️",
    category: "terrain",
    heightVoxels: 1,
    walkable: true,
    drivable: false,
    solid: true,
  },
  [BlockType.Rock]: {
    name: "Rock",
    icon: "🪨",
    category: "terrain",
    heightVoxels: 1,
    walkable: true,
    drivable: false,
    solid: true,
  },
  [BlockType.Road]: {
    name: "Road",
    icon: "🛣️",
    category: "transport",
    heightVoxels: 1,
    walkable: true,
    drivable: true,
    solid: true,
  },
  [BlockType.Bridge]: {
    name: "Bridge",
    icon: "🌉",
    category: "transport",
    heightVoxels: 2,
    walkable: true,
    drivable: true,
    solid: true,
  },
  [BlockType.Tree]: {
    name: "Tree",
    icon: "🌲",
    category: "terrain",
    heightVoxels: 3,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Drainage]: {
    name: "Drainage",
    icon: "🕳️",
    category: "defense",
    heightVoxels: 1,
    walkable: true,
    drivable: true,
    solid: false,
  },
  [BlockType.WaterSource]: {
    name: "Water Source",
    icon: "🌊",
    category: "terrain",
    heightVoxels: 0,
    walkable: false,
    drivable: false,
    solid: false,
  },
  [BlockType.House]: {
    name: "House",
    icon: "🏠",
    category: "residential",
    heightVoxels: 2,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Apartment]: {
    name: "Apartment",
    icon: "🏢",
    category: "residential",
    heightVoxels: 5,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Office]: {
    name: "Office",
    icon: "🏬",
    category: "commercial",
    heightVoxels: 6,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Shop]: {
    name: "Shop",
    icon: "🏪",
    category: "commercial",
    heightVoxels: 2,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Hospital]: {
    name: "Hospital",
    icon: "🏥",
    category: "emergency",
    heightVoxels: 4,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.PoliceStation]: {
    name: "Police Station",
    icon: "👮",
    category: "emergency",
    heightVoxels: 3,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.FloodHQ]: {
    name: "Flood HQ",
    icon: "📡",
    category: "emergency",
    heightVoxels: 4,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.BoatDepot]: {
    name: "Boat Depot",
    icon: "🚤",
    category: "emergency",
    heightVoxels: 2,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.FireStation]: {
    name: "Fire Station",
    icon: "🚒",
    category: "emergency",
    heightVoxels: 3,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Shelter]: {
    name: "Emergency Shelter",
    icon: "⛺",
    category: "emergency",
    heightVoxels: 3,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Helipad]: {
    name: "Helipad",
    icon: "🚁",
    category: "transport",
    heightVoxels: 1,
    walkable: true,
    drivable: false,
    solid: true,
  },
  [BlockType.PowerPlant]: {
    name: "Power Plant",
    icon: "🏭",
    category: "utility",
    heightVoxels: 5,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Substation]: {
    name: "Electrical Substation",
    icon: "⚡",
    category: "utility",
    heightVoxels: 2,
    walkable: false,
    drivable: false,
    solid: true,
  },
  [BlockType.Pole]: {
    name: "Utility Pole",
    icon: "🪵",
    category: "utility",
    heightVoxels: 3,
    walkable: true,
    drivable: false,
    solid: true,
  },
  [BlockType.Levee]: {
    name: "Flood Levee",
    icon: "🧱",
    category: "defense",
    heightVoxels: 2,
    walkable: true,
    drivable: false,
    solid: true,
  },
};
