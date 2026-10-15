import { editorBus } from '../bridge/buses';
import { BlockType, type EditCommand } from '../contracts';
import { useEditorStore } from '../ui/store/editorStore';
import { BLOCK_META } from './catalog';
import { commandBatch } from './commands';
import { footprint, isRoad, lineCells, neighbours, rectCells, validateFootprint } from './geometry';

export function previewGesture(start: number, end: number, path: number[] = [start, end]): { cells: number[]; errors: string[] } {
  const s = useEditorStore.getState(), city = s.scenario;
  if (!city) return { cells: [], errors: [] };
  const { w, h } = city.size;
  if (s.tool === 'building') {
    const cells = footprint(end, BLOCK_META[s.block].footprint, w, h);
    return { cells, errors: validateFootprint(city, cells, s.block) };
  }
  if (s.tool === 'move' && s.moveSource !== null) {
    const building = city.buildings.find(b => b.id === s.moveSource);
    if (!building) return { cells: [], errors: ['Select a building first.'] };
    const ox = Math.min(...building.cells.map(c => c % w)), oz = Math.min(...building.cells.map(c => Math.floor(c / w)));
    const dx = end % w - ox, dz = Math.floor(end / w) - oz;
    const out = building.cells.some(c => c % w + dx < 0 || c % w + dx >= w || Math.floor(c / w) + dz < 0 || Math.floor(c / w) + dz >= h);
    const cells = out ? [] : building.cells.map(c => c + dx + dz * w);
    return { cells, errors: validateFootprint(city, cells, building.type, building.id) };
  }
  let cells = s.tool === 'rect' ? rectCells(start, end, w)
    : s.tool === 'line' ? path.flatMap((c, i) => i ? lineCells(path[i - 1], c, w) : [c]) : [end];
  if (['place', 'erase', 'raise', 'lower'].includes(s.tool)) {
    const radius = Math.floor(s.brush / 2);
    cells = path.flatMap(c => {
      const x = c % w, z = Math.floor(c / w);
      return rectCells(Math.max(0, z - radius) * w + Math.max(0, x - radius), Math.min(h - 1, z + radius) * w + Math.min(w - 1, x + radius), w);
    });
  }
  return { cells: [...new Set(cells)], errors: [] };
}

export function commitGesture(start: number, end: number, path: number[] = [start, end]): void {
  const s = useEditorStore.getState(), city = s.scenario;
  if (!city || s.mode !== 'edit' || s.tool === 'select') return;
  const { cells, errors } = previewGesture(start, end, path);
  if (errors.length) { useEditorStore.setState({ notice: errors.join(' ') }); return; }
  let commands: EditCommand[] = [];
  if (s.tool === 'eyedropper') {
    useEditorStore.setState({ block: city.blocks[end], tool: BLOCK_META[city.blocks[end] as BlockType].building ? 'building' : 'place', notice: `Sampled ${BLOCK_META[city.blocks[end] as BlockType].name}.` }); return;
  }
  if (s.tool === 'power') {
    const node = city.powerGrid.nodes.find(n => n.cell === end || city.buildings.find(b => b.id === n.building)?.cells.includes(end));
    if (!node) { useEditorStore.setState({ notice: 'Select an existing plant, substation, or load node.' }); return; }
    if (s.powerSource === null) { useEditorStore.setState({ powerSource: node.id, notice: `Node ${node.id} selected. Choose the second node.` }); return; }
    if (s.powerSource !== node.id) commands = [{ kind: 'setPowerEdge', a: s.powerSource, b: node.id, on: !city.powerGrid.edges.some(([a,b]) => (a === s.powerSource && b === node.id) || (b === s.powerSource && a === node.id)) }];
    useEditorStore.setState({ powerSource: null });
  } else if (s.tool === 'move' && s.moveSource === null) {
    const building = city.buildings.find(b => b.cells.includes(end));
    useEditorStore.setState({ moveSource: building?.id ?? null, notice: building ? 'Choose the new foundation location.' : 'Click a building to move it.' }); return;
  } else if (s.tool === 'building' || s.tool === 'move') {
    const original = s.tool === 'move' ? city.buildings.find(b => b.id === s.moveSource) : null;
    const type = original?.type ?? s.block;
    if (!BLOCK_META[type].building) { useEditorStore.setState({ notice: 'Choose a building from the palette.' }); return; }
    const road = cells.flatMap(c => neighbours(c, city.size.w, city.size.h)).find(c => !cells.includes(c) && isRoad(city.blocks[c]));
    if (original) commands.push({ kind: 'removeAt', cell: original.cells[0] });
    const powerNode=Math.max(-1,...city.powerGrid.nodes.filter(n=>n.id!==original?.powerNode).map(n=>n.id))+1;
    commands.push({ kind: 'placeBuilding', def: {
      type, cells, entrance: road ?? cells[0], capacity: original?.capacity ?? BLOCK_META[type].capacity,
      floorHeight: original?.floorHeight ?? 0.5,
      powerNode,
      ...(type === BlockType.Hospital ? { generator: { fuelTicks: 2400 } } : {}),
      ...(original?.generator ? { generator: original.generator } : {}),
      ...(type === BlockType.Helipad || original?.helipad ? { helipad: true } : {}),
    } });
    if (original?.powerNode !== undefined) for(const [a,b] of city.powerGrid.edges) {
      if(a===original.powerNode||b===original.powerNode)commands.push({kind:'setPowerEdge',a:a===original.powerNode?powerNode:a,b:b===original.powerNode?powerNode:b,on:true});
    }
    useEditorStore.setState({ moveSource: null });
  } else if (s.tool === 'raise' || s.tool === 'lower') {
    if (cells.some(c => city.buildings.some(b => b.cells.includes(c)))) { useEditorStore.setState({ notice: 'Move or erase buildings before changing their foundation.' }); return; }
    commands = cells.map(cell => ({ kind: 'setHeight', cell, ground: Math.max(0, Math.min(255, city.ground[cell] + (s.tool === 'raise' ? 1 : -1) * s.heightAmount)) }));
  } else {
    if (s.tool !== 'erase' && cells.some(c => city.buildings.some(b => b.cells.includes(c)))) { useEditorStore.setState({ notice: 'Erase or move the building before painting this lot.' }); return; }
    commands = cells.map(cell => s.tool === 'erase' ? { kind: 'removeAt', cell } : { kind: 'setBlock', cell, block: s.block });
  }
  if (commands.length) { s.commit(commands); editorBus.dispatch(commandBatch(commands)); }
}
