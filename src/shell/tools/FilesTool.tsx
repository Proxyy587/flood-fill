'use client';

import { Download, FolderOpen, Save, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ScenarioSchema } from '../../contracts/schemas';
import { AUTOSAVE_KEY, restoreCity } from '../../editor/autosave';
import { citySlot, downloadCity, parseCity, type SavedCity } from '../../editor/persistence';
import { useEditorStore } from '../../ui/store/editorStore';
import { Flyout } from '../primitives';
import styles from '../shell.module.css';

export function FilesTool({ onClose, onTemplate }: { onClose: () => void; onTemplate: (id: string) => void }) {
  const { scenario, params, mode, load } = useEditorStore();
  const file = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState('slot-1');
  const [recovery, setRecovery] = useState<SavedCity | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const locked = mode !== 'edit';

  useEffect(() => {
    let active = true;
    void citySlot('read', AUTOSAVE_KEY)
      .then((v) => active && setRecovery(v))
      .catch(() => {});
    void fetch('/api/templates')
      .then((r) => r.json())
      .then((v: unknown) => {
        if (active && Array.isArray(v)) setTemplates(v.filter((x): x is { id: string; name: string } => typeof x === 'object' && x !== null && typeof x.id === 'string' && typeof x.name === 'string'));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const restore = restoreCity;
  const safely = async (action: () => Promise<string>) => {
    try {
      setMessage({ text: await action() });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), bad: true });
    }
  };

  return (
    <Flyout title="Files" subtitle="Cities are saved in this browser. Everything here is synthetic." onClose={onClose}>
      <label className={`${styles.field}`}>
        City name
        <input
          className={styles.input}
          disabled={locked}
          value={scenario?.name ?? ''}
          onChange={(e) => scenario && useEditorStore.setState((s) => ({ scenario: { ...scenario, name: e.target.value }, revision: s.revision + 1 }))}
        />
      </label>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Save slots</div>
        <select className={styles.select} value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Save slot">
          {[1, 2, 3].map((n) => (
            <option value={`slot-${n}`} key={n}>
              Slot {n}
            </option>
          ))}
        </select>
        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.button} ${styles.grow}`}
            disabled={!scenario}
            onClick={() =>
              void safely(async () => {
                if (scenario) await citySlot('write', slot, { scenario, params });
                return `Saved to ${slot.replace('slot-', 'slot ')}.`;
              })
            }
          >
            <Save size={14} /> Save
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.grow}`}
            disabled={locked}
            onClick={() =>
              void safely(async () => {
                const saved = await citySlot('read', slot);
                if (!saved) throw new Error('That slot is empty.');
                restore(saved);
                return `Opened ${saved.scenario.name}.`;
              })
            }
          >
            <FolderOpen size={14} /> Open
          </button>
        </div>
        <p className={styles.hint}>While you build, the city also autosaves every 30 seconds.</p>
      </div>

      {recovery && (
        <div className={styles.note}>
          Last session: <b>{recovery.scenario.name}</b>
          <div className={styles.row} style={{ marginTop: 8 }}>
            <button
              type="button"
              className={styles.button}
              disabled={locked}
              onClick={() => {
                restore(recovery);
                setRecovery(null);
              }}
            >
              Recover
            </button>
            <button type="button" className={styles.button} onClick={() => setRecovery(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className={styles.group}>
        <div className={styles.groupTitle}>JSON</div>
        <div className={styles.row}>
          <button type="button" className={`${styles.button} ${styles.grow}`} disabled={!scenario} onClick={() => scenario && downloadCity({ scenario, params })}>
            <Download size={14} /> Download
          </button>
          <button type="button" className={`${styles.button} ${styles.grow}`} disabled={locked} onClick={() => file.current?.click()}>
            <Upload size={14} /> Import
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          aria-label="Import city JSON"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void safely(async () => {
              if (f.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB.');
              restore(parseCity(await f.text()));
              return `Imported ${f.name}.`;
            });
            e.target.value = '';
          }}
        />
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Start from a template</div>
        <ul className={styles.list}>
          {[{ id: 'demo:riverside', name: 'Riverside test city' }, { id: 'demo:stress', name: 'Riverside, everything fails at minute 10' }, ...templates].map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={styles.listItem}
                disabled={locked}
                onClick={() => {
                  if (t.id.startsWith('demo:')) {
                    onTemplate(t.id);
                    setMessage({ text: `Opened ${t.name}.` });
                    return;
                  }
                  void safely(async () => {
                    const r = await fetch(`/api/templates?id=${encodeURIComponent(t.id)}`);
                    if (!r.ok) throw new Error('That template could not be loaded.');
                    load(ScenarioSchema.parse(await r.json()));
                    return `Opened ${t.name}.`;
                  });
                }}
              >
                <span>
                  <strong>{t.name}</strong>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {message && (
        <p className={message.bad ? styles.note : styles.hint} role={message.bad ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </Flyout>
  );
}
