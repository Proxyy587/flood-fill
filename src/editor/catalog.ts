import { BLOCK_META as BLOCK_ASSETS, type BlockMetadata } from '../assets/palette';
import { ALL_BLOCK_TYPES, BlockType } from '../contracts';

// Names and groupings come from Worker 1's BLOCK_META; only editor-specific fields live here.
// Simulation stats (capacity defaults used by the sim) stay in contracts.
export const CATEGORIES = ['Terrain', 'Transport', 'Buildings', 'Emergency', 'Utilities', 'Flood control'] as const;
export type EditorCategory = (typeof CATEGORIES)[number];

const CATEGORY_OF: Record<BlockMetadata['category'], EditorCategory> = {
  terrain: 'Terrain',
  transport: 'Transport',
  residential: 'Buildings',
  commercial: 'Buildings',
  emergency: 'Emergency',
  utility: 'Utilities',
  defense: 'Flood control',
};

const DESCRIPTIONS: Partial<Record<BlockType, string>> = {
  [BlockType.Road]: 'Connects the vehicle network. 4 m per cell; depth limits depend on vehicle.',
  [BlockType.Bridge]: 'Crosses water on a raised deck. Can close when overtopped.',
  [BlockType.Hospital]: 'Treats patients. Needs road access, beds, staff, and power or backup.',
  [BlockType.BoatDepot]: 'Stages water rescues. Needs road or water access.',
  [BlockType.Shelter]: 'Receives evacuees up to its seat capacity.',
  [BlockType.Substation]: 'Connects power loads; flooding can cause cascading outages.',
  [BlockType.Drainage]: 'Removes local water through the storm-drain network.',
  [BlockType.FloodHQ]: 'Coordinates response and aggregates uncertain reports.',
  [BlockType.Helipad]: 'Provides a landing site. Aircraft remain subject to wind limits.',
  [BlockType.Levee]: 'Raises a barrier to flood flow.',
  [BlockType.WaterSource]: 'Marks a synthetic river or lake cell.',
};

/** What each block does to a flood, in plain words. Numbers match the preview model in `src/contracts/mocks/sim.ts`. */
const FLOOD_EFFECTS: Partial<Record<BlockType, string>> = {
  [BlockType.Grass]: 'Soaks up 15 mm of rain an hour; only 30% runs off toward the river.',
  [BlockType.Tree]: 'The best natural sponge: soaks 25 mm an hour and only 15% runs off. Planting trees lowers the river’s peak.',
  [BlockType.Sand]: 'Soaks 30 mm an hour; 20% runs off.',
  [BlockType.Dirt]: 'Soaks 10 mm an hour; half the rain runs off.',
  [BlockType.Rock]: 'Almost waterproof: 70% of rain runs off and nothing soaks in.',
  [BlockType.Road]: 'Paved: 90% of rain runs off and nothing soaks in, which raises the river. Cars stall above 0.3 m of water and the street closes.',
  [BlockType.Bridge]: 'Keeps a crossing open while low streets flood, until the river rises over the deck.',
  [BlockType.Drainage]:
    'A storm drain empties the hollow it sits in (0.05 m³/s with a powered pump, 30% on gravity alone). When the river rises above its outlet, an unpowered drain backs up and does nothing. Put it at the low point of a street that ponds, and keep its area powered.',
  [BlockType.Levee]: 'An embankment 3 m above the ground: river water cannot pass until it rises over the top. It must be unbroken, or water flows around the end.',
  [BlockType.WaterSource]: 'Part of the river or a lake. River water spreads from here to every connected low cell.',
  [BlockType.House]: 'Takes water once the flood is 0.5 m deep at its door. Homes on low ground flood first.',
  [BlockType.Apartment]: 'Takes water once the flood is 0.5 m deep at its door; many residents are affected at once.',
  [BlockType.Hospital]: 'Needs a dry road and power or its backup generator; when the generator runs dry it diverts patients.',
  [BlockType.Shelter]: 'Only helps if evacuees can reach it: put it on high ground beside a road that stays open.',
  [BlockType.Substation]: 'Trips at 0.4 m of water and blacks out its whole area: drain pumps stop and traffic lights go dark. Build it high or ring it with a levee.',
  [BlockType.Helipad]: 'Helicopters land here to lift people off roofs when roads are under water (not in gale-force wind).',
  [BlockType.BoatDepot]: 'Rescue boats launch from the nearest deep water; place it close to low areas that flood deep.',
  [BlockType.FloodHQ]: 'Rescue teams are released from here, and HQ sees flooding up to 56 m around it.',
};

const LARGE = new Set([BlockType.Hospital, BlockType.Shelter, BlockType.Office, BlockType.PowerPlant]);

export interface EditorBlock {
  type: BlockType;
  name: string;
  category: EditorCategory;
  footprint: number;
  building: boolean;
  capacity: number;
  description: string;
  /** What it does to a flood, when it does anything. */
  floodEffect?: string;
}

export const BLOCK_META = Object.fromEntries(ALL_BLOCK_TYPES.map((type): [BlockType, EditorBlock] => {
  const asset = BLOCK_ASSETS[type];
  const building = type >= BlockType.House && type <= BlockType.Substation;
  return [type, {
    type,
    name: asset.name,
    category: type === BlockType.WaterSource ? 'Flood control' : type === BlockType.Helipad ? 'Emergency' : CATEGORY_OF[asset.category],
    footprint: building ? (LARGE.has(type) ? 3 : 2) : 1,
    building,
    capacity: type === BlockType.Hospital ? 60 : type === BlockType.Shelter ? 160 : building ? 16 : 0,
    description: DESCRIPTIONS[type] ?? (building ? 'A city building with a level foundation and an entrance.' : 'Paint this surface onto the city grid.'),
    ...(FLOOD_EFFECTS[type] ? { floodEffect: FLOOD_EFFECTS[type] } : {}),
  }];
})) as Record<BlockType, EditorBlock>;

export const DEFAULT_HOTBAR = [BlockType.Road, BlockType.Bridge, BlockType.House, BlockType.Hospital, BlockType.Shelter, BlockType.FloodHQ, BlockType.Drainage, BlockType.Substation, BlockType.Tree];
