import { BlockType, NpcRole, NpcState } from "../types";
import type { BuildingId, Scenario, RenderSnapshot, RunSummary, SimEvent, MetricsFrame } from "../types";

/** Synthetic contract fixtures only. These never stand in for simulation evidence. */
export function mockScenario(): Scenario {
  const blocks = Array<number>(64).fill(BlockType.Grass);
  for (let x = 0; x < 8; x++) blocks[24 + x] = BlockType.Road;
  blocks[9] = BlockType.House; blocks[14] = BlockType.Hospital;
  return {
    schemaVersion: 1, name: "MOCK foundation town", size: { w: 8, h: 8 },
    ground: Array<number>(64).fill(0), blocks,
    buildings: [
      { id: 1 as BuildingId, type: BlockType.House, cells: [9], entrance: 9, capacity: 6, floorHeight: 1, powerNode: 2 },
      { id: 2 as BuildingId, type: BlockType.Hospital, cells: [14], entrance: 14, capacity: 10, floorHeight: 1, generator: { fuelTicks: 20 }, helipad: true, powerNode: 3 },
    ],
    districts: Array.from({ length: 4 }, (_, id) => ({ id, name: `MOCK district ${id + 1}`, cells: Array.from({ length: 16 }, (_, i) => id * 16 + i) })),
    population: { count: 6, mix: { carOwners: 0.3, limitedMobility: 0.1, needsAssist: 0.1 }, schedule: "office-hours" },
    fleet: { ambulances: 1, policeCars: 1, boats: 1, helicopters: 1, doctors: 2, nurses: 2, policeOfficers: 1, boatOperators: 1 },
    weather: { rain: [{ t: 0, intensity: 0 }, { t: 300, intensity: 0 }, { t: 360, intensity: 0.5 }], wind: [{ t: 0, speed: 0 }], floodKind: "growing", sources: [{ cell: 0, startT: 300, endT: 600, rate: 0.1 }], warningDelay: 30 },
    injected: [],
    powerGrid: { nodes: [{ id: 0, kind: "plant", cell: 7 }, { id: 1, kind: "substation", cell: 6 }, { id: 2, kind: "load", cell: 9, building: 1 as BuildingId }, { id: 3, kind: "load", cell: 14, building: 2 as BuildingId }], edges: [[0, 1], [1, 2], [1, 3]] },
    defaults: { dispatchMode: "negotiation", seed: 42 },
  };
}

export function* mockSnapshotStream(count = 3): Generator<RenderSnapshot> {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Snapshot count must be a nonnegative integer");
  for (let tick = 0; tick < count; tick++) yield {
    tick, water: new Float32Array(64).fill(tick * 0.01), powered: new Uint8Array(64).fill(1),
    npcs: { id: new Int32Array([1]), x: new Float32Array([tick % 8]), z: new Float32Array([3]), heading: new Float32Array([0]), role: new Uint8Array([NpcRole.Civilian]), state: new Uint8Array([NpcState.Commute]) },
    vehicles: { id: new Int32Array(), x: new Float32Array(), z: new Float32Array(), heading: new Float32Array(), kind: new Uint8Array(), state: new Uint8Array() },
    reports: { x: new Float32Array(), z: new Float32Array(), confidence: new Float32Array(), status: new Uint8Array() }, dirtyChunks: tick === 0 ? [0] : [],
  };
}
export function mockEvents(): SimEvent[] {
  return [{ tick: 0, type: "WEATHER", data: { mock: true, rain: 0 }, reason: "MOCK weather event for consumer development" }];
}
export function mockMetrics(tick = 0): MetricsFrame {
  return { tick, tts: { mean: 0, p50: 0, p90: 0 }, unmet: 0, idleFrac: {}, gini: 0, hospitals: [{ id: 2 as BuildingId, util: 0, diversion: false, onGenerator: false }], evacDonePct: 0, stranded: 0, gridlockCells: 0, floodedCells: 0, maxDepth: 0, unpoweredPopPct: 0, heliRescues: 0, routeViolations: 0 };
}
export function mockRunSummary(): RunSummary {
  return { scenario: mockScenario().name, seed: 42, mode: "negotiation", metrics: [mockMetrics()], events: mockEvents(), hotspots: [] };
}
