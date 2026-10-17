import { z } from 'zod';
import { BlockType, type EditCommand, type Scenario, type ScenarioPatch } from '../contracts';
import type { Proposal } from './schema';

/** Blocks the critic may paint. Generators and substation moves wait for approved contract commands. */
export const CRITIC_BLOCKS = [BlockType.Road, BlockType.Bridge, BlockType.Drainage, BlockType.Levee, BlockType.Tree] as const;

/** Civic buildings the critic may place (via `placeBuilding`). */
export const CRITIC_FACILITIES = [
  BlockType.Helipad,
  BlockType.Hospital,
  BlockType.PoliceStation,
  BlockType.Shelter,
  BlockType.BoatDepot,
] as const;

export type CriticFacility = (typeof CRITIC_FACILITIES)[number];

/** Abstract cost units per cell for paint blocks and per-cell helipad. */
export const CELL_COST: Record<(typeof CRITIC_BLOCKS)[number] | BlockType.Helipad, number> = {
  [BlockType.Road]: 1,
  [BlockType.Bridge]: 6,
  [BlockType.Drainage]: 2,
  [BlockType.Levee]: 2,
  [BlockType.Tree]: 0.5,
  [BlockType.Helipad]: 15,
};

/** Flat cost for placing a civic facility (plus a small per-cell footprint fee). */
export const FACILITY_COST: Record<CriticFacility, number> = {
  [BlockType.Helipad]: 0, // priced per cell via CELL_COST
  [BlockType.Hospital]: 50,
  [BlockType.PoliceStation]: 25,
  [BlockType.Shelter]: 20,
  [BlockType.BoatDepot]: 30,
};

const FACILITY_DEFAULTS: Record<CriticFacility, { capacity: number; floorHeight: number; maxCells: number }> = {
  [BlockType.Helipad]: { capacity: 0, floorHeight: 1, maxCells: 4 },
  [BlockType.Hospital]: { capacity: 36, floorHeight: 3, maxCells: 16 },
  [BlockType.PoliceStation]: { capacity: 16, floorHeight: 2, maxCells: 9 },
  [BlockType.Shelter]: { capacity: 80, floorHeight: 2, maxCells: 12 },
  [BlockType.BoatDepot]: { capacity: 8, floorHeight: 2, maxCells: 9 },
};

/** Budget tiers shown in the Suggestions UI (abstract cost units). */
export const BUDGET_TIERS = { low: 80, mid: 200, high: 400 } as const;
export type BudgetTier = keyof typeof BUDGET_TIERS;

/** Default Mid-tier budget. Typed as `number` so Low/High callers type-check. */
export const DEFAULT_BUDGET: number = BUDGET_TIERS.mid;

/** Blocks that count as "eco" — preferred when the Eco filter is on. */
export const ECO_BLOCKS = new Set<number>([BlockType.Drainage, BlockType.Levee, BlockType.Tree]);

/** Trees are planted on open ground only, never over roads or water. */
const OPEN_GROUND = new Set<number>([BlockType.Grass, BlockType.Dirt, BlockType.Sand, BlockType.Rock]);

/** Existing built surface being replaced counts as an alter (red ghost). */
const ALTER_SURFACE = new Set<number>([
  BlockType.Road,
  BlockType.Bridge,
  BlockType.Drainage,
  BlockType.Levee,
  BlockType.Tree,
  BlockType.Helipad,
  BlockType.Hospital,
  BlockType.PoliceStation,
  BlockType.Shelter,
  BlockType.BoatDepot,
  BlockType.House,
  BlockType.Apartment,
  BlockType.Office,
  BlockType.Shop,
]);

const MAX_CELLS_PER_PATCH = 160;
const MAX_RECT_SIDE = 12;

const Int = z.number().int().nonnegative().max(1 << 20);
const CriticBlock = z.union([
  z.literal(BlockType.Road),
  z.literal(BlockType.Bridge),
  z.literal(BlockType.Drainage),
  z.literal(BlockType.Levee),
  z.literal(BlockType.Tree),
]);
const FacilityType = z.union([
  z.literal(BlockType.Helipad),
  z.literal(BlockType.Hospital),
  z.literal(BlockType.PoliceStation),
  z.literal(BlockType.Shelter),
  z.literal(BlockType.BoatDepot),
]);

