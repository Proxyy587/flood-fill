import { ALL_BLOCK_TYPES, BlockType } from '../contracts';

// Local metadata until Worker 1 supplies BLOCK_META. Keep simulation stats in contracts.
export const CATEGORIES = ['Terrain', 'Roads', 'Buildings', 'Emergency', 'Utilities', 'Flood control'] as const;
export const BLOCK_META = Object.fromEntries(ALL_BLOCK_TYPES.map((type) => {
  const category = type <= BlockType.Rock || type === BlockType.Tree ? 'Terrain'
    : type === BlockType.Road || type === BlockType.Bridge ? 'Roads'
    : type >= BlockType.House && type <= BlockType.Shop ? 'Buildings'
    : type >= BlockType.Hospital && type <= BlockType.Helipad ? 'Emergency'
    : type >= BlockType.PowerPlant && type <= BlockType.Pole ? 'Utilities' : 'Flood control';
  const building = type >= BlockType.House && type <= BlockType.Substation;
  const large = [BlockType.Hospital, BlockType.Shelter, BlockType.Office, BlockType.PowerPlant].includes(type);
  const description: Partial<Record<BlockType, string>> = {
    [BlockType.Road]: 'Connects the vehicle network. 4 m per cell; depth limits depend on vehicle.',
    [BlockType.Bridge]: 'Crosses water on a raised deck. Can close when overtopped.',
    [BlockType.Hospital]: 'Treats patients. Needs road access, beds, staff, and power or backup.',
    [BlockType.BoatDepot]: 'Stages water rescues. Needs road or water access.',
    [BlockType.Shelter]: 'Receives evacuees up to its seat capacity.',
    [BlockType.Substation]: 'Connects power loads; flooding can cause cascading outages.',
    [BlockType.Drainage]: 'Removes local water. Effectiveness requires the production flood solver.',
    [BlockType.FloodHQ]: 'Coordinates response and aggregates uncertain reports.',
    [BlockType.Helipad]: 'Provides a landing site. Aircraft remain subject to wind limits.',
    [BlockType.Levee]: 'Raises a barrier to flood flow.',
    [BlockType.WaterSource]: 'Marks a synthetic river or lake cell.',
  };
  return [type, { type, name: BlockType[type].replace(/([a-z])([A-Z])/g, '$1 $2'), category,
    footprint: building ? (large ? 3 : 2) : 1, building,
    capacity: type === BlockType.Hospital ? 60 : type === BlockType.Shelter ? 160 : building ? 16 : 0,
    description: description[type] ?? (building ? 'A city building with a level foundation and an entrance.' : 'Paint this surface onto the city grid.'),
  }];
})) as Record<BlockType, { type: BlockType; name: string; category: typeof CATEGORIES[number]; footprint: number; building: boolean; capacity: number; description: string }>;

export const DEFAULT_HOTBAR = [BlockType.Road, BlockType.Bridge, BlockType.House, BlockType.Hospital, BlockType.Shelter, BlockType.FloodHQ, BlockType.Drainage, BlockType.Substation, BlockType.Tree];
