import { create } from 'zustand';
import { DEFAULT_START_SECONDS, sameEntity, type DispatchMode, type EntityRef, type InspectorData, type SimEngine, type LayaDecisionTape } from '../contracts';

export type CameraMode = 'overview' | 'focus' | 'follow' | 'free';
export type ViewMode = 'truth' | 'belief';
export type ViewPreset = 'top' | 'oblique' | 'side';
export type CameraCommand =
  | { kind: 'rotate'; by: number }
  | { kind: 'north' }
  | { kind: 'tilt'; preset: ViewPreset }
  | { kind: 'zoom'; by: number };

/** Analysis lenses: the city desaturates and one measure is painted over it. */
export type Lens = 'none' | 'people' | 'traffic' | 'depth' | 'exposure' | 'power';

export type LandmarkCategory = 'medical' | 'shelter' | 'police' | 'command' | 'fire' | 'power' | 'boats' | 'air';

/** A name pinned to the map. Districts label areas; landmarks label civic buildings. */
export interface MapLabel {
  key: string;
  text: string;
  x: number;
  z: number;
  kind: 'district' | 'landmark';
  category?: LandmarkCategory;
  /** Building id, for live status and click-to-focus. */
  building?: number;
}

export interface Overlays {
  routes: boolean;
  reports: boolean;
  signals: boolean;
  rain: boolean;
  shadows: boolean;
  labels: boolean;
}

export interface HoverInfo {
  cell: number;
  /** Ground elevation in metres. */
  elevation: number;
  /** Water depth in metres. */
  depth: number;
  screen: { x: number; y: number };
}

/** Chosen before a run; sent with every load. */
export interface RunSettings {
  engine: SimEngine;
  /** Time of day at tick 0, seconds after midnight. */
  startSeconds: number;
}

export interface SceneState {
  connection: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  scenario: string;
  seed: number;
  /** Tick on screen. Behind `liveTick` while replaying. */
  tick: number;
  liveTick: number;
  maxTicks: number;
  /** Engine and start time of the loaded run (from the worker). */
  engine: SimEngine;
  startSeconds: number;
  busy: { label: string; progress: number } | null;
  /** Scenario inputs the running engine cannot execute. */
  notes: string[];
  runSettings: RunSettings;
  layaTape: LayaDecisionTape | null;
  playing: boolean;
  speed: number;
  dispatchMode: DispatchMode;
  weather: { rain: number; wind: number };

  /** Cell under the pointer (index `z * W + x`), for the editor. */
  hoverCell: number | null;
  /** Entity under the pointer. */
  hoverEntity: EntityRef | null;
  hoverInfo: HoverInfo | null;
  selected: EntityRef | null;
  inspector: InspectorData | null;
  camera: { mode: CameraMode; target: EntityRef | null; nonce: number };
  cameraCmd: { cmd: CameraCommand; nonce: number } | null;
  /** Camera heading (radians, 0 = looking north) and tilt (0 = top-down), published by the renderer. */
  heading: number;
  tilt: number;
  view: ViewMode;
  lens: Lens;
  overlays: Overlays;
  labels: MapLabel[];
  /** Generic evidence highlight (findings) — pink. */
  highlightCells: number[];
  /** Proposal create ghosts — green. */
  highlightCreate: number[];
  /** Proposal alter ghosts — red. */
  highlightAlter: number[];
  fps: number;

  setHover: (cell: number | null, entity: EntityRef | null) => void;
  select: (ref: EntityRef | null) => void;
  focus: (ref: EntityRef) => void;
  follow: (ref: EntityRef) => void;
  overview: () => void;
  cameraCommand: (cmd: CameraCommand) => void;
  setView: (view: ViewMode) => void;
  setLens: (lens: Lens) => void;
  toggleOverlay: (key: keyof Overlays) => void;
  setRunSettings: (patch: Partial<RunSettings>) => void;
  setLayaTape: (tape: LayaDecisionTape | null) => void;
}

export const useSceneStore = create<SceneState>()((set, get) => ({
  connection: 'idle',
  error: null,
  scenario: '',
  seed: 0,
  tick: 0,
  liveTick: 0,
  maxTicks: 0,
  engine: 'core',
  startSeconds: DEFAULT_START_SECONDS,
  busy: null,
  notes: [],
  runSettings: { engine: 'core', startSeconds: DEFAULT_START_SECONDS },
  layaTape: null,
  playing: false,
  /** Fast enough to feel morning → night over a multi-hour flood without waiting wall-hours. */
  speed: 16,
  dispatchMode: 'negotiation',
  weather: { rain: 0, wind: 0 },

  hoverCell: null,
  hoverEntity: null,
  hoverInfo: null,
  selected: null,
  inspector: null,
  camera: { mode: 'overview', target: null, nonce: 0 },
  cameraCmd: null,
  heading: 0,
  tilt: 0.86,
  view: 'truth',
  lens: 'none',
  overlays: { routes: true, reports: true, signals: true, rain: true, shadows: true, labels: true },
  labels: [],
  highlightCells: [],
  highlightCreate: [],
  highlightAlter: [],
  fps: 0,

  setHover: (cell, entity) => {
    const s = get();
    if (s.hoverCell === cell && sameEntity(s.hoverEntity, entity)) return;
    set({ hoverCell: cell, hoverEntity: entity });
  },
  select: (ref) => {
    const s = get();
    if (sameEntity(s.selected, ref)) return;
    // Selecting never moves the camera; it only stops a follow on a different target.
    const keep = s.camera.mode !== 'follow' || sameEntity(s.camera.target, ref);
    set({
      selected: ref,
      inspector: null,
      ...(keep ? {} : { camera: { mode: 'free', target: null, nonce: s.camera.nonce + 1 } }),
    });
  },
  focus: (ref) => {
    const s = get();
    set({
      selected: ref,
      inspector: sameEntity(s.selected, ref) ? s.inspector : null,
      camera: { mode: 'focus', target: ref, nonce: s.camera.nonce + 1 },
    });
  },
  follow: (ref) => {
    const s = get();
    set({
      selected: ref,
      inspector: sameEntity(s.selected, ref) ? s.inspector : null,
      camera: { mode: 'follow', target: ref, nonce: s.camera.nonce + 1 },
    });
  },
  overview: () => set((s) => ({ camera: { mode: 'overview', target: null, nonce: s.camera.nonce + 1 } })),
  cameraCommand: (cmd) => set((s) => ({ cameraCmd: { cmd, nonce: (s.cameraCmd?.nonce ?? 0) + 1 } })),
  setView: (view) => set({ view }),
  setLens: (lens) => set({ lens }),
  toggleOverlay: (key) => set((s) => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),
  setRunSettings: (patch) => set((s) => ({ runSettings: { ...s.runSettings, ...patch } })),
  setLayaTape: (layaTape) => set({ layaTape }),
}));
