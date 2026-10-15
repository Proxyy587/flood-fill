'use client';

import { CloudRain, GitBranch, LifeBuoy, Pause, Play, Radio, RotateCcw, StepForward } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useSceneStore } from '../bridge/sceneStore';
import type { SimBridge } from '../bridge/SimBridge';
import { useSimFeedStore } from '../bridge/simFeedStore';
import { useEditorStore } from '../ui/store/editorStore';
import { clockOf, elapsed, eventTitle, formatTimeOfDay, HEADLINES } from './city';
import styles from './shell.module.css';

const VW = 1000;
const VH = 40;
const TONE = { info: '#1e6fd9', warn: '#e8a317', bad: '#d93a2b', good: '#1f9d63' } as const;
const RESCUE_TEAMS = 3;

/**
 * Bottom transport: run controls plus the storm timeline, a rain hyetograph
 * with key moments marked. Dragging the playhead back replays recorded
 * frames; dragging past the live edge simulates ahead.
 */
export function Transport({ bridge, onPlay, onRestart, onBranch }: { bridge: SimBridge; onPlay: () => void; onRestart: () => void; onBranch: () => void }) {
  const playing = useSceneStore((s) => s.playing);
  const speed = useSceneStore((s) => s.speed);
  const tick = useSceneStore((s) => s.tick);
  const maxTicks = useSceneStore((s) => s.maxTicks);
  const liveTick = useSceneStore((s) => s.liveTick);
  const busy = useSceneStore((s) => s.busy);
  const dayStart = useSceneStore((s) => s.runSettings.startSeconds);
  const loading = useSceneStore((s) => s.connection !== 'ready');
  const mode = useEditorStore((s) => s.mode);
  const rain = useEditorStore((s) => s.scenario?.weather.rain);
  const events = useSimFeedStore((s) => s.events);
  const bar = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number; label: string } | null>(null);
  const running = mode !== 'edit';
  const total = maxTicks > 0 ? maxTicks : Math.max(3600, ...(rain ?? []).map((p) => p.t));
  const X = (t: number) => (Math.min(total, Math.max(0, t)) / total) * VW;

  const hyeto = useMemo(() => {
    const X = (t: number) => (Math.min(total, Math.max(0, t)) / total) * VW;
    if (!rain?.length) return '';
    const pts = rain.map((p) => `${X(p.t).toFixed(1)},${(VH - p.intensity * (VH - 6)).toFixed(1)}`);
    const last = rain[rain.length - 1];
    return `M0,${VH} L0,${(VH - rain[0].intensity * (VH - 6)).toFixed(1)} L${pts.join(' L')} L${VW},${(VH - last.intensity * (VH - 6)).toFixed(1)} L${VW},${VH} Z`;
  }, [rain, total]);

  const marks = useMemo(() => {
    const X = (t: number) => (Math.min(total, Math.max(0, t)) / total) * VW;
    const out: { x: number; tone: keyof typeof TONE; label: string; t: number }[] = [];
    const used = new Set<number>();
    for (const e of events) {
      const h = HEADLINES[e.type];
      if (!h || e.type === 'WEATHER') continue;
      const x = Math.round(X(e.tick) / 6);
      if (used.has(x)) continue;
      used.add(x);
      out.push({ x: X(e.tick), tone: h.tone, label: eventTitle(e), t: e.tick });
    }
    return out;
  }, [events, total]);

  const tickAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total);
  };
  const shown = scrub ?? tick;
  const seed = useSceneStore((s) => s.seed);
  const over = maxTicks > 0 && tick >= maxTicks;
  const replaying = running && tick < liveTick;

  return (
    <div className={`${styles.panel} ${styles.transport}`} role="group" aria-label="Storm controls">
      <button type="button" className={styles.play} data-live={playing} onClick={onPlay} title="Space" disabled={loading}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
        {loading ? 'Loading city…' : playing ? 'Pause' : !running || over ? 'Start storm' : 'Resume'}
      </button>
      <div className={styles.clock} title={`${tick} simulated seconds · seed ${seed}. The same city and seed replay the same storm.`}>
        <strong>{clockOf(shown)}</strong>
        <span>{!running ? `Day starts ${formatTimeOfDay(dayStart)}` : `${replaying ? 'Replay · ' : ''}${elapsed(shown)} · seed ${seed}`}</span>
      </div>
      <div
        ref={bar}
        className={styles.timeline}
        data-disabled={!running}
        onPointerDown={(e) => {
          if (!running) return;
          bar.current?.setPointerCapture(e.pointerId);
          setScrub(tickAt(e.clientX));
        }}
        onPointerMove={(e) => {
          const t = tickAt(e.clientX);
          const r = bar.current?.getBoundingClientRect();
          const near = marks.find((m) => Math.abs(m.t - t) < total / 120);
          setHover(r ? { x: e.clientX - r.left, t, label: near ? `${near.label} · ${clockOf(near.t)}` : clockOf(t) } : null);
          if (scrub !== null) setScrub(t);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => {
          if (scrub === null) return;
          const t = tickAt(e.clientX);
          setScrub(null);
          if (Math.abs(t - tick) > 2) bridge.seek(t);
        }}
        aria-label={running ? 'Storm timeline. Drag to replay any moment.' : 'Storm rain profile'}
      >
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden>
          <line x1={0} x2={VW} y1={VH - 0.5} y2={VH - 0.5} stroke="rgba(21,35,45,0.15)" vectorEffect="non-scaling-stroke" />
          <path d={hyeto} fill="rgba(30,111,217,0.14)" stroke="rgba(30,111,217,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {running && <rect x={0} y={0} width={X(liveTick)} height={VH} fill="rgba(21,35,45,0.05)" />}
          {running && <rect x={0} y={0} width={X(shown)} height={VH} fill="rgba(21,35,45,0.07)" />}
          {marks.map((m, i) => (
            <line key={i} x1={m.x} x2={m.x} y1={2} y2={VH} stroke={TONE[m.tone]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
          {running && <line x1={X(shown)} x2={X(shown)} y1={0} y2={VH} stroke="#15232d" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        </svg>
        {running && (
          <span
            style={{
              position: 'absolute',
              left: `${(X(shown) / VW) * 100}%`,
              top: -3,
              width: 10,
              height: 10,
              marginLeft: -5,
              borderRadius: 999,
              background: '#15232d',
              boxShadow: '0 0 0 2px #fff',
              pointerEvents: 'none',
            }}
          />
        )}
        {hover && (
          <span
            style={{
              position: 'absolute',
              left: hover.x,
              bottom: 'calc(100% + 10px)',
              transform: 'translateX(-50%)',
              padding: '4px 8px',
              borderRadius: 6,
              background: 'rgba(21,35,45,0.9)',
              color: '#fff',
              fontSize: 11.5,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
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
            Rain over the next {Math.round(total / 60)} minutes
          </span>
        )}
      </div>
      <div className={styles.speeds} role="group" aria-label="Speed">
        {[1, 4, 16].map((n) => (
          <button key={n} type="button" aria-pressed={speed === n} onClick={() => bridge.setSpeed(n)} title={`${n} simulated seconds per second`}>
            {n}×
          </button>
        ))}
      </div>
      {replaying && !busy && (
        <button type="button" className={styles.button} onClick={() => bridge.seek(liveTick)} title="Jump to the furthest simulated moment">
          <Radio size={14} /> Go live
        </button>
      )}
      {running && (
        <>
          <button
            type="button"
            className={`${styles.button} ${styles.rescue}`}
            disabled={over || !!busy || replaying}
            onClick={() => bridge.inject({ t: tick, kind: 'rescue_teams_deployed', count: RESCUE_TEAMS })}
            aria-label="Release rescue teams"
            title={`Release ${RESCUE_TEAMS} SDRF boat teams (a boat and 4 rescuers each) from flood HQ or the boat depot`}
          >
            <LifeBuoy size={14} />
            <span className={styles.rescueLabel}>Release rescue teams</span>
          </button>
          <button type="button" className={styles.iconButton} disabled={playing || over || !!busy} onClick={() => bridge.step(60)} title="Step one minute" aria-label="Step one minute">
            <StepForward size={16} />
          </button>
          <button type="button" className={styles.iconButton} onClick={onRestart} title="Restart the storm (same seed)" aria-label="Restart">
            <RotateCcw size={16} />
          </button>
          <button type="button" className={styles.iconButton} onClick={onBranch} title="Branch the city and edit" aria-label="Branch and edit">
            <GitBranch size={16} />
          </button>
        </>
      )}
    </div>
  );
}
