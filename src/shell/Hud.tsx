'use client';

import { ChevronDown, ChevronUp, Crosshair, Footprints, Minus, Plus, RotateCcw, RotateCw, Scan, Waves, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneStore } from '../bridge/sceneStore';
import { useSimFeedStore } from '../bridge/simFeedStore';
import { BlockType, type MetricsFrame, type SimEvent } from '../contracts';
import { LANDMARK_COLORS } from '../render/palette';
import { LANDMARK_CATEGORY } from '../render/overlays/LandmarkHalos';
import { LENSES } from '../render/lenses';
import { SoundToggle } from '../ui/audio/SoundDirector';
import { ScoreBadge } from '../ui/score/ScoreCard';
import { useEditorStore } from '../ui/store/editorStore';
import { blockName, clockOf, eventTitle, HEADLINES, useCityStore, type Tone } from './city';
import { LensLegend } from './tools/LensTool';
import { focusEvent } from './tools/LogTool';
import styles from './shell.module.css';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

// ---------- identity ----------

export function Identity() {
  const scenario = useEditorStore((s) => s.scenario);
  const mode = useEditorStore((s) => s.mode);
  const playing = useSceneStore((s) => s.playing);
  const tick = useSceneStore((s) => s.tick);
  const maxTicks = useSceneStore((s) => s.maxTicks);
  const status =
    mode === 'edit'
      ? { text: 'Designing', tone: 'design' }
      : maxTicks > 0 && tick >= maxTicks
        ? { text: 'Storm over', tone: 'design' }
        : playing
          ? { text: 'Storm running', tone: 'live' }
          : { text: 'Paused', tone: 'paused' };
  return (
    <div className={`${styles.panel} ${styles.identity}`}>
      <div className={styles.mark} aria-hidden>
        <Waves size={17} />
      </div>
      <div>
        <h1>{scenario?.name ? scenario.name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'FloodSim'}</h1>
        <p>
          FloodSim · {scenario ? `${(scenario.size.w * 4) / 1000} × ${(scenario.size.h * 4) / 1000} km` : 'loading'}
        </p>
      </div>
      <span className={styles.pill} data-tone={status.tone}>
        {status.text}
      </span>
      <SoundToggle className={styles.iconButton} />
    </div>
  );
}

