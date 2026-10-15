/**
 * Worker → main, transferable. Positions are in cell units: cell (x, z) spans
 * [x, x+1) × [z, z+1), so its centre is (x + 0.5, z + 0.5).
 * `heading` is radians in the x/z plane: 0 faces +x, π/2 faces +z.
 */
export interface RenderSnapshot {
  tick: number;
  /** w*h depth in voxels. */
  water: Float32Array;
  /** w*h `PowerState`. */
  powered: Uint8Array;
  /** `NpcRole` in `role`, `NpcState` in `state`. */
  npcs: {
    id: Int32Array;
    x: Float32Array;
    z: Float32Array;
    heading: Float32Array;
    role: Uint8Array;
    state: Uint8Array;
  };
  /** `VehicleKind` in `kind`, `VehicleState` in `state`. */
  vehicles: {
    id: Int32Array;
    x: Float32Array;
    z: Float32Array;
    heading: Float32Array;
    kind: Uint8Array;
    state: Uint8Array;
  };
  /** `ReportStatus` in `status`. */
  reports: { x: Float32Array; z: Float32Array; confidence: Float32Array; status: Uint8Array };
  /** Terrain chunks to rebuild (edits). Chunk index = cz * ceil(W / CHUNK_SIZE) + cx. */
  dirtyChunks: number[];
  /** Cosmetic only (rain particles, rotor wobble). Intensity and speed 0..1. */
  weather: { rain: number; wind: number };
  /** HQ's aggregated belief, for the truth-vs-belief view. Omitted when unavailable. */
  hqBelief?: { water: Float32Array };
  /** w*h bit flags from `ZONE` (alerts, closures, barricades, detours). Omitted when unavailable. */
  zones?: Uint8Array;
}

/** Bits of `RenderSnapshot.zones`. */
export const ZONE = {
  /** Inside a flood-prone area named in the flood alert. */
  prone: 1,
  /** Road closed by water. */
  closed: 2,
  /** Open road cell where police hold a barricade facing a closure. */
  barricade: 4,
  /** Road carrying diverted traffic. */
  detour: 8,
  /** Debris or landslide material on the road. */
  debris: 16,
  /** Levee breach. */
  breach: 32,
} as const;

/**
 * Static world layers, sent on `load` and after edits. The renderer rebuilds
 * the chunks listed in `dirtyChunks` (all chunks when empty on first load).
 */
export interface WorldSnapshot {
  w: number;
  h: number;
  /** w*h voxel heights. */
  ground: Uint8Array;
  /** w*h `BlockType`. */
  blocks: Uint8Array;
  /** w*h, 0 = none, else building id + 1. */
  buildingIndex: Uint16Array;
  dirtyChunks: number[];
}

/** Buffers to pass as the transfer list when posting a snapshot across the worker boundary. */
export const snapshotTransferables = (s: RenderSnapshot): ArrayBuffer[] => {
  const arrays: ArrayBufferView[] = [
    s.water,
    s.powered,
    ...Object.values(s.npcs),
    ...Object.values(s.vehicles),
    ...Object.values(s.reports),
    ...(s.hqBelief ? [s.hqBelief.water] : []),
    ...(s.zones ? [s.zones] : []),
  ];
  const buffers = new Set<ArrayBuffer>();
  for (const a of arrays) if (a.buffer instanceof ArrayBuffer) buffers.add(a.buffer);
  return [...buffers];
};

export const worldTransferables = (w: WorldSnapshot): ArrayBuffer[] =>
  [w.ground.buffer, w.blocks.buffer, w.buildingIndex.buffer].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);

export const CHUNK_SIZE = 16;

export const chunkCountX = (w: number): number => Math.ceil(w / CHUNK_SIZE);

export const chunkOfCell = (w: number, cell: number): number => {
  const x = cell % w;
  const z = Math.floor(cell / w);
  return Math.floor(z / CHUNK_SIZE) * chunkCountX(w) + Math.floor(x / CHUNK_SIZE);
};
