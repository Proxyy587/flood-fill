'use client';

import { useSceneStore } from '../bridge/sceneStore';
import type { SimBridge } from '../bridge/SimBridge';
import { useSimFeedStore } from '../bridge/simFeedStore';
import type { InjectedEventKind } from '../contracts';

const SPEEDS = [1, 4, 16, 64];

const INJECTIONS: { kind: InjectedEventKind; label: string }[] = [
  { kind: 'bridge_closed', label: 'Close bridge' },
  { kind: 'substation_flooded', label: 'Trip substation' },
  { kind: 'helicopter_grounded_wind', label: 'Gale: ground helis' },
  { kind: 'boat_failure', label: 'Boat failure' },
  { kind: 'shelter_overflow', label: 'Shelter full' },
  { kind: 'comms_outage', label: 'Comms outage' },
  { kind: 'false_report', label: 'False reports' },
];

const clock = (tick: number) => {
  const h = Math.floor(tick / 3600);
  const m = Math.floor((tick % 3600) / 60);
  const s = tick % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * Temporary run controls so the scene is demoable on its own.
 * Worker 2's HUD (src/ui/hud) replaces this.
 */
export function DevRunBar({ bridge }: { bridge: SimBridge }) {
  const tick = useSceneStore((s) => s.tick);
  const maxTicks = useSceneStore((s) => s.maxTicks);
  const playing = useSceneStore((s) => s.playing);
  const speed = useSceneStore((s) => s.speed);
  const mode = useSceneStore((s) => s.dispatchMode);
  const weather = useSceneStore((s) => s.weather);
  const fps = useSceneStore((s) => s.fps);
  const seed = useSceneStore((s) => s.seed);
  const lastEvent = useSimFeedStore((s) => s.events[s.events.length - 1]);
  const eventCount = useSimFeedStore((s) => s.events.length);

  return (
    <div className="absolute left-3 top-3 flex max-w-[min(720px,calc(100%-24px))] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-black/65 p-2 text-sm shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => (playing ? bridge.pause() : bridge.play())}
          className="min-w-20 rounded-md bg-sky-600 px-3 py-1.5 font-semibold hover:bg-sky-500"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => bridge.step(1)} className="rounded-md bg-slate-700 px-2 py-1.5 hover:bg-slate-600" title="Step one tick">
          Step
        </button>
        <div className="flex overflow-hidden rounded-md" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => bridge.setSpeed(s)}
              className={`px-2 py-1.5 ${s === speed ? 'bg-sky-700' : 'bg-slate-700 hover:bg-slate-600'}`}
            >
              {s}×
            </button>
          ))}
        </div>
        <select
          aria-label="Dispatch mode"
          value={mode}
          onChange={(e) => bridge.setDispatchMode(e.target.value === 'centralised' ? 'centralised' : 'negotiation')}
          className="rounded-md bg-slate-700 px-2 py-1.5"
        >
          <option value="negotiation">Negotiation</option>
          <option value="centralised">Centralised</option>
        </select>
        <span className="font-mono tabular-nums text-slate-200">
          {clock(tick)} <span className="text-slate-400">t={tick}/{maxTicks}</span>
        </span>
        <span className="text-slate-300">
          rain {(weather.rain * 100).toFixed(0)}% · wind {(weather.wind * 100).toFixed(0)}%
        </span>
        <span className="text-slate-400">seed {seed} · {fps} fps</span>
      </div>
      <input
        type="range"
        aria-label="Seek (replay)"
        min={0}
        max={maxTicks || 1}
        value={tick}
        onChange={(e) => bridge.seek(Number(e.target.value))}
        className="w-full accent-sky-500"
      />
      <details className="rounded-lg bg-black/55 p-2 text-xs">
        <summary className="cursor-pointer select-none text-slate-300">Inject event (stress test)</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {INJECTIONS.map((i) => (
            <button
              key={i.kind}
              type="button"
              onClick={() => bridge.inject({ t: tick, kind: i.kind })}
              className="rounded bg-amber-700/80 px-2 py-1 hover:bg-amber-600"
            >
              {i.label}
            </button>
          ))}
        </div>
      </details>
      {lastEvent && (
        <p className="truncate rounded bg-black/50 px-2 py-1 text-xs text-slate-300" title={lastEvent.reason}>
          <span className="font-mono text-slate-400">#{eventCount} t={lastEvent.tick}</span>{' '}
          <span className="font-semibold text-amber-300">{lastEvent.type}</span> {lastEvent.reason}
        </p>
      )}
    </div>
  );
}
