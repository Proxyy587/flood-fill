import { asBuildingId, BlockType, type BuildingDef, type MetricsFrame, type RunSummary, type Scenario, type SimEvent } from '../../contracts';
import { mockScenario } from '../../contracts/mocks';

export const FX_W = 24;
export const at = (x: number, z: number) => z * FX_W + x;

const building = (id: number, type: BlockType, x: number, z: number, capacity = 0): BuildingDef => {
  const cells = [at(x, z), at(x + 1, z), at(x, z + 1), at(x + 1, z + 1)];
  return { id: asBuildingId(id), type, cells, capacity, entrance: cells[2], floorHeight: 3 };
};

/**
 * 24×24 city: an east–west road at z = 10 and a north–south road at x = 12.
 * West holds both hospitals, the shelter and the substation; one drain sits far away in the south-east.
 */
export function fixtureCity(): Scenario {
  const s = mockScenario();
  s.name = 'fixture-city';
  s.size = { w: FX_W, h: FX_W };
  s.ground = new Array(FX_W * FX_W).fill(2);
  s.blocks = new Array(FX_W * FX_W).fill(BlockType.Grass);
  for (let x = 0; x < FX_W; x++) s.blocks[at(x, 10)] = BlockType.Road;
  for (let z = 0; z < FX_W; z++) s.blocks[at(12, z)] = BlockType.Road;
  s.blocks[at(22, 22)] = BlockType.Drainage;
  s.buildings = [building(1, BlockType.Hospital, 2, 8, 20), building(2, BlockType.Hospital, 6, 8, 20), building(3, BlockType.Substation, 2, 11), building(4, BlockType.Shelter, 9, 8, 50)];
  for (const b of s.buildings) for (const c of b.cells) s.blocks[c] = b.type;
  const west: number[] = [];
  const east: number[] = [];
  for (let c = 0; c < FX_W * FX_W; c++) (c % FX_W < 12 ? west : east).push(c);
  s.districts = [
    { id: 1, name: 'Westbank', cells: west },
    { id: 2, name: 'Eastfield', cells: east },
  ];
  s.powerGrid = { nodes: [], edges: [] };
  s.weather.sources = [];
  s.injected = [];
  return s;
}

const frame = (i: number): MetricsFrame => ({
  tick: (i + 1) * 60,
  tts: { mean: 200 + i * 20, p50: 180, p90: 400 + i * 30 },
  unmet: i >= 7 ? 2 : 0,
  idleFrac: { ambulance: 0.3 },
  gini: 0.38,
  hospitals: [
    { id: asBuildingId(1), util: Math.min(1.05, 0.3 + i * 0.09), diversion: i >= 8, onGenerator: i >= 5 },
    { id: asBuildingId(2), util: 0.1, diversion: false, onGenerator: false },
  ],
  evacDonePct: i * 10,
  stranded: i >= 6 ? 3 : 0,
  gridlockCells: i >= 3 && i <= 6 ? 5 : 0,
  floodedCells: i * 12,
  maxDepth: i * 0.1,
  unpoweredPopPct: i >= 5 ? 40 : 0,
  heliRescues: i >= 8 ? 1 : 0,
  routeViolations: 0,
});

/** A plausible bad night on `fixtureCity`: gridlock in Eastfield, a road cut, an overloaded hospital, a substation trip. */
export function fixtureRun(): RunSummary {
  const e: SimEvent[] = [];
  const ev = (tick: number, type: SimEvent['type'], extra: Partial<SimEvent> = {}) => e.push({ tick, type, reason: `${type} at ${tick}`, ...extra });
  for (let x = 15; x <= 17; x++) ev(240, 'GRIDLOCK', { cell: at(x, 10) });
  for (let i = 0; i < 6; i++) ev(250 + i, 'VEHICLE_STALLED', { cell: at(14 + i, 10), actor: asBuildingId(50 + i), actorKind: 'vehicle' });
  ev(200, 'LOCAL_FLOOD', { cell: at(4, 20) });
  ev(205, 'LOCAL_FLOOD', { cell: at(5, 20) });
  ev(300, 'ROAD_CLOSED', { cell: at(12, 10) });
  ev(301, 'ROAD_CLOSED', { cell: at(13, 10) });
  ev(330, 'POWER_TRIP', { actor: asBuildingId(3), actorKind: 'building', cell: at(2, 11), reason: 'Substation flooded: depth 0.5 > trip threshold 0.4' });
  ev(330, 'BLACKOUT_ZONE', { actor: asBuildingId(3), actorKind: 'building', data: { cells: 200 } });
  ev(500, 'GENERATOR_EXHAUSTED', { actor: asBuildingId(1), actorKind: 'building' });
  ev(480, 'HOSPITAL_DIVERT', { actor: asBuildingId(1), actorKind: 'building' });
  for (const [npc, x] of [[101, 16], [102, 18], [103, 20]] as const) ev(360, 'NPC_STRANDED', { actor: asBuildingId(npc), actorKind: 'npc', cell: at(x, 4) });
  ev(361, 'REQUEST_CREATED', { actor: asBuildingId(101), actorKind: 'npc', target: asBuildingId(1), targetKind: 'request', cell: at(16, 4) });
  ev(361, 'REQUEST_CREATED', { actor: asBuildingId(102), actorKind: 'npc', target: asBuildingId(2), targetKind: 'request', cell: at(18, 4) });
  ev(100, 'REQUEST_CREATED', { actor: asBuildingId(104), actorKind: 'npc', target: asBuildingId(3), targetKind: 'request', cell: at(4, 4) });
  ev(200, 'SERVED', { target: asBuildingId(3), targetKind: 'request', data: { tts: 100 } });
  ev(761, 'SERVED', { target: asBuildingId(1), targetKind: 'request', data: { tts: 400 } });
  ev(520, 'ROOFTOP_RESCUE', { target: asBuildingId(103), targetKind: 'npc' });
  e.sort((a, b) => a.tick - b.tick);
  return { scenario: 'fixture-city', seed: 7, mode: 'negotiation', metrics: Array.from({ length: 10 }, (_, i) => frame(i)), events: e, hotspots: [] };
}
