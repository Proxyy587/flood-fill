// Web Worker entry that drives the MockSim with the real worker protocol.
// Swap for AK's `src/sim/worker.ts` in createSimWorker.ts once it lands.
import {
  MAX_SNAPSHOT_HZ,
  BlockType,
  chunkOfCell,
  snapshotTransferables,
  worldTransferables,
  type EditCommand,
  type InjectedEvent,
  type MainToWorker,
  type RunOptions,
  type Scenario,
  type WorkerStatus,
  type WorkerToMain,
} from '../contracts';
import { ScenarioPreview } from './ScenarioPreview';
import { applyCommands } from '../editor/commands';

interface WorkerScope {
  postMessage(msg: WorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<MainToWorker>) => void) | null;
}

type Input = { tick: number; edit: EditCommand } | { tick: number; inject: InjectedEvent };

const scope = globalThis as unknown as WorkerScope;
const post = (msg: WorkerToMain, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

let sim: ScenarioPreview | null = null;
let scenario: Scenario | null = null;
let seed = 0;
let options: RunOptions | null = null;
let playing = false;
let inputs: Input[] = [];
let metricsSent = 0;
let carry = 0;
let lastWall = 0;
let lastSnapshotWall = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const status = (): WorkerStatus => ({
  tick: sim?.tick ?? 0,
  playing,
  speed: options?.speed ?? 1,
  dispatchMode: sim?.dispatchMode ?? 'negotiation',
  scenario: scenario?.name ?? '',
  seed,
  maxTicks: options?.maxTicks ?? 0,
});

const sendSnapshot = () => {
  if (!sim) return;
  const snapshot = sim.snapshot();
  post({ type: 'snapshot', snapshot }, snapshotTransferables(snapshot));
  lastSnapshotWall = performance.now();
};

const flush = () => {
  if (!sim) return;
  const events = sim.drainEvents();
  if (events.length) {
    post({ type: 'events', events });
  }
  while (metricsSent < sim.metricsLog.length) post({ type: 'metrics', frame: sim.mapMetrics(sim.metricsLog[metricsSent++]) });
};

const applyInputsAt = (s: ScenarioPreview, tick: number) => {
  for (const input of inputs) {
    if (input.tick !== tick) continue;
    if ('edit' in input) s.applyEdit(input.edit);
    else s.inject(input.inject);
  }
};

const create = (): ScenarioPreview => {
  if (!scenario || !options) throw new Error('load() first');
  const s = new ScenarioPreview(scenario, seed, { dispatchMode: options.dispatchMode, npcParams: options.npcParams });
  applyInputsAt(s, 0);
  return s;
};

const stepOnce = () => {
  if (!sim) return;
  sim.step();
  applyInputsAt(sim, sim.tick);
};

const loop = () => {
  timer = null;
  if (!sim || !options || !playing) return;
  const now = performance.now();
  const due = ((now - lastWall) / 1000) * options.speed + carry;
  lastWall = now;
  const ticks = Math.min(Math.floor(due), 240);
  carry = Math.min(due - ticks, 1);
  for (let i = 0; i < ticks && sim.tick < options.maxTicks; i++) stepOnce();
  if (ticks > 0) {
    flush();
    if (now - lastSnapshotWall >= 1000 / MAX_SNAPSHOT_HZ - 2) sendSnapshot();
    post({ type: 'status', status: status() });
  }
  if (sim.tick >= options.maxTicks) {
    playing = false;
    sendSnapshot();
    post({ type: 'done', summary: sim.summary() });
    post({ type: 'status', status: status() });
    return;
  }
  timer = setTimeout(loop, 1000 / 60);
};

const start = () => {
  if (timer) clearTimeout(timer);
  lastWall = performance.now();
  carry = 0;
  timer = setTimeout(loop, 0);
};

const handle = (msg: MainToWorker) => {
  switch (msg.type) {
    case 'load': {
      scenario = msg.scenario;
      seed = msg.seed;
      options = msg.options;
      inputs = [];
      metricsSent = 0;
      playing = false;
      sim = create();
      const world = sim.world();
      post({ type: 'world', world }, worldTransferables(world));
      sendSnapshot();
      flush();
      post({ type: 'ready', status: status() });
      return;
    }
    case 'play':
      if (!sim || !options) return;
      if (options.mode !== 'run') throw new Error('Start a new run before playing.');
      playing = sim.tick < options.maxTicks;
      if (playing) start();
      break;
    case 'pause':
      playing = false;
      break;
    case 'step':
      if (!sim || !options || options.mode !== 'run' || playing) return;
      for (let i = 0; i < Math.min(240, Math.max(0, Math.floor(msg.ticks))) && sim.tick < options.maxTicks; i++) stepOnce();
      flush();
      sendSnapshot();
      if(sim.tick>=options.maxTicks)post({type:'done',summary:sim.summary()});
      break;
    case 'setSpeed':
      if (options) options = { ...options, speed: Math.max(0.25, Math.min(64, msg.speed)) };
      break;
    case 'setDispatchMode':
      if (options?.mode !== 'edit') throw new Error('Change policy in edit mode to keep comparisons reproducible.');
      if (sim) sim.dispatchMode = msg.mode;
      if (options) options = { ...options, dispatchMode: msg.mode };
      break;
    case 'setNpcParams':
      if (options?.mode !== 'edit') throw new Error('Change NPC settings in edit mode.');
      if (sim) sim.params = msg.params;
      if (options) options = { ...options, npcParams: msg.params };
      break;
    case 'edit': {
      if (!sim || !scenario || options?.mode !== 'edit' || playing) throw new Error('Pause and branch into edit mode before changing the city.');
      const previous=sim.world();
      // Recreate from the document so power edges and building tables stay
      // coherent even where MockSim.applyEdit is a placeholder.
      scenario = applyCommands(scenario, [msg.cmd]);
      inputs = [];
      metricsSent = 0;
      sim = create();
      const world = sim.world();
      const chunks=new Set<number>();
      for(let c=0;c<world.blocks.length;c++)if(previous.blocks[c]!==world.blocks[c]||previous.ground[c]!==world.ground[c]||previous.buildingIndex[c]!==world.buildingIndex[c]) {
        const x=c%world.w,z=Math.floor(c/world.w);
        for(const [dx,dz] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]])if(x+dx>=0&&x+dx<world.w&&z+dz>=0&&z+dz<world.h)chunks.add(chunkOfCell(world.w,c+dx+dz*world.w));
      }
      // Bridges share a span height; an edited bank can change the entire deck.
      if(chunks.size)for(let c=0;c<world.blocks.length;c++)if(world.blocks[c]===BlockType.Bridge)chunks.add(chunkOfCell(world.w,c));
      world.dirtyChunks=chunks.size?[...chunks]:[0];
      post({ type: 'world', world }, worldTransferables(world));
      flush();
      sendSnapshot();
      break;
    }
    case 'inject':
      if (!sim || options?.mode !== 'run') throw new Error('Inject stress events during a run.');
      inputs.push({ tick: Math.max(sim.tick, msg.event.t), inject: { ...msg.event, t: Math.max(sim.tick, msg.event.t) } });
      sim.inject({ ...msg.event, t: Math.max(sim.tick, msg.event.t) });
      flush();
      break;
    case 'seek': {
      if (!sim) return;
      playing = false;
      const target = Math.max(0, Math.min(msg.tick, options?.maxTicks ?? msg.tick));
      sim = create();
      metricsSent = 0;
      while (sim.tick < target) stepOnce();
      flush();
      const world = sim.world();
      post({ type: 'world', world }, worldTransferables(world));
      sendSnapshot();
      break;
    }
    case 'exportLog':
      if (sim) post({ type: 'log', requestId: msg.requestId, summary: sim.summary() });
      return;
    case 'inspect':
      post({ type: 'inspect', requestId: msg.requestId, data: sim ? sim.inspect(msg.ref) : null });
      return;
  }
  post({ type: 'status', status: status() });
};

scope.onmessage = (e) => {
  try {
    handle(e.data);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
