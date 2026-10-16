import {
  BlockType,
  DEFAULT_START_SECONDS,
  MAX_SNAPSHOT_HZ,
  chunkOfCell,
  snapshotTransferables,
  worldTransferables,
  type InjectedEvent,
  type MainToWorker,
  type MetricsFrame,
  type RenderSnapshot,
  type RunOptions,
  type Scenario,
  type SimEngine,
  type SimEvent,
  type WorkerStatus,
  type WorkerToMain,
  type WorldSnapshot,
} from '../contracts';
import { applyCommands } from '../editor/commands';
import { createEngine, type Engine } from './engines';

export const DEFAULT_ENGINE: SimEngine = 'core';
/** A snapshot is kept every this many ticks for seek and replay. */
export const RECORD_EVERY = 10;
const MAX_TICKS_PER_FRAME = 240;
const MAX_PLAY_TICKS_PER_SLICE = 8;
const MAX_PENDING_PLAY_TICKS = 240;
const PLAY_SLICE_MS = 40;
const FLUSH_MS = 200;
/** Wall budget per catch-up slice — higher so timeline skip-ahead feels responsive. */
const BUSY_SLICE_MS = 80;
const BUSY_TICKS_PER_SLICE = 480;

export interface Clock {
  now(): number;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

type Post = (msg: WorkerToMain, transfer?: Transferable[]) => void;

interface Busy {
  label: string;
  from: number;
  target: number;
  /** Events and frames at or before this tick were already sent. */
  silentUntil: number;
  resume: boolean;
  /** A forward timeline seek reveals the sim as it catches up. */
  advanceView: boolean;
}

const cloneSnapshot = (s: RenderSnapshot): RenderSnapshot => structuredClone(s);

/**
 * Drives one engine with the `MainToWorker` protocol: wall-clock pacing,
 * recorded frames for backwards seek/replay, and catch-up re-simulation when
 * an engine can only accept injected events through its scenario.
 */
export class SimHost {
  private scenario: Scenario | null = null;
  private seed = 0;
  private options: RunOptions | null = null;
  private engine: Engine | null = null;
  private injected: InjectedEvent[] = [];
  private frames = new Map<number, RenderSnapshot>();
  private log: SimEvent[] = [];
  private metrics: MetricsFrame[] = [];
  private viewTick = 0;
  private replayCursor = 0;
  private playing = false;
  private busy: Busy | null = null;
  private doneSent = false;
  private carry = 0;
  private lastWall = 0;
  private lastSnapshotWall = -Infinity;
  private lastFlushWall = -Infinity;
  private timer: unknown = null;

  constructor(
    private readonly post: Post,
    private readonly clock: Clock = realClock,
  ) {}

