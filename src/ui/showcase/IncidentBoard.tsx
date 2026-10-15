'use client';

import { Check, ChevronDown, ChevronUp, Clapperboard } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSceneStore } from '../../bridge/sceneStore';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import type { EntityRef, SimEvent } from '../../contracts';
import { clockOf } from '../../shell/city';
import { cssColor, SHOWCASE, SHOWCASE_COLORS, showcaseOf } from './catalog';
import styles from './showcase.module.css';

/** Wall-clock gap between auto-director cuts, and how long it backs off after the user touches the camera. */
const CUT_MS = 12000;
const HANDS_OFF_MS = 15000;

interface Seen {
  count: number;
  first: number;
  last: SimEvent;
}

/** Where to point the camera for an event: the building it concerns, else its cell. */
const refOf = (e: SimEvent): EntityRef | null => {
  if (e.actorKind === 'building' && e.actor !== undefined && (e.type === 'CAMP_OPENED' || e.type === 'HOSPITAL_DIVERSION_ON' || e.type === 'SHELTER_OVERFLOW')) return { kind: 'building', id: e.actor };
  return e.cell !== undefined ? { kind: 'cell', id: e.cell } : null;
};

/**
 * Judge-facing checklist of the storm's set pieces: which have happened, when
 * and how often. Rows fly the camera there; the auto-director cuts to each
 * major new incident on its own, backing off while the user drives.
 */
export function IncidentBoard() {
  const events = useSimFeedStore((s) => s.events);
  const [open, setOpen] = useState(false);
  const [director, setDirector] = useState(true);

  const seen = useMemo(() => {
    const map = new Map<string, Seen>();
    for (const e of events) {
      const entry = showcaseOf(e);
      if (!entry) continue;
      const s = map.get(entry.id);
      if (s) {
        s.count++;
        s.last = e;
      } else map.set(entry.id, { count: 1, first: e.tick, last: e });
    }
    return map;
  }, [events]);

  useEffect(() => {
    if (!director) return;
    let lastCut = 0;
    let lastTouch = 0;
    const shown = new Set<string>();
    const touch = (ev: Event) => {
      if (ev.target instanceof Element && ev.target.closest('[data-director-ignore]')) return;
      lastTouch = performance.now();
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('wheel', touch, { passive: true });
    let count = useSimFeedStore.getState().events.length;
    const off = useSimFeedStore.subscribe((s) => {
      if (s.events.length < count) shown.clear();
      const fresh = s.events.slice(count);
      count = s.events.length;
      const scene = useSceneStore.getState();
      const now = performance.now();
      if (!scene.playing || fresh.length > 200 || now - lastCut < CUT_MS || now - lastTouch < HANDS_OFF_MS || scene.camera.mode === 'follow') return;
      let pick: SimEvent | null = null;
      for (const e of fresh) {
        const entry = showcaseOf(e);
        if (!entry?.major || !refOf(e)) continue;
        if (!shown.has(entry.id)) {
          pick = e;
          break;
        }
        pick ??= e;
      }
      if (!pick) return;
      const entry = showcaseOf(pick);
      if (entry) shown.add(entry.id);
      lastCut = now;
      const ref = refOf(pick);
      if (ref) scene.focus(ref);
    });
    return () => {
      off();
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('wheel', touch);
    };
  }, [director]);

  const done = SHOWCASE.filter((s) => seen.has(s.id)).length;

  return (
    <section className={styles.board} aria-label="Incident board" data-director-ignore>
      <header className={styles.head}>
        <button type="button" className={styles.title} onClick={() => setOpen(!open)} aria-expanded={open}>
          <span>Incidents</span>
          <small>
            {done} / {SHOWCASE.length} seen
          </small>
          {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
        <button
          type="button"
          className={styles.director}
          aria-pressed={director}
          onClick={() => setDirector(!director)}
          title="Auto-director: the camera cuts to each major new incident (pauses while you move the camera)"
        >
          <Clapperboard size={13} aria-hidden />
          Auto
        </button>
      </header>
      <div className={styles.progress} aria-hidden>
        <i style={{ width: `${(done / SHOWCASE.length) * 100}%` }} />
      </div>
      {open && (
        <ol className={styles.list}>
          {SHOWCASE.map((entry) => {
            const s = seen.get(entry.id);
            const ref = s ? refOf(s.last) : null;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={!ref}
                  data-seen={!!s}
                  style={{ ['--c' as string]: cssColor(SHOWCASE_COLORS[entry.kind]) }}
                  onClick={() => ref && useSceneStore.getState().focus(ref)}
                  title={s ? s.last.reason : 'Not yet in this run'}
                >
                  <span className={styles.tick}>{s ? <Check size={11} strokeWidth={3} aria-hidden /> : null}</span>
                  <span className={styles.label}>{entry.label}</span>
                  {s && (
                    <span className={styles.meta}>
                      {s.count > 1 && <b>×{s.count}</b>}
                      <time>{clockOf(s.first)}</time>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
