import type { Scenario } from '../contracts';
import { useEditorStore } from '../ui/store/editorStore';
import { citySlot, type SavedCity } from './persistence';

export const AUTOSAVE_KEY = 'autosave';
export const AUTOSAVE_MS = 30_000;

/** Offer a recovery only when the autosaved city differs from what is already open. */
export function worthRecovering(saved: SavedCity | null, current: Scenario | null): saved is SavedCity {
  if (!saved) return false;
  return !current || JSON.stringify(saved.scenario) !== JSON.stringify(current);
}

interface AutosaveDeps {
  write: (v: SavedCity) => Promise<unknown>;
  every: number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearTimer: (id: ReturnType<typeof setInterval>) => void;
}

const browserDeps: AutosaveDeps = {
  write: (v) => citySlot('write', AUTOSAVE_KEY, v),
  every: AUTOSAVE_MS,
  setTimer: (fn, ms) => setInterval(fn, ms),
  clearTimer: (id) => clearInterval(id),
};

/**
 * Saves the editor city every 30 s while in edit mode, but only after it changed,
 * so opening the app never overwrites the previous session before it can be recovered.
 */
export function startAutosave(deps: Partial<AutosaveDeps> = {}): () => void {
  const d = { ...browserDeps, ...deps };
  let saved = useEditorStore.getState().revision;
  const id = d.setTimer(() => {
    const s = useEditorStore.getState();
    if (s.mode !== 'edit' || !s.scenario || s.revision === saved) return;
    saved = s.revision;
    void d.write({ scenario: s.scenario, params: s.params }).catch(() => {});
  }, d.every);
  return () => d.clearTimer(id);
}

export function restoreCity(v: SavedCity): void {
  useEditorStore.setState({ params: v.params });
  useEditorStore.getState().load(v.scenario);
}
