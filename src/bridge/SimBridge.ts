import {
  DEFAULT_NPC_PARAMS,
  type DispatchMode,
  type EditCommand,
  type EntityRef,
  type InjectedEvent,
  type InspectorData,
  type MainToWorker,
  type MetricsFrame,
  type NpcParams,
  type RenderSnapshot,
  type RunOptions,
  type RunSummary,
  type Scenario,
  type SimEvent,
  type WorkerStatus,
  type WorkerToMain,
  type WorldSnapshot,
} from '../contracts';

export interface SimBridgeEvents {
  reset: undefined;
  world: WorldSnapshot;
  snapshot: RenderSnapshot;
  events: SimEvent[];
  metrics: MetricsFrame;
  done: RunSummary;
  status: WorkerStatus;
  ready: WorkerStatus;
  error: string;
}

type Listener<K extends keyof SimBridgeEvents> = (value: SimBridgeEvents[K]) => void;

/** Minimal surface of a Worker, so tests can pass an in-process fake. */
export interface WorkerLike {
  postMessage(msg: MainToWorker): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerToMain>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  dispatchMode: 'negotiation',
  npcParams: DEFAULT_NPC_PARAMS,
  maxTicks: 3600,
  speed: 4,
  mode: 'run',
};

/** Main-thread handle on the sim worker. */
export class SimBridge {
  private listeners = new Map<keyof SimBridgeEvents, Set<(value: never) => void>>();
  private requests = new Map<number, (msg: WorkerToMain) => void>();
  private nextRequest = 1;
  private _world: WorldSnapshot | null = null;
  private _snapshot: RenderSnapshot | null = null;
  private _status: WorkerStatus | null = null;
  /** Drop already-posted worker output until the newly selected view is acknowledged. */
  private pendingSeekLimit: number | null = null;

  constructor(private worker: WorkerLike) {
    worker.onmessage = (e) => this.receive(e.data);
    worker.onerror = (e) => this.fire('error', e.message || 'sim worker crashed');
  }

  /** Latest full world (terrain chunks are rebuilt from this). */
  get world(): WorldSnapshot | null {
    return this._world;
  }

  get snapshot(): RenderSnapshot | null {
    return this._snapshot;
  }

  get status(): WorkerStatus | null {
    return this._status;
  }

  on<K extends keyof SimBridgeEvents>(type: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as (value: never) => void);
    return () => {
      set.delete(fn as (value: never) => void);
    };
  }

  load(scenario: Scenario, seed: number, options: Partial<RunOptions> = {}): void {
    this.pendingSeekLimit = null;
    this.fire('reset',undefined);
    this._world = null;
    this._snapshot = null;
    this.send({ type: 'load', scenario, seed, options: { ...DEFAULT_RUN_OPTIONS, dispatchMode: scenario.defaults.dispatchMode, ...options } });
  }

  play(): void {
    this.send({ type: 'play' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  step(ticks = 1): void {
    this.send({ type: 'step', ticks });
  }

  setSpeed(speed: number): void {
    this.send({ type: 'setSpeed', speed });
  }

  edit(cmd: EditCommand): void {
    this.send({ type: 'edit', cmd });
  }

  inject(event: InjectedEvent): void {
    this.send({ type: 'inject', event });
  }

  setNpcParams(params: NpcParams): void {
    this.send({ type: 'setNpcParams', params });
  }

  setDispatchMode(mode: DispatchMode): void {
    this.send({ type: 'setDispatchMode', mode });
  }

  seek(tick: number): void {
    this.pendingSeekLimit = Math.max(0, Math.floor(tick));
    this.fire('reset',undefined);
    this.send({ type: 'seek', tick });
  }

  inspect(ref: EntityRef): Promise<InspectorData | null> {
    return this.request((requestId) => ({ type: 'inspect', requestId, ref }), (msg) => (msg.type === 'inspect' ? msg.data : null));
  }

  exportLog(): Promise<RunSummary | null> {
    return this.request((requestId) => ({ type: 'exportLog', requestId }), (msg) => (msg.type === 'log' ? msg.summary : null));
  }

  dispose(): void {
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.listeners.clear();
    this.requests.clear();
  }

  private send(msg: MainToWorker): void {
    this.worker.postMessage(msg);
  }

  private request<T>(build: (requestId: number) => MainToWorker, pick: (msg: WorkerToMain) => T): Promise<T> {
    const requestId = this.nextRequest++;
    return new Promise((resolve) => {
      this.requests.set(requestId, (msg) => resolve(pick(msg)));
      this.send(build(requestId));
    });
  }

  private fire<K extends keyof SimBridgeEvents>(type: K, value: SimBridgeEvents[K]): void {
    this.listeners.get(type)?.forEach((fn) => (fn as Listener<K>)(value));
  }

  private receive(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'world':
        this._world = msg.world;
        this.fire('world', msg.world);
        break;
      case 'snapshot':
        this._snapshot = msg.snapshot;
        this.fire('snapshot', msg.snapshot);
        break;
      case 'events': {
        const limit = this.pendingSeekLimit;
        this.fire('events', limit === null ? msg.events : msg.events.filter((event) => event.tick <= limit));
        break;
      }
      case 'metrics':
        if (this.pendingSeekLimit === null || msg.frame.tick <= this.pendingSeekLimit) this.fire('metrics', msg.frame);
        break;
      case 'done':
        this.fire('done', msg.summary);
        break;
      case 'status':
        if (this.pendingSeekLimit !== null && msg.status.tick <= this.pendingSeekLimit) this.pendingSeekLimit = null;
        this._status = msg.status;
        this.fire('status', msg.status);
        break;
      case 'ready':
        this.pendingSeekLimit = null;
        this._status = msg.status;
        this.fire('ready', msg.status);
        this.fire('status', msg.status);
        break;
      case 'inspect':
      case 'log': {
        const resolve = this.requests.get(msg.requestId);
        this.requests.delete(msg.requestId);
        resolve?.(msg);
        break;
      }
      case 'error':
        this.fire('error', msg.message);
        break;
    }
  }
}
