'use client';

import { CloudRain, GitBranch, LifeBuoy, Pause, Play, Radio, RotateCcw, StepBack, StepForward } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneStore } from '../bridge/sceneStore';
import type { SimBridge } from '../bridge/SimBridge';
import { useSimFeedStore } from '../bridge/simFeedStore';
import { useEditorStore } from '../ui/store/editorStore';
import { clockOf, elapsed, eventTitle, formatTimeOfDay, HEADLINES } from './city';
import styles from './shell.module.css';

const VW = 1000;
const VH = 36;
const TONE = { info: '#1e6fd9', warn: '#e8a317', bad: '#d93a2b', good: '#1f9d63' } as const;
const RESCUE_TEAMS = 3;
const MINUTE = 60;
const SEEK_DRAG_MS = 80;

/** Snapping speed stops (sim seconds per wall second). */
export const SPEED_STOPS = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const;
export type SpeedStop = (typeof SPEED_STOPS)[number];

const nearestStop = (value: number): SpeedStop => {
  let best: SpeedStop = SPEED_STOPS[0];
  let bestDist = Math.abs(value - best);
  for (const stop of SPEED_STOPS) {
    const dist = Math.abs(value - stop);
    if (dist < bestDist) {
      best = stop;
      bestDist = dist;
    }
  }
  return best;
};

/**
 * Bottom transport: run controls plus the storm timeline. The bar window grows
 * with the live edge so early scrubbing stays precise on long (24 h) runs.
 */