const RawCommand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setBlock'), cell: Int, block: CriticBlock }).strict(),
  z.object({ kind: z.literal('paintRect'), x0: Int, z0: Int, x1: Int, z1: Int, block: CriticBlock }).strict(),
  z
    .object({
      kind: z.literal('placeBuilding'),
      def: z
        .object({
          type: FacilityType,
          cells: z.array(Int).min(1).max(16),
          entrance: Int,
          capacity: z.number().int().nonnegative().max(500).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export interface CompileOptions {
  /** Prefer drainage / trees / levees; reject road, bridge, helipad, and non-eco facilities. */
  eco?: boolean;
}

export type CompileResult =
  | { ok: true; patch: ScenarioPatch; cells: number[]; create: number[]; alter: number[]; clamped: boolean }
  | { ok: false; errors: string[] };

/**
 * Turns an untrusted proposal into a `ScenarioPatch` the editor can apply.
 * Anything outside the whitelist, off the grid, over an existing building, or over budget is rejected.
 */
export function compileProposal(
  proposal: Pick<Proposal, 'title' | 'rationale' | 'commands'>,
  scenario: Scenario,
  budget: number = DEFAULT_BUDGET,
  opts: CompileOptions = {},
): CompileResult {
  const { w, h } = scenario.size;
  const errors: string[] = [];
  const occupied = new Set(scenario.buildings.flatMap((b) => b.cells));
  const cellsTouched = new Set<number>();
  const create = new Set<number>();
  const alter = new Set<number>();
  const out: EditCommand[] = [];
  let cost = 0;
  let clamped = false;
  const eco = !!opts.eco;

  const tagCell = (cell: number) => {
    const prev = scenario.blocks[cell];
    if (ALTER_SURFACE.has(prev)) alter.add(cell);
    else create.add(cell);
  };

  const paint = (cell: number, block: (typeof CRITIC_BLOCKS)[number], where: string) => {
    if (occupied.has(cell)) return errors.push(`${where}: cell ${cell} is part of an existing building.`);
    if (eco && !ECO_BLOCKS.has(block)) return errors.push(`${where}: eco budget only allows drainage, levees and trees.`);
    if (block === BlockType.Bridge && scenario.blocks[cell] !== BlockType.WaterSource && scenario.blocks[cell] !== BlockType.Bridge) {
      return errors.push(`${where}: bridges can only span water.`);
    }
    if (block === BlockType.Tree && !OPEN_GROUND.has(scenario.blocks[cell])) {
      if (scenario.blocks[cell] === BlockType.Tree) return;
      return errors.push(`${where}: trees can only be planted on open ground, not on roads or water.`);
    }
    if (cellsTouched.has(cell) || scenario.blocks[cell] === block) return;
    cellsTouched.add(cell);
    tagCell(cell);
    cost += CELL_COST[block];
    out.push({ kind: 'setBlock', cell, block });
  };

  const placeFacility = (type: CriticFacility, cells: number[], entrance: number, capacity: number | undefined, where: string) => {
    const defaults = FACILITY_DEFAULTS[type];
    if (cells.length > defaults.maxCells) return errors.push(`${where}: ${BlockType[type]} footprint is limited to ${defaults.maxCells} cells.`);
    if (eco && type !== BlockType.Shelter) return errors.push(`${where}: eco budget only allows shelters among facilities (plus drainage / trees / levees).`);
    if (cells.some((c) => c >= w * h) || entrance >= w * h) return errors.push(`${where}: ${BlockType[type]} is outside the city.`);
    if (!cells.includes(entrance)) return errors.push(`${where}: entrance must be on the footprint.`);
    if (new Set(cells).size !== cells.length || !contiguous(cells, w)) return errors.push(`${where}: footprint must be a compact block of cells.`);
    if (cells.some((c) => occupied.has(c) || cellsTouched.has(c))) return errors.push(`${where}: overlaps another building or change.`);
    if (cells.some((c) => scenario.blocks[c] === BlockType.WaterSource)) return errors.push(`${where}: cannot place on open water.`);
    cells.forEach((c) => {
      cellsTouched.add(c);
      tagCell(c);
    });
    if (type === BlockType.Helipad) {
      cost += CELL_COST[BlockType.Helipad] * cells.length;
      out.push({ kind: 'placeBuilding', def: { type, cells, entrance, capacity: 0, floorHeight: 1, helipad: true } });
      return;
    }
    cost += FACILITY_COST[type] + cells.length;
    out.push({
      kind: 'placeBuilding',
      def: {
        type,
        cells,
        entrance,
        capacity: capacity ?? defaults.capacity,
        floorHeight: defaults.floorHeight,
        ...(type === BlockType.Hospital || type === BlockType.Shelter ? { generator: { fuelTicks: 3600 } } : {}),
      },
    });
  };

  proposal.commands.forEach((raw, i) => {
    const where = `Command ${i + 1}`;
    const parsed = RawCommand.safeParse(raw);
    if (!parsed.success) {
      errors.push(`${where}: not an allowed change (${parsed.error.issues[0]?.message ?? 'invalid'}).`);
      return;
    }
    const cmd = parsed.data;
    if (cmd.kind === 'setBlock') {
      if (cmd.cell >= w * h) return void errors.push(`${where}: cell ${cmd.cell} is outside the ${w}×${h} city.`);
      paint(cmd.cell, cmd.block, where);
    } else if (cmd.kind === 'paintRect') {
      const fit = (v: number, max: number) => Math.min(v, max - 1);
      const [x0, x1] = [fit(Math.min(cmd.x0, cmd.x1), w), fit(Math.max(cmd.x0, cmd.x1), w)];
      const [z0, z1] = [fit(Math.min(cmd.z0, cmd.z1), h), fit(Math.max(cmd.z0, cmd.z1), h)];
      if (x0 !== Math.min(cmd.x0, cmd.x1) || x1 !== Math.max(cmd.x0, cmd.x1) || z0 !== Math.min(cmd.z0, cmd.z1) || z1 !== Math.max(cmd.z0, cmd.z1)) clamped = true;
      if (x1 - x0 + 1 > MAX_RECT_SIDE || z1 - z0 + 1 > MAX_RECT_SIDE) {
        return void errors.push(`${where}: rectangles are limited to ${MAX_RECT_SIDE}×${MAX_RECT_SIDE} cells.`);
      }
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) paint(z * w + x, cmd.block, where);
    } else {
      placeFacility(cmd.def.type, cmd.def.cells, cmd.def.entrance, cmd.def.capacity, where);
    }
  });

  if (cellsTouched.size > MAX_CELLS_PER_PATCH) errors.push(`The proposal changes ${cellsTouched.size} cells; the limit is ${MAX_CELLS_PER_PATCH}.`);
  if (cost > budget) errors.push(`The proposal costs ${Math.ceil(cost)}, over the budget of ${budget}.`);
  if (!out.length && !errors.length) errors.push('The proposal makes no change to the city.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    patch: { title: proposal.title.slice(0, 140), rationale: proposal.rationale.slice(0, 900), commands: out, estimatedCost: Math.ceil(cost) },
    cells: [...cellsTouched],
    create: [...create],
    alter: [...alter],
    clamped,
  };
}

/** Which budget tier a cost fits in (smallest that can afford it). */
export function tierForCost(cost: number): BudgetTier {
  if (cost <= BUDGET_TIERS.low) return 'low';
  if (cost <= BUDGET_TIERS.mid) return 'mid';
  return 'high';
}

function contiguous(cells: number[], w: number): boolean {
  const xs = cells.map((c) => c % w);
  const zs = cells.map((c) => Math.floor(c / w));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  // Footprints up to 4×4 stay "compact" (hospital / shelter).
  return maxX - minX <= 3 && maxZ - minZ <= 3 && (maxX - minX + 1) * (maxZ - minZ + 1) <= cells.length * 2;
}
