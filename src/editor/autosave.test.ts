import { beforeEach, describe, expect, it } from 'vitest';
import { BlockType, DEFAULT_NPC_PARAMS } from '../contracts';
import { mockScenario } from '../contracts/mocks';
import { useEditorStore } from '../ui/store/editorStore';
import { startAutosave, worthRecovering } from './autosave';
import type { SavedCity } from './persistence';

function harness() {
  const writes: SavedCity[] = [];
  let tick: () => void = () => {};
  const stop = startAutosave({
    write: async (v) => void writes.push(v),
    setTimer: (fn) => {
      tick = fn;
      return 0 as unknown as ReturnType<typeof setInterval>;
    },
    clearTimer: () => {
      tick = () => {};
    },
  });
  return { writes, tick: () => tick(), stop };
}

describe('autosave', () => {
  beforeEach(() => {
    useEditorStore.setState({ mode: 'edit', params: { ...DEFAULT_NPC_PARAMS } });
    useEditorStore.getState().load(mockScenario());
  });

  it('writes only after the city changed, so a fresh session never overwrites the last one', () => {
    const h = harness();
    h.tick();
    expect(h.writes).toHaveLength(0);
    useEditorStore.setState((s) => ({ revision: s.revision + 1 }));
    h.tick();
    h.tick();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].scenario.name).toBe(useEditorStore.getState().scenario?.name);
    h.stop();
  });

  it('pauses while the storm runs', () => {
    const h = harness();
    useEditorStore.setState((s) => ({ revision: s.revision + 1, mode: 'run' }));
    h.tick();
    expect(h.writes).toHaveLength(0);
    useEditorStore.setState({ mode: 'edit' });
    h.tick();
    expect(h.writes).toHaveLength(1);
    h.stop();
  });

  it('offers recovery only for a different city', () => {
    const current = mockScenario();
    expect(worthRecovering(null, current)).toBe(false);
    expect(worthRecovering({ scenario: current, params: DEFAULT_NPC_PARAMS }, current)).toBe(false);
    const edited = structuredClone(current);
    edited.blocks[0] = BlockType.Road;
    expect(worthRecovering({ scenario: edited, params: DEFAULT_NPC_PARAMS }, current)).toBe(true);
  });
});
