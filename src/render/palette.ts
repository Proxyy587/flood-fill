// Render-local palette. Worker 1 owns the canonical one (src/assets/palette.ts,
// BLOCK_META); swap these lookups to it when it lands (see docs/REQUESTS.md).
import { BlockType, NpcRole, ReportStatus, VehicleKind } from '../contracts';

export type BlockShape = 'terrain' | 'flat' | 'structure' | 'tree' | 'pole' | 'bridge';

export interface BlockVisual {
  top: number;
  side: number;
  /** Structure height above ground, in voxels. */
  height: number;
  shape: BlockShape;
  /** Has windows and reacts to blackouts. */
  windows: boolean;
}

const terrain = (top: number, side = 0x7a5c3e): BlockVisual => ({ top, side, height: 0, shape: 'terrain', windows: false });
const structure = (side: number, top: number, height: number, windows = true): BlockVisual => ({
  top,
  side,
  height,
  shape: 'structure',
  windows,
});

export const BLOCK_VISUALS: Record<BlockType, BlockVisual> = {
  [BlockType.Grass]: terrain(0x93b874, 0x7d6a52),
  [BlockType.Dirt]: terrain(0xb39a78, 0x7d6a52),
  [BlockType.Sand]: terrain(0xe0d2a4, 0xbfae7f),
  [BlockType.Rock]: terrain(0x9a9c98, 0x7a7c78),
  [BlockType.Road]: { top: 0x55595f, side: 0x6b625a, height: 0, shape: 'flat', windows: false },
  [BlockType.Bridge]: { top: 0x8e8478, side: 0x6a6158, height: 0, shape: 'bridge', windows: false },
  [BlockType.Tree]: { top: 0x5e8f4a, side: 0x7d6a52, height: 0, shape: 'tree', windows: false },
  [BlockType.Drainage]: { top: 0x3c5560, side: 0x6b625a, height: 0, shape: 'flat', windows: false },
  [BlockType.WaterSource]: terrain(0x5d6a5e, 0x5d6a5e),
  [BlockType.House]: structure(0xebdfcb, 0xb46a4e, 3),
  [BlockType.Apartment]: structure(0xddd6ca, 0x938c84, 8),
  [BlockType.Office]: structure(0xbccad4, 0x7d8a95, 12),
  [BlockType.Shop]: structure(0xe9dbbb, 0xa98763, 3),
  [BlockType.Hospital]: structure(0xf6f8f7, 0xe3ebe7, 7),
  [BlockType.PoliceStation]: structure(0x8aa2c8, 0x4e6a9a, 4),
  [BlockType.FloodHQ]: structure(0xeab184, 0xc8743a, 5),
  [BlockType.BoatDepot]: structure(0x9cc3c8, 0x4f8790, 3, false),
  [BlockType.FireStation]: structure(0xd9978e, 0xb0483e, 4),
  [BlockType.Shelter]: structure(0xcfe3dd, 0x5f9f93, 4),
  [BlockType.Helipad]: { top: 0x5a5f66, side: 0x464a50, height: 0.4, shape: 'structure', windows: false },
  [BlockType.PowerPlant]: structure(0xa5aaa8, 0x737a79, 6, false),
  [BlockType.Substation]: structure(0xc7b48a, 0x8f7c52, 2, false),
  [BlockType.Pole]: { top: 0x93b874, side: 0x7d6a52, height: 0, shape: 'pole', windows: false },
  [BlockType.Levee]: structure(0xa08a74, 0x8c7762, 3, false),
};

/** Civic landmark categories: halos, map pins and the inspector share these. */
export const LANDMARK_COLORS = {
  medical: 0x1f9d63,
  shelter: 0x0e9aa7,
  police: 0x3559c7,
  command: 0xe86a17,
  fire: 0xd93a2b,
  power: 0xd99a00,
  boats: 0x1e6fd9,
  air: 0x7a5af8,
} as const;

/** Daytime glass reads quietly; generator-lit floors glow amber; dark floors are near-black. */
export const WINDOW_COLORS = {
  grid: 0xc9d6de,
  generator: 0xffb347,
  off: 0x262d36,
} as const;

/** Wall multiplier during a blackout (cool, darker). */
export const BLACKOUT_TINT: [number, number, number] = [0.62, 0.66, 0.78];

export const WATER = {
  shallow: 0x8fd3f0,
  deep: 0x17466e,
  belief: 0xa58bf0,
  /** Depth (voxels) at which the colour reaches `deep`. */
  deepAt: 3,
} as const;

export const ROLE_COLORS: Record<NpcRole, number> = {
  [NpcRole.Civilian]: 0xf2efe6,
  [NpcRole.Driver]: 0xd9d4c7,
  [NpcRole.Police]: 0x2f63d6,
  [NpcRole.BoatOperator]: 0xff8a1f,
  [NpcRole.Paramedic]: 0x2fbf71,
  [NpcRole.Doctor]: 0x9be7ff,
  [NpcRole.Nurse]: 0xff8fc7,
  [NpcRole.HospitalStaff]: 0x7fd6c2,
  [NpcRole.Pilot]: 0x9b6bff,
  [NpcRole.Dispatcher]: 0xffd23f,
};

export const STRANDED_COLOR = 0xff3b30;

export const CAR_COLORS = [0xd94b3d, 0x3e7cc9, 0xe8e4da, 0x2f2f33, 0x5fae5a, 0xe0b23a] as const;

export const VEHICLE_BASE: Record<VehicleKind, number> = {
  [VehicleKind.Car]: 0xffffff,
  [VehicleKind.Bus]: 0xf2c230,
  [VehicleKind.Ambulance]: 0xffffff,
  [VehicleKind.PoliceCar]: 0xffffff,
  [VehicleKind.Boat]: 0xffffff,
  [VehicleKind.Helicopter]: 0xffffff,
};

export const REPORT_COLORS: Record<ReportStatus, number> = {
  [ReportStatus.Unverified]: 0xffb300,
  [ReportStatus.Verified]: 0xff3b30,
  [ReportStatus.Resolved]: 0x34c759,
  [ReportStatus.False]: 0x8e8e93,
};

export const SIGNAL_COLORS = { green: 0x3ddc84, amber: 0xffc233, dark: 0x22262c } as const;

export const UI_COLORS = {
  hover: 0xffffff,
  selection: 0x1e6fd9,
  route: 0x1e6fd9,
  highlight: 0xd6336c,
} as const;

export const SKY = { clear: 0xd8e4ea, storm: 0x6d7880 } as const;
