'use client';

import { Car, Droplets, Eye, Map as MapIcon, Users, Waves, Zap, type LucideIcon } from 'lucide-react';
import { useSceneStore, type Lens, type Overlays } from '../../bridge/sceneStore';
import { LENSES, type LensSpec } from '../../render/lenses';
import { Flyout, Segmented, Switch } from '../primitives';
import styles from '../shell.module.css';

const ICONS: Record<Lens, LucideIcon> = { none: MapIcon, people: Users, traffic: Car, depth: Waves, exposure: Droplets, power: Zap };

const hex = (n: number, a = 1) => `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;

export function LensLegend({ spec }: { spec: LensSpec }) {
  if (spec.categorical) {
    return (
      <div className={styles.legend}>
        <div className={styles.bands} style={{ gridTemplateColumns: `repeat(${spec.stops.length}, 1fr)` }}>
          {spec.stops.map(([, c, a], i) => (
            <span key={i} style={{ background: hex(c, Math.max(0.35, a)) }} />
          ))}
        </div>
        <div className={styles.ticks} style={{ display: 'grid', gridTemplateColumns: `repeat(${spec.ticks.length}, 1fr)` }}>
          {spec.ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    );
  }
  const gradient = spec.stops.map(([t, c, a]) => `${hex(c, Math.max(0.12, a))} ${Math.round(t * 100)}%`).join(', ');
  return (
    <div className={styles.legend}>
      <div className={styles.ramp} style={{ background: `linear-gradient(90deg, ${gradient})` }} />
      <div className={styles.ticks}>
        {spec.ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

const OVERLAY_LABELS: [keyof Overlays, string][] = [
  ['labels', 'Place names and civic pins'],
  ['reports', 'Incident report rings'],
  ['routes', 'Route of the selection'],
  ['signals', 'Traffic signals'],
  ['rain', 'Rain'],
  ['shadows', 'Shadows'],
];

export function LensTool({ onClose }: { onClose: () => void }) {
  const lens = useSceneStore((s) => s.lens);
  const setLens = useSceneStore((s) => s.setLens);
  const view = useSceneStore((s) => s.view);
  const setView = useSceneStore((s) => s.setView);
  const overlays = useSceneStore((s) => s.overlays);
  const toggle = useSceneStore((s) => s.toggleOverlay);
  const options: { id: Lens; label: string; caption: string }[] = [
    { id: 'none', label: 'City', caption: 'The plain map, no analysis.' },
    ...(Object.entries(LENSES) as [Exclude<Lens, 'none'>, LensSpec][]).map(([id, spec]) => ({ id, label: spec.label, caption: spec.caption })),
  ];
  return (
    <Flyout title="Lenses" subtitle="Grey out the city and paint one measure over it." onClose={onClose}>
      <ul className={styles.list}>
        {options.map((o) => {
          const Icon = ICONS[o.id];
          return (
            <li key={o.id}>
              <button type="button" className={styles.listItem} aria-pressed={lens === o.id} onClick={() => setLens(o.id)}>
                <span className={styles.listIcon}>
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{o.label}</strong>
                  <span>{o.caption}</span>
                </span>
              </button>
              {lens === o.id && o.id !== 'none' && <LensLegend spec={LENSES[o.id]} />}
            </li>
          );
        })}
      </ul>

      <div className={styles.group}>
        <div className={styles.groupTitle}>
          <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>Water shown</span>
        </div>
        <Segmented
          label="Water view"
          value={view}
          onChange={setView}
          options={[
            { id: 'truth', label: <><Eye size={14} /> What is true</> },
            { id: 'belief', label: 'What HQ believes' },
          ]}
        />
        <p className={styles.hint}>HQ only knows what reports have told it, and some reports are late or wrong.</p>
      </div>

      <div>
        {OVERLAY_LABELS.map(([key, label]) => (
          <Switch key={key} label={label} checked={overlays[key]} onChange={() => toggle(key)} />
        ))}
      </div>
    </Flyout>
  );
}
