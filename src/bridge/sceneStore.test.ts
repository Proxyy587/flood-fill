import { describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';

describe('simulation defaults', () => {
  it('starts runs on AK core so decisions come from the validated simulator', () => {
    expect(useSceneStore.getState().runSettings.engine).toBe('core');
  });
});
