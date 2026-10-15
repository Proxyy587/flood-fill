import { z } from 'zod';
import { BlockType, type EditCommand, type Scenario, type ScenarioPatch } from '../contracts';
import type { Proposal } from './schema';

/** Blocks the critic may paint. Generators and substation moves wait for approved contract commands. */
export const CRITIC_BLOCKS = [BlockType.Road, BlockType.Bridge, BlockType.Drainage, BlockType.Levee, BlockType.Tree] as const;

/** Abstract cost units per cell. */
export const CELL_COST: Record<(typeof CRITIC_BLOCKS)[number] | BlockType.Helipad, number> = {
  [BlockType.Road]: 1,
  [BlockType.Bridge]: 6,
  [BlockType.Drainage]: 2,
  [BlockType.Levee]: 2,
  [BlockType.Tree]: 0.5,
  [BlockType.Helipad]: 15,
};

/** Trees are planted on open ground only, never over roads or water. */
const OPEN_GROUND = new Set<number>([BlockType.Grass, BlockType.Dirt, BlockType.Sand, BlockType.Rock]);

export const DEFAULT_BUDGET = 200;
const MAX_CELLS_PER_PATCH = 160;
const MAX_RECT_SIDE = 12;

const Int = z.number().int().nonnegative().max(1 << 20);
const CriticBlock = z.union([z.literal(BlockType.Road), z.literal(BlockType.Bridge), z.literal(BlockType.Drainage), z.literal(BlockType.Levee), z.literal(BlockType.Tree)]);

const RawCommand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setBlock'), cell: Int, block: CriticBlock }).strict(),
  z.object({ kind: z.literal('paintRect'), x0: Int, z0: Int, x1: Int, z1: Int, block: CriticBlock }).strict(),
  z
    .object({
      kind: z.literal('placeBuilding'),
      def: z.object({ type: z.literal(BlockType.Helipad), cells: z.array(Int).min(1).max(4), entrance: Int }).strict(),
    })
    .strict(),
]);

export type CompileResult = { ok: true; patch: ScenarioPatch; cells: number[]; clamped: boolean } | { ok: false; errors: string[] };

/**
 * Turns an untrusted proposal into a `ScenarioPatch` the editor can apply.
 * Anything outside the whitelist, off the grid, over an existing building, or over budget is rejected.
 */
export function compileProposal(proposal: Pick<Proposal, 'title' | 'rationale' | 'commands'>, scenario: Scenario, budget = DEFAULT_BUDGET): CompileResult {
  const { w, h } = scenario.size;
  const errors: string[] = [];
  const occupied = new Set(scenario.buildings.flatMap((b) => b.cells));
  const cellsTouched = new Set<number>();
  const out: EditCommand[] = [];
  let cost = 0;
  let clamped = false;

  const paint = (cell: number, block: (typeof CRITIC_BLOCKS)[number], where: string) => {
    if (occupied.has(cell)) return errors.push(`${where}: cell ${cell} is part of an existing building.`);
    if (block === BlockType.Bridge && scenario.blocks[cell] !== BlockType.WaterSource && scenario.blocks[cell] !== BlockType.Bridge) return errors.push(`${where}: bridges can only span water.`);
    if (block === BlockType.Tree && !OPEN_GROUND.has(scenario.blocks[cell])) {
      if (scenario.blocks[cell] === BlockType.Tree) return;
      return errors.push(`${where}: trees can only be planted on open ground, not on roads or water.`);
    }
    if (cellsTouched.has(cell) || scenario.blocks[cell] === block) return;
    cellsTouched.add(cell);
    cost += CELL_COST[block];
    out.push({ kind: 'setBlock', cell, block });
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
      if (x1 - x0 + 1 > MAX_RECT_SIDE || z1 - z0 + 1 > MAX_RECT_SIDE) return void errors.push(`${where}: rectangles are limited to ${MAX_RECT_SIDE}×${MAX_RECT_SIDE} cells.`);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) paint(z * w + x, cmd.block, where);
    } else {
      const { cells, entrance } = cmd.def;
      if (cells.some((c) => c >= w * h) || entrance >= w * h) return void errors.push(`${where}: helipad is outside the city.`);
      if (!cells.includes(entrance)) return void errors.push(`${where}: helipad entrance must be on its footprint.`);
      if (new Set(cells).size !== cells.length || !contiguous(cells, w)) return void errors.push(`${where}: helipad footprint must be a compact block of cells.`);
      if (cells.some((c) => occupied.has(c) || cellsTouched.has(c))) return void errors.push(`${where}: helipad overlaps another building or change.`);
      cells.forEach((c) => cellsTouched.add(c));
      cost += CELL_COST[BlockType.Helipad] * cells.length;
      out.push({ kind: 'placeBuilding', def: { type: BlockType.Helipad, cells, entrance, capacity: 0, floorHeight: 1, helipad: true } });
    }
  });

  if (cellsTouched.size > MAX_CELLS_PER_PATCH) errors.push(`The proposal changes ${cellsTouched.size} cells; the limit is ${MAX_CELLS_PER_PATCH}.`);
  if (cost > budget) errors.push(`The proposal costs ${cost}, over the budget of ${budget}.`);
  if (!out.length && !errors.length) errors.push('The proposal makes no change to the city.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    patch: { title: proposal.title.slice(0, 140), rationale: proposal.rationale.slice(0, 900), commands: out, estimatedCost: Math.ceil(cost) },
    cells: [...cellsTouched],
    clamped,
  };
}

function contiguous(cells: number[], w: number): boolean {
  const xs = cells.map((c) => c % w);
  const zs = cells.map((c) => Math.floor(c / w));
  return Math.max(...xs) - Math.min(...xs) <= 1 && Math.max(...zs) - Math.min(...zs) <= 1;
}
