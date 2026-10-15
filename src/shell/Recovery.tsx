'use client';

import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AUTOSAVE_KEY, restoreCity, worthRecovering } from '../editor/autosave';
import { citySlot, type SavedCity } from '../editor/persistence';
import { useEditorStore } from '../ui/store/editorStore';
import styles from './shell.module.css';

/** Offers the previous session's autosave once, at startup. */
export function RecoveryPrompt() {
  const [saved, setSaved] = useState<SavedCity | null>(null);
  const mode = useEditorStore((s) => s.mode);

  useEffect(() => {
    let active = true;
    void citySlot('read', AUTOSAVE_KEY)
      .then((v) => {
        if (active && worthRecovering(v, useEditorStore.getState().scenario)) setSaved(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!saved || mode !== 'edit') return null;
  return (
    <div className={`${styles.panel} ${styles.recovery}`} role="status">
      <History size={16} />
      <span>
        Pick up where you left off with <b>{saved.scenario.name}</b>?
      </span>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          restoreCity(saved);
          setSaved(null);
        }}
      >
        Recover
      </button>
      <button type="button" className={styles.button} onClick={() => setSaved(null)}>
        Dismiss
      </button>
    </div>
  );
}
