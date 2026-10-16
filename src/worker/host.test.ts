import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NPC_PARAMS, type RenderSnapshot, type RunOptions, type Scenario, type SimEngine, type SimEvent, type WorkerStatus, type WorkerToMain } from '../contracts';
import { mockScenario } from '../contracts/mocks';
import { scenarioFingerprint } from '../ai/decisions/runTape';
import { RECORD_EVERY, SimHost, type Clock } from './host';
import { parseManifest, parseTemplate } from './templates';

const root = path.join(process.cwd(), 'scenarios');
const templates = parseManifest(JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'))).map((e) => ({
  id: e.id,
  scenario: parseTemplate(JSON.parse(readFileSync(path.join(root, e.file), 'utf8'))),
}));

/** Manual clock: `advance` runs due timers in order. */
const manualClock = () => {
  let now = 0;
  let queue: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock: Clock & { advance(ms: number): void; jump(ms: number): void; runNext(): void; idle(): boolean } = {
    now: () => now,
    schedule(fn, ms) {
      const id = next++;
      queue.push({ at: now + ms, fn, id });
      return id;
    },
    cancel(h) {
      queue = queue.filter((q) => q.id !== h);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const job = queue[0];
        if (!job || job.at > end) break;
        queue.shift();
        now = Math.max(now, job.at);
        job.fn();
      }
      now = end;
    },
    jump(ms) {
      now += ms;
    },
    runNext() {
      queue.sort((a, b) => a.at - b.at);
      const job = queue.shift();
      if (!job) return;
      now = Math.max(now, job.at);
      job.fn();
    },
    idle: () => queue.length === 0,
  };
  return clock;
};

const harness = (scenario: Scenario, engine: SimEngine, extra: Partial<RunOptions> = {}) => {
  const clock = manualClock();
  const out: WorkerToMain[] = [];
  const host = new SimHost((msg) => out.push(msg), clock);
  const options: RunOptions = { dispatchMode: scenario.defaults.dispatchMode, npcParams: DEFAULT_NPC_PARAMS, maxTicks: 400, speed: 64, mode: 'run', engine, ...extra };
  host.handle({ type: 'load', scenario, seed: 3, options });
  const of = <T extends WorkerToMain['type']>(type: T) => out.filter((m): m is Extract<WorkerToMain, { type: T }> => m.type === type);
  const lastSnapshot = (): RenderSnapshot => of('snapshot').at(-1)!.snapshot;
  const lastStatus = (): WorkerStatus => out.flatMap((m) => (m.type === 'status' || m.type === 'ready' ? [m.status] : [])).at(-1)!;
  const events = (): SimEvent[] => of('events').flatMap((m) => m.events);
  const errors = () => of('error').map((m) => m.message);
  return { clock, out, host, of, lastSnapshot, lastStatus, events, errors };
};

const cases = [...templates.map((t) => ({ name: t.id, scenario: t.scenario })), { name: 'preview city', scenario: mockScenario() }];

