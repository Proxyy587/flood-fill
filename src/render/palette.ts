// Render palette. Identity colours (role uniforms, vehicle liveries) come from
// Worker 1's canonical palette in src/assets/palette.ts. Surface colours below
// are render-only: they are tuned for the lit, desaturated scene and the
// lenses, so they deliberately differ from W1's flat BLOCK_PALETTE swatches.
import { ROLE_PALETTE, VEHICLE_PALETTE } from '../assets/palette';
import { BlockType, NpcRole, ReportStatus, VehicleKind } from '../contracts';

const hex = (css: string): number => parseInt(css.replace('#', ''), 16);

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
  // Plinth only; the building is the police.glb model (render/props/PoliceStations).
  [BlockType.PoliceStation]: structure(0xc9ccc6, 0x9a9d98, 0.3, false),
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

export const ROLE_COLORS = Object.fromEntries(Object.entries(ROLE_PALETTE).map(([role, css]) => [role, hex(css)])) as Record<NpcRole, number>;

export const STRANDED_COLOR = 0xff3b30;

/** Everyday clothes, so a crowd of civilians doesn't read as one uniform. */
export const CIVILIAN_SHIRTS: readonly number[] = [0x3fa7d6, 0xf29e4c, 0x59c36a, 0xe8d44d, 0xe56b8a, 0x8e7cc3, 0xf2f2f2, 0x5c6f82, 0xd9534f, 0x2bb3a3];

const carLiveries = VEHICLE_PALETTE[VehicleKind.Car];
export const CAR_COLORS: readonly number[] = (Array.isArray(carLiveries) ? carLiveries : [carLiveries]).map(hex);


export const REPORT_COLORS: Record<ReportStatus, number> = {
  [ReportStatus.Unverified]: 0xffb300,
  [ReportStatus.Verified]: 0xff3b30,
  [ReportStatus.Resolved]: 0x34c759,
  [ReportStatus.False]: 0x8e8e93,
};

export const SIGNAL_COLORS = { green: 0x3ddc84, amber: 0xffc233, red: 0xff4a3d, dark: 0x22262c } as const;

export const UI_COLORS = {
  hover: 0xffffff,
  selection: 0x1e6fd9,
  route: 0x1e6fd9,
  highlight: 0xd6336c,
} as const;

export const SKY = { clear: 0xd8e4ea, storm: 0x6d7880, golden: 0xf2b27e, night: 0x0c1524, nightStorm: 0x080d15 } as const;

/** Light colours across the day. */
export const DAYLIGHT = {
  sun: 0xfff4e0,
  sunLow: 0xffa860,
  moon: 0x8fa6d8,
  hemiSkyDay: 0xcfe6ff,
  hemiSkyNight: 0x41588f,
  hemiGroundDay: 0x5a4a3a,
  hemiGroundNight: 0x1a1c26,
  /** Window material multiplier at night: lit glass turns warm. */
  windowsNight: 0xffd08a,
} as const;
