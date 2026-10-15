import { BlockType, type Scenario } from '../contracts';
import { mockBuildingNames } from '../contracts/mocks';

export const CELL_METRES = 4;

const ROAD_LIKE = new Set<number>([BlockType.Road, BlockType.Bridge]);
const CIVIC = new Set<number>([BlockType.Hospital, BlockType.Shelter, BlockType.FloodHQ, BlockType.PoliceStation, BlockType.FireStation, BlockType.BoatDepot, BlockType.Substation, BlockType.PowerPlant]);

/** Names cells by district and nearest civic landmark, so evidence reads like a briefing, not a grid dump. */
export interface CityIndex {
  scenario: Scenario;
  w: number;
  h: number;
  /** Cell → district index into `scenario.districts`, -1 when none. */
  district: Int16Array;
  /** Building id → display name. */
  names: Map<number, string>;
  districtName(cell: number): string;
  /** "(12, 40) in Old Town, 24 m from St. Avery General" style label; `near: false` omits the landmark. */
  describe(cell: number, near?: boolean): string;
  isRoad(cell: number): boolean;
}

export function cityIndex(scenario: Scenario): CityIndex {
  const { w, h } = scenario.size;
  const district = new Int16Array(w * h).fill(-1);
  scenario.districts.forEach((d, i) => d.cells.forEach((c) => (district[c] = i)));
  const list = mockBuildingNames(scenario);
  const names = new Map<number, string>();
  scenario.buildings.forEach((b, i) => names.set(b.id, list[i] ?? `${BlockType[b.type]} #${b.id}`));
  const civic = scenario.buildings.filter((b) => CIVIC.has(b.type));

  const districtName = (cell: number) => scenario.districts[district[cell]]?.name ?? 'open ground';
  const nearest = (cell: number) => {
    const x = cell % w;
    const z = Math.floor(cell / w);
    let best: { name: string; d: number } | null = null;
    for (const b of civic) {
      const bx = b.entrance % w;
      const bz = Math.floor(b.entrance / w);
      const d = Math.hypot(bx - x, bz - z);
      if (!best || d < best.d) best = { name: names.get(b.id) ?? '', d };
    }
    return best;
  };
  return {
    scenario,
    w,
    h,
    district,
    names,
    districtName,
    describe(cell, withLandmark = true) {
      const x = cell % w;
      const z = Math.floor(cell / w);
      const where = `(${x}, ${z}) in ${districtName(cell)}`;
      const near = withLandmark ? nearest(cell) : null;
      return near && near.d <= 20 ? `${where}, ${Math.round(near.d * CELL_METRES)} m from ${near.name}` : where;
    },
    isRoad: (cell) => ROAD_LIKE.has(scenario.blocks[cell]),
  };
}
