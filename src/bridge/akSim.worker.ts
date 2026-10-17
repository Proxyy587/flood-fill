/** Browser-worker adapter for AK's deterministic simulation runner. */
import {
  MAX_SNAPSHOT_HZ,
  snapshotTransferables,
  worldTransferables,
  type MainToWorker,
  type RunOptions as UiRunOptions,
  type Scenario as UiScenario,
  type WorkerStatus,
  type WorkerToMain,
} from '../contracts';
import type { DispatchMode, Scenario as AkScenario } from '../contracts/types';
import { createSimulation } from '../sim';
import { applyCommands } from '../editor/commands';
import {
  toAkInspectorSelection,
  toAkScenario,
  toUiEvent,
  toUiInspector,
  toUiMetricsFrame,
  toUiSnapshot,
  toUiSummary,
  toWorldSnapshot,
} from './akSimAdapter';
import { MAX_WORKER_SPEED } from './simClock';

interface WorkerScope {
  postMessage(msg: WorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null;
}

type AkSimulation = ReturnType<typeof createSimulation>;
const scope = globalThis as unknown as WorkerScope;
const post = (msg: WorkerToMain, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

let simulation: AkSimulation | null = null;
let uiScenario: UiScenario | null = null;
let runnerScenario: AkScenario | null = null;
let seed = 0;
let options: UiRunOptions | null = null;
let playing = false;
let eventsSent = 0;
let metricsSent = 0;
let lastWall = 0;
let lastSnapshotWall = 0;
let carry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const status = (): WorkerStatus => ({
  tick: simulation?.tick ?? 0,
  playing,
  speed: options?.speed ?? 1,
  dispatchMode: options?.dispatchMode ?? 'negotiation',
  scenario: uiScenario?.name ?? '',
  seed,
  maxTicks: options?.maxTicks ?? 0,
});

const sendWorld = () => {
  if (!uiScenario) return;
  const world = toWorldSnapshot(uiScenario);
  post({ type: 'world', world }, worldTransferables(world));
};

const sendSnapshot = () => {
  if (!simulation || !uiScenario) return;
  const snapshot = toUiSnapshot(simulation.snapshot(), uiScenario);
  post({ type: 'snapshot', snapshot }, snapshotTransferables(snapshot));
  lastSnapshotWall = performance.now();
};

const flush = () => {
  if (!simulation) return;
  const updates = simulation.updatesSince(eventsSent, metricsSent);
  eventsSent += updates.events.length;
  metricsSent += updates.metrics.length;
  if (updates.events.length) post({ type: 'events', events: updates.events.map(toUiEvent) });
  for (const frame of updates.metrics) post({ type: 'metrics', frame: toUiMetricsFrame(frame) });
};

const clearTimer = () => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

const makeSimulation = (): AkSimulation => {
  if (!runnerScenario || !options) throw new Error('Load a scenario before starting the simulation.');
  return createSimulation(runnerScenario, seed, options.dispatchMode as DispatchMode, {
    durationTicks: options.maxTicks,
    metricsEvery: 10,
    npcParams: options.npcParams,
  });
};

const advanceTo = (target: number) => {
  if (!simulation) return;
  while (simulation.tick < target && !simulation.done) simulation.step();
};

const finishIfDone = () => {
  if (!simulation?.done) return false;
  playing = false;
  clearTimer();
  flush();
  sendSnapshot();
  post({ type: 'done', summary: toUiSummary(simulation.summary()) });
  post({ type: 'status', status: status() });
  return true;
};

const loop = () => {
  timer = null;
  if (!simulation || !options || !playing) return;
  const now = performance.now();
  const due = ((now - lastWall) / 1000) * options.speed + carry;
  lastWall = now;
  const ticks = Math.min(Math.floor(due), 240);
  carry = Math.min(due - ticks, 1);
  for (let i = 0; i < ticks && !simulation.done; i++) simulation.step();
  if (ticks > 0) {
    flush();
    if (now - lastSnapshotWall >= 1000 / MAX_SNAPSHOT_HZ - 2) sendSnapshot();
    post({ type: 'status', status: status() });
  }
  if (finishIfDone()) return;
  timer = setTimeout(loop, 1000 / 60);
};

const start = () => {
  clearTimer();
  lastWall = performance.now();
  carry = 0;
  timer = setTimeout(loop, 0);
};

const resetRunner = (targetTick = 0) => {
  simulation = makeSimulation();
  eventsSent = 0;
  metricsSent = 0;
  advanceTo(targetTick);
};

const handle = (msg: MainToWorker) => {
  switch (msg.type) {
    case 'load': {
      clearTimer();
      playing = false;
      uiScenario = structuredClone(msg.scenario);
      runnerScenario = toAkScenario(uiScenario);
      seed = msg.seed;
      options = msg.options;
      resetRunner();
      sendWorld();
      sendSnapshot();
      flush();
      post({ type: 'ready', status: status() });
      return;
    }
    case 'play':
      if (!simulation || !options) return;
      if (options.mode !== 'run' && options.mode !== 'replay') throw new Error('Start a new run before playing.');
      playing = !simulation.done;
      if (playing) start();
      break;
    case 'pause':
      playing = false;
      clearTimer();
      break;
    case 'step':
      if (!simulation || !options || options.mode === 'edit' || playing) return;
      for (let i = 0; i < Math.min(240, Math.max(0, Math.floor(msg.ticks))) && !simulation.done; i++) simulation.step();
      flush();
      sendSnapshot();
      if (finishIfDone()) return;
      break;
    case 'setSpeed':
      if (options) options = { ...options, speed: Math.max(0.25, Math.min(MAX_WORKER_SPEED, msg.speed)) };
      break;
    case 'setDispatchMode':
      if (options?.mode !== 'edit' || !uiScenario) throw new Error('Change dispatch policy in edit mode.');
      options = { ...options, dispatchMode: msg.mode };
      uiScenario.defaults.dispatchMode = msg.mode;
      runnerScenario = toAkScenario(uiScenario);
      resetRunner();
      flush();
      sendSnapshot();
      break;
    case 'setNpcParams':
      if (options?.mode !== 'edit') throw new Error('Change NPC settings in edit mode.');
      options = { ...options, npcParams: msg.params };
      resetRunner();
      flush();
      sendSnapshot();
      break;
    case 'edit': {
      if (!simulation || !uiScenario || options?.mode !== 'edit' || playing) throw new Error('Pause and branch into edit mode before changing the city.');
      uiScenario = applyCommands(uiScenario, [msg.cmd]);
      runnerScenario = toAkScenario(uiScenario);
      resetRunner();
      sendWorld();
      sendSnapshot();
      flush();
      break;
    }
    case 'inject': {
      if (!simulation || !uiScenario || options?.mode !== 'run') throw new Error('Inject stress events during a run.');
      const previousTick = simulation.tick;
      const previousSummary = simulation.summary();
      const previousEventCount = previousSummary.events.length;
      const previousMetricCount = previousSummary.metrics.length;
      const event = { ...msg.event, t: Math.max(previousTick + 1, msg.event.t) };
      uiScenario.injected.push(event);
      runnerScenario = toAkScenario(uiScenario);
      resetRunner(previousTick);
      // Replaying to the current tick preserves deterministic state; do not re-emit
      // decisions the UI has already received before the new injection.
      eventsSent = previousEventCount;
      metricsSent = previousMetricCount;
      flush();
      sendSnapshot();
      break;
    }
    case 'seek': {
      if (!simulation || !options) return;
      playing = false;
      clearTimer();
      const target = Math.max(0, Math.min(Math.floor(msg.tick), options.maxTicks));
      resetRunner(target);
      sendWorld();
      flush();
      sendSnapshot();
      break;
    }
    case 'exportLog':
      if (simulation) post({ type: 'log', requestId: msg.requestId, summary: toUiSummary(simulation.summary()) });
      return;
    case 'inspect': {
      if (!simulation) {
        post({ type: 'inspect', requestId: msg.requestId, data: null });
        return;
      }
      const selected = toAkInspectorSelection({ id: msg.ref.id, kind: msg.ref.kind });
      const data = simulation.inspect(selected as Parameters<AkSimulation['inspect']>[0]);
      post({ type: 'inspect', requestId: msg.requestId, data: toUiInspector(data) });
      return;
    }
  }
  post({ type: 'status', status: status() });
};

scope.onmessage = (event) => {
  try {
    handle(event.data);
  } catch (error) {
    playing = false;
    clearTimer();
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    post({ type: 'status', status: status() });
  }
};