describe('SimHost (worker protocol)', () => {
  it('applies a matching Laya tape at run start and ignores a stale fingerprint', () => {
    const scenario = mockScenario();
    const tape = { version: 1 as const, modelRevision: 'test', scenarioFingerprint: scenarioFingerprint(scenario), seed: 3,
      dispatchMode: 'centralised' as const, hospitalPreference: { severe: 1 } };
    const assisted = harness(scenario, 'core', { dispatchMode: 'centralised', layaTape: tape });
    expect(assisted.events().find((event) => event.type === 'RUN_STARTED')?.data).toMatchObject({
      layaDispatchMode: 'centralised', layaHospitalSevere: 1,
    });
    const stale = harness(scenario, 'core', { dispatchMode: 'centralised', layaTape: { ...tape, scenarioFingerprint: '00000000' } });
    expect(stale.events().find((event) => event.type === 'RUN_STARTED')?.data?.layaModelRevision).toBeUndefined();
  });
  it('keeps pause responsive during playback catch-up', () => {
    const h = harness(mockScenario(), 'preview', { speed: 64 });
    h.host.handle({ type: 'play' });
    h.clock.jump(20_000);
    h.clock.runNext();

    expect(h.lastStatus().liveTick).toBe(8);
    h.host.handle({ type: 'pause' });
    const pausedAt = h.lastStatus().liveTick;
    h.clock.advance(1_000);
    expect(h.lastStatus().liveTick).toBe(pausedAt);
  });

  it('contains a playback worker fault and permits loading a fresh run', () => {
    const h = harness(mockScenario(), 'preview');
    const engine = (h.host as unknown as { engine: { step(): void } | null }).engine;
    if (!engine) throw new Error('Expected the preview engine to be loaded');
    engine.step = () => {
      throw new Error('synthetic step fault');
    };

    h.host.handle({ type: 'play' });
    h.clock.jump(1_000);
    h.clock.runNext();

    expect(h.errors()).toEqual(['synthetic step fault']);
    expect(h.lastStatus().playing).toBe(false);
    expect(h.clock.idle()).toBe(true);

    h.host.handle({
      type: 'load',
      scenario: mockScenario(),
      seed: 4,
      options: { dispatchMode: 'negotiation', npcParams: DEFAULT_NPC_PARAMS, maxTicks: 400, speed: 16, mode: 'run', engine: 'preview' },
    });
    expect(h.lastStatus().playing).toBe(false);
    expect(h.of('ready')).toHaveLength(2);
  });

  for (const c of cases)
    for (const engine of ['core', 'preview'] as const) {
      it(`${c.name} on ${engine}: load, step, play, pause without sharing buffers`, () => {
        // Keep playback checks at a modest speed; the UI slider goes to 256×.
        const h = harness(c.scenario, engine, { speed: 16 });
        expect(h.errors()).toEqual([]);
        expect(h.of('world')).toHaveLength(1);
        expect(h.of('ready')[0].status.engine).toBe(engine);
        const first = h.lastSnapshot();
        first.water.fill(99);
        h.host.handle({ type: 'step', ticks: 30 });
        expect(h.lastSnapshot().tick).toBe(30);
        expect(Math.max(...h.lastSnapshot().water)).toBeLessThan(99);
        h.host.handle({ type: 'play' });
        h.clock.advance(2000);
        h.host.handle({ type: 'pause' });
        const live = h.lastStatus().liveTick ?? 0;
        expect(live).toBeGreaterThan(60);
        h.clock.advance(1000);
        expect(h.lastStatus().liveTick).toBe(live);
        expect(h.errors()).toEqual([]);
        const ticks = h.events().map((e) => e.tick);
        expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
      }, 30_000);
    }

  it('runs a core template to the end and reports, dispatches and reserves beds', () => {
    const h = harness(templates.find((t) => t.id === 'stress-triple')!.scenario, 'core', { maxTicks: 900 });
    h.host.handle({ type: 'play' });
    for (let i = 0; i < 200 && h.of('done').length === 0; i++) h.clock.advance(1000);
    const done = h.of('done');
    expect(done).toHaveLength(1);
    const types = new Set(h.events().map((e) => e.type));
    expect(types).toContain('REPORT_CREATED');
    expect(types).toContain('ASSIGNED');
    expect(types).toContain('HOSPITAL_ASSIGN');
    expect(done[0].summary.events.length).toBeGreaterThanOrEqual(h.events().length);
    expect(h.of('metrics').length).toBeGreaterThan(50);
    expect(h.events().filter((e) => e.type === 'WEATHER').length).toBeLessThan(40);
  }, 60_000);

  it('seeks backwards through recorded frames and replays to the live edge', () => {
    const h = harness(cases[0].scenario, 'core');
    for (let i = 0; i < 5; i++) h.host.handle({ type: 'step', ticks: 20 });
    expect(h.lastStatus().liveTick).toBe(100);
    const before = h.events().length;
    h.out.length = 0;
    h.host.handle({ type: 'seek', tick: 47 });
    expect(h.lastSnapshot().tick).toBe(40);
    expect(h.lastStatus()).toMatchObject({ tick: 40, liveTick: 100 });
    expect(h.events().every((e) => e.tick <= 40)).toBe(true);
    h.host.handle({ type: 'play' });
    h.clock.advance(2000);
    expect(h.lastStatus().tick).toBe(h.lastStatus().liveTick);
    expect(h.lastStatus().liveTick).toBeGreaterThan(100);
    h.host.handle({ type: 'pause' });
    expect(h.lastSnapshot().tick).toBe(h.lastStatus().tick);
    const replayed = h.events();
    expect(replayed.filter((e) => e.tick <= 100)).toHaveLength(before);
    h.host.handle({ type: 'seek', tick: 25 });
    h.host.handle({ type: 'step', ticks: 1 });
    expect(h.lastStatus().tick).toBe(20 + RECORD_EVERY);
  }, 30_000);

  it('cancels an in-progress seek when the user selects an earlier timeline point', () => {
    const h = harness(mockScenario(), 'preview', { maxTicks: 6000 });
    h.host.handle({ type: 'step', ticks: 30 });
    const engine = (h.host as unknown as { engine: { step(): void } | null }).engine;
    if (!engine) throw new Error('Expected the preview engine to be loaded');
    const step = engine.step.bind(engine);
    engine.step = () => {
      h.clock.jump(35);
      step();
    };
    h.host.handle({ type: 'seek', tick: 5000 });
    expect(h.lastStatus().busy?.label).toBe('Simulating ahead');
    h.clock.runNext();
    expect(h.lastStatus().busy?.label).toBe('Simulating ahead');
    const progressedLiveTick = h.lastStatus().liveTick ?? 0;
    expect(progressedLiveTick).toBeGreaterThan(30);
    expect(h.lastStatus().tick).toBe(progressedLiveTick);
    expect(h.lastSnapshot().tick).toBe(progressedLiveTick);
    expect(h.events().every((event) => event.tick <= progressedLiveTick)).toBe(true);

    h.host.handle({ type: 'seek', tick: 10 });

    expect(h.lastStatus()).toMatchObject({ tick: 10, liveTick: progressedLiveTick });
    expect(h.lastStatus().busy).toBeUndefined();
    expect(h.lastSnapshot().tick).toBe(10);
    expect(h.clock.idle()).toBe(true);
    h.clock.runNext();
    expect(h.lastStatus()).toMatchObject({ tick: 10, liveTick: progressedLiveTick });
    expect(h.lastStatus().busy).toBeUndefined();
    expect(h.events().every((event) => event.tick <= 10)).toBe(true);
  });

  it('re-simulates the core run when an event is injected, without repeating history', () => {
    const h = harness(cases[0].scenario, 'core');
    h.host.handle({ type: 'step', ticks: 60 });
    const sent = h.events().length;
    h.host.handle({ type: 'inject', event: { kind: 'comms_outage', t: 0, durationTicks: 120 } });
    expect(h.lastStatus().busy?.label).toMatch(/Re-simulating/);
    for (let i = 0; i < 50 && h.lastStatus().busy; i++) h.clock.advance(50);
    expect(h.lastStatus().busy).toBeUndefined();
    expect(h.lastStatus().liveTick).toBe(60);
    expect(h.events().length).toBe(sent);
    h.host.handle({ type: 'step', ticks: 5 });
    const injected = h.events().filter((e) => e.type === 'INJECTED');
    expect(injected.at(-1)).toMatchObject({ tick: 61 });
    expect(h.host.recordedEvents.filter((e) => e.tick <= 60)).toHaveLength(sent);
  });

  it('refuses injected events the core does not model, without crashing the run', () => {
    const h = harness(cases[0].scenario, 'core');
    h.host.handle({ type: 'inject', event: { kind: 'helicopter_grounded_wind', t: 0, speed: 1, durationTicks: 60 } });
    expect(h.errors()[0]).toMatch(/not modelled by the core/);
    h.host.handle({ type: 'step', ticks: 5 });
    expect(h.lastSnapshot().tick).toBe(5);
  });

  it('accepts a boat failure injection through the core worker protocol', () => {
    const scenario = cases.find((item) => item.scenario.fleet.boats > 0 && item.scenario.fleet.boatOperators > 0)?.scenario;
    if (!scenario) throw new Error('Expected one scenario with an operated rescue boat');
    const boatId = scenario.fleet.ambulances + scenario.fleet.policeCars + 1;
    const h = harness(scenario, 'core');
    h.host.handle({ type: 'inject', event: { kind: 'boat_failure', t: 0, target: boatId } });
    h.clock.advance(0);
    h.host.handle({ type: 'step', ticks: 2 });

    expect(h.errors()).toEqual([]);
    expect(h.events().some((event) => event.type === 'INJECTED' && event.data?.kind === 'boat_failure')).toBe(true);
  });

  it('is deterministic: same scenario and seed give the same log', () => {
    const run = () => {
      const h = harness(cases[0].scenario, 'core');
      for (let i = 0; i < 4; i++) h.host.handle({ type: 'step', ticks: 50 });
      return JSON.stringify(h.events());
    };
    expect(run()).toBe(run());
  });

  it('answers building and cell inspection on the core engine', async () => {
    const h = harness(cases[0].scenario, 'core');
    h.host.handle({ type: 'step', ticks: 10 });
    const b = cases[0].scenario.buildings[0];
    h.host.handle({ type: 'inspect', requestId: 1, ref: { kind: 'building', id: b.id } });
    h.host.handle({ type: 'inspect', requestId: 2, ref: { kind: 'cell', id: b.entrance } });
    const [building, cell] = h.of('inspect').map((m) => m.data);
    expect(building?.title).toContain(`#${b.id}`);
    expect(cell?.attributes.Water).toMatch(/m$/);
  });
});
