'use client';

import { BarChart3, FolderOpen, Hammer, Layers, Mountain, MousePointer2, ScrollText, SlidersHorizontal, Zap, type LucideIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { editorBus } from '../bridge/buses';
import { connectBridge } from '../bridge/connect';
import { createSimWorker } from '../bridge/createSimWorker';
import { useSceneStore } from '../bridge/sceneStore';
import { SimBridge } from '../bridge/SimBridge';
import { useSimFeedStore } from '../bridge/simFeedStore';
import { BlockType, type Scenario, type ScenarioPatch } from '../contracts';
import { mockScenario } from '../contracts/mocks';
import { ScenarioSchema } from '../contracts/schemas';
import { startAutosave } from '../editor/autosave';
import { BLOCK_META } from '../editor/catalog';
import { daylightAt } from '../render/effects/daylight';
import { SoundDirector } from '../ui/audio/SoundDirector';
import { NewsTicker } from '../ui/news/NewsTicker';
import { IncidentBoard } from '../ui/showcase/IncidentBoard';
import { ScoreRecorder } from '../ui/score/ScoreCard';
import { useEditorStore, type EditorTool } from '../ui/store/editorStore';
import { describeCity, useCityStore } from './city';
import { Compass, Footer, HoverTip, Identity, Inspector, LensCard, Vitals } from './Hud';
import { BuildTool, Hotbar, TerrainTool } from './tools/BuildTool';
import { FilesTool } from './tools/FilesTool';
import { LensTool } from './tools/LensTool';
import { LogTool } from './tools/LogTool';
import { ReportTool } from './tools/ReportTool';
import { ScenarioTool } from './tools/ScenarioTool';
import { StressTool } from './tools/StressTool';
import { RecoveryPrompt } from './Recovery';
import { Transport } from './Transport';
import styles from './shell.module.css';

const SceneCanvas = dynamic(() => import('../render/SceneCanvas').then((m) => m.SceneCanvas), {
  ssr: false,
  loading: () => <p className={styles.loading}>Drawing the city…</p>,
});

type RailTool = 'inspect' | 'build' | 'terrain' | 'lens' | 'stress' | 'scenario' | 'log' | 'report' | 'files';

const RAIL: ({ id: RailTool; label: string; key: string; icon: LucideIcon } | 'gap')[] = [
  { id: 'inspect', label: 'Inspect', key: 'V', icon: MousePointer2 },
  { id: 'build', label: 'Build', key: 'B', icon: Hammer },
  { id: 'terrain', label: 'Terrain', key: 'T', icon: Mountain },
  'gap',
  { id: 'lens', label: 'Lenses', key: 'L', icon: Layers },
  { id: 'stress', label: 'Stress events', key: 'X', icon: Zap },
  { id: 'log', label: 'What happened', key: 'G', icon: ScrollText },
  { id: 'report', label: 'Report and critic', key: 'R', icon: BarChart3 },
  'gap',
  { id: 'scenario', label: 'Scenario', key: 'P', icon: SlidersHorizontal },
  { id: 'files', label: 'Files', key: 'O', icon: FolderOpen },
];

const BUILD_TOOLS: EditorTool[] = ['place', 'line', 'rect', 'building', 'move', 'power', 'eyedropper', 'erase'];

/** Which editor tool the map uses while a rail tool is open. */
const editorToolFor = (tool: RailTool): EditorTool => {
  const s = useEditorStore.getState();
  if (tool === 'build') return BUILD_TOOLS.includes(s.tool) ? s.tool : BLOCK_META[s.block].building ? 'building' : 'place';
  if (tool === 'terrain') return s.tool === 'lower' ? 'lower' : 'raise';
  return 'select';
};

/** Load options shared by edit previews, runs and restarts. */
const loadOptions = (mode: 'edit' | 'run') => {
  const scene = useSceneStore.getState();
  return {
    mode,
    npcParams: useEditorStore.getState().params,
    speed: scene.speed,
    engine: scene.runSettings.engine,
    startTimeSeconds: scene.runSettings.startSeconds,
    /** 24 h compound flood so morning starts reach night (docs/FLOOD_DESIGN.md). */
    maxTicks: mode === 'run' ? 86_400 : 3_600,
  };
};

/** Worker lifetime, editor ↔ simulation sync, and the tool-based shell. */
export function FloodSimApp({ atlasBack = false }: { atlasBack?: boolean } = {}) {
  const [bridge, setBridge] = useState<SimBridge | null>(null);
  const [tool, setToolState] = useState<RailTool>('inspect');
  const [branch, setBranch] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const error = useSceneStore((s) => s.error);
  const dark = useSceneStore((s) => daylightAt(s.startSeconds + s.tick).day < 0.4);
  const scenario = useEditorStore((s) => s.scenario);
  const mode = useEditorStore((s) => s.mode);
  const events = useSimFeedStore((s) => s.events.length);
  const [seenEvents, setSeenEvents] = useState(0);

  const setTool = (next: RailTool) => {
    const t = next === tool && next !== 'inspect' ? 'inspect' : next;
    setToolState(t);
    useEditorStore.setState({ tool: editorToolFor(t), preview: [], moveSource: null, powerSource: null });
    if (t === 'log') setSeenEvents(useSimFeedStore.getState().events.length);
  };

  useEffect(() => {
    const b = new SimBridge(createSimWorker());
    const disconnect = connectBridge(b);
    const offReady = b.on('ready', () => setBridge(b));
    useEditorStore.getState().load(mockScenario());
    const loadEditor = () => {
      const s = useEditorStore.getState();
      if (!s.scenario) return;
      useSimFeedStore.getState().reset();
      useSceneStore.setState({ connection: 'loading', selected: null, inspector: null });
      b.load(s.scenario, s.scenario.defaults.seed, loadOptions('edit'));
    };
    loadEditor();
    const stopAutosave = startAutosave();
    const offEditor = useEditorStore.subscribe((s, prev) => {
      if (s.revision === prev.revision || s.mode !== 'edit') return;
      // Fresh commands go through editorBus; undo and configuration use checkpoints.
      const command = s.past.at(-1);
      const newCommand = command !== prev.past.at(-1) && command !== prev.future.at(-1) && s.future.length === 0 && command?.before === prev.scenario;
      if (!newCommand) loadEditor();
    });
    let settingsTimer: ReturnType<typeof setTimeout> | null = null;
    const offSettings = useSceneStore.subscribe((s, prev) => {
      if (s.runSettings === prev.runSettings) return;
      if (settingsTimer) clearTimeout(settingsTimer);
      settingsTimer = setTimeout(() => {
        const cur = useSceneStore.getState();
        const editor = useEditorStore.getState();
        if (!editor.scenario) return;
        if (editor.mode === 'edit') {
          loadEditor();
          return;
        }
        // Paused run: a new start time (or engine) restarts the storm from that clock.
        if (cur.playing) b.pause();
        useSimFeedStore.getState().reset();
        b.load(editor.scenario, editor.scenario.defaults.seed, {
          ...loadOptions('run'),
          speed: cur.speed,
          engine: cur.runSettings.engine,
          startTimeSeconds: cur.runSettings.startSeconds,
        });
      }, 280);
    });
    return () => {
      offReady();
      offEditor();
      offSettings();
      if (settingsTimer) clearTimeout(settingsTimer);
      stopAutosave();
      disconnect();
      b.dispose();
    };
  }, []);

  // Names and map labels follow the city as it is edited.
  useEffect(() => {
    if (!scenario) return;
    const timer = setTimeout(() => {
      const { names, labels } = describeCity(scenario);
      useCityStore.setState({ names });
      useSceneStore.setState({ labels });
    }, 120);
    return () => clearTimeout(timer);
  }, [scenario]);

  const play = () => {
    if (!bridge) return;
    const s = useEditorStore.getState();
    const scene = useSceneStore.getState();
    if (scene.playing) {
      bridge.pause();
      return;
    }
    if (!s.scenario || scene.connection !== 'ready') return;
    if (s.mode === 'edit' || scene.tick >= scene.maxTicks) {
      const valid = ScenarioSchema.safeParse(s.scenario);
      if (!valid.success) {
        useSceneStore.setState({ error: valid.error.issues[0].message });
        return;
      }
      useEditorStore.setState({ mode: 'run', preview: [] });
      if (tool === 'build' || tool === 'terrain') setTool('inspect');
      useSimFeedStore.getState().reset();
      bridge.load(s.scenario, s.scenario.defaults.seed, loadOptions('run'));
    }
    bridge.play();
  };
  const restart = () => {
    const s = useEditorStore.getState();
    if (!bridge || !s.scenario) return;
    useSimFeedStore.getState().reset();
    bridge.load(s.scenario, s.scenario.defaults.seed, loadOptions('run'));
  };
  const askBranch = () => {
    bridge?.pause();
    setBranch(true);
  };
  const acceptBranch = () => {
    const s = useEditorStore.getState();
    if (!s.scenario) return;
    s.load({ ...s.scenario, name: `${s.scenario.name.replace(/ · branch$/, '')} · branch` });
    setBranch(false);
    setTool('build');
  };
  /** Critic proposals land in a branch of the city as one undoable edit. */
  const applyPatch = (patch: ScenarioPatch) => {
    bridge?.pause();
    const s = useEditorStore.getState();
    if (!s.scenario) return;
    if (s.mode !== 'edit') s.load({ ...s.scenario, name: `${s.scenario.name.replace(/ · branch$/, '')} · branch` });
    const cmd = { kind: 'applyPatch' as const, patch };
    useEditorStore.getState().commit([cmd]);
    editorBus.dispatch(cmd);
    useEditorStore.setState({ notice: `Applied “${patch.title}”. Undo with ⌘Z; start the storm to test it.` });
  };
  useEffect(() => {
    if (branch) dialog.current?.showModal();
    else dialog.current?.close();
  }, [branch]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable=true],dialog')) return;
      const s = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') {
        e.preventDefault();
        play();
        return;
      }
      if (e.key === 'Escape') {
        if (tool !== 'inspect') setTool('inspect');
        else useSceneStore.getState().select(null);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && s.mode === 'edit') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && s.mode === 'edit') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod || e.altKey) return;
      const railHit = RAIL.find((r) => r !== 'gap' && r.key.toLowerCase() === e.key.toLowerCase());
      if (railHit && railHit !== 'gap') {
        setTool(railHit.id);
        return;
      }
      if (s.mode === 'edit' && tool === 'build') {
        if (/^[1-9]$/.test(e.key)) s.pickSlot(+e.key - 1);
        if (e.key === '[' || e.key === ']') useEditorStore.setState({ brush: Math.max(1, Math.min(9, s.brush + (e.key === ']' ? 2 : -2))) });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const template = (name: string) => {
    const s = mockScenario();
    if (name === 'demo:stress') {
      s.name = 'riverside-everything-fails';
      // Core-safe stress pack: only injections the validated runner accepts.
      const incidents: Scenario['injected'] = [
        { t: 600, kind: 'bridge_closed', cell: s.blocks.findIndex((block) => block === BlockType.Bridge) },
      ];
      if (s.fleet.boats > 0 && s.fleet.boatOperators > 0) {
        incidents.push({ t: 600, kind: 'boat_failure', target: s.fleet.ambulances + s.fleet.policeCars + 1 });
      }
      const shelter = s.buildings.find((building) => building.type === BlockType.Shelter);
      if (shelter) incidents.push({ t: 600, kind: 'shelter_overflow', target: shelter.id });
      const substation = s.powerGrid.nodes.find((node) => node.kind === 'substation');
      if (substation) incidents.push({ t: 600, kind: 'substation_flooded', target: substation.id });
      s.injected = incidents;
    }
    useEditorStore.getState().load(s);
  };

  const close = () => setTool('inspect');
  const unseen = tool !== 'log' && events > seenEvents && mode === 'run';

  return (
    <main className={styles.app} data-night={dark}>
      <section className={styles.stage} aria-label="City map">
        {bridge ? <SceneCanvas bridge={bridge} /> : <p className={styles.loading}>Starting the simulation…</p>}
      </section>

      <Identity atlasBack={atlasBack} />

      <nav className={`${styles.panel} ${styles.rail}`} aria-label="Tools">
        {RAIL.map((r, i) =>
          r === 'gap' ? (
            <span key={`gap-${i}`} className={styles.railGap} />
          ) : (
            <button key={r.id} type="button" className={styles.tool} aria-pressed={tool === r.id} aria-label={r.label} onClick={() => setTool(r.id)}>
              <r.icon size={18} />
              {r.id === 'log' && unseen && <span className={styles.dot} />}
              <span className={styles.tip}>
                {r.label}
                <kbd>{r.key}</kbd>
              </span>
            </button>
          ),
        )}
      </nav>

      {tool === 'build' && <BuildTool onClose={close} onBranch={askBranch} />}
      {tool === 'terrain' && <TerrainTool onClose={close} onBranch={askBranch} />}
      {tool === 'lens' && <LensTool onClose={close} />}
      {tool === 'stress' && bridge && <StressTool bridge={bridge} onClose={close} />}
      {tool === 'log' && bridge && <LogTool bridge={bridge} onClose={close} />}
      {tool === 'scenario' && <ScenarioTool onClose={close} />}
      {tool === 'files' && <FilesTool onClose={close} onTemplate={template} />}
      {tool === 'report' && <ReportTool onClose={close} onApply={applyPatch} />}

      <div className={styles.right}>
        <Vitals onScore={() => setTool('report')} />
        {tool === 'inspect' && mode === 'run' && <IncidentBoard />}
        <Inspector />
      </div>

      <ScoreRecorder />
      <SoundDirector />
      <RecoveryPrompt />
      {tool === 'build' && mode === 'edit' && <Hotbar />}
      <div className={styles.dock}>
        <NewsTicker />
        {bridge && <Transport bridge={bridge} onPlay={play} onRestart={restart} onBranch={askBranch} />}
      </div>
      <Compass />
      {tool === 'inspect' && <LensCard />}
      <Footer />
      <HoverTip />

      {error && (
        <div className={`${styles.panel} ${styles.alert}`} role="alert">
          <span>{error}</span>
          <button type="button" className={styles.button} onClick={() => useSceneStore.setState({ error: null, connection: 'ready' })}>
            Dismiss
          </button>
        </div>
      )}

      <dialog ref={dialog} className={styles.dialog} onCancel={() => setBranch(false)}>
        <h2>Branch this city?</h2>
        <p>The storm stops and you get an editable copy of the city. The next run starts from the beginning with the same seed, so you can compare it fairly against this one.</p>
        <div className={styles.row}>
          <button type="button" className={styles.button} onClick={() => setBranch(false)}>
            Keep watching
          </button>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={acceptBranch}>
            Branch and edit
          </button>
        </div>
      </dialog>
    </main>
  );
}