export function Transport({ bridge, onPlay, onRestart, onBranch }: { bridge: SimBridge; onPlay: () => void; onRestart: () => void; onBranch: () => void }) {
  const playing = useSceneStore((s) => s.playing);
  const speed = useSceneStore((s) => s.speed);
  const tick = useSceneStore((s) => s.tick);
  const maxTicks = useSceneStore((s) => s.maxTicks);
  const liveTick = useSceneStore((s) => s.liveTick);
  const busy = useSceneStore((s) => s.busy);
  const engine = useSceneStore((s) => s.engine);
  const dayStart = useSceneStore((s) => s.runSettings.startSeconds);
  const loading = useSceneStore((s) => s.connection !== 'ready');
  const mode = useEditorStore((s) => s.mode);
  const rain = useEditorStore((s) => s.scenario?.weather.rain);
  const events = useSimFeedStore((s) => s.events);
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pointerId = useRef<number | null>(null);
  const pendingTarget = useRef<number | null>(null);
  const lastDragSeek = useRef(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; label: string } | null>(null);
  const running = mode !== 'edit';
  const seed = useSceneStore((s) => s.seed);
  const over = maxTicks > 0 && tick >= maxTicks;
  const replaying = running && tick < liveTick;
  const snapped = nearestStop(speed);
  const speedIndex = Math.max(0, SPEED_STOPS.indexOf(snapped));

  const rainEnd = rain?.length ? rain[rain.length - 1]!.t : 0;
  const cap = maxTicks > 0 ? maxTicks : Math.max(3_600, rainEnd);
  const focus = scrub ?? tick;
  // Growing window: keep ~30 min of headroom past the live edge so the playhead
  // is not crushed to the left on a 24 h storm.
  const total = Math.min(cap, Math.max(30 * MINUTE, liveTick + 30 * MINUTE, focus + 15 * MINUTE, Math.min(rainEnd || 30 * MINUTE, cap)));

  const X = (t: number) => (Math.min(total, Math.max(0, t)) / Math.max(1, total)) * VW;

  const hyeto = useMemo(() => {
    if (!rain?.length) return '';
    const pts = rain.map((p) => `${X(p.t).toFixed(1)},${(VH - p.intensity * (VH - 6)).toFixed(1)}`);
    const last = rain[rain.length - 1]!;
    return `M0,${VH} L0,${(VH - rain[0]!.intensity * (VH - 6)).toFixed(1)} L${pts.join(' L')} L${VW},${(VH - last.intensity * (VH - 6)).toFixed(1)} L${VW},${VH} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- X closes over total
  }, [rain, total]);

  const marks = useMemo(() => {
    const out: { x: number; tone: keyof typeof TONE; label: string; t: number }[] = [];
    const used = new Set<number>();
    for (const e of events) {
      const h = HEADLINES[e.type];
      if (!h || e.type === 'WEATHER' || e.tick > total) continue;
      const x = Math.round(X(e.tick) / 6);
      if (used.has(x)) continue;
      used.add(x);
      out.push({ x: X(e.tick), tone: h.tone, label: eventTitle(e), t: e.tick });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, total]);

  // Hold the playhead on the scrub/seek target until the worker view catches up.
  useEffect(() => {
    const target = pendingTarget.current;
    if (target === null || dragging.current) return;
    if (Math.abs(tick - target) <= 12) {
      pendingTarget.current = null;
      setScrub(null);
    }
  }, [tick]);

  const tickAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total);
  };

  const seekTo = (t: number, opts?: { optimistic?: boolean }) => {
    const target = Math.max(0, Math.min(cap, Math.floor(t)));
    pendingTarget.current = target;
    setScrub(target);
    if (opts?.optimistic !== false) useSceneStore.setState({ tick: target, playing: false });
    bridge.seek(target);
  };

  const setSpeed = (n: SpeedStop) => {
    useSceneStore.setState({ speed: n });
    bridge.setSpeed(n);
  };

  const jump = (delta: number) => {
    if (!running || loading) return;
    if (playing) bridge.pause();
    seekTo((pendingTarget.current ?? tick) + delta);
  };

  const finishDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    pointerId.current = null;
    const t = pendingTarget.current ?? scrub ?? tick;
    seekTo(t);
  };

  const shown = scrub ?? tick;

  return (
    <div className={`${styles.panel} ${styles.transport}`} role="group" aria-label="Storm controls">
      <div className={styles.transportTop}>
        <button type="button" className={styles.play} data-live={playing} onClick={onPlay} title="Space" disabled={loading}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {loading ? 'Loading…' : playing ? 'Pause' : !running || over ? 'Start' : 'Resume'}
        </button>

        <div className={styles.clock} title={`${tick} simulated seconds · seed ${seed}`}>
          <strong>{clockOf(shown)}</strong>
          <span>{!running ? `Starts ${formatTimeOfDay(dayStart)}` : `${replaying ? 'Replay · ' : ''}${elapsed(shown)} · #${seed}`}</span>
        </div>

        <label className={styles.speedControl} title={`${snapped}× simulated seconds per wall second`}>
          <span className={styles.speedValue}>{snapped}×</span>
          <input
            type="range"
            min={0}
            max={SPEED_STOPS.length - 1}
            step={1}
            value={speedIndex}
            disabled={loading}
            aria-label="Simulation speed"
            onInput={(e) => setSpeed(SPEED_STOPS[Number((e.target as HTMLInputElement).value)] ?? 1)}
            onChange={(e) => setSpeed(SPEED_STOPS[Number(e.target.value)] ?? 1)}
          />
        </label>

        <div className={styles.transportActions}>
          {running && (
            <>
              <button type="button" className={styles.iconButton} disabled={loading || !!busy && !replaying} onClick={() => jump(-10 * MINUTE)} title="Back 10 minutes" aria-label="Back 10 minutes">
                <StepBack size={15} />
              </button>
              <button type="button" className={styles.iconButton} disabled={loading || over} onClick={() => jump(10 * MINUTE)} title="Forward 10 minutes" aria-label="Forward 10 minutes">
                <StepForward size={15} />
              </button>
            </>
          )}
          {replaying && !busy && (
            <button type="button" className={styles.button} onClick={() => seekTo(liveTick)} title="Jump to the furthest simulated moment">
              <Radio size={14} /> Live
            </button>
          )}
          {running && (
            <>
              <button
                type="button"
                className={`${styles.button} ${styles.rescue}`}
                disabled={over || !!busy || replaying || engine === 'core'}
                onClick={() => bridge.inject({ t: tick, kind: 'rescue_teams_deployed', count: RESCUE_TEAMS })}
                aria-label="Release rescue teams"
                title={
                  engine === 'core'
                    ? 'Dynamic release is not supported on Core; configured boats dispatch automatically from the simulation.'
                    : `Release ${RESCUE_TEAMS} SDRF boat teams`
                }
              >
                <LifeBuoy size={14} />
                <span className={styles.rescueLabel}>Rescue</span>
              </button>
              <button type="button" className={styles.iconButton} onClick={onRestart} title="Restart the storm (same seed)" aria-label="Restart">
                <RotateCcw size={15} />
              </button>
              <button type="button" className={styles.iconButton} onClick={onBranch} title="Branch the city and edit" aria-label="Branch and edit">
                <GitBranch size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      <div
        ref={bar}
        className={styles.timeline}
        data-disabled={!running}
        data-busy={!!busy}
        onPointerDown={(e) => {
          if (!running || loading || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (playing) bridge.pause();
          dragging.current = true;
          pointerId.current = e.pointerId;
          bar.current?.setPointerCapture(e.pointerId);
          const t = tickAt(e.clientX);
          pendingTarget.current = t;
          setScrub(t);
          useSceneStore.setState({ tick: t, playing: false });
        }}
        onPointerMove={(e) => {
          const t = tickAt(e.clientX);
          const r = bar.current?.getBoundingClientRect();
          if (r) {
            const near = marks.find((m) => Math.abs(m.t - t) < total / 100);
            setHover({ x: e.clientX - r.left, label: near ? `${near.label} · ${clockOf(near.t)}` : clockOf(t) });
          }
          if (!dragging.current || pointerId.current !== e.pointerId) return;
          pendingTarget.current = t;
          setScrub(t);
          useSceneStore.setState({ tick: t });
          // Live reverse scrub through recorded frames; forward waits for release
          // so we do not restart catch-up on every pixel.
          const now = performance.now();
          if (t <= liveTick && now - lastDragSeek.current >= SEEK_DRAG_MS) {
            lastDragSeek.current = now;
            bridge.seek(t);
          }
        }}
        onPointerUp={(e) => {
          if (pointerId.current !== e.pointerId) return;
          try {
            bar.current?.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
          finishDrag();
        }}
        onPointerCancel={(e) => {
          if (pointerId.current !== e.pointerId) return;
          finishDrag();
        }}
        onLostPointerCapture={() => {
          if (dragging.current) finishDrag();
        }}
        onPointerLeave={() => {
          if (!dragging.current) setHover(null);
        }}
        aria-label={running ? 'Storm timeline. Drag to scrub; release past the live edge to simulate ahead.' : 'Storm rain profile'}
      >
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden>
          <line x1={0} x2={VW} y1={VH - 0.5} y2={VH - 0.5} stroke="rgba(21,35,45,0.15)" vectorEffect="non-scaling-stroke" />
          <path d={hyeto} fill="rgba(30,111,217,0.14)" stroke="rgba(30,111,217,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {running && <rect x={0} y={0} width={X(liveTick)} height={VH} fill="rgba(21,35,45,0.06)" />}
          {running && <rect x={0} y={0} width={X(shown)} height={VH} fill="rgba(30,111,217,0.12)" />}
          {marks.map((m, i) => (
            <line key={i} x1={m.x} x2={m.x} y1={2} y2={VH} stroke={TONE[m.tone]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
          {running && <line x1={X(shown)} x2={X(shown)} y1={0} y2={VH} stroke="#15232d" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        </svg>
        {running && <span className={styles.playhead} style={{ left: `${(X(shown) / VW) * 100}%` }} />}
        {hover && (
          <span className={styles.timelineTip} style={{ left: hover.x }}>
            {hover.label}
          </span>
        )}
        {busy && (
          <span className={styles.timelineLabel} role="status">
            {busy.label} · {Math.round(busy.progress * 100)}%
          </span>
        )}
        {!running && (
          <span className={styles.timelineLabel}>
            <CloudRain size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            Rain over the next {cap >= 3600 ? `${Math.round(cap / 3600)} h` : `${Math.round(cap / 60)} min`} — press Start to scrub
          </span>
        )}
        {running && !busy && (
          <span className={styles.timelineScale} aria-hidden>
            0 – {clockOf(total)}
          </span>
        )}
      </div>
    </div>
  );
}
