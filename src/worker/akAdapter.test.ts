import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NpcState, VehicleKind, VehicleState, type InjectedEvent } from '../contracts';
import * as Ak from '../contracts/ak';
import { mockScenario } from '../contracts/mocks';
import {
  CORE_INJECTABLE,
  WIND_MS_AT_FULL,
  eventFromCore,
  footprintEntrance,
  injectedFromAk,
  injectedToAk,
  npcStateFromCore,
  sampleTimeline,
  toCoreScenario,
  vehicleStateFromCore,
} from './akAdapter';
import { parseManifest, parseTemplate } from './templates';

const root = path.join(process.cwd(), 'scenarios');
const manifest = parseManifest(JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')));
const rawTemplate = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

const sortBridges = (s: Ak.Scenario) => ({ ...s, bridges: [...(s.bridges ?? [])].sort((a, b) => a.cell - b.cell) });

describe('AK ↔ UI scenario adapter', () => {
  it('finds every template in the manifest', () => {
    expect(manifest.map((e) => e.id)).toEqual(expect.arrayContaining(['riverside-town', 'coastal-grid', 'dense-basin-city', 'stress-triple']));
  });

  for (const entry of manifest) {
    it(`round-trips ${entry.id} without losing data`, () => {
      const ak = Ak.ScenarioSchema.parse(rawTemplate(entry.file));
      const ui = parseTemplate(rawTemplate(entry.file));
      const back = toCoreScenario(ui);
      expect(back.skipped.map((s) => s.event.kind)).toEqual(ak.injected.filter((e) => !CORE_INJECTABLE.has(e.kind)).map((e) => e.kind));
      const executable = { ...ak, injected: ak.injected.filter((e) => CORE_INJECTABLE.has(e.kind)) };
      const reparsed = Ak.ScenarioSchema.parse(back.scenario);
      expect(sortBridges(reparsed)).toEqual(sortBridges(executable));
      expect(ui.weather.wind.every((p) => p.speed >= 0 && p.speed <= 1)).toBe(true);
    });
  }

  it('makes the preview city valid for the core schema', () => {
    const ui = mockScenario();
    const { scenario } = toCoreScenario(ui);
    expect(() => Ak.ScenarioSchema.parse(scenario)).not.toThrow();
    for (const b of scenario.buildings) expect(b.cells).toContain(b.entrance);
    expect(scenario.weather.wind.every((p, i) => Math.abs(p.speed - ui.weather.wind[i].speed * WIND_MS_AT_FULL) < 1e-9)).toBe(true);
  });

  it('reports injected events the core cannot run instead of dropping them', () => {
    const ui = { ...mockScenario(), injected: [{ kind: 'helicopter_grounded_wind', t: 30, speed: 1 } as InjectedEvent, { kind: 'comms_outage', t: 40, durationTicks: 60 } as InjectedEvent] };
    const core = toCoreScenario(ui);
    expect(core.skipped).toHaveLength(1);
    expect(core.skipped[0].reason).toMatch(/helicopter grounded wind/);
    expect(core.scenario.injected).toEqual([{ kind: 'comms_outage', tick: 40, durationTicks: 60 }]);
  });

  it('converts every injected kind both ways', () => {
    const cases: InjectedEvent[] = [
      { kind: 'bridge_closed', t: 5, cell: 12 },
      { kind: 'road_blocked_by_debris', t: 6, cell: 13 },
      { kind: 'boat_failure', t: 7, target: 2 },
      { kind: 'shelter_overflow', t: 8, target: 3 },
      { kind: 'substation_flooded', t: 9, target: 4 },
      { kind: 'false_report', t: 10, cell: 14, confidence: 0.3 },
      { kind: 'comms_outage', t: 11, durationTicks: 90 },
      { kind: 'helicopter_grounded_wind', t: 12, speed: 0.5, durationTicks: 100 },
    ];
    for (const e of cases) {
      const r = injectedToAk(e);
      if ('error' in r) throw new Error(r.error);
      expect(injectedFromAk(Ak.InjectedEventSchema.parse(r.event))).toEqual(e);
    }
    expect(injectedToAk({ kind: 'bridge_closed', t: 1 })).toEqual({ error: 'bridge_closed at tick 1 needs cell' });
  });

  it('moves an outside entrance onto the nearest footprint cell', () => {
    expect(footprintEntrance([10, 11, 20, 21], 30, 10)).toBe(20);
    expect(footprintEntrance([10, 11], 11, 10)).toBe(11);
  });

  it('maps every core NPC and vehicle state', () => {
    const npc = Object.values(Ak.NpcState).filter((v): v is number => typeof v === 'number');
    for (const s of npc) expect(npcStateFromCore(s)).not.toBe(NpcState.Idle);
    expect(npcStateFromCore(Ak.NpcState.Respond)).toBe(NpcState.OnDuty);
    const vehicle = Object.values(Ak.VehicleState).filter((v): v is number => typeof v === 'number');
    for (const s of vehicle) expect(Object.values(VehicleState)).toContain(vehicleStateFromCore(s, VehicleKind.Ambulance));
    expect(vehicleStateFromCore(Ak.VehicleState.Moving, VehicleKind.Ambulance)).toBe(VehicleState.Responding);
    expect(vehicleStateFromCore(Ak.VehicleState.Moving, VehicleKind.Car)).toBe(VehicleState.Driving);
    expect(vehicleStateFromCore(Ak.VehicleState.Moving, VehicleKind.Helicopter)).toBe(VehicleState.Flying);
  });

  it('keeps UI event types and drops per-person bookkeeping', () => {
    expect(eventFromCore({ tick: 1, type: "ASSIGNED", reason: 'x' })?.type).toBe("ASSIGNED");
    expect(eventFromCore({ tick: 1, type: 'NPC_CREATED', reason: 'x' })).toBeNull();
  });

  it('samples timelines piecewise-linearly', () => {
    const pts = [{ t: 0, v: 0 }, { t: 100, v: 1 }];
    expect(sampleTimeline(pts, 50)).toBeCloseTo(0.5);
    expect(sampleTimeline(pts, 500)).toBe(1);
    expect(sampleTimeline([], 5)).toBe(0);
  });
});
