import { describe, expect, it } from 'vitest';
import { BlockType, BLOCK_TYPE_COUNT } from './blocks';
import { MockSim, mockRunSummary, mockScenario } from './mocks';
import { EditCommandSchema, NpcParamsSchema, RunSummarySchema, ScenarioSchema, SimEventSchema } from './schemas';
import { DEFAULT_NPC_PARAMS } from './params';
import { chunkOfCell } from './snapshot';
import { bridgeDeckHeights } from './world';

describe('contracts', () => {
  it('mockScenario validates against the Scenario schema', () => {
    const result = ScenarioSchema.safeParse(mockScenario());
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues.slice(0, 3))).toBe(true);
  });

  it('mockScenario is deterministic for a seed', () => {
    expect(JSON.stringify(mockScenario(3))).toBe(JSON.stringify(mockScenario(3)));
    expect(JSON.stringify(mockScenario(3))).not.toBe(JSON.stringify(mockScenario(4)));
  });

  it('rejects a scenario with the wrong grid length', () => {
    const s = mockScenario();
    const bad = { ...s, ground: s.ground.slice(1) };
    expect(ScenarioSchema.safeParse(bad).success).toBe(false);
  });

  it('validates default params and edit commands', () => {
    expect(NpcParamsSchema.safeParse(DEFAULT_NPC_PARAMS).success).toBe(true);
    expect(EditCommandSchema.safeParse({ kind: 'setBlock', cell: 3, block: BlockType.Road }).success).toBe(true);
    expect(
      EditCommandSchema.safeParse({
        kind: 'applyPatch',
        patch: { title: 't', rationale: 'r', estimatedCost: 1, commands: [{ kind: 'removeAt', cell: 1 }] },
      }).success,
    ).toBe(true);
    expect(EditCommandSchema.safeParse({ kind: 'nuke', cell: 1 }).success).toBe(false);
    expect(SimEventSchema.safeParse({ tick: 1, type: 'REROUTE', reason: '' }).success).toBe(false);
  });

  it('chunkOfCell maps cells to 16×16 chunks', () => {
    expect(chunkOfCell(64, 0)).toBe(0);
    expect(chunkOfCell(64, 17)).toBe(1);
    expect(chunkOfCell(64, 16 * 64)).toBe(4);
    expect(BLOCK_TYPE_COUNT).toBe(24);
  });

  it('bridge deck sits above the higher bank', () => {
    const w = 5;
    const ground = [3, 0, 0, 0, 2];
    const blocks = [BlockType.Road, BlockType.Bridge, BlockType.Bridge, BlockType.Bridge, BlockType.Road];
    const deck = bridgeDeckHeights(w, 1, ground, blocks);
    expect(Array.from(deck)).toEqual([-1, 5, 5, 5, -1]);
  });
});

describe('mock sim', () => {
  it('same scenario + seed = identical event log', () => {
    const a = mockRunSummary(900, 11);
    const b = mockRunSummary(900, 11);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('produces a schema-valid run summary where the city floods and power trips', () => {
    const summary = mockRunSummary(2400);
    const parsed = RunSummarySchema.safeParse(summary);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    const types = new Set(summary.events.map((e) => e.type));
    for (const t of ['WEATHER', 'FLOOD_THRESHOLD', 'ROAD_CLOSED', 'EVAC_ORDER', 'POWER_TRIP', 'GENERATOR_START', 'NPC_STRANDED']) {
      expect(types, `missing ${t}`).toContain(t);
    }
    expect(summary.events.every((e) => e.reason.length > 0)).toBe(true);
  });

  it('snapshot arrays are consistent and sized to the grid', () => {
    const s = mockScenario();
    const sim = new MockSim(s, 1);
    for (let i = 0; i < 50; i++) sim.step();
    const snap = sim.snapshot();
    const n = s.size.w * s.size.h;
    expect(snap.water.length).toBe(n);
    expect(snap.powered.length).toBe(n);
    const k = snap.npcs.id.length;
    expect(k).toBeGreaterThan(100);
    for (const arr of [snap.npcs.x, snap.npcs.z, snap.npcs.heading, snap.npcs.role, snap.npcs.state]) expect(arr.length).toBe(k);
    expect(snap.vehicles.id.length).toBe(snap.vehicles.kind.length);
  });

  it('edits mark the touched chunks dirty and show up in the next snapshot', () => {
    const s = mockScenario();
    const sim = new MockSim(s, 1);
    const chunks = sim.applyEdit({ kind: 'setBlock', cell: 0, block: BlockType.Tree });
    expect(chunks).toContain(0);
    expect(sim.world().blocks[0]).toBe(BlockType.Tree);
    expect(sim.snapshot().dirtyChunks).toContain(0);
  });
});
