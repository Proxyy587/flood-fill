'use client';

import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSceneStore } from '../../bridge/sceneStore';
import type { SimBridge } from '../../bridge/SimBridge';
import { useSimFeedStore } from '../../bridge/simFeedStore';
import type { SimEvent } from '../../contracts';
import { clockOf, EVENT_GROUPS, eventTitle, HEADLINES } from '../city';
import { Flyout } from '../primitives';
import styles from '../shell.module.css';

const TONE_COLOR = { info: 'var(--blue)', warn: '#e8a317', bad: 'var(--danger)', good: 'var(--green)' } as const;

/** Moves the camera to whatever an event is about. */
export const focusEvent = (e: SimEvent): void => {
  const st = useSceneStore.getState();
  if (e.actor !== undefined && e.actorKind) {
    const ref = { kind: e.actorKind, id: e.actor as number };
    if (ref.kind === 'building') st.focus(ref);
    else st.follow(ref);
    return;
  }
  if (e.cell !== undefined) st.focus({ kind: 'cell', id: e.cell });
};

export function LogTool({ bridge, onClose }: { bridge: SimBridge; onClose: () => void }) {
  const events = useSimFeedStore((s) => s.events);
  const [group, setGroup] = useState('key');
  const shown = useMemo(() => {
    const g = EVENT_GROUPS.find((x) => x.id === group);
    const keep = group === 'key' ? (e: SimEvent) => !!HEADLINES[e.type] : group === 'all' ? () => true : (e: SimEvent) => !!g?.types.includes(e.type);
    const out: SimEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 120; i--) if (keep(events[i])) out.push(events[i]);
    return out;
  }, [events, group]);

  const exportLog = async () => {
    const summary = await bridge.exportLog();
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${summary.scenario}-seed${summary.seed}-run.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Flyout title="What happened" subtitle="Every decision in the run, with its reason. Click one to look at it." onClose={onClose}>
      <div className={styles.chips} role="group" aria-label="Filter events">
        {[{ id: 'key', label: 'Key moments' }, ...EVENT_GROUPS, { id: 'all', label: 'Everything' }].map((g) => (
          <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className={styles.hint}>Nothing yet. Start the storm and events will collect here.</p>
      ) : (
        <ol className={styles.list}>
          {shown.map((e, i) => {
            const tone = HEADLINES[e.type]?.tone ?? 'info';
            return (
              <li key={`${e.tick}-${i}`}>
                <button type="button" className={styles.listItem} onClick={() => focusEvent(e)} disabled={e.cell === undefined && e.actor === undefined}>
                  <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: TONE_COLOR[tone], flex: 'none' }} />
                  <span>
                    <strong>
                      {eventTitle(e)} <span style={{ display: 'inline', fontWeight: 500 }}>· {clockOf(e.tick)}</span>
                    </strong>
                    <span>{e.reason}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <button type="button" className={styles.button} onClick={() => void exportLog()} disabled={!events.length}>
        <Download size={14} /> Download the run log
      </button>
    </Flyout>
  );
}
