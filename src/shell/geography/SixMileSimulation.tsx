'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_START_SECONDS } from '../../contracts';
import { useSceneStore } from '../../bridge/sceneStore';
import { AUTOSAVE_KEY } from '../../editor/autosave';
import { createSixMile } from '../../editor/geography/sixMile';
import { citySlot } from '../../editor/persistence';
import { useEditorStore } from '../../ui/store/editorStore';
import { FloodSimApp } from '../FloodSimApp';
import { CloudWipe, peekCloudEnter, takeCloudEnter, type WipePhase } from './CloudWipe';

/** Additive adapter: waits for the shell's initial worker handshake, then loads the district. */
export function SixMileSimulation() {
  const loaded = useRef(false);
  const [wipe, setWipe] = useState<WipePhase>(() => (peekCloudEnter() ? 'holding' : 'idle'));

  useEffect(() => {
    if (wipe === 'holding') takeCloudEnter();
  }, [wipe]);

  useEffect(() => {
    loaded.current = false;
    useSceneStore.getState().setRunSettings({ engine: 'preview', startSeconds: DEFAULT_START_SECONDS });
    useSceneStore.setState({ speed: 16 });
    const apply = () => {
      const { scenario } = createSixMile();
      const params = useEditorStore.getState().params;
      useEditorStore.getState().load(scenario);
      void citySlot('write', AUTOSAVE_KEY, { scenario, params }).catch(() => {});
    };
    const load = () => {
      if (useSceneStore.getState().connection !== 'ready') return;
      if (loaded.current) return;
      loaded.current = true;
      apply();
    };
    const off = useSceneStore.subscribe(load);
    load();
    return () => off();
  }, []);

  useEffect(() => {
    if (wipe !== 'holding') return;
    let done = false;
    const tryReveal = () => {
      if (done) return;
      const st = useSceneStore.getState();
      const city = useEditorStore.getState().scenario?.name ?? '';
      if (st.connection !== 'ready' || !city.includes('Six Mile')) return;
      done = true;
      window.setTimeout(() => setWipe('revealing'), 320);
    };
    tryReveal();
    const offScene = useSceneStore.subscribe(tryReveal);
    const offEditor = useEditorStore.subscribe(tryReveal);
    return () => {
      offScene();
      offEditor();
    };
  }, [wipe]);

  const onRevealed = useCallback(() => setWipe('idle'), []);

  return (
    <>
      <CloudWipe phase={wipe} onRevealed={onRevealed} />
      <FloodSimApp atlasBack />
    </>
  );
}
