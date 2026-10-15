'use client';

import { useSceneStore, type Overlays } from '../bridge/sceneStore';
import styles from '../ui/hud/Sandbox.module.css';

const OVERLAYS: { key: keyof Overlays; label: string }[] = [
  { key: 'routes', label: 'Routes' },
  { key: 'reports', label: 'Report rings' },
  { key: 'signals', label: 'Signals' },
  { key: 'rain', label: 'Rain' },
  { key: 'shadows', label: 'Shadows' },
];

/** Camera modes, truth-vs-belief toggle and overlay switches (AJ-owned). */
export function ViewControls() {
  const view = useSceneStore((s) => s.view);
  const setView = useSceneStore((s) => s.setView);
  const overlays = useSceneStore((s) => s.overlays);
  const toggle = useSceneStore((s) => s.toggleOverlay);
  const camera = useSceneStore((s) => s.camera);
  const selected = useSceneStore((s) => s.selected);
  const overview = useSceneStore((s) => s.overview);
  const focus = useSceneStore((s) => s.focus);
  const follow = useSceneStore((s) => s.follow);
  const canFollow = selected && (selected.kind === 'npc' || selected.kind === 'vehicle');

  return (
    <section className={styles.section} aria-label="Camera and overlays">
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">View</p>
        <div className="grid grid-cols-2 overflow-hidden rounded-md" role="group" aria-label="Truth or HQ belief">
          {(['truth', 'belief'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`py-1.5 ${view === v ? (v === 'belief' ? 'bg-violet-700' : 'bg-sky-700') : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              {v === 'truth' ? 'Truth' : 'HQ belief'}
            </button>
          ))}
        </div>
        {view === 'belief' && <p className="mt-1 text-xs text-violet-300">Water as HQ knows it: stale and only near reports.</p>}
      </div>
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Camera · {camera.mode}</p>
        <div className="grid grid-cols-3 gap-1">
          <button type="button" onClick={overview} className="rounded bg-slate-700 py-1 hover:bg-slate-600" title="Esc">
            Overview
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && focus(selected)}
            className="rounded bg-slate-700 py-1 hover:bg-slate-600 disabled:opacity-40"
          >
            Focus
          </button>
          <button
            type="button"
            disabled={!canFollow}
            onClick={() => selected && follow(selected)}
            className="rounded bg-slate-700 py-1 hover:bg-slate-600 disabled:opacity-40"
            title="F"
          >
            Follow
          </button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Overlays</p>
        <div className="flex flex-col gap-0.5">
          {OVERLAYS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={overlays[o.key]} onChange={() => toggle(o.key)} className="accent-sky-500" />
              {o.label}
            </label>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Click to select · double-click to focus/follow · drag to orbit · right-drag to pan · wheel to zoom
      </p>
    </section>
  );
}
