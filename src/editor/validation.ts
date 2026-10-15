import { BlockType, type Scenario } from '../contracts';
import { isRoad, neighbours } from './geometry';

export function cityWarnings(s: Scenario): string[] {
  const warnings: string[] = [];
  if (!s.buildings.some(b => b.type === BlockType.FloodHQ)) warnings.push('No Flood HQ: add a command centre.');
  for (const b of s.buildings) {
    const access = b.cells.some(c => neighbours(c, s.size.w, s.size.h).some(n => isRoad(s.blocks[n])));
    if (!access && b.type !== BlockType.Helipad) warnings.push(`${BlockType[b.type]} #${b.id} has no adjacent road.`);
    if (b.type === BlockType.Shelter && b.capacity === 0) warnings.push(`Shelter #${b.id} has zero capacity.`);
  }
  const nodes = s.powerGrid.nodes;
  for (const sub of nodes.filter(n => n.kind === 'substation')) {
    const seen = new Set([sub.id]), queue = [sub.id];
    for (let i = 0; i < queue.length; i++) {
      for (const [a, b] of s.powerGrid.edges) {
        const next = a === queue[i] ? b : b === queue[i] ? a : -1;
        if (next < 0 || seen.has(next) || nodes.find(n => n.id === next)?.kind === 'plant') continue;
        seen.add(next); queue.push(next);
      }
    }
    if (!nodes.some(n => n.kind === 'load' && seen.has(n.id))) warnings.push(`Substation #${sub.id} has no connected loads.`);
  }
  const seen = new Set<number>();
  let components = 0;
  for (let c = 0; c < s.blocks.length; c++) {
    if (!isRoad(s.blocks[c]) || seen.has(c)) continue;
    components++; const queue = [c]; seen.add(c);
    for (let i = 0; i < queue.length; i++) for (const n of neighbours(queue[i], s.size.w, s.size.h)) {
      if (isRoad(s.blocks[n]) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  if (components > 1) warnings.push(`Road network has ${components} disconnected components.`);
  return warnings;
}
