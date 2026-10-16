import type { EditCommand } from './edit';
import type { SimEvent } from './events';
import type { EntityRef } from './ids';
import type { InspectorData } from './inspector';
import type { MetricsFrame, RunSummary } from './metrics';
import type { NpcParams } from './params';
import type { DispatchMode, InjectedEvent, Scenario } from './scenario';
import type { RenderSnapshot, WorldSnapshot } from './snapshot';

export interface RunOptions {
  dispatchMode: DispatchMode;
  npcParams: NpcParams;
  /** Stop and emit `done` at this tick. */
  maxTicks: number;
  /** Ticks per wall-second. */
  speed: number;
  /** Editor mode accepts `edit` messages. */
  mode: 'edit' | 'run' | 'replay';
  /** 'core' = AK's validated simulator (default); 'preview' = the wider mock model. */
  engine?: SimEngine;
  /** Time of day at tick 0, in seconds after midnight (default 08:00 morning). */
  startTimeSeconds?: number;
}

export type SimEngine = 'core' | 'preview';
/** Morning start — the 24 h storm then runs through afternoon and night. */
export const DEFAULT_START_SECONDS = 8 * 3600;

export type MainToWorker =
  | { type: 'load'; scenario: Scenario; seed: number; options: RunOptions }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step'; ticks: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'edit'; cmd: EditCommand }
  | { type: 'inject'; event: InjectedEvent }
  | { type: 'setNpcParams'; params: NpcParams }
  | { type: 'setDispatchMode'; mode: DispatchMode }
  | { type: 'seek'; tick: number }
  | { type: 'exportLog'; requestId: number }
  | { type: 'inspect'; requestId: number; ref: EntityRef };

export interface WorkerStatus {
  tick: number;
  playing: boolean;
  speed: number;
  dispatchMode: DispatchMode;
  scenario: string;
  seed: number;
  maxTicks: number;
  /** Furthest simulated tick. Greater than `tick` while replaying recorded frames. */
  liveTick?: number;
  engine?: SimEngine;
  startTimeSeconds?: number;
  /** Long work in progress (catching up after an injected event or a forward seek). */
  busy?: { label: string; progress: number };
  /** Scenario inputs the active engine cannot execute, in plain words. */
  notes?: string[];
}

export type WorkerToMain =
  | { type: 'ready'; status: WorkerStatus }
  | { type: 'status'; status: WorkerStatus }
  | { type: 'world'; world: WorldSnapshot }
  | { type: 'snapshot'; snapshot: RenderSnapshot }
  | { type: 'events'; events: SimEvent[] }
  | { type: 'metrics'; frame: MetricsFrame }
  | { type: 'done'; summary: RunSummary }
  | { type: 'log'; requestId: number; summary: RunSummary }
  | { type: 'inspect'; requestId: number; data: InspectorData | null }
  | { type: 'error'; message: string };

/** Snapshot rate cap from docs/ARCHITECTURE.md §2. */
export const MAX_SNAPSHOT_HZ = 20;
export const METRICS_EVERY_TICKS = 10;
