import type {
  DispatchMode,
  EntityRef,
  InjectedEvent,
  InspectorData,
  MetricsFrame,
  NpcParams,
  RenderSnapshot,
  RunSummary,
  Scenario,
  SimEngine,
  SimEvent,
  WorldSnapshot,
} from '../contracts';
import { ScenarioPreview } from '../bridge/ScenarioPreview';
import { createSimulation } from '../sim/runner';
import { CORE_INJECTABLE, WIND_MS_AT_FULL, eventFromCore, injectedToAk, snapshotFromCore, toCoreScenario } from './akAdapter';
import { inspectStatic, worldFromScenario } from './world';

export interface EngineOptions {
  dispatchMode: DispatchMode;
  npcParams: NpcParams;
  maxTicks: number;
  startTimeSeconds: number;
}

/** One running simulation behind the worker protocol. */
export interface Engine {
  readonly kind: SimEngine;
  readonly tick: number;
  /** Scenario inputs this engine cannot execute. */
  readonly notes: readonly string[];
  step(): void;
  /** Fresh arrays the caller may transfer. */
  snapshot(): RenderSnapshot;
  world(): WorldSnapshot;
  /** UI-contract events and metric frames produced since the previous drain. */
  drain(): { events: SimEvent[]; metrics: MetricsFrame[] };
  inspect(ref: EntityRef): InspectorData | null;
  /**
   * Apply an event at the live tick. Returns false when the engine can only
   * take it as part of its scenario (the host then rebuilds and catches up).
   */
  injectLive(event: InjectedEvent): boolean;
  /** Reason the engine cannot run this event at all, or null. */
  rejects(event: InjectedEvent): string | null;
  summary(): RunSummary;
}

export class PreviewEngine implements Engine {
  readonly kind = 'preview' as const;
  readonly notes: readonly string[] = [];
  private sim: ScenarioPreview;
  private metricsSent = 0;

  constructor(scenario: Scenario, seed: number, o: EngineOptions) {
    this.sim = new ScenarioPreview(scenario, seed, { dispatchMode: o.dispatchMode, npcParams: o.npcParams });
  }
  get tick() {
    return this.sim.tick;
  }
  step() {
    this.sim.step();
  }
  snapshot() {
    return this.sim.snapshot();
  }
  world() {
    return this.sim.world();
  }
  drain() {
    const metrics: MetricsFrame[] = [];
    while (this.metricsSent < this.sim.metricsLog.length) metrics.push(this.sim.mapMetrics(this.sim.metricsLog[this.metricsSent++]));
    return { events: this.sim.drainEvents(), metrics };
  }
  inspect(ref: EntityRef) {
    return this.sim.inspect(ref);
  }
  injectLive(event: InjectedEvent) {
    this.sim.inject(event);
    return true;
  }
  rejects() {
    return null;
  }
  summary() {
    return this.sim.summary();
  }
}

/** Keep one WEATHER event per 0.1 band of rain or wind instead of one per tick. */
const weatherBand = (e: SimEvent) => {
  const rain = Number(e.data?.rain ?? 0);
  const wind = Number(e.data?.wind ?? 0) / WIND_MS_AT_FULL;
  return `${Math.round(rain * 10)}:${Math.round(wind * 10)}`;
};

/** AK's validated simulator (`src/sim`) behind the UI contract. */
export class CoreEngine implements Engine {
  readonly kind = 'core' as const;
  readonly notes: readonly string[];
  private sim: ReturnType<typeof createSimulation>;
  private eventsSeen = 0;
  private metricsSeen = 0;
  private lastBand = '';
  private lastSnapshot: RenderSnapshot | null = null;
  private lastFrame: MetricsFrame | null = null;

  constructor(
    private readonly scenario: Scenario,
    seed: number,
    o: EngineOptions,
  ) {
    const core = toCoreScenario(scenario);
    this.notes = core.skipped.map((s) => s.reason);
    this.sim = createSimulation(core.scenario, seed, o.dispatchMode, {
      durationTicks: Math.max(1, o.maxTicks),
      metricsEvery: 10,
      startTimeSeconds: o.startTimeSeconds,
      npcParams: o.npcParams,
    });
  }
  get tick() {
    return this.sim.tick;
  }
  step() {
    if (!this.sim.done) this.sim.step();
  }
  snapshot() {
    const core = this.sim.snapshot();
    // Kept for the inspector; the returned copy may be transferred away.
    this.lastSnapshot = snapshotFromCore(core, this.scenario);
    return snapshotFromCore(core, this.scenario);
  }
  world() {
    return worldFromScenario(this.scenario);
  }
  drain() {
    const updates = this.sim.updatesSince(this.eventsSeen, this.metricsSeen);
    const events: SimEvent[] = [];
    for (const rawEvent of updates.events) {
      const e = eventFromCore(rawEvent);
      if (!e) continue;
      if (e.type === 'WEATHER') {
        const band = weatherBand(e);
        if (band === this.lastBand) continue;
        this.lastBand = band;
        events.push({ ...e, data: { ...e.data, wind: Number(e.data?.wind ?? 0) / WIND_MS_AT_FULL } });
      } else events.push(e);
    }
    this.eventsSeen += updates.events.length;
    const metrics = updates.metrics as unknown as MetricsFrame[];
    this.metricsSeen += updates.metrics.length;
    if (metrics.length) this.lastFrame = metrics[metrics.length - 1];
    return { events, metrics };
  }
  inspect(ref: EntityRef): InspectorData | null {
    if (ref.kind === 'building' || ref.kind === 'cell') return inspectStatic(this.scenario, ref, this.lastSnapshot ?? this.snapshot(), this.lastFrame);
    const found = ref.kind === 'npc' ? this.sim.inspect({ kind: 'npc', id: ref.id as never }) : this.sim.inspect({ kind: 'vehicle', id: ref.id as never });
    if (found) return { ...found, id: ref.id, kind: ref.kind } as InspectorData;
    if (ref.kind !== 'vehicle') return null;
    const snap = this.lastSnapshot ?? this.snapshot();
    const i = snap.vehicles.id.indexOf(ref.id);
    if (i < 0) return null;
    return {
      id: ref.id,
      kind: 'vehicle',
      title: `Emergency unit #${ref.id}`,
      attributes: { Position: `${snap.vehicles.x[i].toFixed(1)}, ${snap.vehicles.z[i].toFixed(1)}`, Kind: snap.vehicles.kind[i], State: snap.vehicles.state[i] },
    };
  }
  injectLive() {
    return false;
  }
  rejects(event: InjectedEvent) {
    const r = injectedToAk(event);
    if ('error' in r) return r.error;
    if (!CORE_INJECTABLE.has(event.kind)) return `${event.kind.replace(/_/g, ' ')} is not modelled by the core simulator yet.`;
    return null;
  }
  summary(): RunSummary {
    const s = this.sim.summary();
    return {
      scenario: s.scenario,
      seed: s.seed,
      mode: s.mode,
      metrics: s.metrics as unknown as MetricsFrame[],
      events: s.events.map(eventFromCore).filter((e): e is SimEvent => e !== null),
      hotspots: s.hotspots,
    };
  }
}

export const createEngine = (kind: SimEngine, scenario: Scenario, seed: number, o: EngineOptions): Engine =>
  kind === 'core' ? new CoreEngine(scenario, seed, o) : new PreviewEngine(scenario, seed, o);
