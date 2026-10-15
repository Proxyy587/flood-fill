'use client';

import { useMemo } from 'react';
import { useSimFeedStore } from '../bridge/simFeedStore';
import { useEditorStore } from '../ui/store/editorStore';
import { useCityStore, clockOf, eventTitle } from './city';
import { focusEvent } from './tools/LogTool';
import { selectDecisionEntries } from './decisionEvents';
import styles from './shell.module.css';

/** Compact run overlay showing actual decisions and outcomes emitted by the simulation worker. */
export function DecisionPanel() {
  const mode = useEditorStore((state) => state.mode);
  const events = useSimFeedStore((state) => state.events);
  const names = useCityStore((state) => state.names);
  const decisions = useMemo(() => selectDecisionEntries(events), [events]);

  if (mode !== 'run') return null;

  return (
    <section className={`${styles.panel} ${styles.decisionPanel}`} aria-labelledby="decision-panel-title">
      <header className={styles.decisionHead}>
        <div>
          <h2 id="decision-panel-title">Response decisions</h2>
          <p>Live choices from the simulation</p>
        </div>
        <span className={styles.decisionCount}>{decisions.length}</span>
      </header>
      {decisions.length === 0 ? (
        <p className={styles.decisionEmpty}>No response decisions yet. They’ll appear here as the simulation reacts.</p>
      ) : (
        <ol className={styles.decisionList}>
          {decisions.map(({ event, key }) => {
            const targetName = event.targetKind === 'building' && event.target !== undefined
              ? names[event.target as number]
              : undefined;
            const canFocus = event.actor !== undefined || event.cell !== undefined;

            return (
              <li key={key}>
                <button type="button" className={styles.decisionItem} onClick={() => focusEvent(event)} disabled={!canFocus}>
                  <time>{clockOf(event.tick)}</time>
                  <span className={styles.decisionCopy}>
                    <strong>{eventTitle(event)}</strong>
                    <span>{event.reason}</span>
                    {targetName && (
                      <small>{event.type === 'HOSPITAL_ASSIGN' || event.type === 'HOSPITAL_DIVERT' ? 'Hospital' : 'Destination'}: {targetName}</small>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