  handle(msg: MainToWorker): void {
    try {
      this.dispatch(msg);
    } catch (err) {
      this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** For tests: the full UI event log recorded so far. */
  get recordedEvents(): readonly SimEvent[] {
    return this.log;
  }

  private get live(): number {
    return this.engine?.tick ?? 0;
  }

  private get engineKind(): SimEngine {
    return this.options?.engine ?? DEFAULT_ENGINE;
  }

  private status(): WorkerStatus {
    return {
      tick: this.viewTick,
      liveTick: this.live,
      playing: this.playing,
      speed: this.options?.speed ?? 1,
      dispatchMode: this.options?.dispatchMode ?? 'negotiation',
      scenario: this.scenario?.name ?? '',
      seed: this.seed,
      maxTicks: this.options?.maxTicks ?? 0,
      engine: this.engineKind,
      startTimeSeconds: this.options?.startTimeSeconds ?? DEFAULT_START_SECONDS,
      ...(this.busy ? { busy: { label: this.busy.label, progress: (this.live - this.busy.from) / Math.max(1, this.busy.target - this.busy.from) } } : {}),
      ...(this.engine?.notes.length ? { notes: [...this.engine.notes] } : {}),
    };
  }

  private postStatus() {
    this.post({ type: 'status', status: this.status() });
  }

  private build(): Engine {
    if (!this.scenario || !this.options) throw new Error('Load a scenario first.');
    const scenario = this.injected.length ? { ...this.scenario, injected: [...this.scenario.injected, ...this.injected] } : this.scenario;
    return createEngine(this.engineKind, scenario, this.seed, {
      dispatchMode: this.options.dispatchMode,
      npcParams: this.options.npcParams,
      maxTicks: this.options.maxTicks,
      startTimeSeconds: this.options.startTimeSeconds ?? DEFAULT_START_SECONDS,
    });
  }

  /** Fresh engine at tick 0 with empty recordings. */
  private restart() {
    this.engine = this.build();
    this.frames.clear();
    this.log = [];
    this.metrics = [];
    this.viewTick = 0;
    this.replayCursor = 0;
    this.doneSent = false;
    this.busy = null;
    this.record();
    this.collect(-1);
  }

  private record() {
    const e = this.engine;
    if (!e || e.tick % RECORD_EVERY !== 0 || this.frames.has(e.tick)) return;
    this.frames.set(e.tick, e.snapshot());
  }

  /** Drain the engine into the log; returns what is newer than `after`. */
  private collect(after: number): { events: SimEvent[]; metrics: MetricsFrame[] } {
    if (!this.engine) return { events: [], metrics: [] };
    const d = this.engine.drain();
    const events = d.events.filter((e) => e.tick > after);
    const metrics = d.metrics.filter((m) => m.tick > after);
    this.log.push(...events);
    this.metrics.push(...metrics);
    return { events, metrics };
  }

  private send(events: readonly SimEvent[], metrics: readonly MetricsFrame[]) {
    if (events.length) this.post({ type: 'events', events: [...events] });
    for (const frame of metrics) this.post({ type: 'metrics', frame });
  }

  /** Send everything recorded in (from, to]. */
  private sendRange(from: number, to: number) {
    this.send(
      this.log.filter((e) => e.tick > from && e.tick <= to),
      this.metrics.filter((m) => m.tick > from && m.tick <= to),
    );
  }

  private postSnapshot(snapshot: RenderSnapshot) {
    this.post({ type: 'snapshot', snapshot }, snapshotTransferables(snapshot));
    this.lastSnapshotWall = this.clock.now();
  }

  private sendView() {
    if (!this.engine) return;
    if (this.viewTick >= this.live) {
      this.postSnapshot(this.engine.snapshot());
      return;
    }
    const frame = this.frames.get(Math.floor(this.viewTick / RECORD_EVERY) * RECORD_EVERY);
    if (frame) this.postSnapshot(cloneSnapshot(frame));
  }

  private finishIfDone() {
    if (!this.engine || !this.options || this.doneSent) return;
    if (this.live < this.options.maxTicks || this.viewTick < this.live) return;
    this.playing = false;
    this.doneSent = true;
    this.post({ type: 'done', summary: this.engine.summary() });
  }

  private schedule(ms: number) {
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = this.clock.schedule(() => {
      try {
        this.loop();
      } catch (err) {
        this.stop();
        this.playing = false;
        this.busy = null;
        this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        this.postStatus();
      }
    }, ms);
  }

  private stop() {
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
  }

  private loop() {
    this.timer = null;
    const engine = this.engine;
    const options = this.options;
    if (!engine || !options) return;
    const now = this.clock.now();

    if (this.busy) {
      const b = this.busy;
      let stepped = 0;
      while (engine.tick < b.target && stepped < BUSY_TICKS_PER_SLICE && this.clock.now() - now < BUSY_SLICE_MS) {
        engine.step();
        this.record();
        stepped++;
      }
      const fresh = this.collect(b.silentUntil);
      const beforeView = this.viewTick;
      const reachedTarget = engine.tick >= b.target;
      if (reachedTarget) {
        this.busy = null;
        this.viewTick = engine.tick;
        this.replayCursor = engine.tick;
        this.sendView();
        this.playing = b.resume && engine.tick < options.maxTicks;
        this.lastWall = this.clock.now();
        this.carry = 0;
      } else if (b.advanceView && this.clock.now() - this.lastSnapshotWall >= 1000 / MAX_SNAPSHOT_HZ - 2) {
        this.viewTick = this.replayCursor = engine.tick;
        this.sendView();
      }
      // Advance the visible clock/snapshot before appending its events so the
      // decision timeline never shows choices from a later tick than the map.
      if (b.advanceView) {
        this.postStatus();
        this.sendRange(beforeView, this.viewTick);
      } else {
        this.send(fresh.events, fresh.metrics);
        this.postStatus();
      }
      if (this.busy || this.playing) this.schedule(this.busy ? 0 : 1000 / 60);
      return;
    }

    if (!this.playing) return;
    const due = ((now - this.lastWall) / 1000) * options.speed + this.carry;
    this.lastWall = now;
    const ticks = Math.min(Math.floor(due), MAX_PLAY_TICKS_PER_SLICE);
    this.carry = Math.min(Math.max(0, due - ticks), MAX_PENDING_PLAY_TICKS);
    if (ticks > 0) {
      if (this.viewTick < this.live) {
        const before = this.viewTick;
        this.replayCursor = Math.min(this.live, this.replayCursor + ticks);
        this.viewTick = this.replayCursor >= this.live ? this.live : Math.floor(this.replayCursor / RECORD_EVERY) * RECORD_EVERY;
        if (this.viewTick !== before) {
          this.sendRange(before, this.viewTick);
          this.sendView();
        }
      } else {
        let stepped = 0;
        while (stepped < ticks && engine.tick < options.maxTicks && this.clock.now() - now < PLAY_SLICE_MS) {
          engine.step();
          this.record();
          stepped++;
        }
        this.carry = Math.min(this.carry + ticks - stepped, MAX_PENDING_PLAY_TICKS);
        this.viewTick = this.replayCursor = engine.tick;
        const atEnd = engine.tick >= options.maxTicks;
        if (atEnd || now - this.lastFlushWall >= FLUSH_MS) {
          const fresh = this.collect(-1);
          this.send(fresh.events, fresh.metrics);
          this.lastFlushWall = now;
        }
        if (atEnd || now - this.lastSnapshotWall >= 1000 / MAX_SNAPSHOT_HZ - 2) this.sendView();
      }
      this.finishIfDone();
      this.postStatus();
    }
    if (this.playing) this.schedule(1000 / 60);
  }

  private startPlaying() {
    this.playing = true;
    this.lastWall = this.clock.now();
    this.carry = 0;
    this.schedule(0);
  }

  /** Move the view to the live edge, sending what the UI has not seen. */
  private toLive() {
    if (this.viewTick >= this.live) return;
    this.sendRange(this.viewTick, this.live);
    this.viewTick = this.replayCursor = this.live;
    this.sendView();
  }

  private catchUp(label: string, target: number, silentUntil: number, resume: boolean, advanceView = false) {
    this.busy = { label, from: this.live, target, silentUntil, resume, advanceView };
    this.playing = false;
    this.schedule(0);
  }

  private requireRun(action: string) {
    if (this.options?.mode !== 'run') throw new Error(`${action} during a run.`);
  }

  private requireEdit(action: string) {
    if (this.options?.mode !== 'edit' || this.playing) throw new Error(`Pause and branch into edit mode to ${action}.`);
  }

  private dispatch(msg: MainToWorker): void {
    switch (msg.type) {
      case 'load': {
        this.stop();
        this.scenario = msg.scenario;
        this.seed = msg.seed;
        this.options = msg.options;
        this.injected = [];
        this.playing = false;
        this.restart();
        const world = this.engine!.world();
        this.post({ type: 'world', world }, worldTransferables(world));
        this.sendView();
        this.send(this.log, this.metrics);
        this.post({ type: 'ready', status: this.status() });
        return;
      }
      case 'play':
        if (!this.engine || !this.options) return;
        this.requireRun('Start playback');
        if (this.busy) {
          this.busy.resume = true;
          break;
        }
        if (this.live < this.options.maxTicks || this.viewTick < this.live) this.startPlaying();
        break;
      case 'pause':
        if (this.busy) this.busy.resume = false;
        else if (this.playing) {
          const fresh = this.collect(-1);
          this.send(fresh.events, fresh.metrics);
          this.sendView();
        }
        this.playing = false;
        break;
      case 'step': {
        if (!this.engine || !this.options || this.playing || this.busy) return;
        this.requireRun('Step');
        const n = Math.min(MAX_TICKS_PER_FRAME, Math.max(0, Math.floor(msg.ticks)));
        if (this.viewTick < this.live) {
          const before = this.viewTick;
          this.viewTick = this.replayCursor = Math.min(this.live, this.viewTick + Math.max(n, RECORD_EVERY));
          this.sendRange(before, this.viewTick);
        } else {
          for (let i = 0; i < n && this.engine.tick < this.options.maxTicks; i++) {
            this.engine.step();
            this.record();
          }
          this.viewTick = this.replayCursor = this.live;
          const fresh = this.collect(-1);
          this.send(fresh.events, fresh.metrics);
        }
        this.sendView();
        this.finishIfDone();
        break;
      }
      case 'setSpeed':
        if (this.options) this.options = { ...this.options, speed: Math.max(0.25, Math.min(256, msg.speed)) };
        break;
      case 'setDispatchMode':
        this.requireEdit('change the dispatch policy');
        if (this.options) this.options = { ...this.options, dispatchMode: msg.mode };
        this.restart();
        this.sendView();
        break;
      case 'setNpcParams':
        this.requireEdit('change NPC settings');
        if (this.options) this.options = { ...this.options, npcParams: msg.params };
        this.restart();
        this.sendView();
        break;
      case 'edit': {
        if (!this.scenario || !this.engine) return;
        this.requireEdit('change the city');
        const previous = this.engine.world();
        this.scenario = applyCommands(this.scenario, [msg.cmd]);
        this.restart();
        const world = this.engine.world();
        world.dirtyChunks = dirtyChunksBetween(previous, world);
        this.post({ type: 'world', world }, worldTransferables(world));
        this.sendView();
        break;
      }
      case 'inject': {
        if (!this.engine) return;
        this.requireRun('Inject stress events');
        if (this.busy) throw new Error('Wait for the re-simulation to finish before injecting another event.');
        const reason = this.engine.rejects(msg.event);
        if (reason) throw new Error(reason);
        this.toLive();
        const live = this.live;
        // Scenario-scheduled events fire on the step that reaches their tick, so the earliest is live + 1.
        const event = { ...msg.event, t: Math.max(msg.event.t, this.engine.kind === 'preview' ? live : live + 1) };
        this.injected.push(event);
        if (this.engine.injectLive(event)) {
          const fresh = this.collect(-1);
          this.send(fresh.events, fresh.metrics);
          break;
        }
        const resume = this.playing;
        this.engine = this.build();
        // Deterministic replay of ticks the UI already has; only later output is new.
        this.collect(live);
        this.catchUp('Re-simulating with the injected event', live, live, resume);
        break;
      }
      case 'seek': {
        if (!this.engine || !this.options) return;
        // A later scrub supersedes any previous seek/catch-up. Otherwise its
        // scheduled loop can continue after the view moved and publish stale
        // snapshots or decision events over the newly selected timeline point.
        this.stop();
        this.busy = null;
        this.playing = false;
        const target = Math.max(0, Math.min(Math.floor(msg.tick), this.options.maxTicks));
        // The bridge has cleared the UI feed; resend history up to the new view.
        if (target <= this.live) {
          this.viewTick = this.replayCursor = target >= this.live ? this.live : Math.floor(target / RECORD_EVERY) * RECORD_EVERY;
          this.sendRange(-1, this.viewTick);
          this.sendView();
          this.doneSent = this.doneSent && this.viewTick >= this.live;
        } else {
          this.viewTick = this.replayCursor = this.live;
          this.sendRange(-1, this.live);
          this.catchUp('Simulating ahead', target, this.live, false, true);
        }
        break;
      }
      case 'exportLog':
        if (this.engine) this.post({ type: 'log', requestId: msg.requestId, summary: this.engine.summary() });
        return;
      case 'inspect':
        this.post({ type: 'inspect', requestId: msg.requestId, data: this.engine ? this.engine.inspect(msg.ref) : null });
        return;
    }
    this.postStatus();
  }
}

/** Chunks touched by an edit, plus every bridge chunk (a bank edit can move a whole deck). */
export const dirtyChunksBetween = (previous: WorldSnapshot, world: WorldSnapshot): number[] => {
  const chunks = new Set<number>();
  for (let c = 0; c < world.blocks.length; c++) {
    if (previous.blocks[c] === world.blocks[c] && previous.ground[c] === world.ground[c] && previous.buildingIndex[c] === world.buildingIndex[c]) continue;
    const x = c % world.w;
    const z = Math.floor(c / world.w);
    for (const [dx, dz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (x + dx >= 0 && x + dx < world.w && z + dz >= 0 && z + dz < world.h) chunks.add(chunkOfCell(world.w, c + dx + dz * world.w));
    }
  }
  if (chunks.size) for (let c = 0; c < world.blocks.length; c++) if (world.blocks[c] === BlockType.Bridge) chunks.add(chunkOfCell(world.w, c));
  return chunks.size ? [...chunks] : [0];
};
