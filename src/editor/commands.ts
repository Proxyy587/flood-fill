import { asBuildingId, BlockType, type EditCommand, type Scenario } from '../contracts';
import { EditCommandSchema } from '../contracts/schemas';
import { rectCells } from './geometry';

/** Editor's immutable document reducer. The worker receives the same commands via editorBus. */
export function applyCommands(source: Scenario, commands: EditCommand[]): Scenario {
  const s = structuredClone(source);
  const remove = (cell: number) => {
    const removed = s.buildings.filter(b => b.cells.includes(cell));
    const ids = new Set(removed.map(b => b.id));
    removed.forEach(b => b.cells.forEach(c => { s.blocks[c] = BlockType.Grass; }));
    s.buildings = s.buildings.filter(b => !ids.has(b.id));
    const nodes = new Set(s.powerGrid.nodes.filter(n => n.building !== undefined && ids.has(n.building)).map(n => n.id));
    s.powerGrid.nodes = s.powerGrid.nodes.filter(n => !nodes.has(n.id));
    s.powerGrid.edges = s.powerGrid.edges.filter(([a, b]) => !nodes.has(a) && !nodes.has(b));
  };
  const put = (cell: number, block: BlockType) => { remove(cell); s.blocks[cell] = block; };
  const apply = (raw: EditCommand): void => {
    const cmd = EditCommandSchema.parse(raw);
    const inGrid = (c:number) => Number.isInteger(c) && c>=0 && c<s.blocks.length;
    if ('cell' in cmd && !inGrid(cmd.cell)) throw new Error('Edit cell is outside the city.');
    if (cmd.kind==='paintRect' && (cmd.x0>=s.size.w||cmd.x1>=s.size.w||cmd.z0>=s.size.h||cmd.z1>=s.size.h)) throw new Error('Rectangle is outside the city.');
    if (cmd.kind==='placeBuilding' && (cmd.def.cells.some(c=>!inGrid(c))||!inGrid(cmd.def.entrance)||new Set(cmd.def.cells).size!==cmd.def.cells.length)) throw new Error('Invalid building footprint or entrance.');
    if (cmd.kind==='setPowerEdge' && (cmd.a===cmd.b||![cmd.a,cmd.b].every(id=>s.powerGrid.nodes.some(n=>n.id===id)))) throw new Error('Power edges need two distinct existing nodes.');
    switch (cmd.kind) {
      case 'setBlock': put(cmd.cell, cmd.block); break;
      case 'setHeight': s.ground[cmd.cell] = cmd.ground; break;
      case 'removeAt': remove(cmd.cell); s.blocks[cmd.cell] = BlockType.Grass; break;
      case 'paintRect': rectCells(cmd.z0 * s.size.w + cmd.x0, cmd.z1 * s.size.w + cmd.x1, s.size.w).forEach(c => put(c, cmd.block)); break;
      case 'placeBuilding': {
        const id = asBuildingId(Math.max(-1, ...s.buildings.map(b => b.id)) + 1);
        cmd.def.cells.forEach(c => put(c, cmd.def.type));
        const powerNode=cmd.def.powerNode ?? Math.max(-1,...s.powerGrid.nodes.map(n=>n.id))+1;
        if(s.powerGrid.nodes.some(n=>n.id===powerNode))throw new Error('This power node already belongs to another building.');
        s.buildings.push({ ...cmd.def, id, powerNode });
        s.powerGrid.nodes.push({id:powerNode,kind:cmd.def.type===BlockType.PowerPlant?'plant':cmd.def.type===BlockType.Substation?'substation':'load',cell:cmd.def.cells[0],building:id});
        break;
      }
      case 'setPowerEdge': {
        s.powerGrid.edges = s.powerGrid.edges.filter(([a, b]) => !((a === cmd.a && b === cmd.b) || (a === cmd.b && b === cmd.a)));
        if (cmd.on) s.powerGrid.edges.push([cmd.a, cmd.b]); break;
      }
      case 'applyPatch': cmd.patch.commands.forEach(apply); break;
    }
  };
  commands.forEach(apply);
  return s;
}

export interface HistoryEntry { before: Scenario; after: Scenario; commands: EditCommand[]; inverse: EditCommand[] }
/** Structural edits require checkpoints: the frozen contract cannot restore a removed building ID. */
export function historyEntry(before: Scenario, commands: EditCommand[]): HistoryEntry {
  const after = applyCommands(before, commands);
  const inverse: EditCommand[] = [];
  for (let c = 0; c < before.blocks.length; c++) {
    if (before.blocks[c] !== after.blocks[c]) inverse.push({ kind: 'setBlock', cell: c, block: before.blocks[c] });
    if (before.ground[c] !== after.ground[c]) inverse.push({ kind: 'setHeight', cell: c, ground: before.ground[c] });
  }
  return { before, after, commands, inverse };
}

export const commandBatch = (commands: EditCommand[], title = 'Editor gesture'): EditCommand => ({
  kind: 'applyPatch', patch: { title, rationale: 'Human city edit', commands, estimatedCost: 0 },
});