// ---------- vitals ----------

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg className={styles.spark} aria-hidden />;
  const max = Math.max(1e-6, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(17 - (v / max) * 15).toFixed(1)}`).join(' ');
  return (
    <svg className={styles.spark} viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ label, value, unit, tone, series, color = '#5e6e78' }: { label: string; value: string; unit?: string; tone?: 'bad' | 'warn'; series?: number[]; color?: string }) {
  return (
    <div className={styles.tile} data-tone={tone}>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
      <span>{label}</span>
      {series && <Spark values={series} color={color} />}
    </div>
  );
}

function CityFacts() {
  const s = useEditorStore((st) => st.scenario);
  if (!s) return null;
  const sum = (t: BlockType) => s.buildings.filter((b) => b.type === t).reduce((a, b) => a + b.capacity, 0);
  const drains = s.blocks.filter((b) => b === BlockType.Drainage).length;
  return (
    <div className={styles.tiles} style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
      <Tile label="Residents" value={s.population.count.toLocaleString()} />
      <Tile label="Hospital beds" value={String(sum(BlockType.Hospital))} />
      <Tile label="Shelter places" value={String(sum(BlockType.Shelter))} />
      <Tile label="Storm drains" value={String(drains)} />
      <Tile label="Rescue boats" value={String(s.fleet.boats)} />
      <Tile label="Helicopters" value={String(s.fleet.helicopters)} />
    </div>
  );
}

function LiveVitals({ frames }: { frames: MetricsFrame[] }) {
  const scenario = useEditorStore((s) => s.scenario);
  const names = useCityStore((s) => s.names);
  const focus = useSceneStore((s) => s.focus);
  const f = frames[frames.length - 1];
  const recent = frames.slice(-80);
  const cells = scenario ? scenario.size.w * scenario.size.h : 1;
  const flooded = (f.floodedCells / cells) * 100;
  const tts = f.tts.mean / 60;
  return (
    <>
      <div className={styles.tiles} style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Tile label="City flooded" value={flooded.toFixed(flooded < 10 ? 1 : 0)} unit="%" tone={flooded > 15 ? 'bad' : flooded > 5 ? 'warn' : undefined} series={recent.map((m) => m.floodedCells)} color="#1e6fd9" />
        <Tile label="Stranded" value={String(f.stranded)} tone={f.stranded > 20 ? 'bad' : f.stranded > 0 ? 'warn' : undefined} series={recent.map((m) => m.stranded)} color="#d93a2b" />
        <Tile label="Without power" value={f.unpoweredPopPct.toFixed(0)} unit="%" tone={f.unpoweredPopPct > 20 ? 'bad' : f.unpoweredPopPct > 0 ? 'warn' : undefined} series={recent.map((m) => m.unpoweredPopPct)} color="#c98a06" />
        <Tile label="Evacuated" value={f.evacDonePct.toFixed(0)} unit="%" series={recent.map((m) => m.evacDonePct)} color="#1f9d63" />
        <Tile label="Waiting for help" value={String(f.unmet)} tone={f.unmet > 10 ? 'bad' : undefined} series={recent.map((m) => m.unmet)} color="#d93a2b" />
        <Tile label="Time to help" value={tts > 0 ? tts.toFixed(1) : '–'} unit={tts > 0 ? 'min' : undefined} />
      </div>
      {f.hospitals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {f.hospitals.map((h) => {
            const status = h.diversion ? { t: 'Diverting', c: 'var(--danger)' } : h.onGenerator ? { t: 'On generator', c: 'var(--amber)' } : { t: 'Open', c: 'var(--green)' };
            return (
              <button key={h.id} type="button" className={styles.hospital} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => focus({ kind: 'building', id: h.id })}>
                <b>{names[h.id] ?? `Hospital ${h.id}`}</b>
                <em style={{ color: status.c }}>{status.t}</em>
                <span className={styles.meter}>
                  <span style={{ width: `${Math.min(100, h.util * 100)}%`, background: h.util > 0.9 ? 'var(--danger)' : h.util > 0.7 ? '#e8a317' : 'var(--green)' }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function Vitals({ onScore }: { onScore?: () => void }) {
  const frames = useSimFeedStore((s) => s.metrics);
  const mode = useEditorStore((s) => s.mode);
  const tick = useSceneStore((s) => s.tick);
  const weather = useSceneStore((s) => s.weather);
  const selected = useSceneStore((s) => s.selected);
  // Collapsed by default while something is selected, so the inspector has room; a manual toggle sticks per selection.
  const selKey = selected ? `${selected.kind}:${selected.id}` : null;
  const [pref, setPref] = useState<{ open: boolean; key: string | null }>({ open: true, key: null });
  const open = pref.key === selKey ? pref.open : selKey === null;
  const setOpen = (next: boolean) => setPref({ open: next, key: selKey });
  const live = mode !== 'edit' && frames.length > 0;
  return (
    <section className={`${styles.panel} ${styles.vitals}`} aria-label="City vitals">
      <div className={styles.vitalsHead}>
        <h2>{live ? 'City vitals' : 'City at a glance'}</h2>
        <div className={styles.row}>
          {live && (
            <span>
              {clockOf(tick)} · rain {Math.round(weather.rain * 150)} mm/h
            </span>
          )}
          <button type="button" className={styles.iconButton} onClick={() => setOpen(!open)} aria-label={open ? 'Collapse vitals' : 'Expand vitals'} aria-expanded={open}>
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>
      {live && <ScoreBadge onOpen={onScore} />}
      {open && (live ? <LiveVitals frames={frames} /> : <CityFacts />)}
    </section>
  );
}

// ---------- inspector ----------

const humanKey = (k: string) => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase());
const humanValue = (v: number | string) => (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)) : v);

export function Inspector() {
  const selected = useSceneStore((s) => s.selected);
  const data = useSceneStore((s) => s.inspector);
  const select = useSceneStore((s) => s.select);
  const focus = useSceneStore((s) => s.focus);
  const follow = useSceneStore((s) => s.follow);
  const names = useCityStore((s) => s.names);
  const scenario = useEditorStore((s) => s.scenario);
  if (!selected) return null;
  const building = selected.kind === 'building' ? scenario?.buildings.find((b) => b.id === selected.id) : undefined;
  const category = building ? LANDMARK_CATEGORY[building.type] : undefined;
  const title = building ? (names[building.id] ?? data?.title) : selected.kind === 'cell' && scenario ? `${blockName(scenario.blocks[selected.id])} at ${selected.id % scenario.size.w}, ${Math.floor(selected.id / scenario.size.w)}` : (data?.title ?? 'Loading…');
  const kind = building ? blockName(building.type) : selected.kind === 'npc' ? 'Person' : selected.kind === 'vehicle' ? 'Vehicle' : 'Ground';
  const movable = selected.kind === 'npc' || selected.kind === 'vehicle';
  const alts = data?.lastDecision?.alternatives ?? [];
  const best = Math.max(1e-6, ...alts.map((a) => Math.abs(a.score)));
  return (
    <section className={`${styles.panel} ${styles.inspector}`} aria-label="Selection" aria-live="polite">
      <header className={styles.flyoutHead}>
        <div style={{ minWidth: 0 }}>
          <span className={styles.kind}>
            <i style={{ background: category ? hex(LANDMARK_COLORS[category]) : 'var(--faint)' }} />
            {kind}
          </span>
          <h2 style={{ marginTop: 2 }}>{title}</h2>
        </div>
        <div className={styles.row} style={{ gap: 2 }}>
          <button type="button" className={styles.iconButton} title="Look at it (F)" aria-label="Focus" onClick={() => focus(selected)}>
            <Crosshair size={15} />
          </button>
          {movable && (
            <button type="button" className={styles.iconButton} title="Follow" aria-label="Follow" onClick={() => follow(selected)}>
              <Footprints size={15} />
            </button>
          )}
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={() => select(null)}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div className={styles.inspectorBody}>
        {!data && <p className={styles.hint}>Reading the simulation…</p>}
        {data?.lastDecision && (
          <div className={styles.why}>
            <strong>{data.lastDecision.chosen}</strong>
            <p>{data.lastDecision.reason}</p>
            {alts.slice(0, 3).map((a, i) => (
              <div className={styles.alt} key={`${i}-${a.label}`}>
                <span>{a.label}</span>
                <span className={styles.meter} style={{ gridColumn: 'auto' }}>
                  <span style={{ width: `${(Math.abs(a.score) / best) * 100}%`, background: i === 0 ? 'var(--blue)' : '#9fb0bb' }} />
                </span>
                <output>{a.score.toFixed(2)}</output>
              </div>
            ))}
          </div>
        )}
        {data?.assignment && (
          <p className={styles.hint}>
            Answering request {data.assignment.requestId}, {data.assignment.status.replace(/_/g, ' ')}, about {Math.max(1, Math.round(data.assignment.eta / 60))} min away.
          </p>
        )}
        {data && (
          <dl className={styles.attrs}>
            {Object.entries(data.attributes)
              .slice(0, 12)
              .map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{humanKey(k)}</dt>
                  <dd title={String(v)}>{humanValue(v)}</dd>
                </div>
              ))}
          </dl>
        )}
        {data?.route && <p className={styles.hint}>Planned route: {data.route.cells.length * 4} m, shown in blue on the map.</p>}
        {data?.belief && (
          <p className={styles.hint}>
            Knows of {data.belief.knownClosures.length} closed roads; information is {data.belief.staleness} s old.
          </p>
        )}
      </div>
    </section>
  );
}

// ---------- compass ----------

export function Compass() {
  const heading = useSceneStore((s) => s.heading);
  const tilt = useSceneStore((s) => s.tilt);
  const cmd = useSceneStore((s) => s.cameraCommand);
  const overview = useSceneStore((s) => s.overview);
  const preset = tilt < 0.25 ? 'top' : tilt > 1.15 ? 'side' : 'oblique';
  return (
    <nav className={`${styles.panel} ${styles.compass}`} aria-label="Camera">
      <button type="button" className={styles.dial} onClick={() => cmd({ kind: 'north' })} title="Face north" aria-label="Face north">
        <svg viewBox="0 0 44 44" style={{ transform: `rotate(${(heading * 180) / Math.PI}deg)` }} aria-hidden>
          <path d="M22 6 L27 22 L22 20 L17 22 Z" fill="#d93a2b" />
          <path d="M22 38 L27 22 L22 24 L17 22 Z" fill="#c4ccd0" />
          <text x="22" y="5.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="#15232d" dominantBaseline="hanging" transform="translate(0 -4)">
            N
          </text>
        </svg>
      </button>
      <div className={styles.row} style={{ gap: 0 }}>
        <button type="button" className={styles.iconButton} style={{ width: 24 }} title="Rotate left (Q)" aria-label="Rotate left" onClick={() => cmd({ kind: 'rotate', by: -Math.PI / 4 })}>
          <RotateCcw size={14} />
        </button>
        <button type="button" className={styles.iconButton} style={{ width: 24 }} title="Rotate right (E)" aria-label="Rotate right" onClick={() => cmd({ kind: 'rotate', by: Math.PI / 4 })}>
          <RotateCw size={14} />
        </button>
      </div>
      <span className={styles.compassSep} />
      {(
        [
          ['top', 'Top', 'Straight down, like a map'],
          ['oblique', '3D', 'Angled city view'],
          ['side', 'Side', 'Low view across the streets'],
        ] as const
      ).map(([id, label, title]) => (
        <button key={id} type="button" className={styles.iconButton} style={{ fontSize: 11.5, fontWeight: 650 }} aria-pressed={preset === id} title={title} onClick={() => cmd({ kind: 'tilt', preset: id })}>
          {label}
        </button>
      ))}
      <span className={styles.compassSep} />
      <button type="button" className={styles.iconButton} title="Zoom in (+)" aria-label="Zoom in" onClick={() => cmd({ kind: 'zoom', by: 0.7 })}>
        <Plus size={15} />
      </button>
      <button type="button" className={styles.iconButton} title="Zoom out (−)" aria-label="Zoom out" onClick={() => cmd({ kind: 'zoom', by: 1.4 })}>
        <Minus size={15} />
      </button>
      <button type="button" className={styles.iconButton} title="Whole city (H)" aria-label="Show the whole city" onClick={overview}>
        <Scan size={15} />
      </button>
    </nav>
  );
}

// ---------- toasts ----------

interface Toast {
  id: number;
  event: SimEvent;
  tone: Tone;
  count: number;
  born: number;
}

const TOAST_MS = 7000;

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef(0);
  const nextId = useRef(1);
  useEffect(
    () =>
      useSimFeedStore.subscribe((s) => {
        if (s.events.length < seen.current) seen.current = 0;
        const fresh = s.events.slice(seen.current).filter((e) => HEADLINES[e.type]);
        const bulk = s.events.length - seen.current > 400;
        seen.current = s.events.length;
        if (!fresh.length || bulk) return;
        setToasts((prev) => {
          let list = [...prev];
          for (const e of fresh) {
            const same = list.find((t) => t.event.type === e.type && e.tick - t.event.tick < 90);
            if (same) {
              list = list.map((t) => (t === same ? { ...t, event: e, count: t.count + 1, born: performance.now() } : t));
            } else {
              list.push({ id: nextId.current++, event: e, tone: HEADLINES[e.type]?.tone ?? 'info', count: 1, born: performance.now() });
            }
          }
          return list.slice(-3);
        });
      }),
    [],
  );
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setInterval(() => setToasts((l) => l.filter((t) => performance.now() - t.born < TOAST_MS)), 500);
    return () => clearInterval(timer);
  }, [toasts.length]);
  return (
    <div className={styles.toasts} role="log" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`${styles.panel} ${styles.toast}`}
          data-tone={t.tone}
          onClick={() => {
            focusEvent(t.event);
            setToasts((l) => l.filter((x) => x.id !== t.id));
          }}
        >
          <span>
            <strong>
              {eventTitle(t.event)}
              {t.count > 1 ? ` ×${t.count}` : ''}
            </strong>
            <p>{t.event.reason}</p>
          </span>
          <span />
          <time>{clockOf(t.event.tick)}</time>
        </button>
      ))}
    </div>
  );
}

// ---------- hover tip ----------

export function HoverTip() {
  const info = useSceneStore((s) => s.hoverInfo);
  const entity = useSceneStore((s) => s.hoverEntity);
  const names = useCityStore((s) => s.names);
  const scenario = useEditorStore((s) => s.scenario);
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    const down = () => setPressed(true);
    const up = () => setPressed(false);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, []);
  if (!info || pressed || !scenario) return null;
  const what =
    entity?.kind === 'npc'
      ? 'Person'
      : entity?.kind === 'vehicle'
        ? 'Vehicle'
        : entity?.kind === 'building'
          ? (names[entity.id] ?? 'Building')
          : blockName(scenario.blocks[info.cell]);
  return (
    <div className={styles.hoverTip} style={{ left: info.screen.x, top: info.screen.y }}>
      <b>{what}</b>
      <br />
      <span>Ground {info.elevation} m</span>
      {info.depth >= 0.05 && (
        <>
          <span> · </span>
          <em>water {info.depth.toFixed(2)} m</em>
        </>
      )}
    </div>
  );
}

// ---------- lens legend + footer ----------

export function LensCard() {
  const lens = useSceneStore((s) => s.lens);
  const setLens = useSceneStore((s) => s.setLens);
  const spec = useMemo(() => (lens === 'none' ? null : LENSES[lens]), [lens]);
  if (!spec) return null;
  return (
    <section className={`${styles.panel} ${styles.legendCard}`} aria-label={`${spec.label} legend`}>
      <div className={styles.row} style={{ justifyContent: 'space-between' }}>
        <h3>{spec.label}</h3>
        <button type="button" className={styles.iconButton} aria-label="Turn lens off" onClick={() => setLens('none')}>
          <X size={14} />
        </button>
      </div>
      <p>{spec.caption}</p>
      <LensLegend spec={spec} />
    </section>
  );
}

export function Footer() {
  return <p className={styles.footer}>Simulation output; not an emergency-planning authority. Synthetic city, 1 cell = 4 m, heights drawn ×2.</p>;
}
