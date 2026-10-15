import { BlockType, type EntityRef, type InspectorData, type MetricsFrame, type RenderSnapshot, type Scenario, type WorldSnapshot } from '../contracts';

/** Static world layers straight from the scenario document. */
export const worldFromScenario = (s: Scenario, dirtyChunks: number[] = []): WorldSnapshot => {
  const n = s.size.w * s.size.h;
  const buildingIndex = new Uint16Array(n);
  for (const b of s.buildings) for (const c of b.cells) buildingIndex[c] = b.id + 1;
  return { w: s.size.w, h: s.size.h, ground: Uint8Array.from(s.ground), blocks: Uint8Array.from(s.blocks), buildingIndex, dirtyChunks };
};

const POWER_LABEL = ['Off', 'Grid', 'Generator'];

const blockName = (b: number) => BlockType[b]?.replace(/([a-z])([A-Z])/g, '$1 $2') ?? 'Unknown';

const metres = (v: number) => `${v.toFixed(2)} m`;

/**
 * Building and cell inspector built from the scenario plus the latest
 * snapshot/metrics. Used for engines whose own inspector covers only agents.
 */
export const inspectStatic = (s: Scenario, ref: EntityRef, snap: RenderSnapshot | null, frame: MetricsFrame | null): InspectorData | null => {
  const n = s.size.w * s.size.h;
  if (ref.kind === 'cell') {
    if (ref.id < 0 || ref.id >= n) return null;
    const x = ref.id % s.size.w;
    const z = Math.floor(ref.id / s.size.w);
    return {
      id: ref.id,
      kind: 'cell',
      title: `${blockName(s.blocks[ref.id])} (${x}, ${z})`,
      attributes: {
        Ground: `${s.ground[ref.id]} m`,
        Water: snap ? metres(snap.water[ref.id]) : '—',
        Power: snap ? POWER_LABEL[snap.powered[ref.id]] ?? 'Off' : '—',
      },
    };
  }
  if (ref.kind !== 'building') return null;
  const b = s.buildings.find((x) => x.id === ref.id);
  if (!b) return null;
  let wet = 0;
  for (const c of b.cells) wet = Math.max(wet, snap?.water[c] ?? 0);
  const attributes: Record<string, number | string> = {
    Type: blockName(b.type),
    Footprint: `${b.cells.length} cells`,
    Capacity: b.capacity,
    'Floor height': `${b.floorHeight} m`,
    Generator: b.generator ? `Yes (${b.generator.fuelTicks} s fuel)` : 'No',
    Power: snap ? POWER_LABEL[snap.powered[b.entrance]] ?? 'Off' : '—',
    'Deepest water at footprint': metres(wet),
  };
  const h = frame?.hospitals.find((x) => x.id === b.id);
  if (h) {
    attributes['Beds in use'] = `${Math.round(h.util * 100)}%`;
    attributes.Diversion = h.diversion ? 'Yes' : 'No';
  }
  return { id: b.id, kind: 'building', title: `${blockName(b.type)} #${b.id}`, attributes };
};
